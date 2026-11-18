const localHosts = new Set(['localhost', '127.0.0.1']);
const localDevPorts = new Set(['5500', '5173']);
const isLocalFile = window.location.protocol === 'file:';
const isGitHubPages = window.location.hostname === 'duongcongcao-0312.github.io';
const isLocalDevServer = localHosts.has(window.location.hostname) &&
	localDevPorts.has(window.location.port);

window.BOOKNEST_API_BASE_URL = isLocalFile
	? 'http://127.0.0.1:8000'
	: isGitHubPages
	? 'https://duannhom5-main.onrender.com'
	: isLocalDevServer
		? `http://${window.location.hostname}:8000`
		: '';
