import React, { useMemo, useState } from "react";
import { INDIGO, VIOLET, ORANGE, AMBER, TEAL, GREEN, CYAN, SLATE, fin, chip, DenseHeader, Panel, Note } from "../../components/dense.jsx";
import { useLongRun, rowsFor, points, trend, pct, RangePills, SeriesChips, LongLines, span } from "./longRunKit.jsx";

// ============================================================================
// HISTORICAL → INTEREST RATES. The long view of what money has cost:
//   U.S. rates since 1857   one long government yield (Shiller's long rate to
//                           1953, the 10-year Treasury after), the 30-year,
//                           Moody's corporates, NBER railroad bonds and
//                           commercial paper, the 3-month bill and fed funds
//   the real 10-year        nominal minus the past year's inflation, 1872→
//   seven centuries         Schmelzing's global nominal and real rates and the
//                           Bank of England's Bank Rate (1694) and consols (1703)
//   18 economies            Jordà–Schularick–Taylor long-term yields, 1870→2020
// Recent detail (the curve, auctions, the Fed) is on U.S. Economy → Rates & Fed;
// this is the century view.
// ============================================================================

const US_DEFS = [
  { key: "long", label: "10-year Treasury", color: INDIGO, width: 2.2, note: "Long-term U.S. government bond yield: Shiller's series (Homer & Sylla) before April 1953, the 10-year constant maturity after" },
  { key: "gs30", label: "30-year Treasury", color: VIOLET },
  { key: "baa", label: "Baa corporate", color: ORANGE },
  { key: "aaa", label: "Aaa corporate", color: AMBER },
  { key: "rail", label: "Railroad bonds", color: TEAL, note: "High-grade American railroad bond yields (Macaulay, NBER), the benchmark long corporate rate before 1919" },
  { key: "tb3m", label: "3-month bill", color: GREEN },
  { key: "cp", label: "Commercial paper", color: CYAN, dash: true, note: "Prime commercial paper rates, New York (NBER) — the benchmark short rate before Treasury bills" },
  { key: "fedfunds", label: "Fed funds", color: SLATE },
];
const RANGES = [["Since 1857", 1857], ["1900", 1900], ["1950", 1950], ["1980", 1980], ["2000", 2000]];
const CENT_RANGES = [["Since 1317", 1317], ["1600", 1600], ["1800", 1800], ["1900", 1900]];
const CORE = { USA: INDIGO, GBR: ORANGE, DEU: AMBER, JPN: GREEN, FRA: CYAN, ITA: VIOLET, CAN: TEAL };

const latest = ser => { const p = points(ser).filter(([, v]) => fin(v)); return p.length ? { x: p[p.length - 1][0], v: p[p.length - 1][1] } : null; };
const monthName = x => { const y = Math.floor(x), m = Math.round((x - y) * 12); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${y}`; };

export default function LongRates() {
  const { data, error } = useLongRun();
  const [from, setFrom] = useState(1857);
  const [on, setOn] = useState(["long", "baa", "rail", "tb3m", "cp"]);
  const [realFrom, setRealFrom] = useState(1872);
  const [centFrom, setCentFrom] = useState(1317);
  const [centOn, setCentOn] = useState(["globalReal", "globalNominal", "consols"]);
  const [countries, setCountries] = useState(["USA", "GBR", "DEU", "JPN"]);
  const toYear = new Date().getFullYear();

  const R = data?.us?.rates;
  const usRows = useMemo(() => (R ? rowsFor(US_DEFS.filter(d => on.includes(d.key)).map(d => ({ key: d.key, ser: R[d.key] })), from, toYear, toYear - from > 60) : []), [R, on, from, toYear]);
  // the long yield's extremes in the window, from the monthly data
  const extremes = useMemo(() => {
    const p = points(R?.long).filter(([x, v]) => fin(v) && x >= from);
    if (!p.length) return [];
    const hi = p.reduce((a, b) => (b[1] > a[1] ? b : a)), lo = p.reduce((a, b) => (b[1] < a[1] ? b : a));
    const annual = toYear - from > 60, snap = x => (annual ? Math.floor(x) : Math.round(x * 1200) / 1200);
    const yAt = x => usRows.find(r => r.x === snap(x))?.long;
    return [{ x: snap(hi[0]), y: yAt(hi[0]) ?? hi[1], label: `${pct(hi[1])} ${monthName(hi[0])}`, color: INDIGO }, { x: snap(lo[0]), y: yAt(lo[0]) ?? lo[1], label: `${pct(lo[1], 2)} ${monthName(lo[0])}`, color: INDIGO, position: "bottom" }];
  }, [R, from, usRows, toYear]);
  const realRows = useMemo(() => (R ? rowsFor([{ key: "real", ser: R.real }], realFrom, toYear, toYear - realFrom > 60) : []), [R, realFrom, toYear]);

  const CENT_DEFS = useMemo(() => !data ? [] : [
    { key: "globalReal", label: "Global real rate", color: INDIGO, width: 2.2, ser: data.schmelzing.globalReal, note: "Schmelzing: GDP-weighted real yields on sovereign debt of the leading economies, 7-year averages, 1317–2018" },
    { key: "globalNominal", label: "Global nominal rate", color: AMBER, ser: data.schmelzing.globalNominal },
    { key: "safeReal", label: "Safe-asset real rate", color: TEAL, dash: true, ser: data.schmelzing.safeReal, note: "Real yield of the era's safe-asset provider: Italian city-states, then Spain, Holland, Britain and the U.S." },
    { key: "consols", label: "UK consols", color: ORANGE, ser: data.boe.consols, note: "British perpetual government bonds / long-term gilts, Bank of England, 1703–2016" },
    { key: "bankRate", label: "Bank Rate", color: GREEN, ser: data.boe.bankRate, note: "Bank of England policy rate, year end, 1694–2016" },
  ], [data]);
  const centRows = useMemo(() => {
    const rows = rowsFor(CENT_DEFS.filter(d => centOn.includes(d.key)), centFrom, toYear, true);
    const tr = trend(points(data?.schmelzing?.globalReal).filter(([x]) => x >= centFrom));
    if (tr && centOn.includes("globalReal")) for (const r of rows) r.trend = Math.round(tr.at(r.x) * 100) / 100;
    return { rows, tr };
  }, [CENT_DEFS, centOn, centFrom, data, toYear]);

  const jstRows = useMemo(() => (data ? rowsFor(countries.map(c => ({ key: c, ser: data.jst.countries[c]?.ltrate })), 1870, 2020, true) : []), [data, countries]);

  if (error) return <Note>The long-run data could not load: {error}</Note>;
  if (!data) return <Note>Loading a century and a half of rates…</Note>;

  const now = Object.fromEntries(US_DEFS.map(d => [d.key, latest(R[d.key])]));
  const longPts = points(R.long).filter(([, v]) => fin(v));
  const avgLong = longPts.reduce((s, [, v]) => s + v, 0) / longPts.length;
  const below = longPts.filter(([, v]) => v < now.long?.v).length / longPts.length;
  const toggle = (list, set, max) => k => set(l => (l.includes(k) ? l.filter(x => x !== k) : max && l.length >= max ? [...l.slice(1), k] : [...l, k]));

  return (<>
    <DenseHeader
      eyebrow="Interest rates · the long view"
      headline={<>The 10-year Treasury yields {pct(now.long?.v, 2)} — higher than {Math.round(below * 100)}% of the months since 1871, against a long-run average of {pct(avgLong)}.</>}
      blurb={<>One long U.S. government yield runs from 1871 to today: Robert Shiller&apos;s long rate (from Homer and Sylla&apos;s <em>History of Interest Rates</em>) until 1953, the 10-year constant-maturity Treasury after. Around it, the corporate, railroad, money-market and policy rates that complete the picture back to 1857 — and, further down, seven centuries of rates from the Bank of England&apos;s archives.</>}
      meta={<>FRED, Shiller, NBER Macrohistory<br />monthly through {data.asOf?.rates}</>}
      chips={[
        chip("10-year", pct(now.long?.v, 2), INDIGO, "1871 average " + pct(avgLong)),
        chip("30-year", pct(now.gs30?.v, 2), "var(--text-primary)", "since 1977"),
        chip("Baa corporate", pct(now.baa?.v, 2), "var(--text-primary)", `spread ${pct((now.baa?.v ?? NaN) - (now.long?.v ?? NaN), 2)}`),
        chip("3-month bill", pct(now.tb3m?.v, 2), "var(--text-primary)", "since 1934"),
        chip("fed funds", pct(now.fedfunds?.v, 2), "var(--text-primary)", "since 1954"),
      ]}
    />

    <Panel title="U.S. interest rates since 1857" right={toYear - from > 60 ? "annual averages of monthly data" : "monthly"}>
      <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
        <RangePills ranges={RANGES} value={from} onChange={setFrom} />
        <SeriesChips defs={US_DEFS.map(d => ({ ...d, span: span(R[d.key]) }))} on={on} toggle={toggle(on, setOn)} />
      </div>
      <LongLines rows={usRows} lines={US_DEFS.filter(d => on.includes(d.key))} height={320} dots={on.includes("long") ? extremes : []} from={from} />
      <Note>
        The 10-year line is one series: Shiller&apos;s long-term government yield before April 1953 and the constant-maturity 10-year after (the join is seamless: 2.77% → 2.83%). Before the Fed (1914) and Treasury bills (1934), commercial paper was the benchmark short rate and railroad bonds the benchmark long corporate yield. The marked points are the 10-year&apos;s high and low in the window.
      </Note>
    </Panel>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12 }}>
      <Panel title="The real 10-year yield since 1872" right="nominal yield minus the past year's inflation" style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}><RangePills ranges={[["Since 1872", 1872], ["1900", 1900], ["1950", 1950], ["1980", 1980]]} value={realFrom} onChange={setRealFrom} /></div>
        <LongLines rows={realRows} lines={[{ key: "real", label: "Real 10-year", color: INDIGO, width: 1.8 }]} height={240} refs={[{ key: "zero", y: 0, stroke: "var(--text-muted)" }]} from={realFrom} />
        <Note>Inflation is the CPI after 1913 and Warren &amp; Pearson&apos;s wholesale prices before (Shiller), so the 19th-century swings are partly price-index noise. Deeply negative real yields cluster in the two world wars, the late 1970s and 2021–22.</Note>
      </Panel>

      <Panel title="Seven centuries of interest rates" right="annual · global series are 7-year averages" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
          <RangePills ranges={CENT_RANGES} value={centFrom} onChange={setCentFrom} />
          <SeriesChips defs={CENT_DEFS.map(d => ({ ...d, span: span(d.ser) }))} on={centOn} toggle={toggle(centOn, setCentOn)} />
        </div>
        <LongLines rows={centRows.rows} height={240} from={centFrom} refs={[{ key: "zero", y: 0, stroke: "var(--text-muted)" }]}
          lines={[...CENT_DEFS.filter(d => centOn.includes(d.key)), ...(centRows.tr && centOn.includes("globalReal") ? [{ key: "trend", label: "Trend in the global real rate", color: SLATE, dash: true, width: 1.2 }] : [])]} />
        <Note>
          Paul Schmelzing&apos;s reconstruction of what lenders earned on sovereign debt since the 1300s{centRows.tr ? <> trends down by {Math.abs(centRows.tr.slope * 100).toFixed(1)} basis points a year over this window</> : null} — the &quot;suprasecular decline&quot; that predates central banks, inflation targeting and the savings glut. Bank Rate and consols are the Bank of England&apos;s own series (to 2016).
        </Note>
      </Panel>
    </div>

    <Panel title="Long-term government yields in 18 economies, 1870–2020" right="Jordà–Schularick–Taylor Macrohistory Database · pick up to five">
      <div style={{ marginBottom: 6 }}>
        <SeriesChips defs={Object.entries(data.jst.names).map(([iso, name]) => ({ key: iso, label: name, color: CORE[iso] || SLATE }))} on={countries} toggle={toggle(countries, setCountries, 5)} />
      </div>
      <LongLines rows={jstRows} lines={countries.map(c => ({ key: c, label: data.jst.names[c], color: CORE[c] || SLATE, width: c === "USA" ? 2.2 : 1.5 }))} height={280} y={[-1, 22]} from={1870} to={2020} />
      <Note>Annual averages of each country&apos;s benchmark long government bond. Yields converge under the gold standard before 1914, scatter through the world wars and the 1970s inflation, and converge again on the way down after 1990 — the axis is capped at 22%, so the war-time extremes in a few countries run off the top. Licence CC BY-NC-SA 4.0.</Note>
    </Panel>
  </>);
}
