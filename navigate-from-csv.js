const fs = require("fs");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");
const path = require("path");
const { chromium } = require("playwright");
const userAgents = require("./userAgents");
const { getCountrySettings, getRandomViewport, langMap } = require("./helper");
const os = require("os");

const generalTimeout = 95000;
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const generateSessionId = () =>
	"sess_" + Math.random().toString(36).slice(2, 12);
const vp = getRandomViewport();
const userDataDir = path.join(__dirname, "user_data");
function getOSFamily() {
	const platform = os.platform(); // 'linux' | 'win32' | 'darwin'
	if (platform === "linux") return "linux";
	if (platform === "win32") return "windows";
	if (platform === "darwin") return "mac";
	return "linux"; // fallback
}

function getRandomUA() {
	const osFamily = getOSFamily();
	const pool = userAgents[osFamily];
	return pool[Math.floor(Math.random() * pool.length)];
}

function parseProxyConfig(proxyRaw, country, sessionId = generateSessionId()) {
	try {
		if (proxyRaw) {
			const parsed = proxyRaw.startsWith("http")
				? new URL(proxyRaw)
				: null;
			const [host, port, user, pass] = parsed
				? [
						parsed.hostname,
						parsed.port,
						parsed.username,
						parsed.password,
				  ]
				: proxyRaw.split(":");

			if (!host || !port || !user || !pass)
				throw new Error("Incomplete proxy config");

			return {
				proxy: {
					server: `http://${host}:${port}`,
					username: user,
					password: pass,
				},
				proxyTypeUsed: parsed ? "custom-url" : "custom-colon",
				session: sessionId,
			};
		}

		return {
			proxy: {
				server: "http://brd.superproxy.io:33335",
				username: `brd-customer-hl_65a6bfb9-zone-isp_thesa_ww_01-country-${country.toLowerCase()}-session-${sessionId}`,
				password: "ksv8wqc9joh3",
			},
			proxyTypeUsed: `brightdata-${country.toUpperCase()}`,
			session: sessionId,
		};
	} catch (err) {
		throw new Error(`Proxy config error: ${err.message}`);
	}
}

async function applyOSFix(context, targetOS = "Windows") {
	const osMap = {
		Windows: { platform: "Win32", uaPlatform: "Windows" },
		Mac: { platform: "MacIntel", uaPlatform: "macOS" },
		Linux: { platform: "Linux x86_64", uaPlatform: "Linux" },
	};

	const { platform, uaPlatform } = osMap[targetOS] || osMap.Windows;

	await context.addInitScript(
		({ platform, uaPlatform }) => {
			// navigator.platform
			Object.defineProperty(navigator, "platform", {
				get: () => platform,
			});

			// navigator.userAgentData.platform
			if (navigator.userAgentData) {
				Object.defineProperty(navigator.userAgentData, "platform", {
					get: () => uaPlatform,
				});
			}

			// userAgent + appVersion patch
			const ua = navigator.userAgent.replace(
				/\(X11; Linux x86_64\)/,
				"(Windows NT 10.0; Win64; x64)"
			);
			Object.defineProperty(navigator, "userAgent", { get: () => ua });
			Object.defineProperty(navigator, "appVersion", {
				get: () => ua.replace("Mozilla/", ""),
			});

			// Patch high entropy values
			if (navigator.userAgentData?.getHighEntropyValues) {
				const orig = navigator.userAgentData.getHighEntropyValues.bind(
					navigator.userAgentData
				);
				navigator.userAgentData.getHighEntropyValues = async (
					hints
				) => {
					const values = await orig(hints);
					if (hints.includes("platform"))
						values.platform = uaPlatform;
					if (hints.includes("architecture"))
						values.architecture = "x86";
					if (hints.includes("bitness")) values.bitness = "64";
					return values;
				};
			}
		},
		{ platform, uaPlatform }
	);
}

async function getRedirectedUrl(
	{ url, country, selector = "", proxyRaw },
	attempt = 1,
	sessionId = null
) {
	if (!country) throw new Error("Country code is missing");

	let proxy, proxyTypeUsed, session;
	try {
		({ proxy, proxyTypeUsed, session } = parseProxyConfig(
			proxyRaw,
			country,
			sessionId
		));
	} catch (err) {
		return buildErrorResult(
			url,
			country,
			selector,
			sessionId,
			0,
			"",
			"proxy",
			err.message
		);
	}

	const userAgent = getRandomUA();
	const { locale, timezoneId, geolocation } = getCountrySettings(country);

	// ---- 1) Start persistent browser context (normal mode, not incognito) ----
	const browser1 = await chromium.launchPersistentContext(userDataDir, {
		headless: false,
		proxy,
		args: ["--disable-blink-features=AutomationControlled"],
	});

	let ipInfo = {},
		finalUrl = "",
		anchorUsed = "",
		error_type = null,
		error_message = null;

	try {
		await browser1.route("**/*", (route) =>
			["image", "stylesheet", "font"].includes(
				route.request().resourceType()
			)
				? route.abort()
				: route.continue()
		);
		// ---- 2) Use first page for ipinfo lookup ----
		const page1 = await browser1.newPage();
		await page1.goto("https://ipinfo.io/json", {
			waitUntil: "domcontentloaded",
			timeout: 8000,
		});
		ipInfo = await page1.evaluate(() =>
			JSON.parse(document.body.innerText)
		);
		console.log(ipInfo);

		await page1.close();
		browser1.close();
	} catch (err) {
		await browser1.close();
		return buildErrorResult(
			url,
			country,
			selector,
			sessionId,
			attempt,
			proxyTypeUsed,
			"proxy",
			`Proxy failure: ${err.message}`
		);
	}

	// ---- 3) Adjust context settings based on ipinfo ----
	let newTimezone = timezoneId;
	let newGeolocation = geolocation;

	if (ipInfo?.timezone) newTimezone = ipInfo.timezone;
	if (ipInfo?.loc) {
		const [lat, lon] = ipInfo.loc.split(",").map(Number);
		newGeolocation = { latitude: lat, longitude: lon };
	}
	const acceptLang = langMap[ipInfo?.country] || "en-US,en;q=0.9";
	const browser2 = await chromium.launchPersistentContext(userDataDir, {
		headless: false,
		proxy,
		args: [
			"--disable-blink-features=AutomationControlled",
			"--no-default-browser-check",
			"--disable-dev-shm-usage",
			"--disable-infobars",
			"--start-maximized",
			"--disable-extensions",
			"--disable-translate",
		],
		viewport: null,
		userAgent,
		locale,
		timezoneId: newTimezone,
		geolocation: newGeolocation,
		permissions: ["geolocation"],
	});

	// These cannot be "changed" in the same context → create new page with extra headers
	await browser2.setDefaultNavigationTimeout(generalTimeout);
	await browser2.setExtraHTTPHeaders({ "Accept-Language": acceptLang });

	await browser2.addInitScript(() => {
		// Patch console.debug trick
		Object.defineProperty(console, "debug", {
			get: () => () => {},
		});

		// Fake window dimensions to avoid devtools detection
		Object.defineProperty(window, "outerHeight", {
			get: () => window.innerHeight + 100,
		});
		Object.defineProperty(window, "outerWidth", {
			get: () => window.innerWidth + 100,
		});

		// Block detection via performance.memory
		if (
			window.performance &&
			Object.getOwnPropertyDescriptor(performance, "memory")
		) {
			Object.defineProperty(performance, "memory", {
				get: () => undefined,
			});
		}
	});

	// await applyOSFix(browser2, "Windows");

	// ---- 4) Actual navigation to target URL ----
	try {
		await browser2.route("**/*", (route) =>
			["image", "stylesheet", "font"].includes(
				route.request().resourceType()
			)
				? route.abort()
				: route.continue()
		);
		const page2 = await browser2.newPage();
		await page2.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: generalTimeout,
		});

		const anchor = selector
			? await page2
					.waitForSelector(selector, { timeout: 5000 })
					.then(() => page2.$(selector))
			: await page2.$("center > a:only-child");

		if (!anchor) throw new Error("Anchor not found");
		anchorUsed = selector
			? `CSS: ${selector}`
			: "AUTO: <center><a></a></center>";

		await anchor.click();
		await delay(60500); // wait for redirects
		finalUrl = page2.url();
		await browser2.close();
	} catch (err) {
		if (attempt < 3) {
			await browser2.close();
			await delay(3500 * attempt);
			return getRedirectedUrl(
				{ url, country, selector, proxyRaw },
				attempt + 1,
				session
			);
		}
		error_type = "target";
		error_message = err.message;
	}

	return {
		original_url: url,
		country,
		selector,
		final_url: finalUrl,
		ip: ipInfo?.ip || "",
		geo_country: ipInfo?.country || "",
		isp: ipInfo?.org || "",
		user_agent: userAgent,
		timezone: ipInfo?.timezone || "",
		anchor_type: anchorUsed,
		session_id: session || sessionId || "",
		attempts: attempt,
		proxy_type: proxyTypeUsed,
		error_type,
		error_message,
	};
}

function buildErrorResult(
	url,
	country,
	selector,
	sessionId,
	attempts,
	proxyTypeUsed,
	errorType,
	errorMessage
) {
	return {
		original_url: url,
		country,
		selector,
		final_url: "",
		ip: "",
		geo_country: "",
		isp: "",
		user_agent: "",
		anchor_type: "",
		session_id: sessionId || "",
		attempts,
		proxy_type: proxyTypeUsed,
		error_type: errorType,
		error_message: errorMessage,
	};
}

async function writeJsonRecords(outputRows) {
	// 📅 Get current date string
	const today = new Date().toISOString().split("T")[0]; // e.g. 2025-09-08
	const fileName = `output-${today}.json`;
	const filePath = path.join(__dirname, fileName);

	let existingData = [];

	// 📂 If file exists, load old data
	if (fs.existsSync(filePath)) {
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			existingData = JSON.parse(raw);
		} catch (err) {
			console.error(
				"⚠️ Error reading existing JSON, starting fresh",
				err
			);
		}
	}

	// 📌 Append new rows
	existingData.push(...outputRows);

	// ✍️ Save back to file (pretty print for readability)
	fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), "utf-8");

	console.log(`✅ Data written to ${filePath}`);
}

async function processCsv() {
	const inputRows = [];
	const outputRows = [];

	const csvWriter = createObjectCsvWriter({
		path: "output5.csv",
		header: [
			"original_url",
			"country",
			"selector",
			"final_url",
			"ip",
			"geo_country",
			"isp",
			"user_agent",
			"anchor_type",
			"session_id",
			"attempts",
			"proxy_type",
			"error_type",
			"error_message",
		].map((id) => ({ id, title: id })),
	});

	fs.createReadStream("input5.csv")
		.pipe(csv())
		.on("data", (row) => {
			const normalizedRow = Object.fromEntries(
				Object.entries(row).map(([k, v]) => [k.trim(), v])
			);
			inputRows.push(normalizedRow);
		})
		.on("end", async () => {
			for (const row of inputRows) {
				const url = String(row.url || row.original_url || "").trim();
				const country = String(row.country || "").trim();
				const selector = String(row.selector || "").trim();
				const proxyRaw = String(row.proxy || "").trim();

				if (!url || !country) {
					outputRows.push(
						buildErrorResult(
							url,
							country,
							selector,
							"",
							0,
							"",
							"input",
							"Missing URL or country"
						)
					);
					continue;
				}

				console.log(`Processing: ${url}`);
				const result = await getRedirectedUrl({
					url,
					country,
					selector,
					proxyRaw,
				});
				outputRows.push(result);
			}

			// await csvWriter.writeRecords(outputRows);
			await writeJsonRecords(outputRows);
			console.log("✅ Done. Check output5.csv");
		});
}

processCsv();
