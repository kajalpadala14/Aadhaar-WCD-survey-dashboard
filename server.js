const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const fileEnv = parseEnvFile(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || fileEnv.PORT) || 3000;
const BACKEND_API_BASE_URL = process.env.API_BASE_URL || fileEnv.API_BASE_URL || '';
const SHEET_PROXY_PATHS = new Set(['/api/sheet', '/api/sheet/', '/api/sheetye', '/api/sheetye/']);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return env;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) return env;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
      return env;
    }, {});
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveConfig(res) {
  send(
    res,
    200,
    `window.APP_CONFIG = ${JSON.stringify({ API_BASE_URL: '/api/sheet' })};\n`,
    'text/javascript; charset=utf-8'
  );
}

function corsHeaders(type = 'application/json; charset=utf-8') {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, corsHeaders());
  res.end(JSON.stringify(payload));
}

function buildBackendUrl(req) {
  const incoming = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const target = new URL(BACKEND_API_BASE_URL);
  incoming.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });
  return target;
}

async function proxySheet(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (!BACKEND_API_BASE_URL) {
    sendJson(res, 500, { ok: false, error: 'API_BASE_URL missing in .env' });
    return;
  }

  try {
    const target = buildBackendUrl(req);
    const init = {
      method: req.method,
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    };

    if (req.method === 'POST') {
      init.body = await readBody(req);
    }

    const backendRes = await fetch(target, init);
    const text = await backendRes.text();
    const contentType = backendRes.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = JSON.parse(text);
      if (json && Array.isArray(json.entries)) {
        json.entries = json.entries.map(entry => {
          const explicitFather = entry.father || entry.father_name || entry.husband || entry.husbandName || entry.husband_name || entry['पिताजी का नाम'] || entry['पिता का नाम'] || entry['पति का नाम'] || entry['पिता/पति का नाम'] || '';
          const apiFather = entry.fatherName || '';
          const fatherIsSameAsHof = apiFather && entry.hof && String(apiFather).trim() === String(entry.hof).trim();
          const source = explicitFather || (apiFather && !fatherIsSameAsHof) ? 'father' : (entry.hof ? 'hof' : '');
          return {
            ...entry,
            fatherName: explicitFather || apiFather || entry.hof || '',
            fatherNameSource: source
          };
        });
      }
      res.writeHead(backendRes.status, corsHeaders());
      res.end(JSON.stringify(json));
      return;
    }

    sendJson(res, 502, {
      ok: false,
      error: extractTextError(text) || `Backend returned ${contentType || 'non-JSON response'}`
    });
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err.message || 'Backend fetch failed' });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function extractTextError(text) {
  const clean = String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const match = clean.match(/Error:\s*([^]+)$/i);
  return (match ? match[1] : clean).slice(0, 220);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);

  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    send(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, 'Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/config.js') {
    serveConfig(res);
    return;
  }

  if (SHEET_PROXY_PATHS.has(pathname)) {
    proxySheet(req, res);
    return;
  }

  serveStatic(req, res);
});

let currentPort = PORT;

function listen(port) {
  currentPort = port;
  server.listen(port);
}

function getLanUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter(item => item.family === 'IPv4' && !item.internal)
    .map(item => `http://${item.address}:${port}`);
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE' && currentPort < PORT + 10) {
    const nextPort = currentPort + 1;
    console.log(`Port busy, trying http://localhost:${nextPort}`);
    listen(nextPort);
    return;
  }

  throw err;
});

server.on('listening', () => {
  const address = server.address();
  const port = address && address.port ? address.port : currentPort;
  console.log(`Aadhaar WCD survey running at http://localhost:${port}`);
  getLanUrls(port).forEach(url => console.log(`LAN access: ${url}`));
  console.log(BACKEND_API_BASE_URL ? 'API_BASE_URL loaded from env.' : 'API_BASE_URL is empty.');
});

listen(PORT);
