'use strict';
// Fase 3: genera assets, imágenes de diplomas, data.js/data.json y QR.
// Uso:
//   node tools/build.js            (idempotente: omite imágenes existentes)
//   FORCE_RENDER=1 node tools/build.js
// Variables opcionales:
//   SITE_URL=https://tu-dominio  (URL canónica para los QR)
const fs = require('fs');
const path = require('path');
const { ROOT, EVENT_DIR } = require('./lib/pdftext');
const { extractResults, extractDiplomas, findPdf } = require('./extract');

const FORCE = process.env.FORCE_RENDER === '1';
const SITE_URL = (process.env.SITE_URL || 'https://reto-aeropuerto-7ma.vercel.app').replace(/\/+$/, '');
const QUALITY = 80;
const SCALE = 1.5;

const DIRS = {
  assets: path.join(ROOT, 'assets'),
  img: path.join(ROOT, 'diplomas', 'img'),
  vendor: path.join(ROOT, 'vendor'),
  tools: path.join(ROOT, 'tools'),
  data: path.join(ROOT),
};

function ensureDirs() {
  for (const d of [DIRS.assets, DIRS.img, DIRS.vendor]) fs.mkdirSync(d, { recursive: true });
}

function copyPdfs() {
  const final = findPdf('FINAL');
  const diplomas = findPdf('DIPLOMAS');
  fs.copyFileSync(final, path.join(DIRS.assets, 'resultados-oficiales.pdf'));
  fs.copyFileSync(diplomas, path.join(DIRS.assets, 'diplomas-oficiales.pdf'));
  return { final, diplomas };
}

function copyVendors() {
  fs.copyFileSync(path.join(ROOT, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js'), path.join(DIRS.vendor, 'pdf-lib.min.js'));
  fs.copyFileSync(path.join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js'), path.join(DIRS.vendor, 'qrcode.js'));
}

const pad4 = (n) => String(n).padStart(4, '0');

function slugCategory(label) {
  return label
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function displayCategory(label) {
  // "10 K MASTER A (40-49)" -> "10K MASTER A (40-49)"
  return String(label || '').replace(/^(\d+)\s*K\b/i, '$1K').replace(/\s+/g, ' ').trim();
}

function fmtDate(iso) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${meses[m - 1]} de ${y}`;
}

function mergeData(results, diplomas) {
  const resultByDorsal = new Map();
  for (const r of results.rows) if (!resultByDorsal.has(r.dorsal)) resultByDorsal.set(r.dorsal, r);

  // Totales de género (solo finalistas, para que cuadren con los diplomas)
  const genderTotals = {};
  for (const r of results.rows) {
    if (r.pos === null) continue;
    const k = `${r.categoryLabel}|${r.gender}`;
    genderTotals[k] = (genderTotals[k] || 0) + 1;
  }

  const dnis = diplomas.diplomas.map((d) => {
    const r = resultByDorsal.get(d.dorsal) || null;
    const catLabel = displayCategory(d.categoryLabel);
    const sameName = r && r.name && d.name && r.name.trim() === d.name.trim();
    return {
      id: 'd' + String(d.dorsal || d.page).padStart(4, '0'),
      dorsal: d.dorsal,
      name: d.name || (r ? r.name : '—'),
      nameAlt: r && !sameName ? r.name : null,
      city: r && r.city ? r.city : '—',
      gender: r ? r.gender : '—',
      category: d.categoryLabel,
      catLabel,
      distance: d.distance || (r ? r.distance : '10K'),
      time: r && r.time ? r.time : (d.time ? d.time.replace(/^0(?=\d:)/, '') : '—'),
      pace: r && r.pace ? r.pace : '—',
      speed: r && r.speed ? r.speed : '—',
      diff: r && r.diff ? r.diff : '—',
      pos: r && r.pos !== null ? r.pos : null,
      posGender: r && r.pos !== null ? r.pos : null,
      totalGender: r ? genderTotals[`${r.categoryLabel}|${r.gender}`] || null : null,
      posCategory: d.posCategory,
      totalCategory: d.totalCategory,
      posGlobal: d.posGlobal,
      totalGlobal: d.totalGlobal,
      hasResult: Boolean(r && r.time),
      hasDiploma: Boolean(d.page),
      diplomaPdf: 'assets/diplomas-oficiales.pdf',
      diplomaPage: d.page,
      diplomaImg: `diplomas/img/d-${pad4(d.dorsal || d.page)}.webp`,
    };
  });

  // Categorías y conteos
  const catMap = new Map();
  for (const a of dnis) {
    if (!catMap.has(a.category)) {
      catMap.set(a.category, {
        id: slugCategory(a.category),
        distance: a.distance,
        label: displayCategory(a.category),
        total: 0,
        Damas: 0,
        Hombres: 0,
        Mixta: 0,
      });
    }
    const c = catMap.get(a.category);
    c.total++;
    if (c[a.gender] != null) c[a.gender]++;
  }
  const order = { '21K': 3, '15K': 2.5, '10K': 2, '5K': 1, '3K': 0.6, '1K': 0.2 };
  const categories = [...catMap.values()].sort((a, b) => (order[b.distance] || 0) - (order[a.distance] || 0) || a.label.localeCompare(b.label, 'es'));

  dnis.sort((a, b) => (order[b.distance] || 0) - (order[a.distance] || 0) || (a.posGlobal || 1e9) - (b.posGlobal || 1e9) || a.name.localeCompare(b.name, 'es'));

  const event = {
    name: 'Reto Aeropuerto 7ma Edición',
    shortName: 'Reto Aeropuerto',
    edition: '7ma edición',
    city: 'Bucaramanga, Santander',
    date: '2026-11-08',
    dateLabel: fmtDate('2026-11-08'),
    total: dnis.length,
    registered: results.rows.length,
    dns: results.rows.filter((r) => r.pos === null).length,
    resultsPdf: 'assets/resultados-oficiales.pdf',
    diplomasPdf: 'assets/diplomas-oficiales.pdf',
    emisor: 'TCTSAS · Timing Company',
    siteUrl: SITE_URL,
    categories,
    colors: {
      ink: '#241a33',
      brand: '#4a1d6e',
      brand2: '#7b2d8e',
      accent: '#b8860b',
      accent2: '#d94f8a',
      paper: '#f7f2e8',
    },
  };

  const samples = {
    results: results.rows.slice(0, 3),
    dns: results.rows.filter((r) => r.pos === null).slice(0, 5),
    diplomas: diplomas.diplomas.slice(0, 3),
    athletes: dnis.slice(0, 3),
  };
  return { event, athletes: dnis, samples, results, diplomas };
}

async function renderDiplomas(diplomas) {
  const napi = require('@napi-rs/canvas');
  const { openPdf } = require('./lib/pdftext');
  const file = path.join(DIRS.assets, 'diplomas-oficiales.pdf');
  const { doc } = await openPdf(file);
  let rendered = 0;
  let skipped = 0;
  const started = Date.now();
  const fail = [];

  for (const d of diplomas) {
    const out = path.join(DIRS.img, `d-${pad4(d.dorsal || d.page)}.webp`);
    if (!FORCE && fs.existsSync(out) && fs.statSync(out).size > 1000) {
      skipped++;
      continue;
    }
    try {
      const page = await doc.getPage(d.page);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const buf = await canvas.encode('webp', QUALITY);
      fs.writeFileSync(out, buf);
      page.cleanup();
      rendered++;
      if (rendered % 25 === 0) {
        const sec = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`  render ${rendered} (${skipped} omitidas) · ${sec}s`);
      }
    } catch (e) {
      fail.push({ page: d.page, dorsal: d.dorsal, error: e.message });
    }
  }
  await doc.destroy();
  return { rendered, skipped, failed: fail };
}

function writeData(bundle) {
  const { event, athletes } = bundle;
  const data = { event, athletes };
  fs.writeFileSync(path.join(DIRS.data, 'data.js'), 'window.EVENT_DATA = ' + JSON.stringify(data, null, 1) + ';\n');
  fs.writeFileSync(path.join(DIRS.data, 'data.json'), JSON.stringify(data, null, 1) + '\n');
  fs.writeFileSync(path.join(DIRS.tools, 'samples.json'), JSON.stringify(bundle.samples, null, 2) + '\n');
}

function makeQrSvg(text) {
  const qrcode = require('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  let svg = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
  svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  return svg;
}

async function makeQrPoster(event) {
  const qrSvg = fs.readFileSync(path.join(DIRS.assets, 'qr-sitio.svg'), 'utf8');
  const qrData = 'data:image/svg+xml;base64,' + Buffer.from(qrSvg).toString('base64');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1080px;height:1350px;background:radial-gradient(circle at 85% 10%,#7b2d8e 0,#4a1d6e 42%,#241a33 100%);color:#fff;font-family:Segoe UI,Arial,sans-serif;overflow:hidden;position:relative}
  .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.18) 1px,transparent 1px);background-size:38px 38px;opacity:.5}
  .wrap{position:absolute;inset:0;padding:74px;display:flex;flex-direction:column;align-items:center;text-align:center}
  .kicker{letter-spacing:.28em;text-transform:uppercase;font-weight:700;font-size:24px;color:#f4d58d}
  h1{font-size:78px;line-height:.98;margin:22px 0 10px;font-weight:900;letter-spacing:-2px}
  .sub{font-size:31px;color:#efe6ff;margin-bottom:34px}
  .card{background:#fff;border-radius:42px;padding:44px 44px 38px;box-shadow:0 30px 80px rgba(0,0,0,.35);margin-top:8px}
  .card img{width:470px;height:470px;display:block}
  .url{margin-top:30px;font-size:27px;font-weight:800;color:#4a1d6e;word-break:break-all}
  .cta{margin-top:24px;font-size:30px;color:#5b4a73}
  .foot{margin-top:auto;display:flex;gap:18px;align-items:center;justify-content:center;font-size:22px;color:#d9cff0}
  .pill{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);padding:10px 20px;border-radius:999px}
  .accent{width:120px;height:8px;border-radius:99px;background:linear-gradient(90deg,#f4d58d,#d94f8a);margin:18px auto 0}
  </style></head><body><div class="dots"></div><div class="wrap">
  <div class="kicker">${event.city} · ${event.dateLabel}</div>
  <h1>${event.name}</h1>
  <div class="sub">Resultados oficiales y diplomas virtuales</div>
  <div class="accent"></div>
  <div class="card"><img src="${qrData}" alt="QR"><div class="url">${SITE_URL.replace(/^https?:\/\//, '')}</div><div class="cta">Escanea para buscar tu diploma</div></div>
  <div class="foot"><span class="pill">${event.total} deportistas</span><span class="pill">${event.categories.length} categorías</span><span class="pill">PDF oficial</span></div>
  </div></body></html>`;
  const posterPath = path.join(DIRS.tools, 'qr-poster.html');
  fs.writeFileSync(posterPath, html);
  let chrome = process.env.CHROME_PATH;
  if (!chrome) {
    const candidates = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ];
    chrome = candidates.find((p) => fs.existsSync(p));
  }
  if (!chrome) return { skipped: true };
  const { spawnSync } = require('child_process');
  const out = path.join(DIRS.assets, 'qr-whatsapp.png');
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1350', '--screenshot=' + out, 'file://' + posterPath.replace(/\\/g, '/')];
  spawnSync(chrome, args, { stdio: 'ignore', timeout: 120000 });
  return { skipped: false, ok: fs.existsSync(out), file: out };
}

async function main() {
  console.log('Reto Aeropuerto · build');
  ensureDirs();
  const pdfs = copyPdfs();
  copyVendors();
  console.log('PDFs copiados:', path.basename(pdfs.final), path.basename(pdfs.diplomas));

  console.log('Extrayendo PDFs...');
  const results = await extractResults(pdfs.final);
  const diplomas = await extractDiplomas(pdfs.diplomas);
  console.log(`Resultados: ${results.rows.length} filas (${results.rows.filter((r) => r.pos !== null).length} finalistas, ${results.rows.filter((r) => r.pos === null).length} DNS)`);
  console.log(`Diplomas: ${diplomas.diplomas.length} páginas, ${new Set(diplomas.diplomas.map((d) => d.dorsal)).size} dorsales únicos`);

  const bundle = mergeData(results, diplomas);
  writeData(bundle);
  fs.writeFileSync(path.join(DIRS.assets, 'qr-sitio.svg'), makeQrSvg(SITE_URL) + '\n');
  const poster = await makeQrPoster(bundle.event);
  if (poster.skipped) console.log('QR poster: Chrome no encontrado, se omite PNG (el SVG sí se generó).');
  else console.log('QR poster:', poster.ok ? 'assets/qr-whatsapp.png' : 'ERROR');

  // Limpieza de PDFs por diploma de builds antiguos (nunca deben existir)
  for (const f of fs.existsSync(path.join(ROOT, 'diplomas')) ? fs.readdirSync(path.join(ROOT, 'diplomas')) : []) {
    if (/^d-.*\.pdf$/i.test(f)) fs.rmSync(path.join(ROOT, 'diplomas', f), { force: true });
  }

  console.log('Renderizando diplomas WebP...');
  const render = await renderDiplomas(diplomas.diplomas);
  console.log(`Imágenes: ${render.rendered} nuevas, ${render.skipped} omitidas, ${render.failed.length} errores`);
  if (render.failed.length) console.log(render.failed.slice(0, 5));

  const images = fs.readdirSync(DIRS.img).filter((f) => /\.webp$/i.test(f));
  const imgBytes = images.reduce((s, f) => s + fs.statSync(path.join(DIRS.img, f)).size, 0);
  const pdfBytes = fs.statSync(path.join(DIRS.assets, 'resultados-oficiales.pdf')).size + fs.statSync(path.join(DIRS.assets, 'diplomas-oficiales.pdf')).size;
  const dataBytes = fs.statSync(path.join(DIRS.data, 'data.js')).size;
  console.log('\n=== REPORTE BUILD ===');
  console.log(`Total deportistas (diplomas): ${bundle.event.total}`);
  console.log(`Registros en resultados: ${bundle.event.registered} (DNS: ${bundle.event.dns})`);
  console.log(`Categorías: ${bundle.event.categories.length} -> ${bundle.event.categories.map((c) => c.label + ':' + c.total).join(' | ')}`);
  console.log(`Páginas únicas de diploma: ${diplomas.diplomas.length}`);
  console.log(`Imágenes WebP: ${images.length} (${(imgBytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`PDFs: ${(pdfBytes / 1024 / 1024).toFixed(1)} MB · data.js: ${(dataBytes / 1024).toFixed(0)} KB`);
  console.log(`Sin resultado: ${bundle.athletes.filter((a) => !a.hasResult).length} · Sin diploma: ${results.rows.filter((r) => !diplomas.diplomas.some((d) => d.dorsal === r.dorsal)).length}`);
  console.log(`SITE_URL (QR): ${SITE_URL}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
