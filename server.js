'use strict';
// Servidor local sin dependencias. Uso: node server.js [puerto]
// Variables: PORT, HOST, NO_OPEN=1
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const NO_STORE = new Set(['.html', '.css', '.js', '.json']);

function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const abs = path.resolve(ROOT, '.' + p);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  return abs;
}

function lanUrl(port) {
  const nets = os.networkInterfaces();
  const out = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}`);
    }
  }
  return out[0] || `http://localhost:${port}`;
}

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) { /* opcional */ }
}

const server = http.createServer((req, res) => {
  // Mock local de Vercel Web Analytics (en producción lo sirve Vercel).
  if (req.url.split('?')[0] === '/_vercel/insights/view' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    return res.end('ok');
  }
  if (req.url.split('?')[0] === '/_vercel/insights/script.js') {
    const js = `(function(){try{var u=location.origin+'/_vercel/insights/view';var b=JSON.stringify({url:location.href,referrer:document.referrer||null});if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([b],{type:'text/plain'}));}else{fetch(u,{method:'POST',body:b,keepalive:true,headers:{'content-type':'text/plain'}}).catch(function(){});}}catch(e){}})();`;
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(js);
  }

  let abs = safePath(req.url);
  if (!abs) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('Prohibido'); }

  // Clean URLs: /print -> print.html; / -> index.html
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    if (!path.extname(abs) && fs.existsSync(abs + '.html')) abs += '.html';
    else if (fs.existsSync(path.join(abs, 'index.html'))) abs = path.join(abs, 'index.html');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<h1>404</h1><p>No encontrado: ' + req.url.replace(/[<>]/g, '') + '</p><p><a href="/">Volver</a></p>');
  }

  const ext = path.extname(abs).toLowerCase();
  const stat = fs.statSync(abs);
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
  };
  if (NO_STORE.has(ext)) headers['cache-control'] = 'no-store';
  else if (ext === '.pdf') headers['cache-control'] = 'public, max-age=86400';
  else headers['cache-control'] = 'public, max-age=604800';

  // Soporte de Range para PDFs (visor nativo).
  const range = req.headers.range;
  if (range && ext === '.pdf') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end !== null) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
      if (start !== null && end === null) end = stat.size - 1;
      if (start === null) start = 0;
      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
  }

  headers['content-length'] = stat.size;
  headers['accept-ranges'] = 'bytes';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
});

function listen(port, attempts) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) {
      console.log(`Puerto ${port} ocupado, probando ${port + 1}…`);
      listen(port + 1, attempts - 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const local = `http://localhost:${port}/`;
    console.log('');
    console.log('  Reto Aeropuerto · servidor local');
    console.log('  Local: ' + local);
    console.log('  LAN:   ' + lanUrl(port));
    console.log('  Detén con Ctrl+C');
    console.log('');
    openBrowser(local);
  });
}

const port = Number(process.env.PORT) || Number(process.argv[2]) || 5173;
listen(port, 20);
