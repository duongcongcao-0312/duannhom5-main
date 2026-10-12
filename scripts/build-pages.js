const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist');
const publicFiles = [
	'404.html',
	'500.html',
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
const publicAssets = ['favicon.svg', 'firebase-config.js'];

async function copyFiles(files, sourceDirectory, destinationDirectory) {
	await fs.mkdir(destinationDirectory, { recursive: true });
	await Promise.all(files.map((file) => fs.copyFile(
		path.join(sourceDirectory, file),
		path.join(destinationDirectory, file)
	)));
}

async function buildPages() {
	await fs.rm(outputDirectory, { recursive: true, force: true });
	await fs.mkdir(outputDirectory, { recursive: true });
	await copyFiles(publicFiles, projectRoot, outputDirectory);
	await copyFiles(publicAssets, path.join(projectRoot, 'assets'), path.join(outputDirectory, 'assets'));
	await fs.writeFile(path.join(outputDirectory, '.nojekyll'), '');
	console.log(`GitHub Pages files built in ${path.relative(projectRoot, outputDirectory)}.`);
}

buildPages().catch((error) => {
	console.error('Could not build GitHub Pages files:', error);
	process.exitCode = 1;
});