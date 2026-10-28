# Task 5 – Weyland-Yutani mining output: generator and analytics dashboard

- **Generator (Google Sheets, formulas only):** https://docs.google.com/spreadsheets/d/1KxNeW1Ccx1u1V_1ngHKzAD_556bXqVUD2Z66exkqJBo/edit
- **Dashboard:** https://wy-mining-analytics.vercel.app

## Part I – generator

The spreadsheet has two tabs:

- **Parameters** – every input is a yellow cell with blue text; labels and formulas are protected.
  - Mines: up to 8 names with a size factor; add or remove a mine by typing or clearing its name.
  - Date range (up to 3 years) and a random seed.
  - Distribution: Uniform (min, max), Normal (mean, standard deviation) or Lognormal (median, sigma).
    Each keeps its own parameters; the active one is highlighted and the "Active" labels change with the choice.
  - Smoothing: AR(1) day-to-day correlation (0–0.95) and the share of variation common to all mines (0–1).
  - Day-of-week factors, linear trend per year, yearly seasonality (amplitude, peak month).
  - Up to 6 events (spikes or drops): start date, duration, magnitude and either a probability per mine
    or an exact number of affected mines. Events follow a bell curve.
  - Two charts (total output, output by mine) that update with the data.
- **Data** – one `LET` formula builds the whole table (`Date`, `Total`, one column per mine):

```
output = size × draw(distribution, AR(1)-smoothed noise) × weekday factor × (1 + trend·t) × seasonality × (1 + Σ events)
```

Random numbers come from a deterministic hash of (seed, day, mine), not `RAND()`, so the data only changes when a parameter changes.

## Part II – dashboard

A static web app (no backend) that reads the `Data` tab straight from Google Sheets
(`/gviz/tq?tqx=out:csv`) and does all the analysis in the browser.

- Mean, standard deviation, median, quartiles and IQR for each mine and the total.
- Anomaly tests with adjustable parameters: IQR rule (k), z-score (threshold), distance from the
  trailing moving average (window, %) and iterative two-sided Grubbs' test (alpha).
  A day is confirmed when at least N enabled tests flag it; nearby confirmed days form an episode.
  Optionally the weekly pattern is removed before testing, so a normal quiet Sunday is not a "drop".
- Line, bar or stacked charts with highlighted anomalies (▲ spike, ▼ drop) and polynomial trendlines (degree 1–4).
- Clicking an episode zooms the chart to it.
- **Generate PDF report** builds a multi-page PDF in the browser (jsPDF + AutoTable): settings, statistics,
  test results, all charts and one section per anomaly episode with a zoomed chart.

Libraries (CDN): Bootstrap 5, Chart.js 4, PapaParse, jStat, jsPDF, jsPDF-AutoTable.

### Run locally

```bash
python -m http.server 5173     # then open http://localhost:5173
npm install && npm test        # unit tests of the analysis module
```

To read another copy of the generator, open the dashboard with `?sheet=<spreadsheet id or URL>`.
