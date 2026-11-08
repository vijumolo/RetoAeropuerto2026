'use strict';
// Fase 2: extracción de resultados y diplomas a un JSON intermedio.
// Uso: node tools/extract.js
const fs = require('fs');
const path = require('path');
const { EVENT_DIR, ROOT, openPdf, pageItems, toLines, norm, round } = require('./lib/pdftext');

const OUT = path.join(ROOT, 'tmp-extract.json');

function findPdf(prefix) {
  const hit = fs.readdirSync(EVENT_DIR).filter((f) => /\.pdf$/i.test(f)).find((f) => new RegExp('^' + prefix, 'i').test(f));
  if (!hit) throw new Error('PDF no encontrado: ' + prefix);
  return path.join(EVENT_DIR, hit);
}

const isTime = (s) => /^\d{1,2}:\d{2}:\d{2}$/.test(s);
const isPos = (s) => /^\d+\.$/.test(s);
const isDns = (s) => /^(DNS|DNF|DSQ|NP)$/i.test(s);
const parsePos = (s) => {
  const m = String(s).match(/(\d+)\s*\.?\s*\/\s*(\d+)/);
  return m ? { pos: Number(m[1]), total: Number(m[2]) } : null;
};

function velocityOK(s) {
  return /^\d+[.,]\d+\s*Km\/h$/i.test(s);
}
function paceOK(s) {
  // En este evento el ritmo viene como "2:24 Min/km" (sin decimales de segundo).
  return /^\d{1,2}:\d{2}(?:[,.]\d{2})?\s*Min\/km$/i.test(s);
}

// ---------- Resultados ----------
async function extractResults(file) {
  const { doc } = await openPdf(file);
  const rows = [];
  const sections = [];
  let categoryLabel = null;
  let distance = null;
  let gender = null;
  let categoryId = null;
  const pages = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const items = await pageItems(await doc.getPage(p));
    const lines = toLines(items);
    pages.push({ page: p, items: items.length, lines: lines.length });
    for (const line of lines) {
      const first = line.items[0];
      if (!first) continue;
      // Encabezado de categoría: "10 K ABIERTA (18-39)"
      if (/^\d+\s*K\b/i.test(first.str) && line.items.length <= 4 && first.size >= 11) {
        categoryLabel = line.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        const dm = categoryLabel.match(/^(\d+)\s*K\b/i);
        distance = dm ? dm[1] + 'K' : null;
        categoryId = categoryLabel
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        gender = null;
        sections.push({ kind: 'category', page: p, y: line.y, label: categoryLabel });
        continue;
      }
      // Género
      if (/^(Damas|Hombres|Caballeros|Mixta)$/i.test(line.text) && line.items.length === 1) {
        gender = /^damas$/i.test(line.text) ? 'Damas' : /^mixta$/i.test(line.text) ? 'Mixta' : 'Hombres';
        sections.push({ kind: 'gender', page: p, y: line.y, label: gender });
        continue;
      }
      if (!categoryLabel) continue;
      const posStr = first.str;
      if (!isPos(posStr) && !isDns(posStr)) continue;

      // Columnas por x (evidencia §3)
      const byX = (min, max) => line.items.find((i) => i.x >= min && i.x < max);
      const pos = isPos(posStr) ? Number(posStr.replace('.', '')) : null;
      const chip = (byX(35, 60) || {}).str || null;
      const nameItem = byX(90, 300);
      const cityItem = byX(300, 390);
      const timeItem = byX(390, 445);
      const diffItem = byX(445, 485);
      const speedItem = byX(485, 535);
      const paceItem = byX(535, 600);

      let name = nameItem ? nameItem.str : '';
      let city = cityItem ? cityItem.str : '';
      // Fallback: si nombre y ciudad vienen fusionados, no inventamos; se deja ciudad vacía.
      rows.push({
        page: p,
        y: line.y,
        dorsal: chip ? chip.trim() : null,
        pos,
        status: pos === null ? posStr.toUpperCase() : 'OK',
        name: name.trim(),
        city: city.trim(),
        time: timeItem && isTime(timeItem.str.trim()) ? timeItem.str.trim() : null,
        diff: diffItem ? diffItem.str.trim() : null,
        speed: speedItem && velocityOK(speedItem.str.trim()) ? speedItem.str.trim() : null,
        pace: paceItem && paceOK(paceItem.str.trim()) ? paceItem.str.trim() : null,
        categoryLabel,
        categoryId,
        distance,
        gender,
      });
    }
  }
  await doc.destroy();
  return { rows, sections, pages };
}

// ---------- Diplomas ----------
async function extractDiplomas(file) {
  const { doc } = await openPdf(file);
  const diplomas = [];
  const dupReport = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const raw = await pageItems(await doc.getPage(p));
    // Deduplicación exacta por (x,y,str) redondeados
    const seen = new Set();
    const items = [];
    let dups = 0;
    for (const it of raw) {
      const key = `${Math.round(it.x)},${Math.round(it.y)},${it.str}`;
      if (seen.has(key)) { dups++; continue; }
      seen.add(key);
      items.push(it);
    }
    if (dups) dupReport.push({ page: p, dups });

    // El nombre puede empezar muy a la izquierda si es largo (x=40 en el dorsal 330).
    const nameItem = items
      .filter((i) => i.size >= 24 && i.y >= 280 && i.y <= 450 && !/DORSAL/i.test(i.str))
      .sort((a, b) => b.size - a.size)[0];
    const dorsalLabel = items.find((i) => /^DORSAL\s*No\.?$/i.test(i.str.trim()));
    const dorsalItem = dorsalLabel
      ? items.filter((i) => Math.abs(i.y - dorsalLabel.y) < 3 && i.x > dorsalLabel.x && /^\d+$/.test(i.str.trim())).sort((a, b) => a.x - b.x)[0]
      : null;
    const categoryItem = items
      .filter((i) => i.size >= 20 && i.y >= 170 && i.y <= 240 && /^\d+\s*K\b/i.test(i.str))
      .sort((a, b) => b.size - a.size)[0];
    const posItems = items.filter((i) => parsePos(i.str)).map((i) => ({ ...parsePos(i.str), item: i }));
    const catPos = posItems.filter((x) => x.item.x < 350).sort((a, b) => b.item.x - a.item.x)[0] || null;
    const globalPos = posItems.filter((x) => x.item.x >= 350).sort((a, b) => a.item.x - b.item.x)[0] || null;
    const timeItem = items.find((i) => i.y >= 120 && i.y <= 170 && isTime(i.str.trim()));
    const distanceItem = items.find((i) => i.y >= 120 && i.y <= 170 && /^\d+\s*K$/i.test(i.str.trim()));

    const categoryLabel = categoryItem ? categoryItem.str.trim() : null;
    const dm = categoryLabel && categoryLabel.match(/^(\d+)\s*K\b/i);
    diplomas.push({
      page: p,
      dorsal: dorsalItem ? dorsalItem.str.trim() : null,
      name: nameItem ? nameItem.str.trim() : null,
      nameSize: nameItem ? nameItem.size : null,
      categoryLabel,
      distance: distanceItem ? distanceItem.str.trim().replace(/\s+/g, '') : dm ? dm[1] + 'K' : null,
      time: timeItem ? timeItem.str.trim() : null,
      posCategory: catPos ? catPos.pos : null,
      totalCategory: catPos ? catPos.total : null,
      posGlobal: globalPos ? globalPos.pos : null,
      totalGlobal: globalPos ? globalPos.total : null,
      duplicateItems: dups,
    });
  }
  await doc.destroy();
  return { diplomas, dupReport };
}

async function main() {
  const resultsFile = findPdf('FINAL');
  const diplomasFile = findPdf('DIPLOMAS');
  const results = await extractResults(resultsFile);
  const diplomas = await extractDiplomas(diplomasFile);

  const byDorsal = new Map();
  for (const d of diplomas.diplomas) {
    if (!d.dorsal) continue;
    if (!byDorsal.has(d.dorsal)) byDorsal.set(d.dorsal, []);
    byDorsal.get(d.dorsal).push(d);
  }
  const matched = results.rows.filter((r) => r.dorsal && byDorsal.has(r.dorsal));
  const unmatchedResults = results.rows.filter((r) => r.dorsal && !byDorsal.has(r.dorsal));
  const matchedDorsals = new Set(matched.map((r) => r.dorsal));
  const unmatchedDiplomas = diplomas.diplomas.filter((d) => d.dorsal && !matchedDorsals.has(d.dorsal));

  const summary = {
    resultsPages: results.pages.length,
    resultRows: results.rows.length,
    resultFinishers: results.rows.filter((r) => r.pos !== null).length,
    resultDns: results.rows.filter((r) => r.pos === null).length,
    diplomaPages: diplomas.diplomas.length,
    diplomaUniqueDorsals: byDorsal.size,
    duplicateDorsalDiplomas: [...byDorsal.entries()].filter(([, v]) => v.length > 1),
    duplicateTextPages: diplomas.dupReport.length,
    duplicateTextTotal: diplomas.dupReport.reduce((s, x) => s + x.dups, 0),
    matchedByDorsal: matched.length,
    unmatchedResults: unmatchedResults.length,
    unmatchedDiplomas: unmatchedDiplomas.length,
    missingTime: results.rows.filter((r) => !r.time).length,
    missingCity: results.rows.filter((r) => !r.city).length,
    missingPos: results.rows.filter((r) => r.pos === null).length,
    missingNameDiploma: diplomas.diplomas.filter((d) => !d.name).length,
    missingDorsalDiploma: diplomas.diplomas.filter((d) => !d.dorsal).length,
    missingPosDiploma: diplomas.diplomas.filter((d) => !d.posCategory || !d.posGlobal).length,
    sections: results.sections,
    counts: {},
    sampleResults: results.rows.slice(0, 3),
    sampleDiplomas: diplomas.diplomas.slice(0, 3),
  };
  for (const r of results.rows) {
    const k = `${r.categoryLabel} | ${r.gender}`;
    summary.counts[k] = summary.counts[k] || { total: 0, finishers: 0, dns: 0 };
    summary.counts[k].total++;
    if (r.pos !== null) summary.counts[k].finishers++; else summary.counts[k].dns++;
  }
  // Totales oficiales desde diplomas
  const official = {};
  for (const d of diplomas.diplomas) {
    const k = d.categoryLabel || '?';
    official[k] = official[k] || { totalCategory: d.totalCategory, totalGlobal: d.totalGlobal, pages: 0 };
    official[k].pages++;
  }
  summary.officialTotals = official;
  summary.unmatchedResultSamples = unmatchedResults.slice(0, 10);

  fs.writeFileSync(OUT, JSON.stringify({ results, diplomas, summary }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nEscrito ' + OUT);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { extractResults, extractDiplomas, parsePos, findPdf, isTime, isPos, isDns };
