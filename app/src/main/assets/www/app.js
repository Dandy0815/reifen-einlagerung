(() => {
'use strict';

const $ = id => document.getElementById(id);
const nf = n => n.toLocaleString('de-DE');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = v => String(v == null ? '' : v).trim().toLowerCase();
const slug = s => String(s).toLowerCase().replace(/[äöüß]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[c])).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const PAGE = 50;
const CAP = { L: 2953, M: 2331, Q: 1663, H: 1273 };
const enc = new TextEncoder();
const blen = s => enc.encode(s).length;

const DEFAULT_FIELDS = [
  { key: 'artikelnr', label: 'Artikelnr', hint: 'Eindeutige Artikel- oder Bestellnummer' },
  { key: 'bezeichnung', label: 'Bezeichnung', hint: 'Name oder Beschreibung des Artikels' },
  { key: 'menge', label: 'Menge', hint: 'Anzahl' },
  { key: 'einheit', label: 'Einheit', hint: 'z. B. Stk, kg, m' },
  { key: 'preis', label: 'Preis', hint: 'Einzelpreis' },
  { key: 'lieferant', label: 'Lieferant', hint: 'Lieferant oder Hersteller' }
];

const S = {
  fields: DEFAULT_FIELDS.map(f => ({ ...f })),
  draft: DEFAULT_FIELDS.map(f => ({ ...f })), draftDirty: false,
  records: [], page: 0, q: '', tab: 'db', dbOk: false, dbLoaded: false,
  ex: { kind: '', name: '', lines: [], text: '', map: [], rows: [], pages: 0, chars: 0 },
  qr: { colsOff: new Set(), rowsOff: new Set(), q: '', items: [], capSig: '' }
};

function setMsg(id, text, cls) { const e = $(id); if (!e) return; e.textContent = text || ''; e.className = 'msg' + (cls ? ' ' + cls : ''); }

/* ---------- Lokale Datenbank (IndexedDB) ---------- */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('qr-datenbank', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('records', { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = (store, mode, fn) => open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('abgebrochen'));
  }));
  return {
    all: store => run(store, 'readonly', s => s.getAll()),
    put: (store, obj) => run(store, 'readwrite', s => s.put(obj)),
    putMany: (store, arr) => run(store, 'readwrite', s => { arr.forEach(o => s.put(o)); }),
    del: (store, key) => run(store, 'readwrite', s => s.delete(key))
  };
})();

const sortRecords = () => S.records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/* ---------- Tabs, Status ---------- */
function showTab(name) {
  S.tab = name;
  if (name !== 'sc') camStop();
  ['db', 'in', 'fd', 'qr', 'sc'].forEach(t => {
    $('p-' + t).hidden = t !== name;
    $('t-' + t).setAttribute('aria-selected', String(t === name));
  });
  if (name === 'qr') renderQr();
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

function renderStatus() {
  const set = (id, on, yes, no) => { const e = $(id); e.className = 'dot ' + (on ? 'on' : 'off'); e.textContent = on ? yes : no; };
  set('stDb', S.dbOk, 'Lokal gespeichert', 'Speicher nicht verfügbar');
  set('stPdf', !!window.pdfjsLib, 'PDF-Leser bereit', 'PDF-Leser fehlt');
  set('stQr', typeof qrcode !== 'undefined', 'QR-Erzeugung bereit', 'QR-Erzeugung fehlt');
  $('dbNote').innerHTML = S.dbOk ? '' : '<p class="note bad">Der Gerätespeicher ist nicht verfügbar. Eingaben werden nicht gespeichert.</p>';
  $('addRec').disabled = !S.dbOk;
  $('rvSave').disabled = !S.dbOk || !pending().length;
}

/* ---------- Dateien speichern, drucken ---------- */
let pendingMsg = 'dbMsg';
window.onNativeSaved = (ok, name) => setMsg(pendingMsg, ok ? 'Gespeichert: ' + name : 'Speichern abgebrochen.', ok ? 'ok' : '');
const blobToBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
function saveFile(name, data, mime, msgId) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  pendingMsg = msgId;
  if (window.Android && window.Android.saveFile) {
    blobToBase64(blob).then(b64 => window.Android.saveFile(name, mime, b64), () => setMsg(msgId, 'Datei konnte nicht vorbereitet werden.', 'bad'));
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  setMsg(msgId, 'Gespeichert: ' + name, 'ok');
}
function printHtml(html, title) {
  if (window.Android && window.Android.printHtml) { window.Android.printHtml(html, title); return; }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.print(); } catch (e) { /* ignorieren */ } setTimeout(() => f.remove(), 2000); }, 300);
}

/* ---------- CSV-Hilfen ---------- */
const q = v => { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function parseCSV(text, d) {
  const rows = []; let row = [], cell = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += ch;
    } else if (ch === '"' && cell === '') inq = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function detectDelim(t) {
  const line = t.split(/\r?\n/).find(l => l.trim()) || '';
  let best = null, max = 0;
  [';', '\t', '|', ','].forEach(d => {
    let n = 0, inq = false;
    for (let i = 0; i < line.length; i++) { if (line[i] === '"') inq = !inq; else if (!inq && line[i] === d) n++; }
    if (n > max) { max = n; best = d; }
  });
  return best;
}

/* ---------- Datenbank-Tab ---------- */
function filtered() {
  const t = S.q.trim().toLowerCase();
  if (!t) return S.records;
  return S.records.filter(r => Object.keys(r.values || {}).some(k => String(r.values[k]).toLowerCase().includes(t)) || String(r.source || '').toLowerCase().includes(t));
}
let dbDirty = false;
function renderDb() {
  const tbl = $('dbTbl');
  if (tbl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { dbDirty = true; return; }
  dbDirty = false;
  $('cnt').textContent = nf(S.records.length);
  const list = filtered(), pages = Math.max(1, Math.ceil(list.length / PAGE));
  if (S.page >= pages) S.page = pages - 1;
  const slice = list.slice(S.page * PAGE, S.page * PAGE + PAGE);
  if (!slice.length) {
    tbl.innerHTML = ''; $('dbWrap').style.display = 'none';
    const m = !S.dbLoaded ? 'Lade Datensätze …' : (S.q ? 'Keine Treffer für diese Suche.' : 'Noch keine Datensätze. Lesen Sie im Reiter „Einlesen“ eine PDF- oder CSV-Datei ein oder fügen Sie einen Datensatz von Hand hinzu.');
    const el = $('dbMsg'); if (!/ok|bad/.test(el.className)) { el.textContent = m; el.className = 'msg'; }
  } else {
    $('dbWrap').style.display = '';
    const head = '<thead><tr>' + S.fields.map(f => '<th>' + esc(f.label) + '</th>').join('') + '<th>Quelle</th><th></th></tr></thead>';
    const body = slice.map(r => '<tr>' + S.fields.map(f =>
      '<td><input type="text" data-id="' + esc(r.id) + '" data-key="' + esc(f.key) + '" value="' + esc((r.values || {})[f.key]) + '" aria-label="' + esc(f.label) + '"></td>').join('') +
      '<td class="meta">' + esc(r.source || '') + '</td><td class="act"><button class="btn small danger" type="button" data-del="' + esc(r.id) + '">Löschen</button></td></tr>').join('');
    tbl.innerHTML = head + '<tbody>' + body + '</tbody>';
  }
  $('pg').textContent = 'Seite ' + (S.page + 1) + ' von ' + pages + ' · ' + nf(list.length) + ' Einträge';
  $('prev').disabled = S.page === 0; $('next').disabled = S.page >= pages - 1;
}
$('q').addEventListener('input', () => { S.q = $('q').value; S.page = 0; renderDb(); });
$('prev').addEventListener('click', () => { S.page = Math.max(0, S.page - 1); renderDb(); });
$('next').addEventListener('click', () => { S.page++; renderDb(); });
$('dbTbl').addEventListener('change', e => {
  const i = e.target; if (!i.dataset || !i.dataset.id) return;
  const rec = S.records.find(r => r.id === i.dataset.id); if (!rec) return;
  rec.values = { ...rec.values, [i.dataset.key]: i.value };
  DB.put('records', rec).then(() => setMsg('dbMsg', 'Gespeichert.', 'ok'), () => setMsg('dbMsg', 'Änderung nicht gespeichert.', 'bad'));
});
$('dbTbl').addEventListener('focusout', () => setTimeout(() => { if (dbDirty) renderDb(); }, 150));
const armed = {};
$('dbTbl').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const id = b.dataset.del;
  if (!armed[id]) { armed[id] = setTimeout(() => { delete armed[id]; b.textContent = 'Löschen'; }, 3000); b.textContent = 'Wirklich löschen?'; return; }
  clearTimeout(armed[id]); delete armed[id];
  DB.del('records', id).then(() => { S.records = S.records.filter(r => r.id !== id); setMsg('dbMsg', 'Datensatz gelöscht.', 'ok'); renderAll(); }, () => setMsg('dbMsg', 'Löschen nicht möglich.', 'bad'));
});
$('addRec').addEventListener('click', () => {
  const rec = { id: uid(), values: {}, source: 'von Hand', createdAt: Date.now() };
  DB.put('records', rec).then(() => { S.records.unshift(rec); S.page = 0; setMsg('dbMsg', 'Leerer Datensatz angelegt.', 'ok'); renderAll(); }, () => setMsg('dbMsg', 'Anlegen nicht möglich.', 'bad'));
});
$('toQr').addEventListener('click', () => showTab('qr'));
function tableRows(list) { return list.map(r => S.fields.map(f => (r.values && r.values[f.key]) || '')); }
$('expCsv').addEventListener('click', () => {
  const csv = '﻿' + [S.fields.map(f => q(f.label)).join(';')].concat(tableRows(filtered()).map(r => r.map(q).join(';'))).join('\r\n');
  saveFile('reifen-einlagerung.csv', csv, 'text/csv', 'dbMsg');
});
$('bkSave').addEventListener('click', () => {
  const data = JSON.stringify({ app: 'qr-datenbank', version: 1, fields: S.fields, records: S.records }, null, 1);
  saveFile('reifen-einlagerung-sicherung.json', data, 'application/json', 'dbMsg');
});
$('bkLoad').addEventListener('click', () => $('bkFile').click());
$('bkFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.app !== 'qr-datenbank' || !Array.isArray(d.records)) throw new Error('Das ist keine Sicherung dieser App.');
    const recs = d.records.filter(r => r && r.id && r.values).map(r => ({ id: String(r.id), values: r.values, source: r.source || '', createdAt: r.createdAt || Date.now() }));
    if (Array.isArray(d.fields) && d.fields.length) {
      S.fields = d.fields.map(x => ({ key: String(x.key), label: String(x.label || x.key), hint: String(x.hint || '') }));
      S.draft = S.fields.map(x => ({ ...x })); S.draftDirty = false;
      await DB.put('meta', { key: 'schema', fields: S.fields });
    }
    await DB.putMany('records', recs);
    const map = new Map(S.records.map(r => [r.id, r])); recs.forEach(r => map.set(r.id, r));
    S.records = Array.from(map.values()); sortRecords();
    renderFields(); renderAll(); setMsg('dbMsg', nf(recs.length) + ' Datensätze aus der Sicherung geladen.', 'ok');
  } catch (err) { setMsg('dbMsg', 'Sicherung nicht geladen: ' + err.message, 'bad'); }
});

/* ---------- Felder-Tab ---------- */
function renderFields() {
  $('fields').innerHTML = S.draft.map((f, i) =>
    '<div class="frow"><input type="text" data-fi="' + i + '" data-p="label" value="' + esc(f.label) + '" aria-label="Feldname" placeholder="Feldname">' +
    '<input class="hintin" type="text" data-fi="' + i + '" data-p="hint" value="' + esc(f.hint) + '" aria-label="Beschreibung" placeholder="Beschreibung">' +
    '<span class="row"><button class="btn small" type="button" data-mv="' + i + '" data-d="-1" aria-label="Nach oben"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
    '<button class="btn small" type="button" data-mv="' + i + '" data-d="1" aria-label="Nach unten"' + (i === S.draft.length - 1 ? ' disabled' : '') + '>↓</button>' +
    '<button class="btn small danger" type="button" data-rm="' + i + '">Entfernen</button></span></div>').join('');
}
$('fields').addEventListener('input', e => { const t = e.target; if (t.dataset.fi == null) return; S.draft[+t.dataset.fi][t.dataset.p] = t.value; S.draftDirty = true; });
$('fields').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.rm != null) { S.draft.splice(+b.dataset.rm, 1); S.draftDirty = true; renderFields(); }
  else if (b.dataset.mv != null) { const i = +b.dataset.mv, j = i + +b.dataset.d; [S.draft[i], S.draft[j]] = [S.draft[j], S.draft[i]]; S.draftDirty = true; renderFields(); }
});
$('addField').addEventListener('click', () => {
  S.draft.push({ key: '', label: '', hint: '' }); S.draftDirty = true; renderFields();
  const ins = $('fields').querySelectorAll('input[data-p="label"]'); if (ins.length) ins[ins.length - 1].focus();
});
$('saveFields').addEventListener('click', () => {
  const used = new Set(), out = [];
  S.draft.forEach(f => {
    const label = f.label.trim(); if (!label) return;
    let key = f.key || slug(label) || 'feld'; const base = key; let n = 2;
    while (used.has(key)) key = base + '_' + (n++);
    used.add(key); out.push({ key, label, hint: f.hint.trim() });
  });
  if (!out.length) { setMsg('fdMsg', 'Mindestens ein Feld mit Namen ist nötig.', 'bad'); return; }
  DB.put('meta', { key: 'schema', fields: out }).then(() => {
    S.fields = out; S.draft = out.map(f => ({ ...f })); S.draftDirty = false;
    renderFields(); renderAll(); setMsg('fdMsg', 'Felder gespeichert.', 'ok');
  }, () => setMsg('fdMsg', 'Felder konnten nicht gespeichert werden.', 'bad'));
});

/* ---------- Einlesen ---------- */
function resetEx() {
  S.ex = { kind: '', name: '', lines: [], text: '', map: [], rows: [], pages: 0, chars: 0 };
  $('review').hidden = true; $('mapBox').hidden = true; $('fileInfo').hidden = true;
  setMsg('mapMsg', ''); setMsg('rvMsg', '');
}
function pageLines(items) {
  const rows = [];
  items.forEach(it => {
    if (!it.str || !it.str.trim()) return;
    const y = it.transform[5];
    let r = rows.find(r => Math.abs(r.y - y) <= 2.5);
    if (!r) { r = { y, items: [] }; rows.push(r); }
    r.items.push({ x: it.transform[4], w: it.width, s: it.str });
  });
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => r.items.sort((a, b) => a.x - b.x));
}
async function readPdf(file) {
  if (!window.pdfjsLib) { setMsg('srcMsg', 'Der PDF-Leser fehlt in dieser App-Version.', 'bad'); return; }
  setMsg('srcMsg', 'Lese ' + file.name + ' …');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false, disableFontFace: true }).promise;
    const lines = []; let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      setMsg('srcMsg', 'Lese Seite ' + p + ' von ' + pdf.numPages + ' …');
      const pg = await pdf.getPage(p), tc = await pg.getTextContent();
      pageLines(tc.items).forEach(l => { lines.push(l); l.forEach(i => { chars += i.s.length; }); });
    }
    S.ex = { kind: 'pdf', name: file.name, lines, text: '', map: [], rows: [], pages: pdf.numPages, chars };
    if (chars < 20 * pdf.numPages) setMsg('srcMsg', 'Dieses PDF enthält kaum Text, vermutlich ist es ein Scan. Ohne KI lässt es sich nicht auslesen. Verwenden Sie ein PDF mit auswählbarem Text oder eine CSV-Datei.', 'bad');
    else setMsg('srcMsg', '');
    sourceReady();
  } catch (err) {
    resetEx();
    setMsg('srcMsg', 'Das PDF konnte nicht gelesen werden' + (err && err.message ? ' (' + err.message + ')' : '') + '.', 'bad');
  }
}
async function readTextFile(file) {
  const buf = await file.arrayBuffer(); let t;
  try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder('windows-1252').decode(buf); }
  S.ex = { kind: 'text', name: file.name, lines: [], text: t.replace(/^﻿/, ''), map: [], rows: [], pages: 0, chars: t.length };
  setMsg('srcMsg', ''); sourceReady();
}
function sourceReady() {
  const e = S.ex;
  $('review').hidden = true;
  const items = [['Datei', e.name]];
  if (e.kind === 'pdf') { items.push(['Seiten', nf(e.pages)], ['Zeilen', nf(e.lines.length)]); }
  else items.push(['Zeichen', nf(e.chars)]);
  $('fileInfo').innerHTML = items.map(p => '<div><dt>' + p[0] + '</dt><dd>' + esc(p[1]) + '</dd></div>').join('');
  $('fileInfo').hidden = false;
  $('gapBox').hidden = e.kind !== 'pdf'; $('splitBox').hidden = e.kind === 'pdf';
  autoMap(); renderMap();
}
function buildGrid() {
  const e = S.ex;
  if (e.kind === 'pdf') {
    const gap = Math.max(1, +$('gap').value || 8);
    return e.lines.map(items => {
      const cells = []; let end = null;
      items.forEach(i => {
        if (cells.length && i.x - end <= gap) cells[cells.length - 1] += (i.x - end > 1 ? ' ' : '') + i.s;
        else cells.push(i.s);
        end = i.x + i.w;
      });
      return cells.map(c => c.trim());
    });
  }
  if (e.kind !== 'text') return [];
  const mode = $('splitMode').value;
  const d = mode === 'auto' ? detectDelim(e.text) : { semi: ';', comma: ',', tab: '\t', pipe: '|', space: null }[mode];
  if (d) return parseCSV(e.text, d).map(r => r.map(c => c.trim()));
  return e.text.split(/\r?\n/).filter(l => l.trim()).map(l => l.trim().split(/\s{2,}|\t/));
}
const nonEmpty = r => r.filter(c => c !== '').length;
function filterRows(grid) {
  const skip = Math.max(0, +$('skipTop').value || 0), minC = Math.max(1, +$('minCells').value || 1);
  return grid.slice(skip).filter(r => nonEmpty(r) >= minC);
}
function autoMap() {
  const grid = buildGrid(); if (!grid.length) { S.ex.map = []; return; }
  const labels = S.fields.map(f => [norm(f.label), norm(f.key), f.key]);
  const hit = c => labels.find(l => norm(c) === l[0] || norm(c) === l[1]);
  let best = -1, bestN = 0;
  grid.slice(0, 8).forEach((r, i) => { const n = r.filter(c => hit(c)).length; if (n > bestN) { bestN = n; best = i; } });
  if (best >= 0 && bestN >= Math.min(2, S.fields.length)) {
    $('skipTop').value = best + 1;
    S.ex.map = grid[best].map(c => { const l = hit(c); return l ? l[2] : ''; });
  } else {
    $('skipTop').value = 0;
    const w = Math.min(24, grid.slice(0, 30).reduce((m, r) => Math.max(m, r.length), 0));
    S.ex.map = Array.from({ length: w }, (_, i) => S.fields[i] ? S.fields[i].key : '');
  }
}
function renderMap() {
  const e = S.ex;
  $('mapBox').hidden = !e.kind; if (!e.kind) return;
  const grid = buildGrid();
  const skip = Math.max(0, +$('skipTop').value || 0), minC = Math.max(1, +$('minCells').value || 1);
  const valid = filterRows(grid);
  const ncols = Math.min(24, grid.reduce((m, r) => Math.max(m, r.length), 0));
  while (e.map.length < ncols) e.map.push('');
  if (!ncols) { $('mapTbl').innerHTML = ''; setMsg('mapMsg', 'Es wurden keine Zeilen erkannt.', 'bad'); return; }
  const opts = c => '<option value="">– nicht übernehmen –</option>' + S.fields.map(f => '<option value="' + esc(f.key) + '"' + (e.map[c] === f.key ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('');
  let head = '<thead><tr><th class="rn">#</th>';
  for (let c = 0; c < ncols; c++) head += '<th><select data-c="' + c + '" aria-label="Feld für Spalte ' + (c + 1) + '">' + opts(c) + '</select></th>';
  head += '</tr></thead>';
  const body = grid.slice(0, 60).map((r, i) => {
    const off = i < skip || nonEmpty(r) < minC;
    let tds = '';
    for (let c = 0; c < ncols; c++) tds += '<td class="' + (e.map[c] ? 'mapped' : '') + '" title="' + esc(r[c] || '') + '">' + esc(r[c] || '') + '</td>';
    return '<tr class="' + (off ? 'skip' : '') + '"><td class="rn">' + (i + 1) + '</td>' + tds + '</tr>';
  }).join('');
  $('mapTbl').innerHTML = head + '<tbody>' + body + '</tbody>';
  setMsg('mapMsg', nf(valid.length) + ' Zeilen werden übernommen' + (grid.length > 60 ? ' · Vorschau zeigt die ersten 60 von ' + nf(grid.length) : '') + '.');
}
$('mapTbl').addEventListener('change', ev => {
  const t = ev.target; if (t.dataset.c == null) return;
  S.ex.map[+t.dataset.c] = t.value; renderMap();
});
['skipTop', 'minCells', 'gap', 'splitMode'].forEach(id => $(id).addEventListener('input', renderMap));
$('autoMap').addEventListener('click', () => { autoMap(); renderMap(); });
$('applyMap').addEventListener('click', () => {
  const rows = filterRows(buildGrid()), map = S.ex.map, out = [];
  if (!map.some(Boolean)) { setMsg('mapMsg', 'Ordnen Sie mindestens eine Spalte einem Feld zu.', 'bad'); return; }
  rows.forEach(r => {
    const vals = {}; S.fields.forEach(f => { vals[f.key] = ''; });
    r.forEach((cell, c) => { const k = map[c]; if (k && cell) vals[k] = vals[k] ? vals[k] + ' ' + cell : cell; });
    if (Object.values(vals).some(Boolean)) out.push({ vals, dup: false });
  });
  S.ex.rows = out;
  if (!out.length) { setMsg('mapMsg', 'Aus diesen Einstellungen ergeben sich keine Datensätze.', 'bad'); renderReview(); return; }
  setMsg('mapMsg', nf(out.length) + ' Datensätze gebildet.', 'ok');
  renderReview(); $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('drop').addEventListener('click', () => $('file').click());
$('drop').addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('file').click(); } });
$('file').addEventListener('change', ev => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return;
  resetEx();
  if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) readPdf(f); else readTextFile(f);
});
$('paste').addEventListener('input', () => {
  const t = $('paste').value;
  if (!t.trim()) { if (S.ex.name === 'Eingefügter Text') resetEx(); return; }
  S.ex = { kind: 'text', name: 'Eingefügter Text', lines: [], text: t, map: [], rows: [], pages: 0, chars: t.length };
  sourceReady();
});

/* ---------- Prüfen und speichern ---------- */
const pending = () => S.ex.rows.filter(r => !($('skipDup').checked && r.dup));
function dupFlags() {
  const id = S.fields[0] && S.fields[0].key, have = new Set(), seen = new Set();
  S.records.forEach(r => { const v = norm((r.values || {})[id]); if (v) have.add(v); });
  S.ex.rows.forEach(r => { const v = norm(r.vals[id]); r.dup = !!(v && (have.has(v) || seen.has(v))); if (v) seen.add(v); });
}
function renderReview() {
  const rows = S.ex.rows;
  $('review').hidden = !rows.length;
  if (!rows.length) return;
  dupFlags();
  const head = '<thead><tr><th></th>' + S.fields.map(f => '<th>' + esc(f.label) + '</th>').join('') + '<th></th></tr></thead>';
  const body = rows.slice(0, 500).map((r, i) => '<tr class="' + (r.dup ? 'dup' : '') + '"><td class="meta">' + (r.dup ? '<span class="badge warn">vorhanden</span>' : '<span class="badge ok">neu</span>') + '</td>' +
    S.fields.map(f => '<td><input type="text" data-r="' + i + '" data-key="' + esc(f.key) + '" value="' + esc(r.vals[f.key]) + '" aria-label="' + esc(f.label) + '"></td>').join('') +
    '<td class="act"><button class="btn small danger" type="button" data-rm="' + i + '">Entfernen</button></td></tr>').join('');
  $('rvTbl').innerHTML = head + '<tbody>' + body + '</tbody>';
  const n = pending().length;
  $('rvSave').textContent = n + (n === 1 ? ' Datensatz speichern' : ' Datensätze speichern');
  $('rvSave').disabled = !S.dbOk || !n;
  if (rows.length > 500) setMsg('rvMsg', 'Die Tabelle zeigt die ersten 500 Zeilen, gespeichert werden alle ' + nf(rows.length) + '.');
}
$('rvTbl').addEventListener('change', e => {
  const t = e.target; if (t.dataset.r == null) return;
  S.ex.rows[+t.dataset.r].vals[t.dataset.key] = t.value;
  if (t.dataset.key === (S.fields[0] && S.fields[0].key)) renderReview();
});
$('rvTbl').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; S.ex.rows.splice(+b.dataset.rm, 1); renderReview(); });
$('skipDup').addEventListener('change', renderReview);
$('rvClear').addEventListener('click', () => { S.ex.rows = []; renderReview(); setMsg('rvMsg', ''); });
$('rvSave').addEventListener('click', async () => {
  const list = pending(); if (!list.length || !S.dbOk) return;
  const src = S.ex.name || 'Import', base = Date.now();
  const recs = list.map((r, i) => ({ id: uid(), values: r.vals, source: src, createdAt: base + i }));
  $('rvSave').disabled = true;
  try {
    await DB.putMany('records', recs);
    S.records = recs.slice().reverse().concat(S.records);
    S.ex.rows = []; renderReview(); setMsg('rvMsg', ''); setMsg('mapMsg', '');
    S.page = 0; setMsg('dbMsg', nf(recs.length) + ' Datensätze aus „' + src + '“ gespeichert.', 'ok');
    renderAll(); showTab('db');
  } catch (err) {
    setMsg('rvMsg', 'Speichern fehlgeschlagen. Es wurde nichts gespeichert' + (err && err.name === 'QuotaExceededError' ? ' (Speicher voll).' : '.'), 'bad');
    renderReview();
  }
});

/* ---------- QR-Etiketten ---------- */
function serialize(recs, cols, fmt, omit, single) {
  if (fmt === 'json') {
    const objs = recs.map(r => { const o = {}; cols.forEach(c => { if (!(omit && r[c] === '')) o[c] = r[c]; }); return JSON.stringify(o); });
    return single ? objs[0] : '[' + objs.join(',') + ']';
  }
  if (fmt === 'csv') return [cols.map(q).join(';')].concat(recs.map(r => cols.map(c => q(r[c])).join(';'))).join('\n');
  return recs.map(r => cols.filter(c => !(omit && r[c] === '')).map(c => c + ': ' + r[c]).join('\n')).join('\n\n');
}
function makeQR(text, ecc) {
  const qr = qrcode(0, ecc); qr.addData(text, 'Byte'); qr.make();
  const n = qr.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) { const s = c; while (c < n && qr.isDark(r, c)) c++; d += 'M' + (s + 4) + ' ' + (r + 4) + 'h' + (c - s) + 'v1h-' + (c - s) + 'z'; } else c++;
    }
  }
  return { modules: n, version: (n - 17) / 4, path: d };
}
function svgStr(it, px) {
  const s = it.modules + 8;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '"' + (px ? ' width="' + px + '" height="' + px + '"' : '') +
    ' shape-rendering="crispEdges" role="img" aria-label="QR-Code"><rect width="' + s + '" height="' + s + '" fill="#ffffff"/><path fill="#000000" d="' + it.path + '"/></svg>';
}
const qRadio = n => document.querySelector('input[name="' + n + '"]:checked').value;
function qSettings() {
  return { mode: qRadio('qmode'), fmt: qRadio('qfmt'), ecc: $('qecc').value, limit: +$('qlimit').value, size: Math.min(18, Math.max(1, +$('qsize').value || 4)), cap: $('qcap').value, omit: $('qomit').checked };
}
function qList() {
  const t = S.qr.q.trim().toLowerCase(), asc = S.records.slice().reverse();
  if (!t) return asc;
  return asc.filter(r => Object.keys(r.values || {}).some(k => String(r.values[k]).toLowerCase().includes(t)));
}
function qBuild() {
  const A = qSettings();
  const cols = S.fields.filter(f => !S.qr.colsOff.has(f.key));
  const used = {}, names = cols.map(f => { let n = f.label || f.key; const b = n; let k = 2; while (used[n]) n = b + ' (' + (k++) + ')'; used[n] = 1; return n; });
  const recs = qList().filter(r => !S.qr.rowsOff.has(r.id));
  const res = { S: A, items: [], nRecs: recs.length, empty: !cols.length || !recs.length };
  if (res.empty) return res;
  const cap = CAP[A.ecc], limit = Math.min(A.limit, cap), pos = {};
  recs.forEach((r, i) => { pos[r.id] = i; });
  const rec = r => { const o = {}; cols.forEach((f, i) => { o[names[i]] = (r.values && r.values[f.key]) || ''; }); return o; };
  const ser = rs => serialize(rs.map(rec), names, A.fmt, A.omit, A.mode === 'each');
  let groups = [];
  if (A.mode === 'each') groups = recs.map(r => [r]);
  else {
    let cur = [];
    recs.forEach(r => { const t = cur.concat(r); if (!cur.length || blen(ser(t)) <= limit) cur = t; else { groups.push(cur); cur = [r]; } });
    if (cur.length) groups.push(cur);
  }
  const capOf = r => A.cap && A.cap !== '-' ? ((r.values || {})[A.cap] || '') : '';
  groups.forEach((g, k) => {
    const text = ser(g), bytes = blen(text), it = { bytes, over: A.mode === 'all' && bytes > limit };
    if (A.mode === 'each') { it.label = capOf(g[0]) || ('Datensatz ' + (pos[g[0].id] + 1)); it.sub = 'Nr. ' + (pos[g[0].id] + 1); }
    else {
      it.label = 'Teil ' + (k + 1) + ' von ' + groups.length;
      const a = capOf(g[0]), b = capOf(g[g.length - 1]);
      it.sub = (a && b ? (g.length > 1 ? a + ' bis ' + b : a) : 'Nr. ' + (pos[g[0].id] + 1) + '–' + (pos[g[g.length - 1].id] + 1)) + ' · ' + g.length + (g.length === 1 ? ' Datensatz' : ' Datensätze');
    }
    if (bytes > cap) it.tooBig = true;
    else { try { const z = makeQR(text, A.ecc); it.modules = z.modules; it.version = z.version; it.path = z.path; } catch (e) { it.tooBig = true; } }
    res.items.push(it);
  });
  return res;
}
function renderQChips() {
  $('qChips').innerHTML = S.fields.map((f, i) => '<button type="button" class="qchip" data-qc="' + i + '" aria-pressed="' + !S.qr.colsOff.has(f.key) + '">' + esc(f.label) + '</button>').join('');
}
function updQSel() {
  const list = qList(), n = list.filter(r => !S.qr.rowsOff.has(r.id)).length;
  $('qSel').textContent = list.length ? n + ' von ' + list.length + ' ausgewählt' + (list.length > 300 ? ' · Tabelle zeigt 300' : '') : (S.records.length ? 'Keine Treffer' : 'Noch keine Datensätze');
}
function renderQTable(force) {
  const tbl = $('qTbl');
  if (!force && tbl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const list = qList(); updQSel();
  if (!list.length) { tbl.innerHTML = ''; return; }
  const allOn = list.every(r => !S.qr.rowsOff.has(r.id));
  const head = '<thead><tr><th class="num"><input type="checkbox" id="qRowAll" aria-label="Alle Datensätze" ' + (allOn ? 'checked' : '') + '></th>' + S.fields.map(f => '<th>' + esc(f.label) + '</th>').join('') + '</tr></thead>';
  const body = list.slice(0, 300).map(r => {
    const on = !S.qr.rowsOff.has(r.id);
    return '<tr class="' + (on ? '' : 'off') + '"><td class="num"><input type="checkbox" data-qr="' + esc(r.id) + '" aria-label="Datensatz auswählen" ' + (on ? 'checked' : '') + '></td>' +
      S.fields.map(f => { const v = (r.values || {})[f.key] || ''; return '<td title="' + esc(v) + '">' + esc(v) + '</td>'; }).join('') + '</tr>';
  }).join('');
  tbl.innerHTML = head + '<tbody>' + body + '</tbody>';
}
function renderQCap() {
  const sig = S.fields.map(f => f.key).join('|'), sel = $('qcap');
  if (sig === S.qr.capSig && sel.options.length) return;
  const prev = sel.value; S.qr.capSig = sig;
  sel.innerHTML = '<option value="-">keine</option>' + S.fields.map(f => '<option value="' + esc(f.key) + '">' + esc(f.label) + '</option>').join('');
  const keys = S.fields.map(f => f.key);
  sel.value = keys.includes(prev) ? prev : (keys[0] || '-');
}
function renderQResult() {
  const R = $('qResult'), A = qSettings();
  $('qLimitVal').textContent = nf(Math.min(A.limit, CAP[A.ecc])) + ' Byte';
  $('qlimit').disabled = A.mode === 'each';
  $('qModeHint').textContent = A.mode === 'each'
    ? 'Jeder gewählte Datensatz bekommt einen eigenen Code, passend für Etiketten an Geräten, Kisten oder Akten.'
    : 'Alle gewählten Datensätze werden hintereinander in Codes geschrieben. Wird ein Code zu voll, beginnt automatisch der nächste.';
  if (typeof qrcode === 'undefined') { R.innerHTML = '<p class="empty">Die QR-Bibliothek fehlt in dieser App-Version.</p>'; return; }
  if (!S.records.length) { S.qr.items = []; R.innerHTML = '<p class="empty">Noch keine Datensätze. Lesen Sie im Reiter „Einlesen“ eine Datei ein, dann erscheinen hier die Etiketten.</p>'; return; }
  const B = qBuild(); S.qr.items = B.items;
  if (B.empty) { R.innerHTML = '<p class="empty">Wählen Sie mindestens ein Feld und einen Datensatz.</p>'; return; }
  const ok = B.items.filter(i => !i.tooBig), cap = CAP[A.ecc], limit = Math.min(A.limit, cap);
  const maxIt = ok.reduce((m, i) => !m || i.bytes > m.bytes ? i : m, null);
  const maxBytes = B.items.reduce((m, i) => Math.max(m, i.bytes), 0);
  let html = '<dl class="stats">' +
    '<div class="stat"><dt>Datensätze</dt><dd>' + nf(B.nRecs) + '</dd></div>' +
    '<div class="stat"><dt>Codes</dt><dd>' + nf(ok.length) + '</dd></div>' +
    '<div class="stat"><dt>Größter Code</dt><dd>' + nf(maxBytes) + ' <small>Byte</small></dd></div>' +
    '<div class="stat"><dt>QR-Version</dt><dd>' + (maxIt ? maxIt.version : '–') + ' <small>' + (maxIt ? maxIt.modules + '×' + maxIt.modules : '') + '</small></dd></div></dl>';
  const pct = Math.min(100, maxBytes / cap * 100), lpos = limit / cap * 100;
  html += '<div class="meter" role="img" aria-label="Auslastung des größten Codes"><div class="fill" style="width:' + pct.toFixed(1) + '%"></div>' +
    (A.mode === 'all' ? '<div class="tick" style="left:' + lpos.toFixed(1) + '%"></div>' : '') + '</div>' +
    '<div class="meter-l"><span>0</span><span>' + (A.mode === 'all' ? 'Limit ' + nf(limit) : '') + '</span><span>Max. ' + nf(cap) + ' (Stufe ' + A.ecc + ')</span></div>';
  if (maxIt) {
    const mm = A.size * 10 / (maxIt.modules + 8), mmTxt = mm.toFixed(2).replace('.', ',');
    const cls = mm < 0.3 ? 'bad' : mm < 0.4 ? 'warn' : 'ok', txt = mm < 0.3 ? 'zu klein zum Scannen' : mm < 0.4 ? 'knapp, nur mit gutem Druck' : 'gut lesbar';
    html += '<div class="read"><span>Bei ' + String(A.size).replace('.', ',') + ' cm Kantenlänge ist ein Punkt ' + mmTxt + ' mm groß.</span><span class="pill ' + cls + '">' + txt + '</span></div>';
  }
  const warns = [], big = B.items.filter(i => i.tooBig).length, over = B.items.filter(i => i.over && !i.tooBig).length;
  if (big) warns.push('<p><strong>' + big + (A.mode === 'each' ? ' Datensätze passen' : ' Teile passen') + ' nicht in einen Code</strong> (über ' + nf(cap) + ' Byte bei Stufe ' + A.ecc + ') und fehlen unten. Wählen Sie weniger Felder, Stufe L oder lassen Sie leere Felder weg.</p>');
  if (over) warns.push('<p>' + over + (over === 1 ? ' einzelner Datensatz ist' : ' einzelne Datensätze sind') + ' größer als das Dichte-Limit, wurde aber als eigener Code angelegt.</p>');
  if (maxIt && maxIt.version > 20 && !big) warns.push('<p>Version ' + maxIt.version + ' ist sehr dicht. Erhöhen Sie die Kantenlänge oder senken Sie das Dichte-Limit, damit Handykameras den Code zuverlässig lesen.</p>');
  if (warns.length) html += '<div class="warns">' + warns.join('') + '</div>';
  html += '<div class="exports"><button class="btn primary" type="button" data-qact="print" ' + (ok.length ? '' : 'disabled') + '>Etiketten drucken</button>' +
    '<span class="hint">Im Druckdialog können Sie auch „Als PDF speichern“ wählen. Maßstab auf 100 % lassen.</span></div>';
  const SHOW = 120;
  html += '<div class="cards">' + B.items.slice(0, SHOW).map((it, i) => {
    const tile = it.tooBig ? '<div class="tile bad">Zu groß: ' + nf(it.bytes) + ' Byte, maximal ' + nf(cap) + '</div>' : '<div class="tile">' + svgStr(it) + '</div>';
    return '<article class="card">' + tile + '<div class="meta"><strong>' + esc(it.label) + '</strong><span>' + esc(it.sub) + '</span>' + (it.tooBig ? '' : '<span>' + nf(it.bytes) + ' Byte · V' + it.version + '</span>') + '</div>' +
      (it.tooBig ? '' : '<div class="acts"><button class="btn small" type="button" data-qact="svg" data-i="' + i + '">SVG</button><button class="btn small" type="button" data-qact="png" data-i="' + i + '">PNG</button></div>') + '</article>';
  }).join('') + '</div>';
  if (B.items.length > SHOW) html += '<p class="cardnote">Vorschau zeigt die ersten ' + SHOW + ' von ' + nf(B.items.length) + ' Codes. Gedruckt werden alle.</p>';
  R.innerHTML = html;
}
function renderQr() {
  if (S.tab !== 'qr') return;
  renderQChips(); renderQTable(); renderQCap(); renderQResult();
}
function sheetHTML(items, A) {
  const labs = items.filter(i => !i.tooBig).map(it =>
    '<figure class="lab">' + svgStr(it) + '<figcaption><b>' + esc(it.label) + '</b><br>' + esc(it.sub) + '</figcaption></figure>').join('\n');
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>QR-Etiketten</title><style>' +
    '@page{size:A4;margin:12mm}body{font:9pt/1.3 Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:0}' +
    '.grid{display:flex;flex-wrap:wrap;gap:6mm}.lab{width:' + A.size + 'cm;margin:0;break-inside:avoid;page-break-inside:avoid}' +
    '.lab svg{width:100%;height:auto;display:block}figcaption{padding-top:1mm;overflow-wrap:anywhere}</style></head><body><div class="grid">\n' + labs + '\n</div></body></html>';
}
function savePNG(it, name) {
  const px = (it.modules + 8) * Math.max(4, Math.ceil(1000 / (it.modules + 8))), img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.fillStyle = '#fff'; x.fillRect(0, 0, px, px); x.drawImage(img, 0, 0, px, px);
    c.toBlob(b => { if (b) saveFile(name, b, 'image/png', 'qMsg'); else setMsg('qMsg', 'PNG konnte nicht erzeugt werden.', 'bad'); }, 'image/png');
  };
  img.onerror = () => setMsg('qMsg', 'PNG konnte nicht erzeugt werden.', 'bad');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr(it, px));
}
$('qChips').addEventListener('click', e => {
  const b = e.target.closest('[data-qc]'); if (!b) return;
  const k = S.fields[+b.dataset.qc].key;
  if (S.qr.colsOff.has(k)) S.qr.colsOff.delete(k); else S.qr.colsOff.add(k);
  b.setAttribute('aria-pressed', String(!S.qr.colsOff.has(k))); renderQResult();
});
$('qColsAll').addEventListener('click', () => { S.qr.colsOff = new Set(); renderQChips(); renderQResult(); });
$('qColsNone').addEventListener('click', () => { S.qr.colsOff = new Set(S.fields.map(f => f.key)); renderQChips(); renderQResult(); });
$('qQ').addEventListener('input', () => { S.qr.q = $('qQ').value; renderQTable(true); renderQResult(); });
$('qTbl').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'qRowAll') { qList().forEach(r => { if (t.checked) S.qr.rowsOff.delete(r.id); else S.qr.rowsOff.add(r.id); }); renderQTable(true); renderQResult(); return; }
  if (t.dataset.qr != null) {
    if (t.checked) S.qr.rowsOff.delete(t.dataset.qr); else S.qr.rowsOff.add(t.dataset.qr);
    t.closest('tr').className = t.checked ? '' : 'off';
    const all = $('qRowAll'); if (all) all.checked = qList().every(r => !S.qr.rowsOff.has(r.id));
    updQSel(); renderQResult();
  }
});
['qecc', 'qsize', 'qlimit', 'qcap', 'qomit'].forEach(id => $(id).addEventListener('input', () => {
  if (id === 'qecc') { const l = $('qlimit'); l.max = CAP[$('qecc').value]; if (+l.value > +l.max) l.value = l.max; }
  renderQResult();
}));
document.querySelectorAll('input[name="qmode"], input[name="qfmt"]').forEach(r => r.addEventListener('change', renderQResult));
$('qResult').addEventListener('click', e => {
  const b = e.target.closest('[data-qact]'); if (!b) return;
  const act = b.dataset.qact, A = qSettings();
  if (act === 'print') { printHtml(sheetHTML(S.qr.items, A), 'QR-Etiketten'); return; }
  const it = S.qr.items[+b.dataset.i]; if (!it || it.tooBig) return;
  const name = 'qr-' + (slug(it.label).replace(/_/g, '-') || 'code-' + (+b.dataset.i + 1));
  if (act === 'svg') saveFile(name + '.svg', svgStr(it, (it.modules + 8) * 10), 'image/svg+xml', 'qMsg');
  else if (act === 'png') savePNG(it, name + '.png');
});
$('qlimit').max = CAP[$('qecc').value];

/* ---------- Scannen und Abgleichen ---------- */
S.scan = { log: [], stream: null, timer: 0, lastText: '', lastAt: 0 };
let scanSeq = 0;
const scanCanvas = document.createElement('canvas');
const fieldLabel = k => { const f = S.fields.find(f => f.key === k); return f ? f.label : k; };
function fieldKeyFor(label) {
  const n = norm(String(label).replace(/\s*\(\d+\)\s*$/, ''));
  const f = S.fields.find(f => norm(f.label) === n || norm(f.key) === n);
  return f ? f.key : null;
}
function parseScan(text) {
  const t = text.trim();
  const mapObj = o => { const r = {}; Object.keys(o).forEach(k => { const fk = fieldKeyFor(k); if (fk) r[fk] = String(o[k] == null ? '' : o[k]).trim(); }); return Object.keys(r).length ? r : null; };
  if (t[0] === '{' || t[0] === '[') {
    try {
      const v = JSON.parse(t), arr = (Array.isArray(v) ? v : [v]).filter(o => o && typeof o === 'object').map(mapObj).filter(Boolean);
      if (arr.length) return arr;
    } catch (e) { /* kein JSON */ }
  }
  const blocks = t.split(/\n\s*\n/).filter(b => b.trim());
  const recs = blocks.map(b => {
    const o = {}; let n = 0;
    b.split(/\r?\n/).forEach(l => { const m = l.match(/^([^:]{1,60}):\s?(.*)$/); if (m) { const k = fieldKeyFor(m[1]); if (k) { o[k] = m[2].trim(); n++; } } });
    return n ? o : null;
  });
  if (recs.length && recs.every(Boolean)) return recs;
  if (t.includes(';') && /\r?\n/.test(t)) {
    const rows = parseCSV(t, ';');
    const head = rows[0] ? rows[0].map(fieldKeyFor) : [];
    if (rows.length > 1 && head.some(Boolean)) {
      return rows.slice(1).map(r => { const o = {}; head.forEach((k, i) => { if (k) o[k] = (r[i] || '').trim(); }); return o; }).filter(o => Object.keys(o).length);
    }
  }
  return null;
}
function matchRec(sc, idKey) {
  const keys = Object.keys(sc), val = (r, k) => norm((r.values || {})[k]);
  let cands = [];
  if (sc[idKey] !== undefined && norm(sc[idKey])) cands = S.records.filter(r => val(r, idKey) === norm(sc[idKey]));
  else if (keys.length) cands = S.records.filter(r => keys.every(k => val(r, k) === norm(sc[k])));
  if (!cands.length) return { status: 'none', scan: sc };
  let best = null, bn = -1;
  cands.forEach(r => { const n = keys.filter(k => val(r, k) === norm(sc[k])).length; if (n > bn) { bn = n; best = r; } });
  const diffs = keys.filter(k => val(best, k) !== norm(sc[k]));
  return { status: diffs.length ? 'diff' : 'ok', rec: best, scan: sc, diffs, copies: cands.length };
}
function rawMatch(text) {
  const n = norm(text), hits = S.records.filter(r => Object.values(r.values || {}).some(v => norm(v) === n));
  return hits.length ? { status: 'ok', rec: hits[0], scan: null, diffs: [], copies: hits.length, raw: text } : { status: 'none', scan: null, raw: text };
}
const ST = { ok: ['ok', 'Gefunden · identisch'], diff: ['warn', 'Gefunden · abweichend'], none: ['bad', 'Nicht in der Datenbank'] };
function resTitle(m) {
  const k = S.fields[0] && S.fields[0].key;
  if (m.rec && k && (m.rec.values || {})[k]) return m.rec.values[k];
  if (m.scan && k && m.scan[k]) return m.scan[k];
  return m.raw || (m.scan ? Object.values(m.scan)[0] : '') || 'Code';
}
function resultHTML(m) {
  const v = m.rec ? (m.rec.values || {}) : null, sc = m.scan;
  const diffKeys = new Set((m.diffs || []).map(k => k));
  const rows = S.fields.filter(f => (sc && sc[f.key] !== undefined) || (v && v[f.key])).map(f => {
    const c = sc && sc[f.key] !== undefined ? sc[f.key] : null, d = v ? (v[f.key] || '') : null, bad = diffKeys.has(f.key);
    return '<tr class="' + (bad ? 'd' : '') + '"><td class="f">' + esc(f.label) + '</td><td class="' + (c === null ? 'dim' : '') + '">' + (c === null ? 'nicht im Code' : esc(c || '–')) +
      '</td><td class="' + (d === null ? 'dim' : '') + '">' + (d === null ? '–' : esc(d || '–')) + '</td><td>' + (bad ? '<span class="pill warn">weicht ab</span>' : (c !== null && d !== null ? '<span class="ok">✓</span>' : '')) + '</td></tr>';
  }).join('');
  const [cls, txt] = ST[m.status];
  return '<div class="sres" data-st="' + m.status + '"><div class="sres-h"><span class="pill ' + cls + '">' + txt + '</span><strong>' + esc(resTitle(m)) + '</strong></div>' +
    (m.copies > 1 ? '<p class="hint" style="margin-bottom:8px">' + m.copies + ' Datensätze mit diesem Wert, angezeigt wird der am besten passende.</p>' : '') +
    (rows ? '<div class="sres-t"><table class="stbl"><thead><tr><th>Feld</th><th>Im Code</th><th>In der Datenbank</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="hint">Der Code enthält keine bekannten Felder.</p>') + '</div>';
}
function renderScan(entry) {
  if (entry) $('scanRes').innerHTML = entry.results.map(resultHTML).join('');
  const log = S.scan.log, cnt = { ok: 0, diff: 0, none: 0 };
  log.forEach(e => e.results.forEach(m => { cnt[m.status]++; }));
  $('scanSum').textContent = log.length ? nf(log.length) + ' Scans · ' + cnt.ok + ' identisch · ' + cnt.diff + ' abweichend · ' + cnt.none + ' unbekannt' : 'Noch nichts gescannt.';
  $('scanLog').innerHTML = log.slice(0, 40).map(e => {
    const worst = e.results.some(m => m.status === 'none') ? 'none' : e.results.some(m => m.status === 'diff') ? 'diff' : 'ok';
    const [cls, txt] = ST[worst], t = new Date(e.t);
    return '<li><span class="t">' + t.toLocaleTimeString('de-DE') + '</span><span class="pill ' + cls + '">' + txt + '</span><span class="x">' +
      esc(e.results.length > 1 ? e.results.length + ' Datensätze im Code' : resTitle(e.results[0])) + '</span></li>';
  }).join('');
}
function renderScanKey() {
  const sel = $('scanKey'), prev = sel.value, keys = S.fields.map(f => f.key);
  sel.innerHTML = S.fields.map(f => '<option value="' + esc(f.key) + '">' + esc(f.label) + '</option>').join('');
  sel.value = keys.includes(prev) ? prev : (keys[0] || '');
}
function handleScan(text, via) {
  text = String(text || '').trim(); if (!text) return;
  const idKey = $('scanKey').value || (S.fields[0] && S.fields[0].key);
  const recs = parseScan(text);
  const results = recs ? recs.map(sc => matchRec(sc, idKey)) : [rawMatch(text)];
  const entry = { id: ++scanSeq, t: Date.now(), text, via, results };
  S.scan.log.unshift(entry); if (S.scan.log.length > 200) S.scan.log.pop();
  renderScan(entry);
  setMsg('scanMsg', 'Code gelesen (' + via + ').', 'ok');
  if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignorieren */ } }
}
async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild nicht lesbar')); i.src = url; });
    for (const max of [1600, 1000, 2400]) {
      const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
      scanCanvas.width = w; scanCanvas.height = h;
      const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code.data;
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}
function camStop() {
  clearTimeout(S.scan.timer);
  if (S.scan.stream) { S.scan.stream.getTracks().forEach(t => t.stop()); S.scan.stream = null; }
  const v = $('scanVideo'); v.srcObject = null; $('scanBox').hidden = true; $('camToggle').textContent = 'Kamera starten';
}
function scanLoop() {
  const v = $('scanVideo');
  if (!S.scan.stream) return;
  if (v.readyState >= 2 && v.videoWidth) {
    const w = Math.min(1280, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    scanCanvas.width = w; scanCanvas.height = h;
    const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (code && code.data) {
      const now = Date.now();
      if (code.data !== S.scan.lastText || now - S.scan.lastAt > 3000) { S.scan.lastText = code.data; handleScan(code.data, 'Kamera'); }
      S.scan.lastAt = now;
    }
  }
  S.scan.timer = setTimeout(scanLoop, 120);
}
async function camStart() {
  if (typeof jsQR === 'undefined') { setMsg('scanMsg', 'Die Code-Erkennung fehlt in dieser App-Version.', 'bad'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setMsg('scanMsg', 'Dieses Gerät erlaubt hier keinen Kamerazugriff. Nutzen Sie „Foto aufnehmen“.', 'bad'); return; }
  try {
    const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    S.scan.stream = st; S.scan.lastText = ''; S.scan.lastAt = 0;
    const v = $('scanVideo'); v.srcObject = st; await v.play();
    $('scanBox').hidden = false; $('camToggle').textContent = 'Kamera stoppen';
    setMsg('scanMsg', 'Halten Sie den Code ins Bild.');
    scanLoop();
  } catch (e) {
    camStop();
    setMsg('scanMsg', e && e.name === 'NotAllowedError' ? 'Kamerazugriff nicht erlaubt. Erlauben Sie die Kamera in den Android-Einstellungen für diese App oder nutzen Sie „Foto aufnehmen“.' : 'Die Kamera konnte nicht gestartet werden. Nutzen Sie „Foto aufnehmen“.', 'bad');
  }
}
$('camToggle').addEventListener('click', () => { if (S.scan.stream) { camStop(); setMsg('scanMsg', ''); } else camStart(); });
$('photoBtn').addEventListener('click', () => $('photoFile').click());
$('photoFile').addEventListener('change', async ev => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return;
  if (typeof jsQR === 'undefined') { setMsg('scanMsg', 'Die Code-Erkennung fehlt in dieser App-Version.', 'bad'); return; }
  setMsg('scanMsg', 'Lese Foto …');
  try {
    const text = await decodeImageFile(f);
    if (text) handleScan(text, 'Foto'); else setMsg('scanMsg', 'Im Foto wurde kein QR-Code erkannt. Fotografieren Sie näher heran, gerade von vorn und ohne Spiegelung.', 'bad');
  } catch (e) { setMsg('scanMsg', 'Das Foto konnte nicht gelesen werden.', 'bad'); }
});
const scanManual = () => { const i = $('scanText'); const t = i.value; i.value = ''; if (t.trim()) handleScan(t, 'Eingabe'); i.focus(); };
$('scanGo').addEventListener('click', scanManual);
$('scanText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !$('scanText').value.includes('\n')) { e.preventDefault(); scanManual(); } });
$('scanClear').addEventListener('click', () => { S.scan.log = []; $('scanRes').innerHTML = ''; renderScan(); });

/* ---------- Start ---------- */
function renderAll() {
  renderStatus(); renderDb();
  if (S.ex.rows.length) renderReview();
  renderQr(); renderScanKey();
}
async function init() {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  renderFields(); renderAll(); renderScan();
  try {
    const meta = await DB.all('meta'), sch = meta.find(m => m.key === 'schema');
    if (sch && Array.isArray(sch.fields) && sch.fields.length) {
      S.fields = sch.fields.map(f => ({ key: String(f.key), label: String(f.label || f.key), hint: String(f.hint || '') }));
      S.draft = S.fields.map(f => ({ ...f }));
      renderFields();
    }
    S.records = await DB.all('records'); sortRecords();
    S.dbOk = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) { S.dbOk = false; }
  S.dbLoaded = true;
  renderAll();
}
init();
})();
