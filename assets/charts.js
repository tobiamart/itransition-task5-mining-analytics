// Chart.js configurations shared by the dashboard and the PDF report.
import { polyFit, TESTS } from './analysis.js';

const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export const THEMES = {
  light: {
    surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
    total: '#1f3864', critical: '#d03b3b', band: 'rgba(208, 59, 59, 0.08)', series: SERIES.light,
  },
  dark: {
    surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835',
    total: '#9db4e0', critical: '#e66767', band: 'rgba(230, 103, 103, 0.12)', series: SERIES.dark,
  },
};

export const TREND_NAMES = ['None', 'Linear', 'Quadratic', 'Cubic', 'Quartic'];

const fmt = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Colour follows the mine (its position in the sheet), never its rank in a view.
export function colorOf(name, mines, theme) {
  if (name === 'Total') return theme.total;
  const i = mines.indexOf(name);
  return i >= 0 && i < theme.series.length ? theme.series[i] : theme.muted;
}

// Shaded band behind the plot, e.g. the dates of one anomaly episode.
const bandPlugin = {
  id: 'band',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.from == null) return;
    const { ctx, chartArea, scales: { x } } = chart;
    const step = x.getPixelForValue(1) - x.getPixelForValue(0);
    const left = Math.max(chartArea.left, x.getPixelForValue(opts.from) - step / 2);
    const right = Math.min(chartArea.right, x.getPixelForValue(opts.to) + step / 2);
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(left, chartArea.top, Math.max(right - left, 2), chartArea.bottom - chartArea.top);
    ctx.restore();
  },
};

// Paints the canvas background so exported images are not transparent.
const backgroundPlugin = {
  id: 'background',
  beforeDraw(chart, _args, opts) {
    if (!opts || !opts.color) return;
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

export const plugins = [bandPlugin, backgroundPlugin];

function markerDatasets(points, theme, label = 'Anomaly') {
  const base = {
    type: 'line', showLine: false, pointRadius: 6, pointHoverRadius: 8,
    pointBackgroundColor: theme.critical, pointBorderColor: theme.surface, pointBorderWidth: 2,
    borderColor: theme.critical, backgroundColor: theme.critical, order: -1, stack: 'markers',
  };
  return [
    { ...base, label: `${label}: spike`, data: points.filter((p) => p.dir > 0), pointStyle: 'triangle', pointRotation: 0 },
    { ...base, label: `${label}: drop`, data: points.filter((p) => p.dir < 0), pointStyle: 'triangle', pointRotation: 180 },
  ];
}

function anomalyPoints(series, labels, from = 0, to = labels.length - 1) {
  const pts = [];
  for (let i = from; i <= to; i++) {
    if (series.confirmed[i]) {
      pts.push({ x: labels[i], y: series.values[i], dir: series.direction[i], tests: series.flaggedBy[i], name: series.name });
    }
  }
  return pts;
}

function trendDataset(values, degree, theme, labelPrefix = 'Trend') {
  const fit = polyFit(values, degree);
  return {
    type: 'line', label: `${labelPrefix}: ${TREND_NAMES[degree].toLowerCase()} (R² = ${fit.r2.toFixed(2)})`,
    data: fit.fitted, borderColor: theme.ink2, borderWidth: 2, borderDash: [6, 4], pointRadius: 0,
    pointHoverRadius: 0, fill: false, tension: 0, order: -2, stack: 'trend',
  };
}

function baseOptions(theme, { compact = false, pdf = false, stacked = false, legend = true } = {}) {
  const size = pdf ? 13 : 11;
  return {
    responsive: !pdf, maintainAspectRatio: false, animation: false, devicePixelRatio: pdf ? 2 : undefined,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: compact ? 2 : 8 },
    plugins: {
      background: { color: pdf ? '#ffffff' : null },
      legend: {
        display: legend && !compact, position: 'bottom',
        labels: {
          color: theme.ink2, usePointStyle: true, boxHeight: 8, font: { size },
          filter: (item, chartData) => chartData.datasets[item.datasetIndex].data.length > 0,
        },
      },
      tooltip: {
        enabled: !pdf,
        filter: (item) => item.raw != null,
        callbacks: {
          label(ctx) {
            const v = ctx.parsed.y;
            if (ctx.raw && ctx.raw.tests) {
              return `${ctx.dataset.label} (${ctx.raw.name}): ${fmt(v)} t, flagged by ${ctx.raw.tests.map((t) => TESTS[t]).join(', ')}`;
            }
            return `${ctx.dataset.label}: ${fmt(v)} t`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked,
        grid: { display: false },
        border: { color: theme.axis },
        ticks: { color: theme.muted, maxTicksLimit: compact ? 4 : 10, maxRotation: 0, autoSkip: true, font: { size: compact ? 10 : size } },
      },
      y: {
        stacked,
        beginAtZero: true,
        grid: { color: theme.grid },
        border: { display: false },
        title: { display: !compact, text: 'Output (t/day)', color: theme.muted, font: { size } },
        ticks: {
          color: theme.muted, maxTicksLimit: compact ? 4 : 8, font: { size: compact ? 10 : size },
          callback: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('en-US')}K` : v),
        },
      },
    },
  };
}

// view: { type: 'line' | 'bar' | 'stacked', series: name | '__all', trend: 0-4, anomalies: bool }
// range: optional { from, to } label indexes to zoom into; band: optional { from, to } to shade.
export function mainChartConfig(data, result, view, theme, { range = null, band = null, pdf = false } = {}) {
  const labels = data.labels;
  const datasets = [];
  const total = result.byName.Total;
  const lineStyle = { borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, borderJoinStyle: 'round', borderCapStyle: 'round' };

  if (view.type === 'stacked') {
    data.mines.forEach((m) => datasets.push({
      type: 'bar', label: m, data: data.columns[m], stack: 'mines', backgroundColor: colorOf(m, data.mines, theme),
      borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9,
    }));
    if (view.anomalies) datasets.push(...markerDatasets(anomalyPoints(total, labels), theme, 'Total anomaly'));
    if (view.trend) datasets.push(trendDataset(total.values, view.trend, theme, 'Total trend'));
  } else if (view.series === '__all') {
    data.mines.forEach((m) => datasets.push({
      type: 'line', label: m, data: data.columns[m], borderColor: colorOf(m, data.mines, theme), ...lineStyle,
    }));
    if (view.anomalies) {
      const pts = data.mines.flatMap((m) => anomalyPoints(result.byName[m], labels));
      datasets.push(...markerDatasets(pts, theme));
    }
  } else {
    const s = result.byName[view.series];
    const color = colorOf(view.series, data.mines, theme);
    if (view.type === 'bar') {
      datasets.push({ type: 'bar', label: view.series, data: s.values, backgroundColor: color, borderWidth: 0, barPercentage: 0.9, categoryPercentage: 0.9 });
    } else {
      datasets.push({ type: 'line', label: view.series, data: s.values, borderColor: color, backgroundColor: hexA(color, 0.1), fill: 'origin', ...lineStyle });
    }
    if (view.anomalies) datasets.push(...markerDatasets(anomalyPoints(s, labels), theme));
    if (view.trend) datasets.push(trendDataset(s.values, view.trend, theme));
  }

  const options = baseOptions(theme, { pdf, stacked: view.type === 'stacked' });
  options.scales.y.stacked = view.type === 'stacked';
  if (range) {
    options.scales.x.min = labels[range.from];
    options.scales.x.max = labels[range.to];
  }
  if (band) options.plugins.band = { ...band, color: theme.band };
  return { type: view.type === 'line' ? 'line' : 'bar', data: { labels, datasets }, options, plugins };
}

// Small chart of one mine for the "at a glance" grid and the report.
export function miniChartConfig(data, series, theme, { trend = 0, pdf = false } = {}) {
  const color = colorOf(series.name, data.mines, theme);
  const datasets = [
    { type: 'line', label: series.name, data: series.values, borderColor: color, backgroundColor: hexA(color, 0.1), fill: 'origin', borderWidth: pdf ? 2 : 1.5, pointRadius: 0, tension: 0 },
    ...markerDatasets(anomalyPoints(series, data.labels), theme).map((d) => ({ ...d, pointRadius: pdf ? 6 : 4 })),
  ];
  if (trend) datasets.push(trendDataset(series.values, trend, theme));
  const options = baseOptions(theme, { compact: !pdf, pdf, legend: pdf });
  return { type: 'line', data: { labels: data.labels, datasets }, options, plugins };
}

// Zoomed chart around one anomaly episode with the episode shaded.
export function episodeChartConfig(data, result, episode, theme, { pdf = false, margin = 21 } = {}) {
  const from = Math.max(0, episode.start - margin);
  const to = Math.min(data.labels.length - 1, episode.end + margin);
  const s = result.byName[episode.series];
  const color = colorOf(s.name, data.mines, theme);
  const labels = data.labels.slice(from, to + 1);
  const datasets = [
    { type: 'line', label: s.name, data: s.values.slice(from, to + 1), borderColor: color, borderWidth: 2, pointRadius: 2, pointBackgroundColor: color, tension: 0 },
    { type: 'line', label: 'Expected (median adjusted for weekday)', data: s.expected.slice(from, to + 1), borderColor: theme.ink2, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, tension: 0 },
    ...markerDatasets(anomalyPoints(s, data.labels, from, to), theme),
  ];
  const options = baseOptions(theme, { pdf });
  options.scales.x.ticks.maxTicksLimit = 8;
  options.plugins.band = { from: episode.start - from, to: episode.end - from, color: theme.band };
  return { type: 'line', data: { labels, datasets }, options, plugins };
}

// Render a config off screen and return a PNG data URL (used by the PDF report).
export function renderImage(config, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const holder = document.getElementById('offscreen');
  holder.appendChild(canvas);
  const chart = new Chart(canvas, config);
  const url = chart.toBase64Image('image/jpeg', 0.92);
  chart.destroy();
  canvas.remove();
  return url;
}
