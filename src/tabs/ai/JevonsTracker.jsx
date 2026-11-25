import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { finite, C, VizCard, Kpi, Legend, axisTick, gridProps, tipStyle, tipLabel } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// JEVONS TRACKER — AI Economy → Tokens: lab by lab on OpenRouter, does the
// money spent on tokens rise where their price falls (server/jevonsTracker.js).
//   tiles    how the labs split by verdict, as a share of tokens
//   charts   the selected row: price, tokens and spend by day, indexed to its
//            first week (log scale); and each day as a dot, tokens against
//            price on log axes, with the fitted line whose slope is β
//   table    every lab: tokens, share, spend, days, price first week → last,
//            the three changes, β, R², verdict. Click a row to chart it;
//            click a heading to sort.
// Spend is priced at what was paid each day (OpenRouter's effective price),
// not at list. The window is whatever the dashboard has on file: 31 days is
// all OpenRouter serves at once, and each build keeps what it read.
// ============================================================================

const tok = v => (!finite(v) ? "—" : v >= 1e12 ? `${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : `${(v / 1e6).toFixed(0)}M`);
const money = v => (!finite(v) ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${v.toFixed(0)}`);
const perM = v => (!finite(v) ? "—" : v === 0 ? "free" : v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(4)}`);
const pct = (v, dp = 1) => (!finite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(Math.abs(v) >= 10 ? 0 : dp)}%`);
const share = v => (!finite(v) ? "—" : `${(v * 100).toFixed(v < 0.001 ? 2 : 1)}%`);
const num = (v, dp = 2) => (!finite(v) ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}`);
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const left = { textAlign: "left" }, right = { textAlign: "right" };
const TONE = { "Jevons holds": "var(--oc-good)", "spend shrank": "var(--oc-bad)" };
const MEANING = {
  "Jevons holds": "price fell, spend rose, β beyond −1 with a real fit",
  "spend grew": "price fell and spend rose, but the day-to-day fit is weak or β is short of −1",
  "spend shrank": "price fell and volume did not make up for it",
  "price rose": "the average price paid went up, so there is no Jevons test",
  "price flat": "price moved less than 3% either way",
  "no price–volume link": "price fell and spend rose, with no day-to-day relation between them",
  "free only": "nothing was paid: free variants only",
  "too few days": "not enough days on file",
};

// each day as a dot on log axes, with the least-squares line
function Scatter({ series, beta, r2 }) {
  const [hover, setHover] = useState(null);
  const pts = series.filter(p => p.price > 0 && p.tokens > 0);
  if (pts.length < 3) return <p className="onote" style={{ margin: "40px 0" }}>Nothing was paid on enough days to plot price against volume.</p>;
  const W = 420, H = 230, m = { l: 48, r: 12, t: 10, b: 30 };
  const lx = pts.map(p => Math.log(p.price)), ly = pts.map(p => Math.log(p.tokens));
  const pad = (a, b) => { const s = (b - a) * 0.08 || 0.05; return [a - s, b + s]; };
  const [x0, x1] = pad(Math.min(...lx), Math.max(...lx)), [y0, y1] = pad(Math.min(...ly), Math.max(...ly));
  const X = v => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r), Y = v => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const mx = lx.reduce((a, b) => a + b, 0) / lx.length, my = ly.reduce((a, b) => a + b, 0) / ly.length;
  const ticks = (a, b) => [0, 0.5, 1].map(t => a + (b - a) * t);
  const text = { fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" };
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily tokens against the daily price paid, log scales" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {ticks(y0, y1).map(v => <g key={`y${v}`}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--border-subtle)" /><text x={m.l - 6} y={Y(v) + 3.5} textAnchor="end" style={text}>{tok(Math.exp(v))}</text></g>)}
        {ticks(x0, x1).map(v => <text key={`x${v}`} x={X(v)} y={H - 14} textAnchor="middle" style={text}>{perM(Math.exp(v))}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 2} textAnchor="middle" style={text}>price paid per million tokens (log) → · tokens a day (log) ↑</text>
        {finite(beta) && (() => { const ya = my + beta * (x0 - mx), yb = my + beta * (x1 - mx), cl = v => Math.max(y0, Math.min(y1, v));
          const xa = beta ? mx + (cl(ya) - my) / beta : x0, xb = beta ? mx + (cl(yb) - my) / beta : x1;
          return <line x1={X(xa)} y1={Y(cl(ya))} x2={X(xb)} y2={Y(cl(yb))} stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="5 4" />; })()}
        {pts.map((p, i) => <circle key={p.d} cx={X(lx[i])} cy={Y(ly[i])} r={hover === p ? 6 : 4} fill="var(--oc-1)" fillOpacity={0.35 + 0.65 * (i / Math.max(1, pts.length - 1))} stroke="var(--card-bg)" strokeWidth="1.5" onMouseEnter={() => setHover(p)} />)}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {hover ? <><b style={{ color: "var(--text-primary)" }}>{day(hover.d)}</b> · {tok(hover.tokens)} tokens at {perM(hover.price)} per million · {money(hover.spend)} spent</>
          : finite(beta) ? <>Each dot is a day, later days darker. The dashed line's slope is β = {num(beta)} (R² {num(r2)}).</> : <>Each dot is a day, later days darker. Too few days for a fitted line.</>}
      </div>
    </div>
  );
}

const COLS = [["name", "Lab", left], ["tokens", "Tokens", right], ["share", "Share", right], ["spend", "Spend", right], ["days", "Days", right], ["priceNow", "$ per million, first → last week", right],
  ["dPrice", "Δ price", right], ["dTokens", "Δ tokens", right], ["dSpend", "Δ spend", right], ["beta", "β log-log", right], ["r2", "R²", right], ["verdict", "Verdict", left]];

export default function JevonsTracker() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [sel, setSel] = useState("all"), [sort, setSort] = useState({ key: "tokens", dir: -1 }), [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let live = true, timer;
    const load = () => fetch("/api/jevons").then(r => r.json()).then(j => { if (!live) return; if (j.error && !j.all) { setErr(j.error); return; } setErr(null); setD(j); if (j.building || j.refreshing) timer = setTimeout(load, j.building ? 4000 : 15000); }).catch(e => live && setErr(e.message));
    load();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  const rows = useMemo(() => {
    if (!d?.labs) return [];
    const v = l => (sort.key === "priceNow" ? l.price?.[1] : l[sort.key]);
    return [...d.labs].sort((a, b) => { const x = v(a), y = v(b); if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y)) * sort.dir; return ((finite(x) ? x : -Infinity) - (finite(y) ? y : -Infinity)) * sort.dir; });
  }, [d, sort]);
  if (err) return <div className="options-research"><p className="onote">The Jevons tracker could not be built: {err}</p></div>;
  if (!d || d.building) return <div className="options-research"><p className="onote">Reading a month of daily tokens and prices for OpenRouter's largest models{d?.progress ? `: ${d.progress.done} of ${d.progress.of}` : ""}… (about a minute the first time each day)</p></div>;

  const all = d.all, e = sel === "all" ? all : d.labs.find(l => l.id === sel) || all, k = Math.max(1, e.edge || 1);
  const base = key => e.series.slice(0, k).reduce((a, p) => a + p[key], 0) / k, b = { price: (e.series.slice(0, k).reduce((a, p) => a + p.spend, 0) / e.series.slice(0, k).reduce((a, p) => a + p.tokens, 0)) * 1e6, tokens: base("tokens"), spend: base("spend") };
  const idx = e.series.map(p => ({ d: p.d, price: b.price > 0 && p.price > 0 ? Math.round((p.price / b.price) * 1000) / 10 : null, tokens: Math.round((p.tokens / b.tokens) * 1000) / 10, spend: b.spend > 0 && p.spend > 0 ? Math.round((p.spend / b.spend) * 1000) / 10 : null }));
  const t = v => d.tally.find(x => x.verdict === v), jev = t("Jevons holds"), shr = t("spend shrank"), rose = t("price rose"), grew = t("spend grew");
  const finding = `Across everything tracked (${share(d.coverage)} of OpenRouter's tokens), the average price paid went from ${perM(all.price?.[0])} to ${perM(all.price?.[1])} per million tokens between the first and last week of the window (${pct(all.dPrice)}); volume changed ${pct(all.dTokens)} and spending ${pct(all.dSpend)}, with β ${num(all.beta)}: ${all.verdict === "Jevons holds" ? "volume more than made up for the price" : all.verdict === "spend shrank" ? "volume grew, but not by enough to make up for the price" : all.verdict}.`
    + ` By lab: ${[jev && `${jev.labs} fit Jevons (${share(jev.share)} of tokens)`, grew && `${grew.labs} saw spend grow on a weaker fit (${share(grew.share)})`, shr && `${shr.labs} saw spend shrink as price fell (${share(shr.share)})`, rose && `${rose.labs} raised their average price (${share(rose.share)})`].filter(Boolean).join("; ")}.`
    + ` The window is ${all.days} days, ${day(all.from)} to ${day(all.to)}; it lengthens by a day each day the dashboard is opened.`;
  const shown = showAll ? rows : rows.slice(0, 24);
  const line = (l, isAll) => (
    <tr key={l.id} className="oclick" onClick={() => setSel(l.id)} aria-selected={e.id === l.id} style={e.id === l.id ? { background: "var(--bg-subtle)" } : undefined} title={l.top ? `${l.models} model${l.models === 1 ? "" : "s"}: ${l.top.map(m => `${m.name} ${share(m.share)}`).join(", ")}${l.freeShare > 0.005 ? ` · ${share(l.freeShare)} of tokens free` : ""}` : `${l.models} model-variants`}>
      <td style={{ ...left, fontFamily: "var(--font-body)", fontWeight: isAll || e.id === l.id ? 600 : 400, borderLeft: `3px solid ${e.id === l.id ? "var(--oc-1)" : "transparent"}` }}>{l.name}</td>
      <td style={right}>{tok(l.tokens)}</td><td style={{ ...right, color: "var(--text-secondary)" }}>{share(l.share)}</td><td style={right}>{money(l.spend)}</td><td style={{ ...right, color: "var(--text-secondary)" }}>{l.days}</td>
      <td style={{ ...right, color: "var(--text-secondary)" }}>{l.price ? `${perM(l.price[0])} → ${perM(l.price[1])}` : "—"}</td>
      <td style={right}>{pct(l.dPrice)}</td><td style={right}>{pct(l.dTokens)}</td><td style={{ ...right, fontWeight: 600 }}>{pct(l.dSpend)}</td>
      <td style={right}>{num(l.beta)}</td><td style={{ ...right, color: "var(--text-secondary)" }}>{num(l.r2)}</td>
      <td style={{ ...left, fontFamily: "var(--font-body)", fontWeight: l.verdict === "Jevons holds" ? 600 : 400, color: TONE[l.verdict] ? "var(--text-primary)" : "var(--text-secondary)" }} title={MEANING[l.verdict]}><i aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, marginRight: 6, background: TONE[l.verdict] || "var(--text-muted)", opacity: TONE[l.verdict] ? 1 : 0.5 }} />{l.verdict}</td>
    </tr>);

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`OpenRouter by lab · daily tokens at the price paid · ${day(all.from)} to ${day(all.to)}`} title="Jevons by lab: where the price fell, did spending rise?" finding={finding} style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          {d.tally.map(x => <Kpi key={x.verdict} label={x.verdict} value={share(x.share)} sub={`${x.labs} lab${x.labs === 1 ? "" : "s"} · share of tokens`} tone={TONE[x.verdict]} title={MEANING[x.verdict]} />)}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ flex: "1.4 1 440px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>{e.name} · price, tokens and spend by day · first {k === 1 ? "day" : `${k} days`} = 100 · log scale</div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={idx} margin={{ top: 6, right: 16, bottom: 0, left: -10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="d" tick={axisTick} tickFormatter={day} minTickGap={40} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={axisTick} allowDataOverflow />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={day} formatter={(v, name) => [v, name]} />
                  <Line name="Tokens" dataKey="tokens" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Line name="Spend" dataKey="spend" stroke={C[3]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Line name="Price paid per token" dataKey="price" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["Tokens", C[1]], ["Spend", C[3]], ["Price paid per token", C[2]]]} />
          </div>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>{e.name} · each day's tokens against its price</div>
            <Scatter series={e.series} beta={e.beta} r2={e.r2} />
          </div>
        </div>

        <div className="otable-wrap" style={{ maxHeight: 560, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr>{COLS.map(([key, label, align]) => <th key={key} style={align} aria-sort={sort.key === key ? (sort.dir < 0 ? "descending" : "ascending") : undefined}><button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key ? -s.dir : key === "name" || key === "verdict" ? 1 : -1 }))}>{label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}</button></th>)}</tr></thead>
            <tbody>{line(all, true)}{shown.map(l => line(l, false))}</tbody>
          </table>
        </div>
        {rows.length > 24 && <button type="button" className="ochip" style={{ marginTop: 8 }} onClick={() => setShowAll(v => !v)}>{showAll ? "Show the 24 largest" : `Show all ${rows.length} labs`}</button>}

        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: {d.source}. {d.read} model-variants read, covering {share(d.coverage)} of the month's tokens{d.unpricedShare > 0.001 ? `; ${share(d.unpricedShare)} of their tokens had no price on the day and are left out` : ""}. Read {new Date(d.built).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{d.refreshing ? `; refreshing${d.progress ? ` (${d.progress.done} of ${d.progress.of})` : ""}` : d.stale ? `; OpenRouter could not be reached (${d.error})` : ""}.</li>
        </ul>
      </VizCard>
    </div>
  );
}
