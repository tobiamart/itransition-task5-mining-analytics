// Unit tests for assets/analysis.js. Run: npm install && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

globalThis.jStat = createRequire(import.meta.url)('jstat');
const A = await import('../assets/analysis.js');

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("Grubbs critical values match published tables (alpha = 0.05, two-sided)", () => {
  close(A.grubbsCritical(10, 0.05), 2.290, 2e-3);
  close(A.grubbsCritical(20, 0.05), 2.709, 2e-3);
  close(A.grubbsCritical(100, 0.05), 3.384, 2e-3);
});

test('describe uses sample sd and linearly interpolated quartiles', () => {
  const s = A.describe([1, 2, 3, 4, 5, 6, 7, 8]);
  close(s.q1, 2.75, 1e-9);
  close(s.median, 4.5, 1e-9);
  close(s.q3, 6.25, 1e-9);
  close(s.sd, 2.449490, 1e-6);
});

test('polynomial fit recovers an exact quadratic', () => {
  const ys = Array.from({ length: 50 }, (_, i) => 3 + 0.5 * i - 0.02 * i * i);
  A.polyFit(ys, 2).fitted.forEach((v, i) => close(v, ys[i], 1e-6));
  close(A.polyFit(ys, 4).r2, 1, 1e-9);
});

test('moving-average test compares with the previous window only', () => {
  const { flags, ma } = A.maTest([10, 10, 10, 10, 20, 10], 3, 50);
  assert.deepEqual(flags, [false, false, false, false, true, false]);
  assert.equal(ma[3], 10);
});

test('IQR, z-score and Grubbs all catch a clear outlier', () => {
  const xs = Array.from({ length: 60 }, (_, i) => 100 + 5 * Math.sin(i));
  xs[30] = 160;
  assert.equal(A.iqrTest(xs, 1.5).flags[30], true);
  assert.equal(A.zTest(xs, 3).flags[30], true);
  assert.deepEqual(A.grubbsTest(xs, 0.05).steps.map((s) => s.index), [30]);
});

test('weekday adjustment stops a regular quiet Sunday from being an anomaly', () => {
  const dates = Array.from({ length: 140 }, (_, i) => new Date(Date.UTC(2025, 0, 5 + i)));  // starts on a Sunday
  const values = dates.map((d, i) => (d.getUTCDay() === 0 ? 600 : 1000) + 20 * Math.sin(i * 1.7));
  const p = { iqrK: 1.5, zThreshold: 3, maWindow: 7, maPct: 30, grubbsAlpha: 0.05, minTests: 1,
    enabled: { iqr: true, z: true, ma: true, grubbs: true } };
  assert.ok(A.analyseSeries('m', values, dates, { ...p, adjustWeekday: false }).episodes.length > 10);
  assert.equal(A.analyseSeries('m', values, dates, { ...p, adjustWeekday: true }).episodes.length, 0);
});

test('consecutive flagged days form one episode with the right direction', () => {
  const dates = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)));
  const values = dates.map((_, i) => 1000 + 10 * Math.sin(i * 2.3));
  [40, 41, 42].forEach((i) => { values[i] = 400; });
  const p = { iqrK: 1.5, zThreshold: 3, maWindow: 7, maPct: 30, grubbsAlpha: 0.05, minTests: 2, adjustWeekday: false,
    enabled: { iqr: true, z: true, ma: true, grubbs: true } };
  const [e, ...rest] = A.analyseSeries('m', values, dates, p).episodes;
  assert.equal(rest.length, 0);
  assert.equal(e.type, 'drop');
  assert.equal(e.start, 40);
  assert.equal(e.end, 42);
});
