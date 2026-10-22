import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, ComposedChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "./options/ui.jsx";
import GlobalImbalances from "./intl/GlobalImbalances.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// THE WORLD — the global economy read as if it were one country.
//   The balance sheet: real estate, equities, bonds, broad money, central-bank
//   assets, FX reserves, household / corporate / government debt and household
//   wealth, each in $ trillions and as a multiple of world GDP — measured,
//   nowcast, or anchored estimate, and labelled as such.
//   Then the pieces: world market cap ÷ GDP, money (broad money by economy,
//   central-bank balance sheets, reserves), real estate, debt by sector, the
//   bond market, trade and production, savings vs investment and the
//   current-account imbalances, people, and the IMF member table (which
//   replaced International's World Bank GDP / Debt / Inflation tabs).
// Data: /api/world-economy (server/worldEconomy.js); imbalances from
// /api/trade-flows (intl/GlobalImbalances.jsx). Country detail stays where it
// lives: Real Estate → Global, International → Share of the World / China.
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const P = p => String(p);
const lbl = p => { const s = P(p); return /^\d{4}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)} ${s.slice(0, 4)}` : s.replace(/^(\d{4})-?Q(\d)$/, "Q$2 $1"); };
const year = p => P(p).slice(0, 4);
const yearTicks = (rows, every = 5) => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y) || +y % every) return false; seen.add(y); return true; }).map(r => r.p); };
const tn = v => (finite(v) ? (Math.abs(v) >= 100 ? `$${v.toFixed(0)}tn` : `$${v.toFixed(1)}tn`) : "—");
const xg = v => (finite(v) ? `${v.toFixed(2)}×` : "—");
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
// rows from [[period, v, …]] or a { key: [[period, v]] } map
const rowsOf = (pts, key = "v") => (pts || []).map(a => ({ p: P(a[0]), [key]: a[1], proj: a[2] === true }));
const merge = named => {
  const by = new Map();
  for (const [k, pts] of Object.entries(named)) for (const a of pts || []) { const p = P(a[0]); const r = by.get(p) || { p }; r[k] = a[1]; by.set(p, r); }
  return [...by.values()].sort((a, b) => a.p.localeCompare(b.p));
};
const METHOD = { measured: "measured", nowcast: "nowcast", estimate: "estimate", anchor: "published estimate" };
const SIDE = { asset: "Assets", debt: "Debt", wealth: "Wealth" };
const SHORT = { realEstate: "Real estate", equities: "Listed equities", bonds: "Bonds & notes", broadMoney: "Broad money", cbAssets: "Central-bank assets", fxReserves: "FX reserves", householdDebt: "Households", corporateDebt: "Companies", governmentDebt: "Governments", householdWealth: "Household net wealth" };
const ECON_C = [C[1], C[2], C[3], C[4], C[5], "var(--text-muted)", "var(--oc-mid)"];

function axisX(rows, every) { return { dataKey: "p", tick: axisTick, tickLine: false, axisLine: { stroke: "var(--border-subtle)" }, tickFormatter: year, ticks: yearTicks(rows, every), interval: 0 }; }

// the hero: every item on one bar scale, in $tn or × world GDP
function BalanceSheet({ items, unit }) {
  const [hover, setHover] = useState(null);
  const get = it => (unit === "usd" ? it.usdTn : it.gdpMultiple);
  const list = items.filter(it => finite(get(it)));
  if (!list.length) return <p className="onote">No balance-sheet items loaded.</p>;
  const max = Math.max(...list.map(get)) * 1.12, W = 640, L = 190, R = 70, RH = 26;
  const groups = ["asset", "debt", "wealth"].map(s => [s, list.filter(it => it.side === s)]).filter(([, g]) => g.length);
  let y = 0; const rows = [];
  for (const [side, g] of groups) { rows.push({ head: SIDE[side], y }); y += 20; for (const it of g) { rows.push({ it, y }); y += RH; } y += 6; }
  const H = y + 4, x = v => L + (v / max) * (W - L - R);
  const hv = hover && list.find(it => it.id === hover);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxWidth: 860 }} role="img" aria-label={`The world's balance sheet in ${unit === "usd" ? "dollars" : "multiples of world GDP"}`}>
        {rows.map((r, i) => r.head
          ? <text key={`h${i}`} x={0} y={r.y + 13} fontSize="10" fontWeight="700" letterSpacing="0.6" fill="var(--text-muted)">{r.head.toUpperCase()}</text>
          : (() => { const it = r.it, v = get(it), est = it.method && it.method !== "measured"; return (
            <g key={it.id} onMouseEnter={() => setHover(it.id)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={r.y} width={W} height={RH - 2} style={{ fill: hover === it.id ? "var(--bg-subtle)" : "transparent" }} />
              <text x={L - 8} y={r.y + 11} textAnchor="end" fontSize="11.5" fontWeight="600" fill="var(--text-primary)">{SHORT[it.id] || it.label}</text>
              <text x={L - 8} y={r.y + 21} textAnchor="end" fontSize="9" fill="var(--text-muted)">{METHOD[it.method] || it.method || ""}{it.asOf ? ` · ${lbl(it.asOf)}` : ""}</text>
              <rect x={L} y={r.y + 4} width={Math.max(2, x(v) - L)} height={RH - 12} rx="3"
                style={{ fill: it.side === "debt" ? "var(--oc-pos)" : it.side === "wealth" ? C[3] : C[1], opacity: est ? 0.5 : 0.9 }} strokeDasharray={est ? "3 2" : undefined} stroke={est ? "var(--text-secondary)" : "none"} />
              <text x={x(v) + 6} y={r.y + 16} fontSize="11" fill="var(--text-secondary)" fontFamily="var(--font-number)">{unit === "usd" ? tn(v) : xg(v)}<tspan fill="var(--text-muted)" fontSize="9.5">{unit === "usd" ? `  ${xg(it.gdpMultiple)}` : `  ${tn(it.usdTn)}`}</tspan></text>
            </g>
          ); })())}
      </svg>
      <div className="onote" style={{ margin: 0, minHeight: 18 }}>{hv ? `${hv.label}: ${tn(hv.usdTn)}, ${xg(hv.gdpMultiple)} world GDP (${METHOD[hv.method] || hv.method}${hv.asOf ? `, ${lbl(hv.asOf)}` : ""}). ${hv.source || ""}` : "Solid bars are measured; faded, dashed bars are nowcasts or estimates. Hover a row for its source. The items overlap (deposits are inside broad money, government bonds are inside both bonds and government debt, homes are most of household wealth), so they do not add up to a total."}</div>
    </div>
  );
}

function Mini({ title, rows, k, fmt, color = C[1], every = 10, refY }) {
  if (!rows?.length) return null;
  const last = [...rows].reverse().find(r => finite(r[k]) && !r.proj) || rows.at(-1);
  return (
    <section className="ocard" style={{ padding: "8px 10px 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
        <strong style={{ font: "600 12.5px var(--font-body)" }}>{title}</strong>
        <span className="onote" style={{ margin: 0 }}>{fmt(last?.[k])} · {lbl(last?.p)}</span>
      </div>
      <div style={{ height: 96 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis {...axisX(rows, every)} /><YAxis hide domain={["auto", "auto"]} />
          {finite(refY) && <ReferenceLine y={refY} stroke="var(--border-subtle)" />}
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={v => [fmt(v), title]} />
          <Line dataKey={k} stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer></div>
    </section>
  );
}

export default function WorldTab() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [unit, setUnit] = useState("gdp"), [memberSort, setMemberSort] = useState("gdpUsd"), [moneyView, setMoneyView] = useState("broad");
  useEffect(() => {
    let alive = true;
    fetch("/api/world-economy").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.built) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const H = d?.headline || {}, BS = d?.balanceSheet, M = d?.money || {}, MK = d?.markets?.capToGdp, RE = d?.realEstate, DB = d?.debt, BD = d?.bonds, TR = d?.trade, FL = d?.flows, PE = d?.people, W = d?.wealth;

  const capRows = useMemo(() => (MK?.series || []).map(([p, cap, ratio]) => ({ p: P(p), cap, ratio })), [MK]);
  const capMedian = useMemo(() => { const v = capRows.map(r => r.ratio).filter(finite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; }, [capRows]);
  const broadIds = useMemo(() => Object.keys(M.broad?.seriesByEconomy || {}), [M]);
  // stacked totals end where the published total does: an economy that reports a month early would otherwise make the stack drop
  const broadRows = useMemo(() => merge(M.broad?.seriesByEconomy || {}).filter(r => !M.broad?.asOf || r.p <= M.broad.asOf), [M]);
  const cbIds = useMemo(() => Object.keys(M.centralBanks?.seriesByBank || {}), [M]);
  const cbRows = useMemo(() => merge(M.centralBanks?.seriesByBank || {}).filter(r => !M.centralBanks?.asOf || r.p <= M.centralBanks.asOf), [M]);
  const cbLabel = id => M.centralBanks?.banks?.find(b => b.id === id)?.label || id;
  const resShareRows = useMemo(() => merge(M.reserves?.shareSeries || {}), [M]);
  const resCcy = useMemo(() => Object.keys(M.reserves?.shareSeries || {}), [M]);
  const debtRows = useMemo(() => merge(Object.fromEntries((DB?.sectors || []).map(s => [s.id, s.series]))), [DB]);
  const reRows = useMemo(() => (RE?.series || []).map(([p, usdTn, ratio]) => ({ p: P(p), usdTn, ratio })), [RE]);
  const tradeRows = useMemo(() => merge({ volume: TR?.volume, production: TR?.production }), [TR]);
  const flowRows = useMemo(() => { const r = merge({ savings: FL?.savings, investment: FL?.investment }); const proj = new Set((FL?.savings || []).filter(a => a[2]).map(a => P(a[0]))); return r.map(x => ({ ...x, proj: proj.has(x.p) })); }, [FL]);
  const members = useMemo(() => [...(d?.members || [])].sort((a, b) => (b[memberSort] ?? -1e9) - (a[memberSort] ?? -1e9)), [d, memberSort]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The world economy page is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading the world economy (IMF, World Bank, BIS, central banks, CPB)…</p></div></div>;
  const item = id => BS?.items?.find(it => it.id === id);
  const lastOf = rows => [...(rows || [])].reverse().find(r => !r.proj);

  return (
    <div className="options-research">
      <header style={{ marginBottom: 10 }}>
        <div className="ocard-eyebrow">The world as one economy</div>
        <h2 style={{ margin: "2px 0 6px", font: "600 26px var(--font-body)", letterSpacing: -0.4 }}>Earth, consolidated</h2>
        <p className="ohead-line" style={{ margin: 0 }}>
          Output of {tn(H.gdpUsd?.v)} a year at market exchange rates ({tn(H.gdpPpp?.v)} at purchasing-power parity; {H.gdpUsd?.year}{H.gdpUsd?.projected ? ", IMF projection" : ""}), growing {pct(H.growth?.v)} after inflation, for {fx(H.population?.v, 2)} billion people.
          {item("equities") && ` The world's listed companies are worth ${xg(item("equities").gdpMultiple)} its annual output`}
          {item("realEstate") && `, its real estate about ${xg(item("realEstate").gdpMultiple)}`}
          {item("broadMoney") && `, and broad money ${xg(item("broadMoney").gdpMultiple)}`}.
        </p>
      </header>

      <div className="okpis" style={{ marginBottom: 12 }}>
        <Kpi label="World GDP" value={tn(H.gdpUsd?.v)} sub={`${H.gdpUsd?.year}${H.gdpUsd?.projected ? " projection" : ""}${H.gdpUsd?.lastActual ? ` · ${H.gdpUsd.lastActual.year} ${tn(H.gdpUsd.lastActual.v)}` : ""} · PPP ${tn(H.gdpPpp?.v)}`} />
        <Kpi label="Real growth" value={pct(H.growth?.v)} sub={`IMF · ${H.growth?.year}${H.growth?.projected ? " projection" : ""}${H.growth?.lastActual ? ` · ${H.growth.lastActual.year} ${pct(H.growth.lastActual.v)}` : ""}`} />
        <Kpi label="Inflation" value={pct(H.inflation?.v)} sub={`consumer prices · ${H.inflation?.year}${H.inflation?.projected ? " projection" : ""}${H.inflation?.lastActual ? ` · ${H.inflation.lastActual.year} ${pct(H.inflation.lastActual.v)}` : ""}`} />
        <Kpi label="People" value={finite(H.population?.v) ? `${H.population.v.toFixed(2)}bn` : "—"} sub={`GDP per person ${finite(H.gdpPerCapita?.v) ? `$${Math.round(H.gdpPerCapita.v).toLocaleString()}` : "—"}`} />
        {MK?.nowcast && <Kpi label="Market cap ÷ GDP" value={xg(MK.nowcast.ratio)} sub={`nowcast ${lbl(MK.nowcast.asOf)} · median ${xg(capMedian)}`} tone={finite(MK.nowcast.ratio) && finite(capMedian) && MK.nowcast.ratio > capMedian * 1.3 ? "var(--oc-pos)" : undefined} />}
      </div>

      {BS?.items?.length > 0 && (
        <VizCard eyebrow={`Stocks of wealth and debt · latest available · ${BS.asOf ? lbl(BS.asOf) : ""}`} title="The world's balance sheet"
          right={<Seg label="Unit" value={unit} onChange={setUnit} options={[["gdp", "× world GDP"], ["usd", "$ trillions"]]} />}
          finding={`If the world were one country, its balance sheet would read like this. Each row is a separate stock with its own source and date; together they show how large the claims are against one year of output (${tn(H.gdpUsd?.v)}).`}
          table={<MiniTable columns={[{ key: "label", label: "Item" }, { key: "side", label: "Side", fmt: v => SIDE[v] || v }, { key: "usdTn", label: "$ trillions", fmt: tn }, { key: "gdpMultiple", label: "× world GDP", fmt: xg }, { key: "method", label: "Method", fmt: v => METHOD[v] || v }, { key: "asOf", label: "As of", fmt: lbl }, { key: "source", label: "Source", align: "left" }]} rows={BS.items} />}>
          <BalanceSheet items={BS.items} unit={unit} />
        </VizCard>
      )}

      {BS?.items?.some(it => it.series?.length > 2) && (<>
        <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>Each stock over time · × world GDP</div>
        <div className="omini-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", marginBottom: 12 }}>
          {BS.items.filter(it => it.series?.length > 2).map(it => <Mini key={it.id} title={SHORT[it.id] || it.label} rows={it.series.map(([p, , m]) => ({ p: P(p), v: m }))} k="v" fmt={xg} color={it.side === "debt" ? "var(--oc-pos)" : it.side === "wealth" ? C[3] : C[1]} />)}
        </div>
      </>)}

      <div className="ogrid ogrid-2" style={{ marginTop: 12 }}>
        {capRows.length > 0 && (
          <VizCard eyebrow="World Bank · listed domestic companies ÷ IMF world GDP" title="World market cap ÷ world GDP"
            finding={`The world's "Buffett indicator": ${MK.nowcast ? `about ${xg(MK.nowcast.ratio)} now (${lbl(MK.nowcast.asOf)}, nowcast), ` : ""}against a median of ${xg(capMedian)} since ${capRows[0]?.p} and ${xg(capRows.find(r => r.p === "2000")?.ratio)} at the 2000 peak. ${MK.note || ""}`}
            note={MK.nowcast?.method}
            table={<MiniTable columns={[{ key: "p", label: "Year" }, { key: "cap", label: "Market cap", fmt: tn }, { key: "ratio", label: "÷ GDP", fmt: xg }]} rows={[...capRows].reverse()} />}>
            <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={MK.nowcast ? [...capRows, { p: `${P(MK.nowcast.asOf).slice(0, 4)}*`, ratio: null, now: MK.nowcast.ratio }] : capRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={p => P(p).replace("*", " now")} minTickGap={24} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}×`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [xg(v), n === "now" ? "Nowcast" : "Market cap ÷ GDP"]} />
                {finite(capMedian) && <ReferenceLine y={capMedian} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "median", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
                <Bar dataKey="ratio" isAnimationActive={false} radius={[2, 2, 0, 0]}>{capRows.map(r => <Cell key={r.p} fill={C[1]} />)}</Bar>
                <Bar dataKey="now" isAnimationActive={false} radius={[2, 2, 0, 0]} fill={C[2]} />
              </ComposedChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
        {reRows.length > 0 && (
          <VizCard eyebrow="Anchored estimate · Savills totals moved by BIS world house prices ÷ world nominal GDP" title="All the world's real estate"
            finding={`About ${tn(lastOf(reRows)?.usdTn)} (${xg(lastOf(reRows)?.ratio)} world GDP) in ${lbl(lastOf(reRows)?.p)}. Published totals are the dots; between and after them the ratio to GDP moves with real house prices relative to real output.${RE.backtestSummary ? ` Projecting each published total to the next one, the method misses by ${fx(RE.backtestSummary.method, 1)}% on average (holding the ratio flat misses by ${fx(RE.backtestSummary.naive, 1)}%).` : ""}`}
            note={RE.method}
            table={<MiniTable columns={[{ key: "year", label: "Anchor year" }, { key: "usdTn", label: "Total", fmt: tn }, { key: "residential", label: "Residential", fmt: tn }, { key: "commercial", label: "Commercial", fmt: tn }, { key: "agricultural", label: "Farmland", fmt: tn }, { key: "source", label: "Source", align: "left" }]} rows={RE.anchors || []} />}>
            <Legend items={[["Estimate, $tn", C[3]], ["Published total", "var(--text-primary)"]]} />
            <div className="ochart" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={merge({ usdTn: (RE.series || []).map(a => [a[0], a[1]]), anchor: (RE.anchors || []).map(a => [a.year, a.usdTn]) })} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} minTickGap={28} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}tn`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [tn(v), n === "anchor" ? "Published total" : "Estimate"]} />
                <Line dataKey="usdTn" stroke={C[3]} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="anchor" stroke="none" dot={{ r: 4.5, fill: "var(--text-primary)", stroke: "var(--card-bg)", strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
      </div>

      {(M.broad || M.centralBanks || M.reserves) && (
        <div style={{ marginTop: 12 }}>
          <VizCard eyebrow="Central banks and statistics offices · converted to dollars at month-end rates" title="All the money"
            note={moneyView === "broad" ? M.broad?.note : moneyView === "cb" ? M.centralBanks?.note : M.reserves?.note}
            right={<Seg label="Money view" value={moneyView} onChange={setMoneyView} options={[["broad", "Broad money"], ["cb", "Central banks"], ["res", "FX reserves"]].filter(([k]) => (k === "broad" ? M.broad : k === "cb" ? M.centralBanks : M.reserves))} />}
            finding={moneyView === "broad" && M.broad ? `Broad money in the economies covered (${fx(M.broad.coverage, 0)}% of world GDP) totals ${tn(M.broad.usdTn)} as of ${lbl(M.broad.asOf)}: ${signed(M.broad.yoyLocal, 1, "%")} on a year in local currencies, ${signed(M.broad.yoyUsd, 1, "%")} in dollars (the gap is the dollar's move). Stacked by economy.`
              : moneyView === "cb" && M.centralBanks ? `The big central banks' balance sheets total ${tn(M.centralBanks.usdTn)} (${pct(M.centralBanks.pctGdp, 0)} of world GDP) as of ${lbl(M.centralBanks.asOf)}.`
              : M.reserves ? `The world's official FX reserves total ${tn(M.reserves.usdTn)} (${lbl(M.reserves.asOf)}); ${M.reserves.shares?.slice(0, 3).map(s => `${s.currency} ${pct(s.share)}`).join(", ")} of those with a reported currency.` : ""}
            table={moneyView === "broad" ? <MiniTable columns={[{ key: "label", label: "Economy" }, { key: "measure", label: "Measure" }, { key: "usdTn", label: "$ trillions", fmt: tn }, { key: "yoyLocal", label: "1 yr, local", fmt: v => signed(v, 1, "%") }, { key: "asOf", label: "As of", fmt: lbl }]} rows={M.broad?.byEconomy || []} />
              : moneyView === "cb" ? <MiniTable columns={[{ key: "label", label: "Central bank" }, { key: "usdTn", label: "Assets", fmt: tn }, { key: "pctGdpLocal", label: "% own GDP", fmt: v => pct(v, 0) }, { key: "asOf", label: "As of", fmt: lbl }]} rows={M.centralBanks?.banks || []} />
              : <MiniTable columns={[{ key: "currency", label: "Currency" }, { key: "share", label: "Share of allocated reserves", fmt: v => pct(v) }]} rows={M.reserves?.shares || []} />}>
            {moneyView === "broad" && broadRows.length > 0 && (<>
              <Legend items={broadIds.map((id, i) => [M.broad.byEconomy?.find(e => e.id === id)?.label || id, ECON_C[i % ECON_C.length]])} />
              <div className="ochart" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
                <AreaChart data={broadRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} /><XAxis {...axisX(broadRows, 4)} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}tn`} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [tn(v), M.broad.byEconomy?.find(e => e.id === n)?.label || n]} />
                  {broadIds.map((id, i) => <Area key={id} dataKey={id} stackId="m" stroke={ECON_C[i % ECON_C.length]} fill={ECON_C[i % ECON_C.length]} fillOpacity={0.55} strokeWidth={1} isAnimationActive={false} />)}
                </AreaChart>
              </ResponsiveContainer></div>
            </>)}
            {moneyView === "cb" && cbRows.length > 0 && (<>
              <Legend items={cbIds.map((id, i) => [cbLabel(id), ECON_C[i % ECON_C.length]])} />
              <div className="ochart" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cbRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} /><XAxis {...axisX(cbRows, 4)} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}tn`} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [tn(v), cbLabel(n)]} />
                  {cbIds.map((id, i) => <Area key={id} dataKey={id} stackId="c" stroke={ECON_C[i % ECON_C.length]} fill={ECON_C[i % ECON_C.length]} fillOpacity={0.55} strokeWidth={1} isAnimationActive={false} />)}
                </AreaChart>
              </ResponsiveContainer></div>
            </>)}
            {moneyView === "res" && M.reserves && (<>
              <Legend items={resCcy.map((c, i) => [c, ECON_C[i % ECON_C.length]])} />
              <div className="ochart" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
                <LineChart data={resShareRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} /><XAxis {...axisX(resShareRows, 5)} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [pct(v), n]} />
                  {resCcy.map((c, i) => <Line key={c} dataKey={c} stroke={ECON_C[i % ECON_C.length]} strokeWidth={c === "USD" ? 2.25 : 1.5} dot={false} isAnimationActive={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer></div>
            </>)}
          </VizCard>
        </div>
      )}

      <div className="ogrid ogrid-2" style={{ marginTop: 12 }}>
        {debtRows.length > 0 && (
          <VizCard eyebrow={`BIS total credit · all reporting economies${finite(DB.coverage) ? ` (${fx(DB.coverage, 0)}% of world GDP)` : ""} · % of their GDP`}
            note={DB.note} title="Who owes it"
            finding={`${(DB.sectors || []).map(s => `${s.label} ${pct(s.pctGdp, 0)} of GDP${finite(s.usdTn) ? ` (${tn(s.usdTn)})` : ""}`).join("; ")} — ${lbl(DB.asOf)}.`}
            table={<MiniTable columns={[{ key: "p", label: "Quarter", fmt: lbl }, ...(DB.sectors || []).map(s => ({ key: s.id, label: s.label, fmt: v => pct(v, 0) }))]} rows={[...debtRows].reverse()} />}>
            <Legend items={(DB.sectors || []).map((s, i) => [s.label, ECON_C[i % ECON_C.length]])} />
            <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={debtRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} /><XAxis {...axisX(debtRows, 5)} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [pct(v, 1), (DB.sectors || []).find(s => s.id === n)?.label || n]} />
                {(DB.sectors || []).map((s, i) => <Line key={s.id} dataKey={s.id} stroke={ECON_C[i % ECON_C.length]} strokeWidth={s.id === "total" ? 2.25 : 1.6} dot={false} isAnimationActive={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
        {tradeRows.length > 0 && (
          <VizCard eyebrow="CPB World Trade Monitor · volume indices, 2021 = 100" title="What the world makes and ships"
            finding={`World trade volume ${signed(TR.volumeYoy, 1, "%")} and industrial production ${signed(TR.productionYoy, 1, "%")} on a year (${lbl(TR.asOf)}).`}
            note={TR.note}
            table={<MiniTable columns={[{ key: "p", label: "Month", fmt: lbl }, { key: "volume", label: "Trade volume", fmt: v => fx(v, 1) }, { key: "production", label: "Industrial production", fmt: v => fx(v, 1) }]} rows={[...tradeRows].reverse()} />}>
            <Legend items={[["World trade volume", C[1]], ["World industrial production", C[2]]]} />
            <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={tradeRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} /><XAxis {...axisX(tradeRows, 5)} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [fx(v, 1), n === "volume" ? "Trade volume" : "Industrial production"]} />
                <ReferenceLine y={100} stroke="var(--border-subtle)" />
                <Line dataKey="volume" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="production" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
      </div>

      <div className="ogrid ogrid-2" style={{ marginTop: 12 }}>
        {BD?.series?.length > 0 && (
          <VizCard eyebrow="BIS debt securities statistics · all issuers, $ trillions" title="The world bond market"
            finding={`${tn(BD.usdTn)} of bonds and notes outstanding (${lbl(BD.asOf)}, ${BD.countries || "≈50"} countries)${BD.bySector?.length ? `: ${BD.bySector.map(x => `${x.label.toLowerCase()} ${tn(x.usdTn)}`).join(", ")}` : ""}.`}
            note={BD.note}
            table={<MiniTable columns={[{ key: "p", label: "Quarter", fmt: lbl }, { key: "v", label: "$ trillions", fmt: tn }]} rows={[...rowsOf(BD.series)].reverse()} />}>
            <div className="ochart" style={{ height: 210 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={rowsOf(BD.series)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} /><XAxis {...axisX(rowsOf(BD.series), 5)} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}tn`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={v => [tn(v), "Outstanding"]} />
                <Line dataKey="v" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
        {flowRows.length > 0 && (
          <VizCard eyebrow="World Bank world aggregates · % of world GDP · current account from the IMF" title="Saving and investing"
            note={FL?.note}
            finding={(() => { const l = lastOf(flowRows); const ca = (FL?.caDiscrepancy || []).filter(a => !a[2]).at(-1); return l ? `In ${l.p} the world saved ${pct(l.savings)} of its income and invested ${pct(l.investment)}. For one closed economy the two are the same thing; any gap is measurement error.${ca ? ` The same error shows in trade: every country's current account should net to zero, yet in ${ca[0]} they summed to ${ca[1] > 0 ? "+" : ""}${Math.round(ca[1])}bn — the world runs a surplus with no one.` : ""}` : ""; })()}
            table={<MiniTable columns={[{ key: "p", label: "Year" }, { key: "savings", label: "Saving % GDP", fmt: v => pct(v) }, { key: "investment", label: "Investment % GDP", fmt: v => pct(v) }, { key: "proj", label: "", fmt: v => (v ? "projection" : "") }]} rows={[...flowRows].reverse()} />}>
            <Legend items={[["Gross national saving", C[1]], ["Gross investment", C[2]]]} />
            <div className="ochart" style={{ height: 210 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={flowRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} /><XAxis {...axisX(flowRows, 5)} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [pct(v), n === "savings" ? "Saving" : "Investment"]} />
                <Line dataKey="savings" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="investment" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                {flowRows.find(r => r.proj) && <ReferenceLine x={flowRows.find(r => r.proj).p} stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "projections", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
              </LineChart>
            </ResponsiveContainer></div>
          </VizCard>
        )}
      </div>

      <div style={{ marginTop: 12 }}><GlobalImbalances /></div>

      {PE && (<>
        <div className="ocard-eyebrow" style={{ margin: "14px 0 6px" }}>The people · World Bank world aggregates</div>
        <div className="omini-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", marginBottom: 4 }}>
          <Mini title="Population" rows={rowsOf(PE.population)} k="v" fmt={v => (finite(v) ? `${v.toFixed(2)}bn` : "—")} />
          <Mini title="Working age (15–64)" rows={rowsOf(PE.workingAgeShare)} k="v" fmt={v => pct(v)} color={C[2]} />
          <Mini title="Births per woman" rows={rowsOf(PE.fertility)} k="v" fmt={v => fx(v, 2)} color={C[3]} refY={2.1} />
          <Mini title="Life expectancy" rows={rowsOf(PE.lifeExpectancy)} k="v" fmt={v => (finite(v) ? `${v.toFixed(1)} yrs` : "—")} color={C[4]} />
          <Mini title="Unemployment (ILO)" rows={rowsOf(PE.unemployment)} k="v" fmt={v => pct(v)} color={C[5]} />
        </div>
        {PE.note && <p className="onote" style={{ marginBottom: 12 }}>{PE.note}</p>}
      </>)}

      {members.length > 0 && (
        <VizCard eyebrow={`IMF World Economic Outlook · ${members[0]?.year || ""}${members[0]?.projected ? " (projection)" : ""}`} title="The member states"
          right={<Seg label="Sort" value={memberSort} onChange={setMemberSort} options={[["gdpUsd", "Size"], ["growth", "Growth"], ["inflation", "Inflation"], ["govDebt", "Gov. debt"], ["ca", "Current acct"]]} />}
          finding="The largest economies on one table: size and share of world output at market rates, real growth, inflation, unemployment, general-government debt and the current account. Country deep-dives: International → Pulse and China, Real Estate → Global.">
          <MiniTable maxHeight={520} rows={members} columns={[
            { key: "name", label: "Economy" }, { key: "gdpUsd", label: "GDP", fmt: tn }, { key: "share", label: "Share of world", fmt: v => pct(v) },
            { key: "growth", label: "Real growth", fmt: v => pct(v) }, { key: "inflation", label: "Inflation", fmt: v => pct(v) }, { key: "unemployment", label: "Unemployment", fmt: v => pct(v) },
            { key: "govDebt", label: "Gov. debt % GDP", fmt: v => pct(v, 0) }, { key: "ca", label: "Current account % GDP", fmt: v => signed(v, 1, "%") },
          ]} />
        </VizCard>
      )}

      {W?.anchors?.length > 0 && <p className="onote">Household wealth anchors (UBS Global Wealth Report): {W.anchors.map(a => `${a.year} ${tn(a.usdTn)}${a.derived ? " (derived from the reported growth)" : ""}`).join(" · ")}. Real Estate → Global has country house prices; International → Share of the World has each country's share of world output and market cap.</p>}
      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      {d.note && <p className="onote">{d.note}</p>}
      <p className="onote">Sources: {(d.sources || []).map(s => `${s.label} (${s.from === "live" ? "fetched" : `${s.from} copy`} ${P(s.fetched || "").slice(0, 10)})`).join("; ")}.</p>
    </div>
  );
}
