const { chromium } = require("@playwright/test");

const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:8000";
const edgePath = process.env.PERF_BROWSER ||
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const pages = [
	{ name: "home", path: "/index.html" },
	{ name: "catalog", path: "/index.html#books" },
	{ name: "detail", path: "/book.html?title=" + encodeURIComponent("Nhà giả kim") },
	{ name: "checkout", path: "/index.html#books", cart: true },
];

async function measurePage(browser, pageSpec, viewport) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	page.setDefaultTimeout(5000);
	const externalHosts = new Set();
	const appOrigin = new URL(baseUrl).origin;
	await page.route("**/*", (route) => {
		const requestUrl = new URL(route.request().url());
		if (requestUrl.origin !== appOrigin) {
			externalHosts.add(requestUrl.host);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript((hasCart) => {
		if (hasCart) localStorage.setItem("booknest-cart", JSON.stringify(["Nhà giả kim"]));
		window.__frontendPerf = { cls: 0, lcp: 0, events: [], shifts: [] };
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (!entry.hadRecentInput) {
					window.__frontendPerf.cls += entry.value;
					window.__frontendPerf.shifts.push({
						value: entry.value,
						sources: (entry.sources || []).map(({ node, previousRect, currentRect }) => ({
							node: node?.id ? `#${node.id}` : node?.className?.baseVal || node?.className || node?.tagName,
							previousRect,
							currentRect,
						})),
					});
				}
			}
		}).observe({ type: "layout-shift", buffered: true });
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) window.__frontendPerf.lcp = entry.startTime;
		}).observe({ type: "largest-contentful-paint", buffered: true });
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) window.__frontendPerf.events.push(entry.duration);
		}).observe({ type: "event", buffered: true, durationThreshold: 16 });
	}, pageSpec.cart);

	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const response = await page.goto(new URL(pageSpec.path, baseUrl).href, {
		waitUntil: "load",
		timeout: 45000,
	});
	await page.waitForTimeout(1500);
	let checkoutReady = null;
	if (pageSpec.cart) {
		await page.locator("#cartButton").click();
		const checkout = page.locator("#checkoutButton");
		await checkout.waitFor({ state: "visible" });
		try {
			await checkout.waitFor({ state: "visible", timeout: 1000 });
			await page.waitForFunction(() => !document.querySelector("#checkoutButton")?.disabled, null, { timeout: 10000 });
			await checkout.click();
			checkoutReady = await page.locator("#paymentDialog").evaluate((dialog) => dialog.open);
		} catch {
			checkoutReady = false;
		}
		await page.waitForTimeout(250);
	}
	const metrics = await page.evaluate(() => {
		const navigation = performance.getEntriesByType("navigation")[0];
		const resources = performance.getEntriesByType("resource");
		return {
			lcpMs: Math.round(window.__frontendPerf.lcp),
			cls: Number(window.__frontendPerf.cls.toFixed(4)),
			domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
			loadMs: Math.round(navigation?.loadEventEnd || 0),
			resourceCount: resources.length,
			knownTransferBytes: resources.reduce((sum, item) => sum + item.transferSize, 0),
			longestObservedEventMs: Math.round(Math.max(0, ...window.__frontendPerf.events)),
			layoutShifts: window.__frontendPerf.shifts,
		};
	});
	await context.close();
	return {
		page: pageSpec.name,
		iteration: Number(process.env.PERF_ITERATION || 1),
		viewport: `${viewport.width}x${viewport.height}`,
		status: response?.status() ?? null,
		...metrics,
		...(pageSpec.cart ? { checkoutReady } : {}),
		externalHosts: [...externalHosts].sort(),
		pageErrors: errors,
	};
}

async function main() {
	const browser = await chromium.launch({ executablePath: edgePath, headless: true });
	try {
		const results = [];
		const viewports = [
			{ width: 1365, height: 768 },
			{ width: 390, height: 844 },
		];
		const selectedPages = process.env.PERF_PAGE
			? pages.filter(({ name }) => name === process.env.PERF_PAGE)
			: pages;
		const selectedViewports = process.env.PERF_VIEWPORT
			? viewports.filter(({ width }) => String(width) === process.env.PERF_VIEWPORT)
			: viewports;
		for (const viewport of selectedViewports) {
			for (const pageSpec of selectedPages) {
				const iterations = Math.max(1, Number(process.env.PERF_REPEAT) || 1);
				for (let iteration = 1; iteration <= iterations; iteration += 1) {
					process.env.PERF_ITERATION = String(iteration);
					results.push(await measurePage(browser, pageSpec, viewport));
				}
			}
		}
		process.stdout.write(`${JSON.stringify({ baseUrl, results }, null, 2)}\n`);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
