const fs = require("fs");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");
const { chromium } = require("playwright");
const userAgents = require("./userAgents");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const generateSessionId = () =>
	"sess_" + Math.random().toString(36).slice(2, 12);
const generalTimeout = 95000;

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

	const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
	const browser = await chromium.launch({ headless: false, proxy });
	const context = await browser.newContext({ userAgent });
	await context.route("**/*", (route) =>
		["image", "stylesheet", "font"].includes(route.request().resourceType())
			? route.abort()
			: route.continue()
	);

	const page = await context.newPage();

	let ipInfo = {},
		finalUrl = "",
		anchorUsed = "",
		error_type = null,
		error_message = null;
	try {
		await page.goto("https://ipinfo.io/json", {
			waitUntil: "domcontentloaded",
			timeout: 5000,
		});
		ipInfo = await page.evaluate(() => JSON.parse(document.body.innerText));
		await page.goBack({ waitUntil: "domcontentloaded", timeout: 5000 });
	} catch (err) {
		await browser.close();
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

	try {
		await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: generalTimeout,
		});
		const anchor = selector
			? await page
					.waitForSelector(selector, { timeout: 5000 })
					.then(() => page.$(selector))
			: await page.$("center > a:only-child");
		if (!anchor) throw new Error("Anchor not found");
		anchorUsed = selector
			? `CSS: ${selector}`
			: "AUTO: <center><a></a></center>";

		await anchor.click();
		await delay(30500); // give it time to redirect
		finalUrl = page.url();
	} catch (err) {
		if (attempt < 3) {
			await browser.close();
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

	await browser.close();

	return {
		original_url: url,
		country,
		selector,
		final_url: finalUrl,
		ip: ipInfo?.ip || "",
		geo_country: ipInfo?.country || "",
		isp: ipInfo?.org || "",
		user_agent: userAgent,
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

			await csvWriter.writeRecords(outputRows);
			console.log("✅ Done. Check output5.csv");
		});
}

processCsv();
