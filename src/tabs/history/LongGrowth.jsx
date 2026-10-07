import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Cell, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { INDIGO, ORANGE, AMBER, GREEN, RED, CYAN, VIOLET, TEAL, SLATE, fin, tip, axis, chip, DenseHeader, Panel, Note, useIsPhone, chartH } from "../../components/dense.jsx";
import { useLongRun, rowsFor, points, rolling, spct, RangePills, SeriesChips, LongLines } from "./longRunKit.jsx";

// ============================================================================
// HISTORICAL → GROWTH. Output over a century and a half in the U.S., seven
// and a half centuries in England:
//   U.S. real GDP growth since 1871   Jordà–Schularick–Taylor (Maddison GDP per
//                                     capita × population) to 1929, the BEA's
//                                     official estimates from 1930
//   GDP per person, 18 economies      Maddison via JST, 1870→2020, log scale
//   England since 1270                Bank of England millennium dataset:
//                                     real GDP per person, log scale
//   by decade / extremes              U.S. averages, booms and contractions
// Quarterly GDP and the current cycle are on U.S. Economy; this is the long view.
// ============================================================================

const CORE = { USA: INDIGO, GBR: ORANGE, DEU: AMBER, JPN: GREEN, FRA: CYAN, ITA: VIOLET, CAN: TEAL };
const toggle = (set, max) => k => set(l => (l.includes(k) ? l.filter(x => x !== k) : max && l.length >= max ? [...l.slice(1), k] : [...l, k]));
const compound = gs => { const v = gs.filter(fin); return v.length ? ((v.reduce((p, g) => p * (1 + g / 100), 1)) ** (1 / v.length) - 1) * 100 : null; };

export default function LongGrowth() {
  const { data, error } = useLongRun();
  const phone = useIsPhone();
  const [from, setFrom] = useState(1871);
  const [countries, setCountries] = useState(["USA", "GBR", "DEU", "JPN"]);
  const [engFrom, setEngFrom] = useState(1270);

  const g = data?.us?.growth;
  const bars = useMemo(() => {
    if (!g) return [];
    const rows = points(g).map(([y, v]) => ({ x: y, v }));
    rolling(rows, "v", 10);
    return rows.filter(r => r.x >= from);
  }, [g, from]);
  const pc = useMemo(() => (data ? rowsFor(countries.map(c => ({ key: c, ser: data.jst.countries[c]?.gdppc })), 1870, 2020, true) : []), [data, countries]);
  const eng = useMemo(() => (data ? rowsFor([{ key: "pc", ser: data.boe.gdppcEngland }], engFrom, 2016, true) : []), [data, engFrom]);
  const stats = useMemo(() => {
    if (!g) return null;
    const all = points(g).filter(([, v]) => fin(v));
    const era = (a, b) => compound(all.filter(([y]) => y >= a && y <= b).map(([, v]) => v));
    const sorted = [...all].sort((a, b) => a[1] - b[1]);
    const decades = [];
    for (let d = Math.floor(all[0][0] / 10) * 10; d <= all[all.length - 1][0]; d += 10) {
      const ys = all.filter(([y]) => y >= d && y < d + 10);
      if (!ys.length) continue;
      decades.push({ d, avg: compound(ys.map(([, v]) => v)), hi: ys.reduce((a, b) => (b[1] > a[1] ? b : a)), lo: ys.reduce((a, b) => (b[1] < a[1] ? b : a)), down: ys.filter(([, v]) => v < 0).length, n: ys.length });
    }
    return { e1: era(1871, 1929), e2: era(1930, 1979), e3: era(1980, 2100), worst: sorted.slice(0, 5), best: sorted.slice(-5).reverse(), down: all.filter(([, v]) => v < 0).length, n: all.length, last: all[all.length - 1], decades };
  }, [g]);

  if (error) return <Note>The long-run data could not load: {error}</Note>;
  if (!data || !stats) return <Note>Loading a century and a half of growth…</Note>;

  const engPts = points(data.boe.gdppcEngland).filter(([, v]) => fin(v));
  const engAt = y => engPts.find(([x]) => x === y)?.[1];
  const e1270 = engAt(1270), e1800 = engAt(1800), e2016 = engAt(2016);

  return (<>
    <DenseHeader
      eyebrow="Growth · the long view"
      headline={<>U.S. output has grown {stats.e1 != null ? `${stats.e1.toFixed(1)}%` : "—"} a year in 1871–1929, {stats.e2 != null ? `${stats.e2.toFixed(1)}%` : "—"} in 1930–79 and {stats.e3 != null ? `${stats.e3.toFixed(1)}%` : "—"} since 1980, shrinking in {stats.down} of {stats.n} years.</>}
      blurb={<>Real GDP growth back to 1871 joins two sources: the Jordà–Schularick–Taylor database (Angus Maddison&apos;s GDP per person times population) to 1929, and the Bureau of Economic Analysis&apos;s official estimates from 1930. Below it, output per person across eighteen economies since 1870 and England&apos;s since 1270 — the long flat line before the industrial revolution.</>}
      meta={<>BEA, JST Macrohistory, Bank of England<br />annual through {stats.last[0]}</>}
      chips={[
        chip("latest year", spct(stats.last[1]), stats.last[1] < 0 ? RED : GREEN, String(stats.last[0])),
        chip("worst year", spct(stats.worst[0][1]), RED, String(stats.worst[0][0])),
        chip("best year", spct(stats.best[0][1]), GREEN, String(stats.best[0][0])),
        chip("England per person", fin(e1800) && fin(e2016) ? `×${(e2016 / e1800).toFixed(0)}` : "—", "var(--text-primary)", fin(e1270) && fin(e1800) ? `since 1800 · ×${(e1800 / e1270).toFixed(1)} in the 530 years before` : ""),
      ]}
    />

    <Panel title="U.S. real GDP growth since 1871" right="annual % change · line: 10-year average">
      <div style={{ marginBottom: 6 }}><RangePills ranges={[["Since 1871", 1871], ["1930", 1930], ["1950", 1950], ["1980", 1980]]} value={from} onChange={setFrom} /></div>
      <ResponsiveContainer width="100%" height={chartH(phone, 300)}>
        <ComposedChart data={bars} margin={{ top: 10, right: 10, left: phone ? -16 : -4, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="x" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={22} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }}
            formatter={(v, n) => [spct(v), n === "vAvg" ? "10-year average" : "real GDP growth"]} />
          <ReferenceLine y={0} stroke="var(--text-muted)" />
          {from < 1930 && <ReferenceLine x={1930} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "BEA from 1930", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 9.5, fontFamily: fonts.mono }} />}
          <Bar dataKey="v" name="v" isAnimationActive={false}>{bars.map(r => <Cell key={r.x} fill={r.v < 0 ? RED : GREEN} fillOpacity={0.8} />)}</Bar>
          <Line type="monotone" dataKey="vAvg" name="vAvg" stroke="var(--text-primary)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Note>Green bars are growth, red contractions. The pre-1930 years are reconstructions from output and population estimates, so their year-to-year swings are rougher than the BEA&apos;s; the 10-year line shows the trend slowing from the industrial era to today.</Note>
    </Panel>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12 }}>
      <Panel title="GDP per person, 18 economies, 1870–2020" right="Maddison, 1990 international dollars · log scale" style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}>
          <SeriesChips defs={Object.entries(data.jst.names).map(([iso, name]) => ({ key: iso, label: name, color: CORE[iso] || SLATE }))} on={countries} toggle={toggle(setCountries, 5)} />
        </div>
        <LongLines rows={pc} lines={countries.map(c => ({ key: c, label: data.jst.names[c], color: CORE[c] || SLATE, width: c === "USA" ? 2 : 1.4 }))} height={250} log unit="" fmtY={v => `$${Math.round(v).toLocaleString()}`} from={1870} to={2020} />
        <Note>On a log scale parallel lines grow at the same rate. Britain leads in 1870, the U.S. passes it around 1900, and Germany and Japan converge after 1950. Licence CC BY-NC-SA 4.0.</Note>
      </Panel>
      <Panel title="England's output per person since 1270" right="real GDP per head, 2013 prices · log scale" style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}><RangePills ranges={[["Since 1270", 1270], ["1600", 1600], ["1800", 1800], ["1900", 1900]]} value={engFrom} onChange={setEngFrom} /></div>
        <LongLines rows={eng} lines={[{ key: "pc", label: "Real GDP per person (£, 2013 prices)", color: INDIGO, width: 1.8 }]} height={232} log unit="" fmtY={v => `£${Math.round(v).toLocaleString()}`} from={engFrom} to={2016}
          dots={[{ x: 1270, y: e1270, label: "1270" }, { x: 1800, y: e1800, label: "1800" }, { x: 2016, y: e2016, label: "2016", position: "left" }].filter(d => fin(d.y) && d.x >= engFrom)} />
        <Note>Output per person roughly doubled in the five centuries before 1800 and has risen about {fin(e1800) && fin(e2016) ? Math.round(e2016 / e1800) : "—"}-fold since — the industrial revolution in one line. Bank of England, A Millennium of Macroeconomic Data.</Note>
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12 }}>
      <Panel title="U.S. growth by decade" right="compound annual real growth" style={{ marginBottom: 12 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead><tr>{["Decade", "Average", "Best year", "Worst year", "Contractions"].map((h, i) => <th key={h} style={{ padding: "5px 8px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", textAlign: i ? "right" : "left", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>)}</tr></thead>
            <tbody>{stats.decades.map(r => {
              const td = { padding: "3px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-secondary)", whiteSpace: "nowrap" };
              return (
                <tr key={r.d} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ ...td, textAlign: "left", color: "var(--text-primary)" }}>{r.d}s{r.n < 10 ? <span style={{ color: "var(--text-muted)" }}> ({r.n} yrs)</span> : null}</td>
                  <td style={{ ...td, color: "var(--text-primary)", fontWeight: 700 }}>{spct(r.avg)}</td>
                  <td style={td}>{spct(r.hi[1])} <span style={{ color: "var(--text-muted)" }}>{r.hi[0]}</span></td>
                  <td style={td}>{spct(r.lo[1])} <span style={{ color: "var(--text-muted)" }}>{r.lo[0]}</span></td>
                  <td style={td}>{r.down}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>
      <Panel title="The biggest swings since 1871" right="real GDP, annual % change" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[["Contractions", stats.worst, RED], ["Booms", stats.best, GREEN]].map(([t, list, c]) => (
            <div key={t}>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", marginBottom: 4 }}>{t}</div>
              {list.map(([y, v]) => (
                <div key={y} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: fonts.mono, padding: "3px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>{y}</span><span style={{ color: c, fontWeight: 700 }}>{spct(v)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <Note>The Depression (1930–33) and the demobilisation after 1945 dwarf every modern recession; the war years 1941–43 are the largest booms. Pre-1930 figures are estimates.</Note>
      </Panel>
    </div>
  </>);
}
