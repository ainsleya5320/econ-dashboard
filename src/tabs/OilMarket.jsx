import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, ComposedChart, Area, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "./options/ui.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// OIL — Commodities → Oil, after Rory Johnston's Commodity Context "Global Oil
// Data Deck": prices and the futures curve, refined products and cracks,
// inventories against their five-year range, the SPR, U.S. supply and
// demand, and the EIA's global balance and forecast.
// Data: /api/oil-market (server/oilMarket.js — EIA API v2 and the EIA Short-
// Term Energy Outlook; the full WTI/Brent curves are CME settlements, personal
// use only). Speculative positioning stays on Commodities → CFTC Positioning;
// the weekly-balance chips on Commodities → Pulse are its summary of this page.
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const P = p => String(p);
const lbl = p => { const s = P(p); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)} ${s.slice(0, 4)}` : /^\d{4}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : s; };
const mlbl = m => (m ? `${MON[+P(m).slice(5, 7) - 1]} ${P(m).slice(2, 4)}` : "");
const year = p => P(p).slice(0, 4);
const yearTicks = (rows, every = 1) => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y) || +y % every) return false; seen.add(y); return true; }).map(r => r.p); };
const usd = (v, dp = 2) => (finite(v) ? `$${v.toFixed(dp)}` : "—");
const mb = v => (finite(v) ? (Math.abs(v) >= 1000 ? `${Math.round(v).toLocaleString()} mb` : `${v.toFixed(1)} mb`) : "—");
const kbd = v => (finite(v) ? `${Math.round(v).toLocaleString()} kb/d` : "—");
const mbd = v => (finite(v) ? `${(v / 1000).toFixed(2)} mb/d` : "—"); // STEO flows arrive in thousand b/d
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const merge = named => {
  const by = new Map();
  for (const [k, pts] of Object.entries(named)) for (const a of pts || []) { const p = P(a[0]); const r = by.get(p) || { p }; r[k] = a[1]; if (a[2] === true || a[a.length - 1] === true) r.proj = true; by.set(p, r); }
  return [...by.values()].sort((a, b) => a.p.localeCompare(b.p));
};
const since = (rows, from) => (from ? rows.filter(r => r.p >= from) : rows);
const RANGES = [["1y", "1Y"], ["5y", "5Y"], ["all", "Since 2015"]];
const fromOf = r => { const d = new Date(); if (r === "1y") d.setFullYear(d.getFullYear() - 1); else if (r === "5y") d.setFullYear(d.getFullYear() - 5); else return null; return d.toISOString().slice(0, 10); };
const LINE_C = [C[1], C[2], C[3], C[4], C[5], "var(--text-muted)"];
const axisX = (rows, every = 1, fmt = year) => ({ dataKey: "p", tick: axisTick, tickLine: false, axisLine: { stroke: "var(--border-subtle)" }, tickFormatter: fmt, ticks: yearTicks(rows, every), interval: 0 });

// the deck's signature chart: this year and last year against the five-year range and average, by week of year
function Seasonal({ s, fmt, height = 170, unit }) {
  const rows = (s?.weeks || []).map(w => ({ w: w.w, range: finite(w.min) && finite(w.max) ? [w.min, w.max] : null, avg: w.avg, last: w.lastYear, now: w.thisYear }));
  if (!rows.length) return <p className="onote">No seasonal history.</p>;
  return (
    <div style={{ height }}><ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="w" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} ticks={[1, 9, 18, 27, 36, 45]} tickFormatter={w => MON[Math.min(11, Math.floor(((w - 1) * 7) / 30.5))]} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} tickFormatter={v => fx(v, 0)} />
        <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={w => `Week ${w}`} formatter={(v, n) => [Array.isArray(v) ? `${fmt(v[0])} – ${fmt(v[1])}` : fmt(v), { range: "5-year range", avg: "5-year average", last: "Last year", now: "This year" }[n] || n]} />
        <Area dataKey="range" stroke="none" fill="var(--text-muted)" fillOpacity={0.18} isAnimationActive={false} />
        <Line dataKey="avg" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
        <Line dataKey="last" stroke={C[2]} strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
        <Line dataKey="now" stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer></div>
  );
}
const SEASON_LEGEND = [["This year", C[1]], ["Last year", C[2]], ["5-year average", "var(--text-muted)", true], ["5-year range", "var(--oc-mid)"]];

function LineCard({ eyebrow, title, finding, note, rows, lines, fmt, height = 230, every = 1, axisFmt, right, refY, table, projShade }) {
  const firstProj = projShade ? rows.find(r => r.proj)?.p : null;
  return (
    <VizCard eyebrow={eyebrow} title={title} finding={finding} note={note} right={right}
      table={table || <MiniTable columns={[{ key: "p", label: "Date", fmt: lbl }, ...lines.map(([k, l]) => ({ key: k, label: l, fmt }))]} rows={[...rows].reverse()} />}>
      {lines.length > 1 && <Legend items={lines.map(([, l, c, d]) => [l, c, d])} />}
      <div className="ochart" style={{ height }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} /><XAxis {...axisX(rows, every)} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={46} domain={["auto", "auto"]} tickFormatter={axisFmt || (v => fx(v, 0))} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [fmt(v), lines.find(l => l[0] === n)?.[1] || n]} />
          {finite(refY) && <ReferenceLine y={refY} stroke="var(--text-muted)" />}
          {firstProj && <ReferenceArea x1={firstProj} x2={rows.at(-1).p} fill="var(--text-muted)" fillOpacity={0.08} label={{ value: "EIA forecast", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
          {lines.map(([k, , c, d]) => <Line key={k} dataKey={k} stroke={c} strokeWidth={d ? 1.4 : 2} strokeDasharray={d ? "4 3" : undefined} dot={false} isAnimationActive={false} connectNulls />)}
        </LineChart>
      </ResponsiveContainer></div>
    </VizCard>
  );
}

export default function OilMarket() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [range, setRange] = useState("5y"), [curveOf, setCurveOf] = useState("brent"), [invId, setInvId] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/oil-market").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.built) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const PR = d?.prices, CR = d?.cracks, TS = d?.timespreads, CV = d?.curve, INV = d?.inventories, SPR = d?.spr, SU = d?.supply, DE = d?.demand, RF = d?.refining, ST = d?.steo;
  const from = fromOf(range);

  const priceRows = useMemo(() => since(merge({ wti: PR?.series?.wti, brent: PR?.series?.brent }), from), [PR, from]);
  const productIds = useMemo(() => Object.keys(PR?.series || {}).filter(k => !["wti", "brent"].includes(k)), [PR]);
  const productRows = useMemo(() => since(merge(Object.fromEntries(["brent", ...productIds].map(k => [k, PR?.series?.[k]]))), from), [PR, productIds, from]);
  const crackIds = useMemo(() => Object.keys(CR?.series || {}), [CR]);
  const crackRows = useMemo(() => since(merge(CR?.series || {}), from), [CR, from]);
  const tsRows = useMemo(() => merge({ c1c4: TS?.c1c4 }), [TS]);
  const curveRows = useMemo(() => {
    const cur = CV?.[curveOf] || [], past = CV?.past || {};
    return cur.map((c, i) => { const r = { i, month: c.month, now: c.settle }; for (const k of Object.keys(past)) r[k] = past[k]?.[curveOf]?.[i]?.settle ?? null; return r; });
  }, [CV, curveOf]);
  const pastKeys = useMemo(() => Object.keys(CV?.past || {}).filter(k => CV.past[k]?.[curveOf]?.length), [CV, curveOf]);
  const sprRows = useMemo(() => merge({ v: SPR?.series }), [SPR]);
  const prodRows = useMemo(() => merge({ production: SU?.production, imports: SU?.imports, exports: SU?.exports }).filter(r => !from || r.p >= from), [SU, from]);
  const stateIds = useMemo(() => Object.keys(SU?.byState?.series || {}).filter(k => k !== "us"), [SU]); // the U.S. total is in the finding, not on the same axis
  const stateRows = useMemo(() => merge(SU?.byState?.series || {}), [SU]);
  const demandRows = useMemo(() => since(merge(Object.fromEntries((DE?.items || []).map(it => [it.id, it.series]))), from), [DE, from]);
  const balRows = useMemo(() => (ST?.balance || []).map(([p, s, dm, ch, proj]) => ({ p: P(p), supply: s, demand: dm, change: ch, proj: !!proj })), [ST]);
  const oecdRows = useMemo(() => (ST?.oecdStocks || []).map(([p, v, proj]) => ({ p: P(p), v, proj: !!proj })), [ST]);
  const opecRows = useMemo(() => merge({ crude: ST?.opec?.crude, spare: ST?.opec?.spare }), [ST]);
  const fcRows = useMemo(() => merge({ brent: ST?.priceForecast?.brent, wti: ST?.priceForecast?.wti }), [ST]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The oil page is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading EIA prices, inventories and the futures curve…</p></div></div>;

  const L = PR?.latest || {}, LC = CR?.latest || {}, inv = id => INV?.items?.find(x => x.id === id);
  const crude = inv("crude"), cushing = inv("cushing");
  const sp = CV?.spreads || {}, ws = sp[curveOf] || {};
  const structure = v => (!finite(v) ? "—" : v > 0.25 ? "backwardation" : v < -0.25 ? "contango" : "flat");
  const selInv = INV?.items?.find(x => x.id === (invId || "crude")) || INV?.items?.[0];
  const lastActual = rows => [...(rows || [])].reverse().find(r => !r.proj);

  return (
    <div className="options-research">
      <p className="ohead-line">
        Brent {usd(L.brent?.v)} and WTI {usd(L.wti?.v)} ({lbl(L.brent?.d)}); Brent is {signed(L.brent?.chg1y, 1, "%")} on a year.
        {finite(sp.brent?.m1m13) && ` The Brent curve is in ${structure(sp.brent.m1m13)} (${signed(sp.brent.m1m13, 2)} $/bbl over twelve months)`}
        {crude && `; U.S. commercial crude stocks are ${mb(crude.latest)}, ${signed(crude.vs5yPct, 1, "%")} against the five-year average for the week`}
        {finite(LC["321"]?.v) && `, and the 3-2-1 crack is ${usd(LC["321"].v)} (five-year average ${usd(LC["321"].avg5y)})`}.
      </p>

      <div className="okpis" style={{ marginBottom: 12 }}>
        <Kpi label="Brent" value={usd(L.brent?.v)} sub={`1m ${signed(L.brent?.chg1m, 1, "%")} · 1y ${signed(L.brent?.chg1y, 1, "%")}`} />
        <Kpi label="WTI" value={usd(L.wti?.v)} sub={`Brent–WTI ${finite(sp.brentWtiSameMonth?.v) ? `${usd(sp.brentWtiSameMonth.v)} (${mlbl(sp.brentWtiSameMonth.month)} futures)` : finite(L.brent?.v) && finite(L.wti?.v) ? usd(L.brent.v - L.wti.v) : "—"}`} />
        <Kpi label="3-2-1 crack" value={usd(LC["321"]?.v)} sub={`5y avg ${usd(LC["321"]?.avg5y)} · p${fx(LC["321"]?.pctile5y, 0)}`} />
        <Kpi label="Brent 12-mo spread" value={finite(sp.brent?.m1m13) ? usd(sp.brent.m1m13) : "—"} sub={structure(sp.brent?.m1m13)} tone={finite(sp.brent?.m1m13) ? (sp.brent.m1m13 > 0 ? "var(--oc-pos)" : "var(--oc-neg)") : undefined} />
        <Kpi label="U.S. crude stocks" value={mb(crude?.latest)} sub={`${signed(crude?.chg1w, 1, " mb")} wk · ${signed(crude?.vs5yPct, 1, "%")} vs 5y`} />
        <Kpi label="SPR" value={mb(SPR?.latest)} sub={`${signed(SPR?.chg52w, 1, " mb")} on a year · peak ${mb(SPR?.peak?.v)}`} />
      </div>

      <div className="ocard-eyebrow" style={{ margin: "6px 0 6px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <span>Prices and the curve</span><Seg label="Range" value={range} onChange={setRange} options={RANGES} />
      </div>
      <div className="ogrid ogrid-2">
        <LineCard eyebrow="EIA daily spot · $/bbl" title="Brent and WTI" rows={priceRows} lines={[["brent", "Brent", C[1]], ["wti", "WTI Cushing", C[2]]]} fmt={v => usd(v)} axisFmt={v => `$${v}`}
          finding={`Brent ${usd(L.brent?.v)}, WTI ${usd(L.wti?.v)}. The spread between them prices the cost of getting U.S. crude to the water.`} />
        {CV?.[curveOf]?.length > 0 && (
          <VizCard eyebrow={`CME settlements · ${lbl(CV.asOf)} · $/bbl by contract month`} title="The futures curve"
            right={<Seg label="Benchmark" value={curveOf} onChange={setCurveOf} options={[["brent", "Brent"], ["wti", "WTI"]]} />}
            finding={`${curveOf === "brent" ? "Brent" : "WTI"}: front month ${usd(CV[curveOf][0]?.settle)}; 1-month spread ${signed(ws.m1m2, 2)}, 6-month ${signed(ws.m1m7, 2)}, 12-month ${signed(ws.m1m13, 2)} — ${structure(ws.m1m13)}. A downward-sloping curve (backwardation) means prompt barrels are scarce; an upward one (contango) pays storage.`}
            note={`Past curves fill in as the daily archive builds (${CV.archiveDays || 0} days so far). CME data, for personal use.`}
            table={<MiniTable columns={[{ key: "month", label: "Contract", fmt: mlbl }, { key: "now", label: "Today", fmt: v => usd(v) }, ...pastKeys.map(k => ({ key: k, label: `${k} ago`, fmt: v => usd(v) }))]} rows={curveRows} />}>
            <Legend items={[["Today", C[1]], ...pastKeys.map((k, i) => [`${k} ago`, LINE_C[i + 1], true])]} />
            <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={curveRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={mlbl} minTickGap={24} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={46} domain={["auto", "auto"]} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={mlbl} formatter={(v, n) => [usd(v), n === "now" ? "Today" : `${n} ago`]} />
                {pastKeys.map((k, i) => <Line key={k} dataKey={k} stroke={LINE_C[i + 1]} strokeDasharray="4 3" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />)}
                <Line dataKey="now" stroke={C[1]} strokeWidth={2.25} dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
      </div>

      {tsRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <LineCard eyebrow={`EIA NYMEX WTI contracts 1 and 4 · $/bbl · since ${TS.since || year(tsRows[0].p)}`} title="Backwardation and contango, since the 1980s"
            rows={tsRows} lines={[["c1c4", "Contract 1 − contract 4", C[1]]]} fmt={v => signed(v, 2)} axisFmt={v => `$${v}`} every={4} refY={0} height={220}
            finding={`The front of the WTI curve: ${signed(lastActual(tsRows)?.c1c4, 2)} $/bbl between the first and fourth contract (${lbl(lastActual(tsRows)?.p)}, monthly average). Above zero the market is backwardated (tight now); below it, contango (oversupplied, paying for storage) — 2009, 2015–16 and 2020 were the deep contangos.`}
            note={`EIA stopped publishing NYMEX futures on ${lbl(TS.eiaEnd)}; from ${lbl(TS.cmeFrom)} the line continues from CME settlements, so ${TS.gap ? `${lbl(TS.gap.from || TS.gap[0])} to ${lbl(TS.gap.to || TS.gap[1])}` : "the months between"} are missing.`} />
        </div>
      )}

      {crackIds.length > 0 && (<>
        <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>Refined products</div>
        <div className="ogrid ogrid-2">
          <LineCard eyebrow="EIA daily spot · $/bbl (products converted from $/gal × 42)" title="What a barrel becomes"
            rows={productRows} lines={["brent", ...productIds.slice(0, 5)].map((k, i) => [k, PR.labels?.[k] || k, k === "brent" ? "var(--text-muted)" : LINE_C[i - 1 >= 0 ? i - 1 : 0], k === "brent"])} fmt={v => usd(v)} axisFmt={v => `$${v}`}
            finding={productIds.slice(0, 5).map(k => `${PR.labels?.[k] || k} ${usd(L[k]?.v)}`).join(" · ")} />
          <LineCard eyebrow="Product price minus Brent · $/bbl · 3-2-1 from NYMEX futures vs WTI" title="Crack spreads — the refiner's margin"
            rows={crackRows} lines={crackIds.slice(0, 6).map((k, i) => [k, CR.labels?.[k] || k, LINE_C[i]])} fmt={v => signed(v, 2)} axisFmt={v => `$${v}`} refY={0}
            finding={crackIds.map(k => `${CR.labels?.[k] || k} ${usd(LC[k]?.v)} (p${fx(LC[k]?.pctile5y, 0)} of 5 years)`).join(" · ")}
            table={<MiniTable columns={[{ key: "label", label: "Crack" }, { key: "v", label: "Latest", fmt: v => usd(v) }, { key: "avg5y", label: "5-year average", fmt: v => usd(v) }, { key: "pctile5y", label: "Percentile, 5y", fmt: v => fx(v, 0) }, { key: "d", label: "As of", fmt: lbl }]} rows={crackIds.map(k => ({ label: CR.labels?.[k] || k, ...LC[k] }))} />} />
        </div>
      </>)}

      {INV?.items?.length > 0 && (<>
        <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>Inventories · EIA weekly petroleum status report · million barrels</div>
        <VizCard eyebrow={`Week ending ${lbl(INV.asOf)}`} title="U.S. stocks against the last five years"
          right={<Seg label="Stock" value={selInv?.id} onChange={setInvId} options={INV.items.map(it => [it.id, it.label.replace(/ \(.*\)$/, "")]).slice(0, 8)} />}
          finding={`${selInv?.label}: ${mb(selInv?.latest)}, ${signed(selInv?.chg1w, 1, " mb")} on the week, ${signed(selInv?.vs5y, 1, " mb")} (${signed(selInv?.vs5yPct, 1, "%")}) against the five-year average for this week.`}
          table={<MiniTable columns={[{ key: "label", label: "Stock" }, { key: "latest", label: "Latest", fmt: mb }, { key: "chg1w", label: "1 week", fmt: v => signed(v, 1, " mb") }, { key: "vs5y", label: "vs 5y avg", fmt: v => signed(v, 1, " mb") }, { key: "vs5yPct", label: "vs 5y avg %", fmt: v => signed(v, 1, "%") }]} rows={INV.items} />}>
          <Legend items={SEASON_LEGEND} />
          <Seasonal s={selInv?.seasonal} fmt={mb} height={240} />
        </VizCard>
        <div className="omini-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", margin: "8px 0 12px" }}>
          {INV.items.filter(it => it.id !== selInv?.id).map(it => (
            <button key={it.id} type="button" className="ocard" onClick={() => setInvId(it.id)} style={{ padding: "8px 10px 4px", textAlign: "left", cursor: "pointer", background: "var(--card-bg)", color: "inherit", font: "inherit" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                <strong style={{ font: "600 12.5px var(--font-body)" }}>{it.label}</strong>
                <span className="onote" style={{ margin: 0 }}>{mb(it.latest)} · {signed(it.vs5yPct, 0, "%")} vs 5y</span>
              </div>
              <Seasonal s={it.seasonal} fmt={mb} height={110} />
            </button>
          ))}
        </div>
      </>)}

      <div className="ogrid ogrid-2">
        {sprRows.length > 0 && (
          <LineCard eyebrow="EIA weekly · million barrels" title="The Strategic Petroleum Reserve" rows={sprRows} lines={[["v", "SPR", C[1]]]} fmt={mb} every={5} axisFmt={v => fx(v, 0)}
            finding={`${mb(SPR.latest)} (${lbl(SPR.asOf)}): ${signed(SPR.chg52w, 1, " mb")} over the past year, ${SPR.atLow ? `the lowest level since ${SPR.low?.since || 1983}` : `against a low of ${mb(SPR.low?.v)} (${lbl(SPR.low?.d)})`}. The reserve peaked at ${mb(SPR.peak?.v)} in ${lbl(SPR.peak?.d)}.`} />
        )}
        {RF?.utilization && (
          <VizCard eyebrow={`EIA weekly · % of operable capacity · ${lbl(RF.asOf)}`} title="Refinery utilization"
            finding={`${pct(RF.utilization.latest)} of capacity running.`}
            table={<MiniTable columns={[{ key: "p", label: "Week", fmt: lbl }, { key: "v", label: "Utilization", fmt: v => pct(v) }]} rows={[...merge({ v: RF.utilization.series })].reverse()} />}>
            <Legend items={SEASON_LEGEND} />
            <Seasonal s={RF.utilization.seasonal} fmt={v => pct(v)} height={220} />
          </VizCard>
        )}
      </div>

      {(prodRows.length > 0 || demandRows.length > 0) && (<>
        <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>U.S. supply and demand · thousand barrels a day</div>
        <div className="ogrid ogrid-2">
          {prodRows.length > 0 && <LineCard eyebrow="EIA weekly estimates" title="Production and trade" rows={prodRows} lines={[["production", "Crude production", C[1]], ["imports", "Crude imports", C[2]], ["exports", "Crude exports", C[3]]]} fmt={kbd} axisFmt={v => fx(v / 1000, 0) + "m"}
            finding={`Production ${kbd(SU.latest?.production?.v)} in the latest week (4-week average ${kbd(SU.latest?.production?.avg4w)}, ${signed(SU.latest?.production?.yoy4wPct, 1, "%")} y/y); net imports ${kbd(SU.latest?.netImports?.avg4w)} on a 4-week average. Single weekly readings are noisy.`} />}
          {demandRows.length > 0 && <LineCard eyebrow="EIA weekly product supplied · 4-week average" title="Implied demand" rows={demandRows} lines={(DE.items || []).map((it, i) => [it.id, it.label, LINE_C[i]])} fmt={kbd} axisFmt={v => fx(v / 1000, 0) + "m"}
            finding={(DE.items || []).map(it => `${it.label} ${kbd(it.latest4w)} (${signed(it.yoy4wPct, 1, "%")} y/y)`).join(" · ")} />}
        </div>
        {stateRows.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <LineCard eyebrow={`EIA monthly crude production · ${lbl(SU.byState.asOf)}`} title="Where U.S. crude comes from" rows={stateRows} lines={stateIds.slice(0, 6).map((k, i) => [k, SU.byState.labels?.[k] || k, LINE_C[i]])} fmt={kbd} every={2} axisFmt={v => fx(v / 1000, 1) + "m"}
              finding={`United States ${kbd(lastActual(stateRows)?.us)}: ${stateIds.map(k => `${SU.byState.labels?.[k] || k} ${kbd(lastActual(stateRows)?.[k])}`).join(" · ")}.`} />
          </div>
        )}
      </>)}

      {ST && (<>
        <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>The global balance · EIA Short-Term Energy Outlook{ST.release ? ` (${ST.release})` : ""} · shaded months are EIA&apos;s forecast</div>
        <div className="ogrid ogrid-2">
          {balRows.length > 0 && (
            <VizCard eyebrow="World liquids · million barrels a day" title="Supply, demand and the stock change"
              finding={(() => { const a = lastActual(balRows), f = balRows.at(-1); return a ? `${lbl(a.p)}: supply ${mbd(a.supply)}, demand ${mbd(a.demand)}, so stocks ${a.change >= 0 ? "built" : "drew"} ${mbd(Math.abs(a.change))}. EIA sees ${f && f.change >= 0 ? "builds" : "draws"} of ${mbd(Math.abs(f?.change))} by ${lbl(f?.p)}.` : ""; })()}
              table={<MiniTable columns={[{ key: "p", label: "Month", fmt: lbl }, { key: "supply", label: "Supply", fmt: mbd }, { key: "demand", label: "Demand", fmt: mbd }, { key: "change", label: "Stock change, mb/d", fmt: v => signed(v / 1000, 2) }, { key: "proj", label: "", fmt: v => (v ? "forecast" : "") }]} rows={[...balRows].reverse()} />}>
              <Legend items={[["Supply", C[1]], ["Demand", C[2]], ["Implied stock change (bars)", "var(--oc-pos)"]]} />
              <div className="ochart" style={{ height: 170 }}><ResponsiveContainer width="100%" height="100%">
                <LineChart data={balRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} /><XAxis {...axisX(balRows, 2)} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} tickFormatter={v => fx(v / 1000, 0)} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [mbd(v), n === "supply" ? "Supply" : "Demand"]} />
                  {balRows.find(r => r.proj) && <ReferenceArea x1={balRows.find(r => r.proj).p} x2={balRows.at(-1).p} fill="var(--text-muted)" fillOpacity={0.08} />}
                  <Line dataKey="supply" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="demand" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer></div>
              <div className="ochart" style={{ height: 110 }}><ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={balRows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} /><XAxis {...axisX(balRows, 2)} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => fx(v / 1000, 1)} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={v => [signed(v / 1000, 2), "Stock change, mb/d"]} />
                  <ReferenceLine y={0} stroke="var(--text-muted)" />
                  <Bar dataKey="change" isAnimationActive={false}>{balRows.map(r => <Cell key={r.p} fill={r.change >= 0 ? "var(--oc-pos)" : "var(--oc-neg)"} fillOpacity={r.proj ? 0.45 : 0.9} />)}</Bar>
                </ComposedChart>
              </ResponsiveContainer></div>
            </VizCard>
          )}
          {oecdRows.length > 0 && <LineCard eyebrow="EIA STEO · million barrels, end of month" title="OECD commercial inventories" rows={oecdRows} lines={[["v", "OECD commercial stocks", C[1]]]} fmt={mb} every={2} axisFmt={v => fx(v, 0)} projShade
            finding={(() => { const a = lastActual(oecdRows), f = oecdRows.at(-1); return a ? `${mb(a.v)} in ${lbl(a.p)}; EIA projects ${mb(f?.v)} by ${lbl(f?.p)}. OECD commercial stocks are the inventory the price trades against.` : ""; })()} />}
        </div>
        <div className="ogrid ogrid-2" style={{ marginTop: 12 }}>
          {opecRows.length > 0 && <LineCard eyebrow="EIA STEO · million barrels a day" title="OPEC crude output and spare capacity" rows={opecRows} lines={[["crude", "OPEC crude production", C[1]], ["spare", "Surplus capacity", C[3]]]} fmt={mbd} every={2} axisFmt={v => fx(v / 1000, 0)} projShade
            finding={(() => { const a = lastActual(opecRows); return a ? `OPEC is producing ${mbd(a.crude)} with ${mbd(a.spare)} of spare capacity (${lbl(a.p)}). Spare capacity is the market's shock absorber.` : ""; })()} />}
          {fcRows.length > 0 && <LineCard eyebrow="EIA STEO · $/bbl, monthly average" title="EIA's price path" rows={fcRows} lines={[["brent", "Brent", C[1]], ["wti", "WTI", C[2]]]} fmt={v => usd(v)} every={2} axisFmt={v => `$${v}`} projShade
            finding={(() => { const f = fcRows.at(-1); return f ? `EIA's forecast reaches Brent ${usd(f.brent)} and WTI ${usd(f.wti)} by ${lbl(f.p)}.` : ""; })()} />}
        </div>
        {ST.producers?.length > 0 && (<>
          <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>The big producers · crude production, million barrels a day · EIA STEO</div>
          <div className="omini-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", marginBottom: 12 }}>
            {ST.producers.map(pr => { const rows = pr.series.map(([p, v, proj]) => ({ p: P(p), v, proj: !!proj })), a = lastActual(rows); const fp = rows.find(r => r.proj)?.p; return (
              <section key={pr.id} className="ocard" style={{ padding: "8px 10px 4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}><strong style={{ font: "600 12.5px var(--font-body)" }}>{pr.label}</strong><span className="onote" style={{ margin: 0 }}>{mbd(a?.v)} · {mlbl(a?.p)}</span></div>
                <div style={{ height: 80 }}><ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="p" hide /><YAxis hide domain={["auto", "auto"]} />
                    {fp && <ReferenceArea x1={fp} x2={rows.at(-1).p} fill="var(--text-muted)" fillOpacity={0.1} />}
                    <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={v => [mbd(v), pr.label]} />
                    <Line dataKey="v" stroke={C[1]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer></div>
              </section>
            ); })}
          </div>
        </>)}
      </>)}

      <p className="onote">Speculative positioning in WTI is on Commodities → CFTC Positioning; the weekly balance chips on Commodities → Pulse summarize this page. Not covered here (no free source): Asian and European product prices, global onshore and floating storage, OPEC+ quotas, tanker flows.</p>
      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      {d.note && <p className="onote">{d.note}</p>}
      <p className="onote">Sources: {(d.sources || []).map(s => `${s.label} (${s.from === "live" ? "fetched" : `${s.from} copy`} ${P(s.fetched || "").slice(0, 10)})`).join("; ")}. Framework after Commodity Context (Rory Johnston).</p>
    </div>
  );
}
