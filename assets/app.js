// Dashboard: loads the generator sheet, runs the analysis and renders the page.
import { analyseAll, TESTS } from './analysis.js';
import { THEMES, TREND_NAMES, colorOf, mainChartConfig, miniChartConfig } from './charts.js';
import { generateReport } from './report.js';

const DEFAULT_SHEET = '1KxNeW1Ccx1u1V_1ngHKzAD_556bXqVUD2Z66exkqJBo';
const AUTO_REFRESH_MS = 30000;

const state = {
  sheetId: sheetIdFrom(new URLSearchParams(location.search).get('sheet')) || DEFAULT_SHEET,
  params: {
    iqrK: 1.5, zThreshold: 3, maWindow: 7, maPct: 30, grubbsAlpha: 0.05, minTests: 2, adjustWeekday: true,
    enabled: { iqr: true, z: true, ma: true, grubbs: true },
  },
  view: { type: 'line', series: 'Total', trend: 1, anomalies: true },
  zoom: null,
  data: null,
  result: null,
  loadedAt: null,
};

const $ = (id) => document.getElementById(id);
const charts = { main: null, minis: [] };
const num = (v, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
const iso = (d) => d.toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plain text of an HTML snippet; DOMParser documents are inert (no scripts or event handlers run).
const textOf = (html) => new DOMParser().parseFromString(String(html), 'text/html').body.textContent;

function sheetIdFrom(text) {
  if (!text) return null;
  const m = text.match(/\/d\/([\w-]{20,})/) || text.match(/^([\w-]{20,})$/);
  return m ? m[1] : null;
}

function isDark() {
  return document.documentElement.getAttribute('data-bs-theme') === 'dark';
}
const theme = () => (isDark() ? THEMES.dark : THEMES.light);

// ------------------------------------------------------------------ data

async function loadData() {
  const url = `https://docs.google.com/spreadsheets/d/${state.sheetId}/gviz/tq?tqx=out:csv&sheet=Data&headers=1&_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Google Sheets answered ${res.status}. Is the sheet shared with "anyone with the link"?`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error('The sheet is not public. Share it with "anyone with the link".');
  return parseCsv(text);
}

function parseCsv(text) {
  const rows = Papa.parse(text.trim(), { skipEmptyLines: true }).data;
  const header = rows[0].map((h) => h.trim());
  const keep = header.map((h, j) => j).filter((j) => header[j]);
  const names = keep.map((j) => header[j]);
  if (names[0] !== 'Date') throw new Error('Unexpected layout: the Data tab must start with a Date column.');
  const toNum = (s) => parseFloat(String(s).replace(/[,\s]/g, ''));
  const body = rows.slice(1).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test((r[0] || '').trim()));
  const columns = Object.create(null);   // header names come from a publicly editable sheet
  names.slice(1).forEach((n) => { columns[n] = []; });
  for (const r of body) keep.slice(1).forEach((j) => columns[header[j]].push(toNum(r[j]) || 0));
  const mines = names.slice(1).filter((n) => n !== 'Total');
  if (!columns.Total) columns.Total = body.map((_, i) => mines.reduce((s, m) => s + columns[m][i], 0));
  const labels = body.map((r) => r[0].trim());
  return { labels, dates: labels.map((l) => new Date(`${l}T00:00:00Z`)), mines, columns };
}

async function refresh() {
  const btn = $('btn-refresh');
  btn.disabled = true;
  btn.querySelector('i').classList.add('spin');
  $('status').textContent = 'Loading data from Google Sheets…';
  try {
    state.data = await loadData();
    state.loadedAt = new Date();
    if (state.view.series !== 'Total' && state.view.series !== '__all' && !state.data.mines.includes(state.view.series)) {
      state.view.series = 'Total';
    }
    state.zoom = null;
    $('error').classList.add('d-none');
    analyseAndRender();
  } catch (err) {
    $('error').textContent = `Could not load data. ${err.message}`;
    $('error').classList.remove('d-none');
    $('status').textContent = 'Data not loaded';
  } finally {
    btn.disabled = false;
    btn.querySelector('i').classList.remove('spin');
  }
}

// ------------------------------------------------------------------ rendering

function analyseAndRender() {
  if (!state.data) return;
  state.result = analyseAll(state.data, state.params);
  const d = state.data;
  $('status').innerHTML = `<span class="dot"></span>Live data · ${d.labels.length} days · loaded ${state.loadedAt.toLocaleTimeString('en-GB')}`;
  renderSeriesOptions();
  renderKpis();
  renderMainChart();
  renderStatsTable();
  renderMinis();
  renderEpisodes();
  $('btn-report').disabled = false;
}

function renderKpis() {
  const { data, result } = state;
  const total = result.byName.Total;
  const spikes = result.episodes.filter((e) => e.type === 'spike').length;
  const drops = result.episodes.length - spikes;
  const tiles = [
    ['Period', `<span class="tile-value-sm">${data.labels[0]} – ${data.labels[data.labels.length - 1]}</span>`, `${data.labels.length} days`],
    ['Mines', data.mines.length, esc(data.mines.join(', '))],
    ['Total output', `${num(total.stats.sum / 1000, 1)} kt`, 'all mines, whole period'],
    ['Mean daily output', `${num(total.stats.mean, 0)} t`, `std dev ${num(total.stats.sd, 0)} t · median ${num(total.stats.median, 0)} t`],
    ['Anomaly episodes', result.episodes.length, `<i class="bi bi-caret-up-fill"></i> ${spikes} spikes · <i class="bi bi-caret-down-fill"></i> ${drops} drops`],
  ];
  $('kpis').innerHTML = tiles.map(([label, value, sub]) => `
    <div class="col"><div class="tile h-100">
      <div class="tile-label">${label}</div>
      <div class="tile-value">${value}</div>
      <div class="tile-sub" title="${esc(textOf(sub))}">${sub}</div>
    </div></div>`).join('');
}

function renderSeriesOptions() {
  const sel = $('view-series');
  const opts = [['Total', 'Total (all mines)'], ...state.data.mines.map((m) => [m, m])];
  if (state.view.type === 'line') opts.push(['__all', 'All mines (one line each)']);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  if (state.view.type === 'stacked') {
    sel.innerHTML = '<option>All mines, stacked</option>';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    if (!opts.some(([v]) => v === state.view.series)) state.view.series = 'Total';
    sel.value = state.view.series;
  }
  $('view-trend').disabled = state.view.type !== 'stacked' && state.view.series === '__all';
}

function renderMainChart() {
  const { data, result, view } = state;
  const range = state.zoom && { from: state.zoom.from, to: state.zoom.to };
  const band = state.zoom && state.zoom.band;
  const cfg = mainChartConfig(data, result, { ...view, trend: view.series === '__all' && view.type !== 'stacked' ? 0 : view.trend }, theme(), { range, band });
  if (charts.main) charts.main.destroy();
  charts.main = new Chart($('main-chart'), cfg);
  $('btn-zoom-reset').classList.toggle('d-none', !state.zoom);
  const scope = view.type === 'stacked' ? 'all mines stacked, anomalies of the total' : view.series === '__all' ? 'all mines' : view.series;
  const trend = view.trend && !(view.series === '__all' && view.type !== 'stacked') ? ` · ${TREND_NAMES[view.trend].toLowerCase()} trendline` : '';
  $('chart-caption').textContent = `Daily output, ${scope}${trend}. Triangles mark days confirmed as anomalous (pointing up: spike, down: drop).`;
}

function renderStatsTable() {
  const { result } = state;
  const tests = Object.keys(TESTS);
  $('stats-body').innerHTML = result.series.map((s) => {
    const st = s.stats;
    const swatch = `<span class="swatch" style="background:${colorOf(s.name, state.data.mines, theme())}"></span>`;
    const counts = tests.map((t) => `<td class="${state.params.enabled[t] ? '' : 'text-body-tertiary'}">${s.counts[t]}</td>`).join('');
    return `<tr class="${s.name === 'Total' ? 'total-row' : ''}" data-series="${esc(s.name)}">
      <th scope="row">${swatch}${esc(s.name)}</th>
      <td>${num(st.mean)}</td><td>${num(st.sd)}</td><td>${num(st.median)}</td>
      <td>${num(st.q1)}</td><td>${num(st.q3)}</td><td>${num(st.iqr)}</td>
      <td>${num(st.min)}</td><td>${num(st.max)}</td>
      ${counts}<td class="fw-semibold">${s.episodes.length}</td></tr>`;
  }).join('');
}

function renderMinis() {
  charts.minis.forEach((c) => c.destroy());
  charts.minis = [];
  const { data, result } = state;
  $('minis').innerHTML = data.mines.map((m, i) => {
    const s = result.byName[m];
    return `<div class="col-md-6 col-xl-4"><button type="button" class="mini text-start w-100" data-series="${esc(m)}">
      <div class="d-flex justify-content-between align-items-baseline mb-1">
        <span class="fw-semibold"><span class="swatch" style="background:${colorOf(m, data.mines, theme())}"></span>${esc(m)}</span>
        <span class="small text-body-secondary">mean ${num(s.stats.mean, 0)} t · ${s.episodes.length} episode${s.episodes.length === 1 ? '' : 's'}</span>
      </div>
      <div class="mini-canvas"><canvas id="mini-${i}"></canvas></div></button></div>`;
  }).join('');
  data.mines.forEach((m, i) => {
    charts.minis.push(new Chart($(`mini-${i}`), miniChartConfig(data, result.byName[m], theme())));
  });
}

function renderEpisodes() {
  const eps = state.result.episodes;
  $('episode-count').textContent = eps.length;
  if (!eps.length) {
    $('episodes-body').innerHTML = '<tr><td colspan="10" class="text-center text-body-secondary py-4">No anomalies with the current settings.</td></tr>';
    return;
  }
  $('episodes-body').innerHTML = eps.map((e) => {
    const icon = e.type === 'spike' ? 'bi-caret-up-fill' : 'bi-caret-down-fill';
    const period = e.start === e.end ? iso(e.startDate) : `${iso(e.startDate)} – ${iso(e.endDate)}`;
    return `<tr data-episode="${e.id}" tabindex="0">
      <td class="fw-semibold">${e.id}</td>
      <td><span class="swatch" style="background:${colorOf(e.series, state.data.mines, theme())}"></span>${esc(e.series)}</td>
      <td><span class="badge-type ${e.type}"><i class="bi ${icon}"></i> ${e.type}</span></td>
      <td>${period}</td><td>${e.length}</td><td>${iso(e.peakDate)}</td>
      <td>${num(e.peakValue)}</td><td>${num(e.expected)}</td>
      <td class="fw-semibold">${pct(e.deviation)}</td>
      <td>${e.testsHit.map((t) => `<span class="test-chip">${TESTS[t]}</span>`).join(' ')}</td></tr>`;
  }).join('');
}

// ------------------------------------------------------------------ interaction

function focusEpisode(id) {
  const e = state.result.episodes.find((x) => x.id === id);
  if (!e) return;
  if (state.view.type === 'stacked') state.view.type = 'line';
  setSegment('view-type', state.view.type);
  state.view.series = e.series;
  const n = state.data.labels.length;
  state.zoom = { from: Math.max(0, e.start - 30), to: Math.min(n - 1, e.end + 30), band: { from: e.start, to: e.end } };
  renderSeriesOptions();
  renderMainChart();
  $('chart-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showSeries(name) {
  if (state.view.type === 'stacked') { state.view.type = 'line'; setSegment('view-type', 'line'); }
  state.view.series = name;
  state.zoom = null;
  renderSeriesOptions();
  renderMainChart();
  $('chart-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setSegment(groupId, value) {
  document.querySelectorAll(`#${groupId} button`).forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}

let paramTimer;
function readParams() {
  const p = state.params;
  const val = (id, fallback) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : fallback; };
  p.iqrK = Math.max(0, val('p-iqr', 1.5));
  p.zThreshold = Math.max(0, val('p-z', 3));
  p.maWindow = Math.max(2, Math.round(val('p-ma-window', 7)));
  p.maPct = Math.max(0, val('p-ma-pct', 30));
  p.grubbsAlpha = val('p-grubbs', 0.05);
  p.minTests = Math.round(val('p-min-tests', 2));
  p.adjustWeekday = $('p-weekday').checked;
  Object.keys(TESTS).forEach((t) => { p.enabled[t] = $(`en-${t}`).checked; });
  const active = Object.values(p.enabled).filter(Boolean).length;
  $('min-tests-hint').textContent = `of ${active} enabled`;
  clearTimeout(paramTimer);
  paramTimer = setTimeout(analyseAndRender, 150);
}

function bind() {
  $('btn-refresh').addEventListener('click', refresh);
  $('btn-report').addEventListener('click', async () => {
    const btn = $('btn-report');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Building report…';
    try {
      await new Promise((r) => setTimeout(r, 30));
      await generateReport(state);
    } catch (err) {
      console.error(err);
      $('error').textContent = `The report could not be generated: ${err.message}`;
      $('error').classList.remove('d-none');
    } finally {
      btn.innerHTML = label;
      btn.disabled = false;
    }
  });
  $('auto-refresh').addEventListener('change', (e) => {
    clearInterval(state.timer);
    if (e.target.checked) state.timer = setInterval(refresh, AUTO_REFRESH_MS);
  });
  document.querySelectorAll('#params input, #params select').forEach((el) => {
    el.addEventListener('input', readParams);
    el.addEventListener('change', readParams);
  });
  $('view-type').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.view.type = b.dataset.value;
    if (state.view.type === 'bar' && state.view.series === '__all') state.view.series = 'Total';
    setSegment('view-type', state.view.type);
    renderSeriesOptions();
    renderMainChart();
  });
  $('view-series').addEventListener('change', (e) => { state.view.series = e.target.value; renderSeriesOptions(); renderMainChart(); });
  $('view-trend').addEventListener('change', (e) => { state.view.trend = +e.target.value; renderMainChart(); });
  $('view-anomalies').addEventListener('change', (e) => { state.view.anomalies = e.target.checked; renderMainChart(); });
  $('btn-zoom-reset').addEventListener('click', () => { state.zoom = null; renderMainChart(); });
  $('episodes-body').addEventListener('click', (e) => { const r = e.target.closest('tr[data-episode]'); if (r) focusEpisode(r.dataset.episode); });
  $('episodes-body').addEventListener('keydown', (e) => {
    const r = e.target.closest('tr[data-episode]');
    if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); focusEpisode(r.dataset.episode); }
  });
  $('minis').addEventListener('click', (e) => { const b = e.target.closest('[data-series]'); if (b) showSeries(b.dataset.series); });
  $('stats-body').addEventListener('click', (e) => { const r = e.target.closest('tr[data-series]'); if (r) showSeries(r.dataset.series); });
  $('source-link').href = `https://docs.google.com/spreadsheets/d/${state.sheetId}/edit`;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-bs-theme', e.matches ? 'dark' : 'light');
    analyseAndRender();
  });
}

Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
bind();
refresh();
