'use strict';
/* Reto Aeropuerto · frontend vanilla. Datos 100 % de los PDF (vía data.js). */
(function () {
  const DATA = window.EVENT_DATA || null;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const PAGE_SIZE = 60;

  const state = {
    q: '',
    dist: '',
    cat: '',
    gen: '',
    sort: 'pos',
    visible: PAGE_SIZE,
    filtered: [],
    active: null,
    modalStack: [],
    focusStack: [],
    lastFocus: null,
    pdfCache: null,
    qrContext: null,
  };

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  const pad4 = (n) => String(n == null ? '' : n).padStart(4, '0');
  const display = (v) => (v == null || v === '' || v === '—' ? '—' : String(v));
  function timeToSec(t) {
    if (!t || !/^\d{1,2}:\d{2}:\d{2}$/.test(t)) return Number.POSITIVE_INFINITY;
    return t.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  }
  function fmt(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat('es-CO').format(n);
  }
  function track(name, props) {
    try {
      if (typeof window.va === 'function') window.va('event', Object.assign({ name }, props || {}));
    } catch (_) { /* analytics nunca debe romper la UI */ }
  }

  /* ---------- URL / base ---------- */
  function baseUrl() {
    if (location.protocol === 'file:') return (DATA && DATA.event.siteUrl) || '';
    const u = new URL(location.href);
    let p = u.pathname;
    if (/\/[^/]*\.[a-z0-9]+$/i.test(p)) p = p.replace(/\/[^/]*$/, '/');
    if (!p.endsWith('/')) p += '/';
    return u.origin + p;
  }
  function shareUrl(athlete) {
    const base = baseUrl();
    if (!athlete) return base;
    return base + '?dorsal=' + encodeURIComponent(athlete.dorsal);
  }
  function wa(text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }
  function safeFile(s) {
    return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function currentParams() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.dist) p.set('dist', state.dist);
    if (state.cat) p.set('cat', state.cat);
    if (state.gen) p.set('gen', state.gen);
    if (state.sort && state.sort !== 'pos') p.set('sort', state.sort);
    return p;
  }
  function syncUrl(extra) {
    try {
      if (location.protocol === 'file:') return;
      const p = currentParams();
      if (extra && extra.dorsal) p.set('dorsal', extra.dorsal);
      const qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (_) { /* file:// puede lanzar SecurityError */ }
  }
  function readUrl() {
    try {
      const p = new URLSearchParams(location.search);
      state.q = p.get('q') || '';
      state.dist = p.get('dist') || '';
      state.cat = p.get('cat') || '';
      state.gen = p.get('gen') || '';
      state.sort = ['pos', 'cat', 'time', 'name', 'dorsal'].includes(p.get('sort')) ? p.get('sort') : 'pos';
      return p.get('dorsal');
    } catch (_) {
      return null;
    }
  }

  /* ---------- UI helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setStatus(msg, isError) {
    const n = $('#dmStatus');
    if (!n) return;
    n.textContent = msg || '';
    n.classList.toggle('is-error', Boolean(isError));
  }

  /* ---------- Datos ---------- */
  const athletes = DATA && Array.isArray(DATA.athletes) ? DATA.athletes : [];
  const event = DATA ? DATA.event : null;

  function matches(a) {
    if (state.dist && a.distance !== state.dist) return false;
    if (state.cat && a.category !== state.cat) return false;
    if (state.gen && a.gender !== state.gen) return false;
    if (!state.q) return true;
    const q = norm(state.q);
    if (!q) return true;
    // Dorsal exacto cuando la búsqueda es solo numérica
    if (/^\d+$/.test(q)) {
      if (String(a.dorsal) === q) return true;
      return String(a.dorsal).startsWith(q);
    }
    const hay = norm([
      a.name,
      a.nameAlt,
      a.dorsal,
      a.city,
      a.category,
      a.catLabel,
      a.gender,
      a.time,
    ].join(' '));
    return q.split(' ').every((tok) => hay.includes(tok));
  }

  function sortList(list) {
    const copy = list.slice();
    const order = { '21K': 3, '15K': 2.5, '10K': 2, '5K': 1, '3K': .6, '1K': .2 };
    if (state.sort === 'name') {
      copy.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    } else if (state.sort === 'dorsal') {
      copy.sort((a, b) => Number(a.dorsal) - Number(b.dorsal));
    } else if (state.sort === 'time') {
      copy.sort((a, b) => timeToSec(a.time) - timeToSec(b.time) || (a.posGlobal || 1e9) - (b.posGlobal || 1e9));
    } else if (state.sort === 'cat') {
      copy.sort((a, b) => (order[b.distance] || 0) - (order[a.distance] || 0)
        || String(a.catLabel).localeCompare(String(b.catLabel), 'es')
        || (a.posCategory || 1e9) - (b.posCategory || 1e9)
        || (a.posGlobal || 1e9) - (b.posGlobal || 1e9));
    } else {
      copy.sort((a, b) => (order[b.distance] || 0) - (order[a.distance] || 0)
        || (a.posGlobal || 1e9) - (b.posGlobal || 1e9));
    }
    return copy;
  }

  /* ---------- Chips y filtros ---------- */
  function countBy(list, key) {
    const map = new Map();
    for (const a of list) map.set(a[key], (map.get(a[key]) || 0) + 1);
    return map;
  }
  function buildPills(container, items, active, onPick) {
    container.textContent = '';
    for (const item of items) {
      const b = el('button', null);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(item.value === active));
      b.appendChild(document.createTextNode(item.label));
      const c = el('span', 'pill-count', fmt(item.count));
      b.appendChild(c);
      b.addEventListener('click', () => onPick(item.value));
      container.appendChild(b);
    }
  }
  function renderFilters() {
    const distCounts = countBy(athletes, 'distance');
    const distItems = [{ value: '', label: 'Todas', count: athletes.length }];
    for (const [value, count] of [...distCounts.entries()].sort((a, b) => b[1] - a[1])) {
      distItems.push({ value, label: value.replace('K', 'K'), count });
    }
    buildPills($('#distancePills'), distItems, state.dist, (v) => {
      state.dist = v;
      if (v === '' && state.cat) state.cat = '';
      state.visible = PAGE_SIZE;
      renderAll();
      syncUrl();
    });

    const pool = state.dist ? athletes.filter((a) => a.distance === state.dist) : athletes;
    const catCounts = countBy(pool, 'category');
    const catItems = [{ value: '', label: 'Todas', count: pool.length }];
    for (const [value, count] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
      catItems.push({ value, label: display(value).replace(/^\d+K\s*/i, ''), count });
    }
    buildPills($('#categoryPills'), catItems, state.cat, (v) => {
      state.cat = v;
      state.visible = PAGE_SIZE;
      renderAll();
      syncUrl();
    });

    $$('#genderSeg button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.gen === state.gen));
    });
    $('#sort').value = state.sort;
    const hasFilter = Boolean(state.q || state.dist || state.cat || state.gen || state.sort !== 'pos');
    $('#resetFilters').hidden = !hasFilter;
    if (document.activeElement !== $('#q')) $('#q').value = state.q;
    $('#clearSearch').hidden = !state.q;
  }

  /* ---------- Lista ---------- */
  function buildRow(a) {
    const row = el('div', 'row' + (a.hasDiploma ? '' : ' is-dns'));
    row.setAttribute('role', 'row');
    row.dataset.dorsal = a.dorsal;
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${a.name}, dorsal ${a.dorsal}, ${a.catLabel}, tiempo ${display(a.time)}${a.hasDiploma ? '. Abrir diploma' : '. Sin diploma'}`);

    const pos = el('div', 'cell cell-pos');
    pos.setAttribute('role', 'cell');
    pos.appendChild(el('span', 'pos-num', a.posGlobal ? String(a.posGlobal) : '—'));
    pos.appendChild(el('small', null, 'general'));

    const dorsal = el('div', 'cell cell-dorsal', display(a.dorsal));
    dorsal.setAttribute('role', 'cell');

    const name = el('div', 'cell cell-name');
    name.setAttribute('role', 'cell');
    name.appendChild(el('strong', null, a.name));
    name.appendChild(el('span', 'name-sub', `${a.gender} · ${a.catLabel}`));

    const city = el('div', 'cell cell-city', display(a.city));
    city.setAttribute('role', 'cell');

    const cat = el('div', 'cell cell-cat');
    cat.setAttribute('role', 'cell');
    cat.appendChild(el('span', 'cat-pill', a.catLabel));

    const time = el('div', 'cell cell-time');
    time.setAttribute('role', 'cell');
    time.appendChild(el('strong', null, display(a.time)));
    time.appendChild(el('small', null, a.diff && a.diff !== '--' ? a.diff : (a.hasDiploma ? 'oficial' : 'DNS')));

    const pace = el('div', 'cell cell-pace');
    pace.setAttribute('role', 'cell');
    const pm = String(a.pace || '').match(/^(\d{1,2}:\d{2})/);
    pace.appendChild(el('span', null, pm ? pm[1] : '—'));
    pace.appendChild(el('small', null, 'min/km'));

    const action = el('div', 'cell cell-action');
    action.setAttribute('role', 'cell');
    const btn = el('button', 'row-btn', a.hasDiploma ? 'Ver diploma' : 'Sin diploma');
    btn.type = 'button';
    if (!a.hasDiploma) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); openDiploma(a, btn); });
    }
    action.appendChild(btn);

    row.append(pos, dorsal, name, city, cat, time, pace, action);
    if (a.hasDiploma) {
      row.addEventListener('click', () => openDiploma(a, row));
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDiploma(a, row); }
      });
    }
    return row;
  }

  function appendRows(slice) {
    const frag = document.createDocumentFragment();
    for (const a of slice) frag.appendChild(buildRow(a));
    $('#list').appendChild(frag);
  }

  function renderResults(reset) {
    state.filtered = sortList(athletes.filter(matches));
    if (reset) {
      state.visible = Math.min(PAGE_SIZE, state.filtered.length);
      $('#list').textContent = '';
      appendRows(state.filtered.slice(0, state.visible));
    } else {
      const prev = $('#list').children.length;
      appendRows(state.filtered.slice(prev, state.visible));
    }
    updateSummary();
  }

  function updateSummary() {
    const total = state.filtered.length;
    const shown = Math.min(state.visible, total);
    $('#totalCount').textContent = fmt(total);
    $('#table').setAttribute('aria-rowcount', String(total + 1));
    const parts = [];
    if (state.dist) parts.push(state.dist);
    if (state.cat) parts.push(display(state.cat));
    if (state.gen) parts.push(state.gen);
    if (state.q) parts.push(`«${state.q}»`);
    const sortLabel = $('#sort').selectedOptions[0] ? $('#sort').selectedOptions[0].textContent : 'Posición general';
    $('#summary').textContent = `Mostrando ${fmt(shown)} de ${fmt(total)} deportistas${parts.length ? ' · ' + parts.join(' · ') : ''} · ${sortLabel}`;
    $('#empty').hidden = total !== 0;
    $('#loadMore').hidden = shown >= total;
    if (shown < total) {
      $('#loadMore').textContent = `Cargar ${Math.min(PAGE_SIZE, total - shown)} más (${fmt(total - shown)} restantes)`;
      $('#loadNote').textContent = `${fmt(shown)} de ${fmt(total)} visibles`;
    } else {
      $('#loadNote').textContent = total ? 'Todos los resultados visibles.' : '';
    }
  }

  function renderAll() {
    renderFilters();
    renderResults(true);
  }

  /* ---------- Modal diploma ---------- */
  function openModal(id, trigger) {
    const modal = document.getElementById(id);
    if (!modal) return;
    state.lastFocus = trigger || document.activeElement;
    state.focusStack.push(state.lastFocus);
    modal.hidden = false;
    state.modalStack.push(id);
    document.body.style.overflow = 'hidden';
    const focusable = modal.querySelector('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  }
  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    state.modalStack = state.modalStack.filter((x) => x !== id);
    const restore = state.focusStack.pop();
    if (!state.modalStack.length) document.body.style.overflow = '';
    if (restore && document.contains(restore)) {
      try { restore.focus(); } catch (_) { /* noop */ }
    }
    if (id === 'diplomaModal') {
      state.active = null;
      syncUrl();
    }
  }
  function closeTopModal() {
    const top = state.modalStack[state.modalStack.length - 1];
    if (top) closeModal(top);
  }

  function openDiploma(a, trigger) {
    if (!a || !a.hasDiploma) return;
    state.active = a;
    $('#dmTitle').textContent = `Diploma · ${a.name}`;
    $('#dmName').textContent = a.name;
    $('#dmCat').textContent = a.catLabel;
    $('#dmMeta').textContent = `${a.gender} · ${a.city} · ${a.distance}`;
    $('#dmDorsal').textContent = display(a.dorsal);
    $('#dmTime').textContent = display(a.time);
    $('#dmPace').textContent = display(a.pace);
    $('#dmSpeed').textContent = display(a.speed);
    $('#dmPosCat').textContent = a.posCategory ? `${fmt(a.posCategory)} / ${fmt(a.totalCategory)}` : '—';
    $('#dmPosGlobal').textContent = a.posGlobal ? `${fmt(a.posGlobal)} / ${fmt(a.totalGlobal)}` : '—';
    $('#dmPrint').href = `print.html?dorsal=${encodeURIComponent(a.dorsal)}`;
    $('#dmWa').href = wa(`Mira el diploma de ${a.name} (dorsal ${a.dorsal}) en el ${event.name}: ${shareUrl(a)}`);
    $('#dmShare').onclick = () => openQr(a, $('#dmShare'));
    setStatus('');

    const img = $('#dmImg');
    const sk = $('#dmSkeleton');
    sk.classList.remove('is-hidden');
    img.style.visibility = 'hidden';
    img.alt = `Diploma de ${a.name}`;
    img.onload = () => {
      sk.classList.add('is-hidden');
      img.style.visibility = 'visible';
    };
    img.onerror = () => {
      sk.classList.add('is-hidden');
      img.style.visibility = 'visible';
      setStatus('No se pudo cargar la imagen del diploma.', true);
    };
    img.src = a.diplomaImg;
    $('#dmDesc').textContent = `Diploma oficial de ${a.name}, dorsal ${a.dorsal}, ${a.catLabel}.`;

    openModal('diplomaModal', trigger);
    syncUrl({ dorsal: a.dorsal });
    track('diploma_open', { dorsal: a.dorsal });
  }

  async function getPdfBytes() {
    if (state.pdfCache) return state.pdfCache;
    state.pdfCache = fetch(event.diplomasPdf, { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).catch((e) => {
      state.pdfCache = null;
      throw e;
    });
    return state.pdfCache;
  }

  async function downloadDiploma(a) {
    const btn = $('#dmDownload');
    if (!a || !a.hasDiploma) return;
    if (location.protocol === 'file:') {
      setStatus(`Abriendo el PDF oficial en la página ${a.diplomaPage}…`);
      window.open(`${event.diplomasPdf}#page=${a.diplomaPage}`, '_blank', 'noopener');
      return;
    }
    if (!window.PDFLib || !window.PDFLib.PDFDocument) {
      setStatus('No se cargó el generador de PDF. Abriendo el PDF oficial…', true);
      window.open(`${event.diplomasPdf}#page=${a.diplomaPage}`, '_blank', 'noopener');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Generando PDF…';
    setStatus('Generando PDF de 1 página…');
    try {
      const bytes = await getPdfBytes();
      const src = await window.PDFLib.PDFDocument.load(bytes);
      const out = await window.PDFLib.PDFDocument.create();
      const [page] = await out.copyPages(src, [a.diplomaPage - 1]);
      out.addPage(page);
      const pdfBytes = await out.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeFile(`Diploma - ${a.name} - ${event.name}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus('PDF listo: 1 página, tamaño original.');
      track('diploma_download', { dorsal: a.dorsal });
    } catch (e) {
      setStatus('No se pudo generar el PDF. Puedes abrir el PDF oficial con el botón Imprimir A4.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Descargar PDF';
    }
  }

  /* ---------- QR / compartir ---------- */
  function drawQr(container, text) {
    container.textContent = '';
    if (typeof window.qrcode !== 'function') {
      container.textContent = 'QR no disponible';
      return null;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const wrap = document.createElement('div');
    wrap.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
    const svg = wrap.querySelector('svg');
    if (svg) {
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Código QR');
    }
    if (svg) container.appendChild(svg);
    return svg;
  }

  function openQr(athlete, trigger) {
    state.qrContext = athlete || null;
    const url = shareUrl(athlete);
    const svg = drawQr($('#qrHolder'), url);
    $('#qrUrl').textContent = url;
    $('#qrWa').href = wa(athlete
      ? `Mira el diploma de ${athlete.name} (dorsal ${athlete.dorsal}) en el ${event.name}: ${url}`
      : `Resultados y diplomas del ${event.name}: ${url}`);
    $('#qrTitle').textContent = athlete ? 'QR del diploma' : 'QR del evento';
    $('#qrPrint').dataset.url = url;
    if (!svg) $('#qrHolder').textContent = 'No se pudo generar el QR.';
    if (!$('#qrModal').hidden) return;
    openModal('qrModal', trigger || document.activeElement);
    track('qr_open', athlete ? { dorsal: athlete.dorsal } : {});
  }

  function qrCanvasBlob() {
    return new Promise((resolve, reject) => {
      const svg = $('#qrHolder').querySelector('svg');
      if (!svg) return reject(new Error('sin QR'));
      const data = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        const size = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        const m = 74;
        ctx.drawImage(img, m, m, size - m * 2, size - m * 2);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
      };
      img.onerror = () => reject(new Error('svg'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function printQr() {
    const url = $('#qrPrint').dataset.url || shareUrl(state.qrContext);
    const svg = $('#qrHolder').querySelector('svg');
    if (!svg) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR · ${escapeHtml(event.name)}</title>
    <style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Arial,sans-serif;background:#fff;color:#241a33;display:grid;place-items:center;min-height:100vh}
    .card{width:190mm;padding:18mm 12mm;text-align:center}.name{font-size:26px;font-weight:900;letter-spacing:-.5px}.sub{color:#6b5e7a;margin:4px 0 10mm;font-size:13px}
    .qr{width:120mm;height:120mm;margin:0 auto;background:#fff}.qr svg{width:100%;height:100%}.url{margin-top:9mm;font-family:Consolas,monospace;font-size:12px;word-break:break-all}.foot{margin-top:12mm;font-size:11px;color:#7a6a8f}</style>
    </head><body><div class="card"><div class="name">${escapeHtml(event.name)}</div><div class="sub">${escapeHtml(event.city)} · ${escapeHtml(event.dateLabel)}</div><div class="qr">${new XMLSerializer().serializeToString(svg)}</div><div class="url">${escapeHtml(url)}</div><div class="foot">Escanea para consultar resultados y diplomas · TCTSAS</div></div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script></body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); state.q = $('#q').value.trim(); state.visible = PAGE_SIZE; renderAll(); syncUrl(); });
    let t = null;
    $('#q').addEventListener('input', () => {
      $('#clearSearch').hidden = !$('#q').value;
      clearTimeout(t);
      t = setTimeout(() => {
        state.q = $('#q').value.trim();
        state.visible = PAGE_SIZE;
        renderAll();
        syncUrl();
      }, 110);
    });
    $('#clearSearch').addEventListener('click', () => {
      $('#q').value = '';
      state.q = '';
      $('#clearSearch').hidden = true;
      state.visible = PAGE_SIZE;
      renderAll();
      syncUrl();
      $('#q').focus();
    });
    $('#sort').addEventListener('change', () => {
      state.sort = $('#sort').value;
      state.visible = PAGE_SIZE;
      renderAll();
      syncUrl();
    });
    $$('#genderSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        state.gen = b.dataset.gen;
        state.visible = PAGE_SIZE;
        renderAll();
        syncUrl();
      });
    });
    $('#loadMore').addEventListener('click', () => {
      state.visible += PAGE_SIZE;
      renderResults(false);
    });
    const reset = () => {
      state.q = ''; state.dist = ''; state.cat = ''; state.gen = ''; state.sort = 'pos';
      state.visible = PAGE_SIZE;
      $('#q').value = '';
      renderAll();
      syncUrl();
      $('#q').focus();
    };
    $('#resetFilters').addEventListener('click', reset);
    $('#emptyReset').addEventListener('click', reset);

    $$('[data-close]').forEach((n) => {
      n.addEventListener('click', () => closeModal(n.dataset.close === 'diploma' ? 'diplomaModal' : 'qrModal'));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeTopModal(); return; }
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault(); $('#q').focus(); return;
      }
      if (e.key !== 'Tab' || !state.modalStack.length) return;
      const modal = document.getElementById(state.modalStack[state.modalStack.length - 1]);
      if (!modal) return;
      const nodes = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
        .filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    $('#dmDownload').addEventListener('click', () => downloadDiploma(state.active));
    $('#openQrTop').addEventListener('click', () => openQr(null, $('#openQrTop')));
    $('#openQrHero').addEventListener('click', () => openQr(null, $('#openQrHero')));
    $('#qrCopy').addEventListener('click', async () => {
      const url = shareUrl(state.qrContext);
      try {
        await navigator.clipboard.writeText(url);
        $('#qrUrl').textContent = 'Enlace copiado: ' + url;
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); $('#qrUrl').textContent = 'Enlace copiado: ' + url; } catch (e) { $('#qrUrl').textContent = url; }
        ta.remove();
      }
    });
    $('#qrPng').addEventListener('click', async () => {
      try {
        const blob = await qrCanvasBlob();
        downloadBlob(blob, safeFile(`QR - ${event.name}.png`));
        $('#qrUrl').textContent = 'PNG 1024×1024 descargado.';
        setTimeout(() => { $('#qrUrl').textContent = shareUrl(state.qrContext); }, 2200);
      } catch (e) {
        $('#qrUrl').textContent = 'No se pudo generar el PNG.';
      }
    });
    $('#qrPrint').addEventListener('click', printQr);

    $('#waEvent').href = wa(`Resultados y diplomas del ${event.name}: ${baseUrl()}`);
  }

  function boot() {
    if (!DATA || !event || !athletes.length) {
      document.body.insertAdjacentHTML('afterbegin', '<div style="padding:20px;font-family:Segoe UI,Arial;background:#fff3cd;color:#664d03">No se encontraron datos. Abre la app desde la carpeta App/ (data.js) o ejecuta <code>node tools/build.js</code>.</div>');
      return;
    }
    document.title = `${event.name} · Resultados y diplomas`;
    $('#statTotal').textContent = fmt(event.total);
    $('#statCats').textContent = fmt(event.categories.length);
    $('#statDiplomas').textContent = fmt(athletes.filter((a) => a.hasDiploma).length);
    bind();
    const dorsal = readUrl();
    renderAll();
    if (state.q) $('#q').value = state.q;
    if (dorsal) {
      const a = athletes.find((x) => String(x.dorsal) === String(dorsal));
      if (a) setTimeout(() => openDiploma(a, null), 60);
      else setStatus('No se encontró el dorsal ' + dorsal, true);
    }
    track('page_view_ready', { total: event.total });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
