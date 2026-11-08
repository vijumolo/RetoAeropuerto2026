'use strict';
// Fase 1: volcado de la capa de texto de los PDF del evento.
// Uso:
//   node tools/items.js                 -> resumen de ambos PDF
//   node tools/items.js resultados 1    -> items de la página 1 de resultados
//   node tools/items.js diplomas 1      -> items de la página 1 de diplomas
//   node tools/items.js resultados --all > tmp-items-resultados.txt
const fs = require('fs');
const path = require('path');
const { EVENT_DIR, openPdf, pageItems } = require('./lib/pdftext');

function findPdf(prefix) {
  const files = fs.readdirSync(EVENT_DIR).filter((f) => /\.pdf$/i.test(f));
  const hit = files.find((f) => new RegExp('^' + prefix, 'i').test(f));
  if (!hit) throw new Error('No se encontró PDF que empiece por ' + prefix);
  return path.join(EVENT_DIR, hit);
}

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const rest = argv.filter((a) => !a.startsWith('--'));
  const which = rest[0] || 'resumen';
  const pageArg = rest[1] || '1';
  const targets = which === 'resumen' ? ['final', 'diplomas'] : [which];

  for (const t of targets) {
    const file = findPdf(t === 'final' ? 'FINAL' : t === 'diplomas' ? 'DIPLOMAS' : t);
    const { doc } = await openPdf(file);
    const view = (await doc.getPage(1)).view;
    console.log(`# ${path.basename(file)} páginas=${doc.numPages} view=${view.join('x')} orientación=${view[2] > view[3] ? 'horizontal' : 'vertical'}`);
    if (which === 'resumen' || !all) {
      if (which !== 'resumen') {
        const p = Number(pageArg);
        const page = await doc.getPage(p);
        const items = await pageItems(page);
        console.log(`## página ${p} (${items.length} items)`);
        for (const it of items) {
          console.log(`x=${it.x}\ty=${it.y}\tsize=${it.size}\t${JSON.stringify(it.str)}`);
        }
      }
    }
    if (which === 'resumen') {
      // muestra de la primera página
      const items = await pageItems(await doc.getPage(1));
      console.log(`## muestra pág 1 (${items.length} items)`);
      for (const it of items.slice(0, 80)) {
        console.log(`x=${it.x}\ty=${it.y}\tsize=${it.size}\t${JSON.stringify(it.str)}`);
      }
    }
    if (all) {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const items = await pageItems(page);
        console.log(`## página ${p} (${items.length} items)`);
        for (const it of items) {
          console.log(`x=${it.x}\ty=${it.y}\tsize=${it.size}\t${JSON.stringify(it.str)}`);
        }
      }
    }
    await doc.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
