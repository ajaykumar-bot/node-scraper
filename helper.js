// helper.js

const countrySettings = {
	US: {
		timezoneId: "America/Chicago",
		locale: "en-US",
		geolocation: { latitude: 40.7128, longitude: -74.006 }, // New York
	},
	IN: {
		timezoneId: "Asia/Kolkata",
		locale: "en-IN",
		geolocation: { latitude: 28.6139, longitude: 77.209 }, // Delhi
	},
	DE: {
		timezoneId: "Europe/Berlin",
		locale: "de-DE",
		geolocation: { latitude: 52.52, longitude: 13.405 }, // Berlin
	},
	GB: {
		timezoneId: "Europe/London",
		locale: "en-GB",
		geolocation: { latitude: 51.5072, longitude: -0.1276 }, // London
	},
	FR: {
		timezoneId: "Europe/Paris",
		locale: "fr-FR",
		geolocation: { latitude: 48.8566, longitude: 2.3522 }, // Paris
	},
	CA: {
		timezoneId: "America/Toronto",
		locale: "en-CA",
		geolocation: { latitude: 43.65107, longitude: -79.347015 }, // Toronto
	},
	AU: {
		timezoneId: "Australia/Sydney",
		locale: "en-AU",
		geolocation: { latitude: -33.8688, longitude: 151.2093 }, // Sydney
	},
};

const viewports = [
	{ width: 1920, height: 1080, deviceScaleFactor: 1 },
	{ width: 1366, height: 768, deviceScaleFactor: 1 },
	{ width: 1536, height: 864, deviceScaleFactor: 1 },
	{ width: 1280, height: 800, deviceScaleFactor: 1 },
];

const langMap = {
	US: "en-US,en;q=0.9",
	GB: "en-GB,en;q=0.9",
	DE: "de-DE,de;q=0.9,en;q=0.8",
	FR: "fr-FR,fr;q=0.9,en;q=0.8",
	IN: "en-IN,en;q=0.9,hi;q=0.8",
};

// Pick a random viewport
function getRandomViewport() {
	return viewports[Math.floor(Math.random() * viewports.length)];
}

// Get full settings for a given country (fallback = US)
function getCountrySettings(countryCode = "US") {
	return countrySettings[countryCode] || countrySettings["US"];
}

module.exports = {
	countrySettings,
	viewports,
	langMap,
	getRandomViewport,
	getCountrySettings,
};
