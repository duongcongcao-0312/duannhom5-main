const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist');
const publicFiles = [
	'404.html',
	'500.html',
	'admin.css',
	'admin.html',
	'admin.js',
	'book.html',
	'book-detail.js',
	'books-data.js',
	'index.html',
	'main.css',
	'main.js',
	'manifest.json',
	'privacy.html',
	'robots.txt',
	'sitemap.xml',
	'terms.html'
];
const publicAssets = ['favicon.svg', 'firebase-config.js', 'api-config.js', 'api-client.js', 'toast.css', 'toast.js', 'vietqr.js'];

async function copyFiles(files, sourceDirectory, destinationDirectory) {
	await fs.mkdir(destinationDirectory, { recursive: true });
	await Promise.all(files.map((file) => fs.copyFile(
		path.join(sourceDirectory, file),
		path.join(destinationDirectory, file)
	)));
}

async function assertNoMixedContent(directory, files) {
	for (const file of files) {
		const contents = await fs.readFile(path.join(directory, file), 'utf8');
		if (/http:\/\//i.test(contents)) {
			throw new Error(`Mixed content check failed: ${file} contains an insecure HTTP URL.`);
		}
	}
}

async function buildPages() {
	const apiBaseUrl = (process.env.API_BASE_URL || 'https://duannhom5-main.onrender.com').trim().replace(/\/+$/, '');
	const defaultSiteUrl = 'https://duongcongcao-0312.github.io/duannhom5-main/';
	const siteUrl = (process.env.SITE_URL || defaultSiteUrl).trim().replace(/\/+$/, '') + '/';
	if (apiBaseUrl && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(apiBaseUrl)) {
		throw new Error('API_BASE_URL phải là một origin HTTPS hợp lệ, ví dụ https://booknest-api.onrender.com.');
	}
	let parsedSiteUrl;
	try { parsedSiteUrl = new URL(siteUrl); } catch { throw new Error('SITE_URL must be a valid public HTTPS URL.'); }
	if (parsedSiteUrl.protocol !== 'https:' || parsedSiteUrl.username || parsedSiteUrl.password || parsedSiteUrl.search || parsedSiteUrl.hash) {
		throw new Error('SITE_URL must use HTTPS and must not include credentials, query, or fragment.');
	}
	await fs.rm(outputDirectory, { recursive: true, force: true });
	await fs.mkdir(outputDirectory, { recursive: true });
	await copyFiles(publicFiles, projectRoot, outputDirectory);
	await copyFiles(publicAssets, path.join(projectRoot, 'assets'), path.join(outputDirectory, 'assets'));
	const oldSiteBase = 'https://duongcongcao-0312.github.io/duannhom5-main/';
	const indexPath = path.join(outputDirectory, 'index.html');
	await fs.writeFile(indexPath, (await fs.readFile(indexPath, 'utf8')).replaceAll(oldSiteBase, siteUrl));
	const robotsPath = path.join(outputDirectory, 'robots.txt');
	await fs.writeFile(robotsPath, (await fs.readFile(robotsPath, 'utf8')).replace(`${oldSiteBase}sitemap.xml`, `${siteUrl}sitemap.xml`));
	const sitemapPath = path.join(outputDirectory, 'sitemap.xml');
	await fs.writeFile(sitemapPath, (await fs.readFile(sitemapPath, 'utf8')).replaceAll(oldSiteBase, siteUrl));
	if (parsedSiteUrl.pathname === '/' && parsedSiteUrl.hostname !== 'duongcongcao-0312.github.io') {
		await fs.writeFile(path.join(outputDirectory, 'CNAME'), `${parsedSiteUrl.hostname}\n`);
	}
	await fs.writeFile(
		path.join(outputDirectory, 'assets', 'api-config.js'),
		`window.BOOKNEST_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`
	);
	await fs.writeFile(path.join(outputDirectory, '.nojekyll'), '');
	await assertNoMixedContent(outputDirectory, [
		...publicFiles.filter((file) => /\.(?:html|css|js|json|xml)$/i.test(file)),
		...publicAssets.map((file) => path.join('assets', file)).filter((file) => /\.(?:css|js|json|svg)$/i.test(file)),
	]);
	console.log(`GitHub Pages files built for ${siteUrl} in ${path.relative(projectRoot, outputDirectory)}.`);
}

buildPages().catch((error) => {
	console.error('Could not build GitHub Pages files:', error);
	process.exitCode = 1;
});
