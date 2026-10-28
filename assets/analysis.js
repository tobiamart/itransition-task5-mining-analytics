// Descriptive statistics, anomaly tests and trend fitting for daily output series.
// Pure functions, no DOM access (Grubbs needs the jStat global for the t distribution).

export const TESTS = {
  iqr: 'IQR rule',
  z: 'Z-score',
  ma: 'Moving average',
  grubbs: "Grubbs' test",
};

const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

// Linear interpolation between closest ranks (same as numpy / Excel QUARTILE.INC).
export function quantile(sorted, p) {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

export function describe(values) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const m = mean(values);
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    n, mean: m, sd, median: quantile(sorted, 0.5), q1, q3, iqr: q3 - q1,
    min: sorted[0], max: sorted[n - 1], sum: values.reduce((s, v) => s + v, 0),
  };
}

// Ratio of each weekday's mean to the overall mean (index 0 = Sunday).
export function weekdayFactors(values, dates) {
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  dates.forEach((d, i) => { sums[d.getUTCDay()] += values[i]; counts[d.getUTCDay()] += 1; });
  const overall = mean(values);
  return sums.map((s, w) => (counts[w] && overall ? s / counts[w] / overall : 1));
}

export function iqrTest(x, k) {
  const s = describe(x);
  const lo = s.q1 - k * s.iqr;
  const hi = s.q3 + k * s.iqr;
  return { flags: x.map((v) => v < lo || v > hi), lo, hi };
}

export function zTest(x, threshold) {
  const s = describe(x);
  const scores = x.map((v) => (s.sd > 0 ? (v - s.mean) / s.sd : 0));
  return { flags: scores.map((z) => Math.abs(z) > threshold), scores };
}

// Distance (percent) from the trailing moving average of the previous `window` days.
export function maTest(x, window, pct) {
  const ma = x.map(() => null);
  const flags = x.map(() => false);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    if (i >= window) {
      ma[i] = sum / window;
      flags[i] = ma[i] !== 0 && (Math.abs(x[i] - ma[i]) / Math.abs(ma[i])) * 100 > pct;
      sum -= x[i - window];
    }
    sum += x[i];
  }
  return { flags, ma };
}

// Two-sided critical value of Grubbs' statistic for sample size n.
export function grubbsCritical(n, alpha) {
  const t = jStat.studentt.inv(1 - alpha / (2 * n), n - 2);
  return ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (n - 2 + t * t));
}

// Iterative Grubbs: remove the most extreme value while it is significant.
export function grubbsTest(x, alpha, maxOutliers = Math.floor(x.length * 0.1)) {
  const flags = x.map(() => false);
  const steps = [];
  let active = x.map((_, i) => i);
  while (active.length > 6 && steps.length < maxOutliers) {
    const s = describe(active.map((i) => x[i]));
    if (s.sd === 0) break;
    let best = -1;
    let g = -1;
    for (const i of active) {
      const gi = Math.abs(x[i] - s.mean) / s.sd;
      if (gi > g) { g = gi; best = i; }
    }
    const critical = grubbsCritical(active.length, alpha);
    if (g <= critical) break;
    flags[best] = true;
    steps.push({ index: best, g, critical });
    active = active.filter((i) => i !== best);
  }
  return { flags, steps };
}

// Least-squares polynomial on x scaled to [-1, 1] (keeps the normal equations well conditioned).
export function polyFit(values, degree) {
  const n = values.length;
  const xs = values.map((_, i) => (n > 1 ? (2 * i) / (n - 1) - 1 : 0));
  const k = degree + 1;
  const a = Array.from({ length: k }, () => Array(k + 1).fill(0));
  xs.forEach((x, i) => {
    const pw = Array.from({ length: 2 * k }, (_, p) => x ** p);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) a[r][c] += pw[r + c];
      a[r][k] += pw[r] * values[i];
    }
  });
  for (let c = 0; c < k; c++) {  // Gaussian elimination with partial pivoting
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < k; r++) {
      if (r === c || a[c][c] === 0) continue;
      const f = a[r][c] / a[c][c];
      for (let j = c; j <= k; j++) a[r][j] -= f * a[c][j];
    }
  }
  const coef = a.map((row, i) => (row[i] ? row[k] / row[i] : 0));
  const fitted = xs.map((x) => coef.reduce((s, cf, p) => s + cf * x ** p, 0));
  const m = mean(values);
  const ssTot = values.reduce((s, v) => s + (v - m) ** 2, 0);
  const ssRes = values.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0);
  return { coef, fitted, r2: ssTot ? 1 - ssRes / ssTot : 1 };
}

// Run every test on one series. With `adjustWeekday`, values are divided by their
// weekday factor first, so a regular quiet Sunday is not reported as a drop.
export function analyseSeries(name, values, dates, p) {
  const factors = p.adjustWeekday ? weekdayFactors(values, dates) : Array(7).fill(1);
  const factorOf = dates.map((d) => factors[d.getUTCDay()]);
  const x = values.map((v, i) => v / factorOf[i]);
  const stats = describe(values);
  const tests = {
    iqr: iqrTest(x, p.iqrK),
    z: zTest(x, p.zThreshold),
    ma: maTest(x, p.maWindow, p.maPct),
    grubbs: grubbsTest(x, p.grubbsAlpha),
  };
  const median = describe(x).median;
  const expected = factorOf.map((f) => median * f);
  const enabled = Object.keys(TESTS).filter((t) => p.enabled[t]);
  const flaggedBy = values.map((_, i) => enabled.filter((t) => tests[t].flags[i]));
  const counts = Object.fromEntries(Object.keys(TESTS).map((t) => [t, tests[t].flags.filter(Boolean).length]));
  const direction = values.map((v, i) => (v >= expected[i] ? 1 : -1));
  return {
    name, values, stats, tests, counts, expected, flaggedBy, direction, factors,
    confirmed: flaggedBy.map((f) => f.length >= p.minTests),
    episodes: findEpisodes(name, values, dates, expected, flaggedBy, tests, p.minTests),
  };
}

// Group confirmed days (flagged by at least `minTests` tests) into episodes;
// days at most `maxGap` apart belong to one episode.
export function findEpisodes(name, values, dates, expected, flaggedBy, tests, minTests = 1, maxGap = 2) {
  const idx = flaggedBy.map((f, i) => (f.length >= minTests ? i : -1)).filter((i) => i >= 0);
  const groups = [];
  for (const i of idx) {
    const last = groups[groups.length - 1];
    if (last && i - last[last.length - 1] <= maxGap) last.push(i);
    else groups.push([i]);
  }
  return groups.map((g) => {
    const peak = g.reduce((b, i) => (Math.abs(values[i] - expected[i]) > Math.abs(values[b] - expected[b]) ? i : b), g[0]);
    const testsHit = Object.keys(TESTS).filter((t) => g.some((i) => flaggedBy[i].includes(t)));
    const start = g[0];
    const end = g[g.length - 1];
    let excess = 0;
    for (let i = start; i <= end; i++) excess += values[i] - expected[i];
    return {
      series: name, start, end, days: g.map((i) => i), flaggedDays: g.length,
      startDate: dates[start], endDate: dates[end], length: end - start + 1,
      peak, peakDate: dates[peak], peakValue: values[peak], expected: expected[peak],
      deviation: (values[peak] - expected[peak]) / expected[peak],
      type: values[peak] >= expected[peak] ? 'spike' : 'drop',
      testsHit, excess,
      zPeak: tests.z.scores[peak],
    };
  });
}

export function analyseAll(dataset, p) {
  const series = [...dataset.mines, 'Total'].map((name) => analyseSeries(name, dataset.columns[name], dataset.dates, p));
  const episodes = series.flatMap((s) => s.episodes).sort((a, b) => a.start - b.start || a.series.localeCompare(b.series));
  episodes.forEach((e, i) => { e.id = `A${i + 1}`; });
  return { series, byName: Object.fromEntries(series.map((s) => [s.name, s])), episodes };
}
