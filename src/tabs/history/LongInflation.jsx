import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Cell, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { INDIGO, ORANGE, AMBER, GREEN, CYAN, VIOLET, TEAL, SLATE, fin, tip, axis, chip, DenseHeader, Panel, Note, useIsPhone, chartH } from "../../components/dense.jsx";
import { useLongRun, rowsFor, points, rolling, pct, spct, RangePills, SeriesChips, LongLines } from "./longRunKit.jsx";

// ============================================================================
// HISTORICAL → INFLATION. Prices over two centuries in the U.S. and eight in
// England:
//   U.S. inflation since 1801   Minneapolis Fed annual CPI series (BLS CPI
//                               from 1913, historical estimates before), with
//                               a 10-year average
//   what a dollar buys          the same CPI as a price level, log scale
//   English prices since 1209   Bank of England millennium dataset
//   18 economies                Jordà–Schularick–Taylor CPI, 1871→2020
//   by decade                   U.S. average inflation, extremes, deflation years
// Monthly CPI detail is on U.S. Economy → Prices; this is the long view.
// ============================================================================

const BLUE = "#3b82f6";
const CORE = { USA: INDIGO, GBR: ORANGE, DEU: AMBER, JPN: GREEN, FRA: CYAN, ITA: VIOLET, CAN: TEAL };
const toggle = (set, max) => k => set(l => (l.includes(k) ? l.filter(x => x !== k) : max && l.length >= max ? [...l.slice(1), k] : [...l, k]));

// annual inflation from a price index { s, v }
function inflationOf(ser) {
  if (!ser?.v) return null;
  const v = ser.v.map((p, i) => (i && fin(p) && fin(ser.v[i - 1]) && ser.v[i - 1] > 0 ? Math.round((p / ser.v[i - 1] - 1) * 10000) / 100 : null)).slice(1);
  return { s: ser.s + 1, v };
}

export default function LongInflation() {
  const { data, error } = useLongRun();
  const phone = useIsPhone();
  const [from, setFrom] = useState(1801);
  const [ukMode, setUkMode] = useState("level");
  const [ukFrom, setUkFrom] = useState(1209);
  const [countries, setCountries] = useState(["USA", "GBR", "DEU", "JPN"]);
  const toYear = new Date().getFullYear();

  const us = data?.us;
  const bars = useMemo(() => {
    if (!us) return [];
    const rows = points(us.inflation).map(([y, v]) => ({ x: y, v, est: us.estimateFrom != null && y >= us.estimateFrom }));
    rolling(rows, "v", 10);
    return rows.filter(r => r.x >= from);
  }, [us, from]);
  const level = useMemo(() => (us ? rowsFor([{ key: "cpi", ser: us.cpiAnnual }], 1800, toYear + 1, true) : []), [us, toYear]);
  const uk = useMemo(() => {
    if (!data) return [];
    if (ukMode === "level") return rowsFor([{ key: "cpi", ser: data.boe.cpi }], ukFrom, 2016, true);
    const rows = rowsFor([{ key: "infl", ser: data.boe.inflation }], ukFrom - 10, 2016, true);
    return rolling(rows, "infl", 10).filter(r => r.x >= ukFrom);
  }, [data, ukMode, ukFrom]);
  const jstRows = useMemo(() => (data ? rowsFor(countries.map(c => ({ key: c, ser: inflationOf(data.jst.countries[c]?.cpi) })), 1871, 2020, true) : []), [data, countries]);
  const decades = useMemo(() => {
    if (!us) return [];
    const cpi = new Map(points(us.cpiAnnual)), infl = new Map(points(us.inflation));
    const out = [];
    for (let d = 1800; d <= toYear; d += 10) {
      const ys = Array.from({ length: 10 }, (_, i) => d + i).filter(y => infl.has(y) && fin(infl.get(y)) && !(us.estimateFrom != null && y >= us.estimateFrom));
      if (!ys.length) continue;
      const first = d === 1800 ? 1800 : d - 1, last = ys[ys.length - 1];
      const n = last - first, p0 = cpi.get(first), p1 = cpi.get(last);
      const vals = ys.map(y => [y, infl.get(y)]);
      const hi = vals.reduce((a, b) => (b[1] > a[1] ? b : a)), lo = vals.reduce((a, b) => (b[1] < a[1] ? b : a));
      out.push({ d, avg: p0 > 0 && n > 0 ? ((p1 / p0) ** (1 / n) - 1) * 100 : null, hi, lo, defl: vals.filter(([, v]) => v < 0).length, n: ys.length });
    }
    return out;
  }, [us, toYear]);

  if (error) return <Note>The long-run data could not load: {error}</Note>;
  if (!data) return <Note>Loading two centuries of prices…</Note>;

  const cpiAt = y => points(us.cpiAnnual).find(([x]) => x === y)?.[1];
  const lastActual = (us.estimateFrom ?? toYear + 1) - 1;
  const p1800 = cpiAt(1800), p1913 = cpiAt(1913), p1971 = cpiAt(1971), pNow = cpiAt(lastActual);
  const monthlyNow = points(us.inflationMonthly).filter(([, v]) => fin(v)).at(-1);
  const deflYears = points(us.inflation).filter(([y, v]) => fin(v) && v < 0 && y >= 1801);
  const lastDefl = deflYears.at(-1);

  return (<>
    <DenseHeader
      eyebrow="Inflation · the long view"
      headline={<>A dollar of 1913 buys what {fin(p1913) && fin(pNow) ? `$${(pNow / p1913).toFixed(0)}` : "—"} buys today; a dollar of 1800 bought less than one of 1913. Prices were roughly flat for a century under the gold standard and have risen almost every year since the 1930s.</>}
      blurb={<>Annual U.S. inflation back to 1801 from the Minneapolis Fed&apos;s CPI series (the BLS index from 1913, historical estimates before), English prices back to 1209 from the Bank of England, and eighteen economies since 1870 from the Jordà–Schularick–Taylor database.</>}
      meta={<>latest monthly CPI: {monthlyNow ? `${spct(monthlyNow[1])} y/y` : "—"}<br />annual through {lastActual}</>}
      chips={[
        chip("1800 → 1913", fin(p1800) && fin(p1913) ? spct((p1913 / p1800 - 1) * 100, 0) : "—", BLUE, "prices, 113 years"),
        chip("1913 → today", fin(p1913) && fin(pNow) ? `×${(pNow / p1913).toFixed(1)}` : "—", ORANGE, `${lastActual}`),
        chip("since 1971", fin(p1971) && fin(pNow) ? `×${(pNow / p1971).toFixed(1)}` : "—", "var(--text-primary)", "the end of the gold link"),
        chip("deflation years", `${deflYears.length}`, "var(--text-primary)", lastDefl ? `last: ${lastDefl[0]} (${spct(lastDefl[1])})` : ""),
      ]}
    />

    <Panel title="U.S. inflation since 1801" right="annual % change in the CPI · line: 10-year average">
      <div style={{ marginBottom: 6 }}><RangePills ranges={[["Since 1801", 1801], ["1900", 1900], ["1950", 1950], ["1980", 1980]]} value={from} onChange={setFrom} /></div>
      <ResponsiveContainer width="100%" height={chartH(phone, 300)}>
        <ComposedChart data={bars} margin={{ top: 10, right: 10, left: phone ? -16 : -4, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="x" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={22} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }}
            formatter={(v, n, p) => [spct(v), n === "vAvg" ? "10-year average" : p?.payload?.est ? "inflation (estimate)" : "inflation"]} />
          <ReferenceLine y={0} stroke="var(--text-muted)" />
          <Bar dataKey="v" name="v" isAnimationActive={false}>
            {bars.map(r => <Cell key={r.x} fill={r.v < 0 ? BLUE : ORANGE} fillOpacity={r.est ? 0.4 : 0.85} />)}
          </Bar>
          <Line type="monotone" dataKey="vAvg" name="vAvg" stroke="var(--text-primary)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Note>Orange bars are inflation, blue deflation; {us.estimateFrom ? `${us.estimateFrom} is the Minneapolis Fed's estimate and drawn faded. ` : ""}Before 1913 the index is a historical reconstruction, so single years matter less than the regimes: wartime spikes (1812–14, the Civil War, both world wars) followed by deflations, and no lasting rise in prices until the 1930s.</Note>
    </Panel>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12 }}>
      <Panel title="What a dollar buys: U.S. prices since 1800" right="CPI, annual average · log scale" style={{ marginBottom: 12 }}>
        <LongLines rows={level} lines={[{ key: "cpi", label: "CPI (Minneapolis Fed series)", color: ORANGE, width: 2 }]} height={250} log unit="" fmtY={v => Number(v).toFixed(0)} from={1800}
          dots={[{ x: 1800, y: p1800, label: "1800", color: ORANGE }, { x: 1913, y: p1913, label: "1913: lower than 1800", color: ORANGE, position: "bottom" }, { x: lastActual, y: pNow, label: String(lastActual), color: ORANGE, position: "left" }].filter(d => fin(d.y))} />
        <Note>On a log scale equal slopes are equal rates of inflation: flat for the gold-standard century, then a steady climb — steepest in the 1940s and 1970s.</Note>
      </Panel>
      <Panel title="Eight centuries of English prices, 1209–2016" right="Bank of England millennium dataset" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <RangePills ranges={[["Price level (log)", "level"], ["Inflation, 10-year average", "infl"]]} value={ukMode} onChange={setUkMode} />
          <RangePills ranges={[["Since 1209", 1209], ["1600", 1600], ["1800", 1800], ["1900", 1900]]} value={ukFrom} onChange={setUkFrom} />
        </div>
        {ukMode === "level"
          ? <LongLines rows={uk} lines={[{ key: "cpi", label: "Consumer price index (2015 = 100)", color: ORANGE, width: 1.8 }]} height={232} log unit="" fmtY={v => (v < 1 ? Number(v).toFixed(2) : Number(v).toFixed(0))} from={ukFrom} to={2016} />
          : <LongLines rows={uk} lines={[{ key: "inflAvg", label: "Inflation, 10-year average", color: ORANGE, width: 1.8 }]} height={232} refs={[{ key: "zero", y: 0, stroke: "var(--text-muted)" }]} from={ukFrom} to={2016} />}
        <Note>Prices rose in bursts — the 16th-century &quot;price revolution&quot; after New World silver, the Napoleonic wars, the 20th century — and fell back in between, until the paper-money era made the rise one-way.</Note>
      </Panel>
    </div>

    <Panel title="Inflation in 18 economies, 1871–2020" right="annual CPI inflation · pick up to five">
      <div style={{ marginBottom: 6 }}>
        <SeriesChips defs={Object.entries(data.jst.names).map(([iso, name]) => ({ key: iso, label: name, color: CORE[iso] || SLATE }))} on={countries} toggle={toggle(setCountries, 5)} />
      </div>
      <LongLines rows={jstRows} lines={countries.map(c => ({ key: c, label: data.jst.names[c], color: CORE[c] || SLATE, width: c === "USA" ? 2 : 1.4 }))} height={280} y={[-20, 40]} from={1871} to={2020} refs={[{ key: "zero", y: 0, stroke: "var(--text-muted)" }]} />
      <Note>The axis stops at −20% and +40%: Germany&apos;s 1923 hyperinflation and the post-war inflations in Japan, Italy and France run far off the top. Licence CC BY-NC-SA 4.0.</Note>
    </Panel>

    <Panel title="U.S. inflation by decade" right="average is the compound annual rate over the decade">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead><tr>{["Decade", "Average", "Highest year", "Lowest year", "Deflation years"].map((h, i) => <th key={h} style={{ padding: "5px 8px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", textAlign: i ? "right" : "left", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>)}</tr></thead>
          <tbody>{decades.map(r => {
            const td = { padding: "3px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-secondary)", whiteSpace: "nowrap" };
            return (
              <tr key={r.d} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ ...td, textAlign: "left", color: "var(--text-primary)" }}>{r.d}s{r.n < 10 ? <span style={{ color: "var(--text-muted)" }}> ({r.n} yrs)</span> : null}</td>
                <td style={{ ...td, color: fin(r.avg) ? (r.avg < 0 ? BLUE : r.avg > 4 ? ORANGE : "var(--text-primary)") : td.color, fontWeight: 700 }}>{spct(r.avg)}</td>
                <td style={td}>{spct(r.hi[1])} <span style={{ color: "var(--text-muted)" }}>{r.hi[0]}</span></td>
                <td style={td}>{spct(r.lo[1])} <span style={{ color: "var(--text-muted)" }}>{r.lo[0]}</span></td>
                <td style={td}>{r.defl}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Panel>
  </>);
}
