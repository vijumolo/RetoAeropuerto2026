'use strict';
// Utilidades compartidas para leer la capa de texto de un PDF con pdfjs-dist 3.11.174.
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const EVENT_DIR = path.resolve(ROOT, '..');

function pdfjsLegacy() {
  // @napi-rs/canvas sustituye a node-canvas (que no compila en Windows sin VS build tools).
  const napi = require(path.join(ROOT, 'node_modules', '@napi-rs', 'canvas'));
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = napi.DOMMatrix;
  if (!globalThis.Path2D) globalThis.Path2D = napi.Path2D;
  if (!globalThis.ImageData) globalThis.ImageData = napi.ImageData;
  return require(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
}

function makeCanvasFactory() {
  const napi = require(path.join(ROOT, 'node_modules', '@napi-rs', 'canvas'));
  return {
    create(width, height) {
      const canvas = napi.createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(entry, width, height) {
      entry.canvas.width = Math.max(1, Math.floor(width));
      entry.canvas.height = Math.max(1, Math.floor(height));
    },
    destroy(entry) {
      entry.canvas = null;
      entry.context = null;
    },
  };
}

async function openPdf(file, options = {}) {
  const pdfjs = pdfjsLegacy();
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    canvasFactory: makeCanvasFactory(),
    ...options,
  }).promise;
  return { doc, pdfjs };
}

async function pageItems(page) {
  const tc = await page.getTextContent();
  return tc.items
    .filter((it) => typeof it.str === 'string')
    .map((it) => ({
      str: it.str,
      x: round(it.transform[4]),
      y: round(it.transform[5]),
      size: round(Math.hypot(it.transform[2], it.transform[3]) || it.height || 0),
    }))
    .filter((it) => it.str.trim() !== '');
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Agrupa items por línea (y) y ordena por x.
function toLines(items, tol = 2.5) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (!line) {
      line = { y: it.y, items: [] };
      lines.push(line);
    }
    line.items.push(it);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    l.y = round(l.items.reduce((s, i) => s + i.y, 0) / l.items.length);
  }
  return lines.sort((a, b) => b.y - a.y);
}

function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = { ROOT, EVENT_DIR, openPdf, pageItems, toLines, norm, round, pdfjsLegacy };
