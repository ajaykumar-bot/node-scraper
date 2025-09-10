const { chromium } = require("playwright");
require("dotenv").config();

async function run(url, selector) {
	const browser = await chromium.launch({ headless: false });
	const context = await browser.newContext({
		javaScriptEnabled: true,
		bypassCSP: true,
		userAgent: "Mozilla/5.0",
	});

	// Disable loading images, stylesheets, fonts
	await context.route("**/*", (route) => {
		const blocked = ["image", "stylesheet", "font"];
		if (blocked.includes(route.request().resourceType())) {
			return route.abort();
		}
		return route.continue();
	});

	const page = await context.newPage();
	await page.goto(url, { waitUntil: "domcontentloaded" });

	// Wait for selector to be visible
	await page.waitForSelector(selector, { timeout: 10000 });
	const anchor = await page.$(selector);
	const [newPage] = await Promise.all([
		page.waitForNavigation({ waitUntil: "load" }),
		anchor.click(),
	]);

	console.log("Redirected URL:", page.url());

	await browser.close();
}

// const url = process.argv[2];
// const selector = process.argv[3];
const url = process.env.URL;
const selector = process.env.CSS_SELECTOR;

if (!url || !selector) {
	console.error("Usage: node navigate.js <url> <css_selector>");
	process.exit(1);
}

run(url, selector);
