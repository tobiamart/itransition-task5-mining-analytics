// PDF report: everything on the dashboard plus one section per anomaly episode.
import { TESTS } from './analysis.js';
import { THEMES, TREND_NAMES, colorOf, episodeChartConfig, mainChartConfig, miniChartConfig, renderImage } from './charts.js';

const PAGE = { w: 210, h: 297, m: 16 };
const CONTENT_W = PAGE.w - 2 * PAGE.m;
const NAVY = [31, 56, 100];
const INK = [11, 11, 11];
const INK2 = [82, 81, 78];
const MUTED = [137, 135, 129];
const HAIR = [225, 224, 217];
const CRITICAL = [208, 59, 59];

const num = (v, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const iso = (d) => d.toISOString().slice(0, 10);
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function generateReport(state) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const { data, result, params, view } = state;
  const theme = THEMES.light;
  const r = new Writer(doc);
  const period = `${data.labels[0]} to ${data.labels[data.labels.length - 1]}`;
  const total = result.byName.Total;
  const enabledTests = Object.keys(TESTS).filter((t) => params.enabled[t]);

  // ---------------------------------------------------------------- cover
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE.w, 46, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal').setFontSize(10).text('WEYLAND-YUTANI CORPORATION', PAGE.m, 16);
  doc.setFont('helvetica', 'bold').setFontSize(22).text('Mining Output Analysis Report', PAGE.m, 28);
  doc.setFont('helvetica', 'normal').setFontSize(11).text(`Daily resource extraction, ${period}`, PAGE.m, 37);
  r.y = 56;

  r.table({
    body: [
      ['Generated', new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })],
      ['Data source', `Google Sheets generator (tab "Data"), loaded ${state.loadedAt.toLocaleString('en-GB')}`],
      ['Period', `${period} (${data.labels.length} days)`],
      ['Mines', `${data.mines.length}: ${data.mines.join(', ')}`],
    ],
    theme: 'plain', styles: { fontSize: 9.5, cellPadding: 1.4, textColor: INK },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32, textColor: INK2 } },
  });

  r.y += 4;
  const spikes = result.episodes.filter((e) => e.type === 'spike').length;
  r.tiles([
    ['Total output', `${num(total.stats.sum / 1000, 1)} kt`],
    ['Mean daily output', `${num(total.stats.mean, 0)} t`],
    ['Std deviation (daily)', `${num(total.stats.sd, 0)} t`],
    ['Anomaly episodes', `${result.episodes.length} (${spikes} up, ${result.episodes.length - spikes} down)`],
  ]);

  r.heading('Analysis settings', 2);
  r.table({
    head: [['Test', 'Parameters', 'Status']],
    body: [
      ['IQR rule', `Outside [Q1 - ${params.iqrK} x IQR, Q3 + ${params.iqrK} x IQR]`, params.enabled.iqr ? 'On' : 'Off'],
      ['Z-score', `|z| > ${params.zThreshold}`, params.enabled.z ? 'On' : 'Off'],
      ['Moving average', `More than ${params.maPct}% from the mean of the previous ${params.maWindow} days`, params.enabled.ma ? 'On' : 'Off'],
      ["Grubbs' test", `Iterative, two-sided, significance level ${params.grubbsAlpha}`, params.enabled.grubbs ? 'On' : 'Off'],
    ],
    columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' }, 2: { cellWidth: 18, halign: 'center' } },
  });
  r.para(`A day counts as anomalous when at least ${params.minTests} of the ${enabledTests.length} enabled tests flag it; flagged days no more than two days apart form one episode. `
    + (params.adjustWeekday
      ? 'Before testing, each value is divided by its weekday factor (the weekday mean over the overall mean), so the regular weekly pattern, such as quieter Sundays, is not reported as a drop.'
      : 'Tests run on raw daily values; the weekly pattern is not removed.'));
  r.para(`Charts in this report: ${view.type} chart, trendline ${view.trend ? `${TREND_NAMES[view.trend].toLowerCase()} (polynomial of degree ${view.trend})` : 'off'}.`);

  // ---------------------------------------------------------------- statistics
  r.newPage();
  r.heading('1. Summary statistics', 1);
  r.para('Daily output in tonnes for each mine and for the total of all mines. Standard deviation is the sample standard deviation; quartiles use linear interpolation.');
  r.table({
    head: [['Series', 'Mean', 'Std dev', 'Median', 'Q1', 'Q3', 'IQR', 'Min', 'Max']],
    body: result.series.map((s) => [s.name, ...['mean', 'sd', 'median', 'q1', 'q3', 'iqr', 'min', 'max'].map((k) => num(s.stats[k]))]),
    columnStyles: Object.fromEntries([...Array(8)].map((_, i) => [i + 1, { halign: 'right' }])),
    didParseCell: totalRowBold,
    swatches: (row) => colorOf(result.series[row].name, data.mines, theme),
  });

  r.heading('2. Anomalies by test', 1);
  r.para('Number of days flagged by each test, and the number of confirmed episodes per series. Disabled tests are shown in grey and do not count towards confirmation.');
  r.table({
    head: [['Series', ...Object.values(TESTS), 'Confirmed days', 'Episodes']],
    body: result.series.map((s) => [s.name, ...Object.keys(TESTS).map((t) => s.counts[t]), s.confirmed.filter(Boolean).length, s.episodes.length]),
    columnStyles: Object.fromEntries([...Array(6)].map((_, i) => [i + 1, { halign: 'right' }])),
    didParseCell: (h) => {
      totalRowBold(h);
      const t = Object.keys(TESTS)[h.column.index - 1];
      if (h.section !== 'head' && t && !params.enabled[t]) h.cell.styles.textColor = MUTED;
    },
    swatches: (row) => colorOf(result.series[row].name, data.mines, theme),
  });

  // ---------------------------------------------------------------- charts
  r.newPage();
  r.heading('3. Output charts', 1);
  const mainView = view.type === 'stacked' ? view : { ...view, series: view.series === '__all' ? 'Total' : view.series };
  const mainTitle = view.type === 'stacked' ? 'Daily output of all mines, stacked' : `Daily output: ${mainView.series}`;
  r.chart(mainTitle, mainChartConfig(data, result, mainView, theme, { pdf: true }), 0.42);
  if (view.type !== 'stacked') {
    r.chart('Daily output of all mines, stacked (markers: anomalies of the total)', mainChartConfig(data, result, { ...view, type: 'stacked' }, theme, { pdf: true }), 0.42);
  } else {
    r.chart('Daily output: Total', mainChartConfig(data, result, { ...view, type: 'line', series: 'Total' }, theme, { pdf: true }), 0.42);
  }
  r.heading('Output by mine', 2, CONTENT_W * 0.34 + 8);
  for (const m of data.mines) {
    const s = result.byName[m];
    r.chart(`${m}: mean ${num(s.stats.mean, 0)} t, std dev ${num(s.stats.sd, 0)} t, ${plural(s.episodes.length, 'episode')}`,
      miniChartConfig(data, s, theme, { trend: view.trend, pdf: true }), 0.34);
  }

  // ---------------------------------------------------------------- episodes
  r.newPage();
  r.heading('4. Anomaly episodes', 1);
  if (!result.episodes.length) {
    r.para('No anomalies were confirmed with the current settings.');
  } else {
    r.para(`${plural(result.episodes.length, 'episode')} confirmed. Expected output is the median of the weekday-adjusted series multiplied by the weekday factor of that day.`);
    r.table({
      head: [['ID', 'Series', 'Type', 'Period', 'Days', 'Peak', 'Deviation', 'Tests']],
      body: result.episodes.map((e) => [e.id, e.series, e.type, e.start === e.end ? iso(e.startDate) : `${iso(e.startDate)} to ${iso(e.endDate)}`,
        e.length, num(e.peakValue), pct(e.deviation), e.testsHit.map((t) => TESTS[t]).join(', ')]),
      styles: { fontSize: 8 },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: (h) => {
        if (h.section === 'body' && h.column.index === 2) h.cell.styles.textColor = h.cell.raw === 'drop' ? CRITICAL : [0, 99, 0];
      },
    });
    for (const e of result.episodes) {
      r.ensure(118);
      const where = e.series === 'Total' ? 'in total output' : `at ${e.series}`;
      const subject = e.series === 'Total' ? 'All mines together' : e.series;
      r.heading(`${e.id}. ${e.type === 'spike' ? 'Spike' : 'Drop'} ${where}, ${e.start === e.end ? iso(e.startDate) : `${iso(e.startDate)} to ${iso(e.endDate)}`}`, 2);
      const above = e.deviation > 0 ? 'above' : 'below';
      r.para(`${subject} produced ${num(e.peakValue)} t on ${iso(e.peakDate)}, ${Math.abs(e.deviation * 100).toFixed(1)}% ${above} the expected ${num(e.expected)} t for that weekday. `
        + `The episode spans ${plural(e.length, 'day')} (${e.flaggedDays} confirmed) and was flagged by ${e.testsHit.map((t) => TESTS[t]).join(', ')}. `
        + `Over the episode the series was ${num(Math.abs(e.excess))} t ${e.excess > 0 ? 'above' : 'below'} expectation in total.`);
      r.table({
        body: [
          ['Series', e.series, 'Peak date', iso(e.peakDate)],
          ['Type', e.type, 'Peak value', `${num(e.peakValue)} t`],
          ['Start', iso(e.startDate), 'Expected', `${num(e.expected)} t`],
          ['End', iso(e.endDate), 'Deviation', pct(e.deviation)],
          ['Length', plural(e.length, 'day'), 'Z-score at peak', num(e.zPeak, 2)],
        ],
        theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.3, lineColor: HAIR, lineWidth: 0.2 },
        columnStyles: { 0: { fontStyle: 'bold', textColor: INK2, cellWidth: 30 }, 2: { fontStyle: 'bold', textColor: INK2, cellWidth: 34 } },
      });
      r.chart(null, episodeChartConfig(data, result, e, theme, { pdf: true }), 0.3);
    }
  }

  // ---------------------------------------------------------------- methodology
  r.newPage();
  r.heading('5. Methodology', 1);
  const methods = [
    ['Data', 'The report reads the "Data" tab of the public Google Sheets generator: one row per day, one column per mine and a Total column. The generator draws values from the selected distribution, smooths them with an AR(1) process and applies weekday factors, a trend, seasonality and bell-shaped events.'],
    ['Descriptive statistics', 'Mean, sample standard deviation, median, first and third quartile (linear interpolation) and interquartile range IQR = Q3 - Q1, computed on raw daily output.'],
    ['IQR rule', `A day is flagged when its value lies below Q1 - k x IQR or above Q3 + k x IQR, with k = ${params.iqrK}.`],
    ['Z-score', `z = (x - mean) / standard deviation; a day is flagged when |z| > ${params.zThreshold}.`],
    ['Moving average', `The value is compared with the mean of the previous ${params.maWindow} days; it is flagged when the difference exceeds ${params.maPct}% of that mean. The first ${params.maWindow} days cannot be tested.`],
    ["Grubbs' test", `G = max |x - mean| / s is compared with the two-sided critical value G_crit = (n - 1) / sqrt(n) x sqrt(t^2 / (n - 2 + t^2)), where t is the upper alpha / (2n) quantile of Student's t with n - 2 degrees of freedom (alpha = ${params.grubbsAlpha}). The most extreme value is removed and the test repeats until it is no longer significant (at most 10% of the days).`],
    ['Weekday adjustment', params.adjustWeekday ? 'On: all tests run on values divided by their weekday factor; statistics and charts show raw values.' : 'Off: tests run on raw values.'],
    ['Trendline', 'Least-squares polynomial of the chosen degree (1 to 4) fitted to the daily values; R squared is shown in the chart legend.'],
  ];
  r.table({ body: methods, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } } });

  r.footers();
  doc.save(`WY-mining-report-${iso(new Date())}.pdf`);
}

function totalRowBold(h) {
  if (h.section === 'body' && h.row.raw[0] === 'Total') {
    h.cell.styles.fontStyle = 'bold';
    h.cell.styles.fillColor = [238, 241, 247];
  }
}

// Keeps track of the vertical position and adds pages when content does not fit.
class Writer {
  constructor(doc) {
    this.doc = doc;
    this.y = PAGE.m;
  }

  newPage() {
    this.doc.addPage();
    this.y = PAGE.m + 6;
  }

  ensure(height) {
    if (this.y + height > PAGE.h - PAGE.m - 8) this.newPage();
  }

  // `keep` reserves room for the block that follows, so a heading never ends a page alone.
  heading(text, level, keep = 0) {
    const size = level === 1 ? 15 : 11.5;
    this.ensure((level === 1 ? 20 : 14) + keep);
    this.y += level === 1 ? 2 : 4;
    this.doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...(level === 1 ? NAVY : INK));
    this.doc.text(text, PAGE.m, this.y + size * 0.35);
    this.y += size * 0.35 + 2;
    if (level === 1) {
      this.doc.setDrawColor(...NAVY).setLineWidth(0.5).line(PAGE.m, this.y, PAGE.m + CONTENT_W, this.y);
      this.y += 4;
    } else {
      this.y += 1;
    }
  }

  para(text) {
    this.doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK2);
    const lines = this.doc.splitTextToSize(text, CONTENT_W);
    this.ensure(lines.length * 4.4 + 2);
    this.doc.text(lines, PAGE.m, this.y + 3.2);
    this.y += lines.length * 4.4 + 2.5;
  }

  table({ swatches, didParseCell, ...opts }) {
    const doc = this.doc;
    doc.autoTable({
      startY: this.y,
      margin: { left: PAGE.m, right: PAGE.m, top: PAGE.m + 6, bottom: PAGE.m + 8 },
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 8.8, cellPadding: 1.8, textColor: INK, lineColor: HAIR },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 247, 245] },
      ...opts,
      didParseCell: (h) => {
        if (swatches && h.section === 'body' && h.column.index === 0) h.cell.styles.cellPadding = { top: 1.8, bottom: 1.8, right: 1.8, left: 6 };
        if (didParseCell) didParseCell(h);
      },
      didDrawCell: (h) => {
        if (swatches && h.section === 'body' && h.column.index === 0) {
          doc.setFillColor(...hexRgb(swatches(h.row.index)));
          doc.roundedRect(h.cell.x + 1.8, h.cell.y + h.cell.height / 2 - 1.3, 2.6, 2.6, 0.6, 0.6, 'F');
        }
      },
    });
    this.y = doc.lastAutoTable.finalY + 4;
  }

  tiles(items) {
    const gap = 4;
    const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
    items.forEach(([label, value], i) => {
      const x = PAGE.m + i * (w + gap);
      this.doc.setDrawColor(...HAIR).setFillColor(250, 250, 248).roundedRect(x, this.y, w, 22, 1.5, 1.5, 'FD');
      this.doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED).text(label.toUpperCase(), x + 3.5, this.y + 6.5);
      const size = value.length > 14 ? 11 : 15;
      this.doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...INK).text(value, x + 3.5, this.y + 15.5, { maxWidth: w - 7 });
    });
    this.y += 28;
  }

  chart(title, config, aspect) {
    const pxW = 1000;
    const pxH = Math.round(pxW * aspect);
    const h = CONTENT_W * aspect;
    this.ensure(h + (title ? 8 : 2));
    if (title) {
      this.doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK).text(title, PAGE.m, this.y + 3.5);
      this.y += 6;
    }
    this.doc.addImage(renderImage(config, pxW, pxH), 'JPEG', PAGE.m, this.y, CONTENT_W, h);
    this.y += h + 5;
  }

  footers() {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
      this.doc.setDrawColor(...HAIR).setLineWidth(0.2).line(PAGE.m, PAGE.h - PAGE.m + 1, PAGE.w - PAGE.m, PAGE.h - PAGE.m + 1);
      this.doc.text('Weyland-Yutani Corporation · Mining output analysis', PAGE.m, PAGE.h - PAGE.m + 5);
      this.doc.text(`Page ${i} of ${n}`, PAGE.w - PAGE.m, PAGE.h - PAGE.m + 5, { align: 'right' });
    }
  }
}
