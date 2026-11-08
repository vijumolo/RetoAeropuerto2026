'use strict';
// Pruebas de aceptación (Fase 5). Uso:
//   node tests/run-tests.js
//   BASE_URL=http://127.0.0.1:5199 PROD_URL=https://... node tests/run-tests.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const { openPdf, pageItems } = require('../tools/lib/pdftext');

const APP = path.resolve(__dirname, '..');
const ART = path.join(__dirname, 'artifacts');
const PORT = Number(process.env.TEST_PORT || 5205);
const BASE = (process.env.BASE_URL || `http://127.0.0.1:${PORT}/`).replace(/\/+$/, '') + '/';
const PROD = process.env.PROD_URL ? process.env.PROD_URL.replace(/\/+$/, '') + '/' : '';
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const results = [];
let serverProc = null;
let browser = null;

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log('PASS  ' + name + (detail ? '  · ' + detail : ''));
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log('FAIL  ' + name + (detail ? '  · ' + detail : ''));
}
async function check(name, fn) {
  try {
    const d = await fn();
    pass(name, d);
  } catch (e) {
    fail(name, e && e.message ? e.message : String(e));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert'); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function httpGet(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'user-agent': 'RetoAeropuertoTests/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + url)));
    req.end();
  });
}
async function waitForUrl(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await httpGet(url);
      if (r.status === 200) return;
    } catch (_) { /* reintenta */ }
    await sleep(250);
  }
  throw new Error('Servidor no disponible: ' + url);
}
async function startServer() {
  if (process.env.BASE_URL) return;
  serverProc = spawn(process.execPath, [path.join(APP, 'server.js'), String(PORT)], {
    cwd: APP,
    env: { ...process.env, NO_OPEN: '1' },
    stdio: 'ignore',
  });
  await waitForUrl(BASE);
  await sleep(300);
}
async function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch (_) { /* noop */ }
    serverProc = null;
  }
}

function watchErrors(page) {
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon/i.test(t)) return;
    if (/net::ERR_FILE_NOT_FOUND/i.test(t) && /favicon/i.test(t)) return;
    errs.push('console: ' + t);
  });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (/favicon/i.test(r.url())) return;
    errs.push('requestfailed: ' + r.url() + ' · ' + (r.failure() ? r.failure().errorText : ''));
  });
  return errs;
}

async function getJson(url) {
  const r = await httpGet(url);
  return JSON.parse(r.body.toString('utf8'));
}

async function waitForFile(dir, re, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(dir)) {
      const hit = fs.readdirSync(dir).find((f) => re.test(f));
      if (hit) {
        const p = path.join(dir, hit);
        try {
          if (fs.statSync(p).size > 1000) return p;
        } catch (_) { /* archivo en curso */ }
      }
    }
    await sleep(300);
  }
  throw new Error('No apareció el archivo ' + re + ' en ' + dir);
}

async function clickPill(page, container, text) {
  const handles = await page.$$(container + ' button');
  for (const h of handles) {
    const t = await h.evaluate((n) => n.textContent.replace(/\s+/g, ' ').trim());
    if (t.toLowerCase().includes(text.toLowerCase())) {
      await h.click();
      await sleep(220);
      return t;
    }
  }
  throw new Error('No se encontró el pill "' + text + '" en ' + container);
}
async function totalText(page) {
  return (await page.$eval('#totalCount', (n) => n.textContent)).trim();
}
async function expectTotal(page, n) {
  await page.waitForFunction((n) => document.getElementById('totalCount').textContent.trim() === String(n), { timeout: 8000 }, n);
  return totalText(page);
}
async function rowCount(page) {
  return page.$$eval('.row', (n) => n.length);
}
async function waitRows(page, n, timeout = 15000) {
  await page.waitForFunction((n) => document.querySelectorAll('.row').length === n, { timeout }, n);
}

async function openDiplomaUrl(page, url, name) {
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#diplomaModal:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.getElementById('dmImg');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 30000 });
  const got = (await page.$eval('#dmName', (n) => n.textContent)).trim();
  assert(got === name, `nombre en modal "${got}" != "${name}"`);
}

async function testDesktop(base) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errs = watchErrors(page);
  try {
    const data = await getJson(base + 'data.json');
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.row');
    await waitRows(page, 60);
    assert((await totalText(page)) === '991', 'contador total');
    pass('UI · 60 filas iniciales y contador 991');
    assert(await page.$eval('#statCats', (n) => n.textContent.trim() === '3'), 'stat categorías');

    await page.type('#q', 'garcia gallego');
    await page.waitForFunction(() => document.querySelectorAll('.row').length === 1, { timeout: 8000 });
    const one = await page.$eval('.row .cell-name strong', (n) => n.textContent.trim());
    assert(one === 'Diana Patricia García Gallego', 'búsqueda sin tildes: ' + one);
    assert((await totalText(page)) === '1', 'contador búsqueda');
    pass('UI · búsqueda sin tildes devuelve 1 resultado exacto');

    await page.click('#clearSearch');
    await waitRows(page, 60);

    // Filtros exactos
    await clickPill(page, '#distancePills', '10K');
    await expectTotal(page, 991);
    await clickPill(page, '#categoryPills', 'ABIERTA');
    await expectTotal(page, 624);
    await clickPill(page, '#genderSeg', 'Damas');
    await expectTotal(page, 264);
    await clickPill(page, '#genderSeg', 'Hombres');
    await expectTotal(page, 360);
    await page.click('#resetFilters');
    await sleep(400);
    await clickPill(page, '#categoryPills', 'MASTER A');
    await expectTotal(page, 247);
    await clickPill(page, '#genderSeg', 'Damas');
    await expectTotal(page, 98);
    await page.click('#resetFilters');
    await sleep(400);
    await clickPill(page, '#categoryPills', 'MASTER B');
    await expectTotal(page, 120);
    await clickPill(page, '#genderSeg', 'Hombres');
    await expectTotal(page, 88);
    await page.click('#resetFilters');
    await sleep(400);
    pass('UI · filtros por distancia/categoría/género con conteos exactos');

    // Modal + posiciones + imagen
    await openDiplomaUrl(page, base + '?dorsal=101', 'Adriana Martinez Ramon');
    const posCat = (await page.$eval('#dmPosCat', (n) => n.textContent)).replace(/\s+/g, ' ').trim();
    const posGlob = (await page.$eval('#dmPosGlobal', (n) => n.textContent)).replace(/\s+/g, ' ').trim();
    assert(posCat === '240 / 247', 'pos categoría: ' + posCat);
    assert(posGlob === '971 / 991', 'pos general: ' + posGlob);
    const imgSrc = await page.$eval('#dmImg', (n) => n.getAttribute('src'));
    assert(/d-0101\.webp$/.test(imgSrc), 'imagen: ' + imgSrc);
    const printHref = await page.$eval('#dmPrint', (n) => n.getAttribute('href'));
    assert(printHref === 'print.html?dorsal=101', 'print href: ' + printHref);
    pass('UI · modal con imagen cargada, posiciones y enlace de impresión');

    // Descarga real por CDP
    const pdfPath = await downloadViaCdp(page);
    const bytes = fs.readFileSync(pdfPath);
    assert(bytes.slice(0, 5).toString() === '%PDF-', 'cabecera %PDF');
    const doc = await PDFDocument.load(bytes);
    assert(doc.getPageCount() === 1, 'páginas ' + doc.getPageCount());
    const p = doc.getPage(0);
    const w = Math.round(p.getWidth());
    const h = Math.round(p.getHeight());
    assert(w === 792 && h === 612, `tamaño ${w}x${h}`);
    const { doc: pdoc } = await openPdf(pdfPath);
    const items = await pageItems(await pdoc.getPage(1));
    const text = items.map((i) => i.str).join(' ');
    await pdoc.destroy();
    assert(text.includes('Adriana Martinez Ramon'), 'texto del deportista dentro del PDF');
    pass('UI · descarga real: 1 página 792×612 pt, %PDF y texto correcto');

    // ?dorsal=195
    await openDiplomaUrl(page, base + '?dorsal=195', 'Gloria Isabel Prada Pinzon');
    pass('UI · ?dorsal=195 abre el deportista correcto');

    // Cero errores
    assert(errs.length === 0, 'errores de consola: ' + errs.slice(0, 5).join(' | '));
    pass('UI · cero errores de consola en escritorio');
  } finally {
    await page.close();
  }
}

async function downloadViaCdp(page) {
  fs.mkdirSync(ART, { recursive: true });
  for (const f of fs.readdirSync(ART)) if (/\.pdf$/i.test(f)) fs.rmSync(path.join(ART, f), { force: true });
  const client = await page.target().createCDPSession();
  try {
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: ART });
  } catch (_) {
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: ART, eventsEnabled: true });
  }
  await page.click('#dmDownload');
  const p = await waitForFile(ART, /\.pdf$/i, 60000);
  await sleep(300);
  return p;
}

async function testPrint(base) {
  const page = await browser.newPage();
  const errs = watchErrors(page);
  await page.evaluateOnNewDocument(() => {
    window.__printed = false;
    window.print = function () { window.__printed = true; };
  });
  try {
    await page.goto(base + 'print.html?dorsal=101', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => {
      const i = document.getElementById('diploma');
      return i && i.complete && i.naturalWidth > 0;
    }, { timeout: 30000 });
    await page.waitForFunction(() => window.__printed === true, { timeout: 8000 });
    const name = await page.$eval('#who', (n) => n.textContent);
    assert(/Adriana Martinez Ramon/.test(name), 'nombre: ' + name);
    assert(errs.length === 0, 'errores: ' + errs.join(' | '));
    pass('print.html · imagen carga y window.print() se dispara');
  } finally {
    await page.close();
  }
}

async function testMobile(base) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const errs = watchErrors(page);
  try {
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.row');
    await sleep(500);
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      win: window.innerWidth,
    }));
    assert(m.doc <= m.win && m.body <= m.win, `desbordamiento doc=${m.doc} body=${m.body} win=${m.win}`);
    await page.goto(base + '?dorsal=101', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#diplomaModal:not([hidden])');
    await page.waitForFunction(() => {
      const i = document.getElementById('dmImg');
      return i && i.complete && i.naturalWidth > 0;
    }, { timeout: 30000 });
    const m2 = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    assert(m2.doc <= m2.win, `desbordamiento modal doc=${m2.doc} win=${m2.win}`);
    assert(errs.length === 0, 'errores: ' + errs.join(' | '));
    pass('Móvil 390×844 · 0 px de desbordamiento (lista y modal)');
  } finally {
    await page.close();
  }
}

async function testFileProtocol() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = watchErrors(page);
  try {
    const index = pathToFileURL(path.join(APP, 'index.html')).href;
    await page.goto(index, { waitUntil: 'load' });
    await page.waitForSelector('.row');
    await waitRows(page, 60);
    await page.goto(index + '?dorsal=101', { waitUntil: 'load' });
    await page.waitForSelector('#diplomaModal:not([hidden])');
    await page.waitForFunction(() => {
      const i = document.getElementById('dmImg');
      return i && i.complete && i.naturalWidth > 0;
    }, { timeout: 30000 });
    await page.evaluate(() => {
      window.__opened = null;
      window.open = function (u) { window.__opened = u; return null; };
    });
    await page.click('#dmDownload');
    await page.waitForFunction(() => typeof window.__opened === 'string', { timeout: 5000 });
    const opened = await page.evaluate(() => window.__opened);
    assert(/#page=1$/.test(opened), 'fallback: ' + opened);
    assert(errs.length === 0, 'errores: ' + errs.join(' | '));
    pass('file:// · filas, modal e imagen OK; descarga cae al fallback #page=N');
  } finally {
    await page.close();
  }
}

async function testAssets(base) {
  const checks = [
    ['/', 'text/html', true],
    ['/data.js', 'text/javascript', true],
    ['/styles.css', 'text/css', true],
    ['/vendor/pdf-lib.min.js', 'text/javascript', false],
    ['/vendor/qrcode.js', 'text/javascript', false],
    ['/diplomas/img/d-0101.webp', 'image/webp', false],
    ['/assets/resultados-oficiales.pdf', 'application/pdf', false],
    ['/assets/diplomas-oficiales.pdf', 'application/pdf', false],
    ['/assets/qr-sitio.svg', 'image/svg+xml', false],
    ['/assets/qr-whatsapp.png', 'image/png', false],
  ];
  for (const [u, mime, noStore] of checks) {
    const r = await httpGet(base + u.replace(/^\//, ''));
    assert(r.status === 200, `${u} status ${r.status}`);
    assert(String(r.headers['content-type']).includes(mime), `${u} content-type ${r.headers['content-type']}`);
    if (noStore) assert(/no-store/.test(String(r.headers['cache-control'])), `${u} cache ${r.headers['cache-control']}`);
  }
  pass('Assets · HTTP 200, MIME correcto y no-store en HTML/JS/CSS');

  const r1 = await httpGet(base + '/assets/resultados-oficiales.pdf');
  const r2 = await httpGet(base + '/assets/diplomas-oficiales.pdf');
  const { doc: d1 } = await openPdfFromBuffer(r1.body);
  const { doc: d2 } = await openPdfFromBuffer(r2.body);
  assert(d1.numPages === 21, 'resultados páginas ' + d1.numPages);
  assert(d2.numPages === 991, 'diplomas páginas ' + d2.numPages);
  await d1.destroy(); await d2.destroy();
  pass('Assets · PDFs íntegros (21 y 991 páginas)');
}

async function openPdfFromBuffer(buf) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
  return { doc: await task.promise };
}

async function testAnalytics(base) {
  const page = await browser.newPage();
  const ua = (await page.browser().userAgent()).replace('HeadlessChrome', 'Chrome');
  await page.setUserAgent(ua);
  const hits = [];
  const errs = watchErrors(page);
  page.on('response', (r) => {
    if (/\/_vercel\/insights\/view/.test(r.url())) hits.push(r.status());
  });
  try {
    await page.goto(base, { waitUntil: 'networkidle2' });
    for (let i = 0; i < 20 && !hits.length; i++) await sleep(250);
    assert(hits.length > 0, 'no se envió /_vercel/insights/view');
    assert(hits[0] === 200, 'status analytics ' + hits[0]);
    assert(errs.length === 0, 'errores: ' + errs.join(' | '));
    pass('Analytics · script y POST /_vercel/insights/view 200', 'UA: ' + ua.slice(0, 60));
  } finally {
    await page.close();
  }
}

async function testProduction(base) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errs = watchErrors(page);
  try {
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.row');
    await waitRows(page, 60);
    assert((await totalText(page)) === '991', 'total producción');
    await openDiplomaUrl(page, base + '?dorsal=195', 'Gloria Isabel Prada Pinzon');
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.row');
    await clickPill(page, '#categoryPills', 'ABIERTA');
    assert((await totalText(page)) === '624', 'ABIERTA producción');
    await clickPill(page, '#genderSeg', 'Damas');
    assert((await totalText(page)) === '264', 'Damas producción');
    assert(errs.length === 0, 'errores: ' + errs.slice(0, 4).join(' | '));
    pass('PRODUCCIÓN · UI, modal y filtros');
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('Reto Aeropuerto · pruebas');
  console.log('Chrome: ' + CHROME);
  console.log('Base:   ' + BASE);
  if (!CHROME) throw new Error('Chrome/Edge no encontrado. Define CHROME_PATH.');
  fs.mkdirSync(ART, { recursive: true });
  await startServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
  });
  try {
    await check('node --check app.js', async () => {
      const { execFileSync } = require('child_process');
      execFileSync(process.execPath, ['--check', path.join(APP, 'app.js')], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', path.join(APP, 'tools', 'build.js')], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', path.join(APP, 'tools', 'extract.js')], { stdio: 'pipe' });
    });
    await check('Escritorio · filas, búsqueda, modal, descarga, filtros, ?dorsal', () => testDesktop(BASE));
    await check('print.html · impresión A4', () => testPrint(BASE));
    await check('Móvil 390×844', () => testMobile(BASE));
    await check('file:// · datos, modal y fallback', () => testFileProtocol());
    await check('Assets · MIME, caché y PDFs', () => testAssets(BASE));
    await check('Analytics · view 200', () => testAnalytics(BASE));
    if (PROD) await check('Producción', () => testProduction(PROD));
    else pass('Producción · omitida (define PROD_URL para repetir 2–4 en producción)');
  } finally {
    if (browser) await browser.close();
    await stopServer();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== RESUMEN ===');
  console.log(`${results.length - failed.length}/${results.length} pruebas OK`);
  if (failed.length) {
    console.log('Fallos:');
    for (const f of failed) console.log(' - ' + f.name + ': ' + f.detail);
  }
  fs.writeFileSync(path.join(ART, 'resultados.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
