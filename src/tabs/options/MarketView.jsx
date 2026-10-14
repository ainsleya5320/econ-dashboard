import React, { useState } from "react";
import { useOptionsMarket } from "./marketData.js";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { finite, fx, pctS, signed, ord, usdK, intK, dayLabel, monLabel, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, RangeStrip, Spark, divBg, seqBg, Seg, Legend } from "./ui.jsx";

// ============================================================================
// MARKET: the options market's temperature on one page. Volatility indices
// and their term structure (Cboe), put/call ratios (Cboe daily statistics),
// SKEW and VVIX, a volatility-and-skew board across index and sector ETFs,
// the largest stocks and your watchlist, skew curves, where premium traded,
// and unusual activity (volume well above open interest). Data:
// /api/options-market (server/optionsMarket.js). Every chart has a table
// twin; each measure keeps its own scale (no dual axes).
// ============================================================================

const TENORS = [["VIX9D", "9 days"], ["VIX", "30 days"], ["VIX3M", "3 months"], ["VIX6M", "6 months"], ["VIX1Y", "1 year"]];
const CROSS = [["VIX", "S&P 500"], ["VXN", "Nasdaq 100"], ["RVX", "Russell 2000"], ["VVIX", "VIX of VIX"], ["SKEW", "Tail risk (SKEW)"], ["OVX", "Oil"], ["GVZ", "Gold"]];
const GROUPS = [["all", "All"], ["index", "Indexes"], ["sector", "Sectors"], ["macro", "Rates, credit, commodities"], ["megacap", "Largest stocks"], ["watch", "Watchlist"]];

const expLabel = d => (d ? `${dayLabel(d)}${d.slice(0, 4) !== String(new Date().getFullYear()) ? ` '${d.slice(2, 4)}` : ""}` : "—");
const lastN = (hist, n) => (hist || []).slice(-n);
const quantile = (xs, p) => { const s = xs.filter(finite).sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const ma = (rows, key, n) => rows.map((r, i) => { const w = rows.slice(Math.max(0, i - n + 1), i + 1).map(x => x[key]).filter(finite); return w.length >= Math.min(n, 5) ? w.reduce((a, b) => a + b, 0) / w.length : null; });
const ivAt = (term, d) => { const t = (term || []).filter(p => finite(p.iv)).sort((a, b) => a.dte - b.dte); if (!t.length) return null; if (d <= t[0].dte) return t[0].iv; for (let i = 1; i < t.length; i++) if (t[i].dte >= d) { const a = t[i - 1], b = t[i]; return a.iv + ((d - a.dte) / (b.dte - a.dte || 1)) * (b.iv - a.iv); } return t.at(-1).iv; };

// the overall read: counts of stress and calm signals, each one stated in the headline
function temperature(d) {
  const vix = d.indices?.VIX, pc = d.putCall, r = d.term?.ratios || {};
  const s = [], c = [];
  if (finite(vix?.pct?.y1)) (vix.pct.y1 >= 70 ? s : vix.pct.y1 <= 30 ? c : []).push(`VIX ${fx(vix.last)} at the ${ord(vix.pct.y1)} percentile of the past year`);
  if (finite(r.vix9dVix) && r.vix9dVix > 1) s.push(`the 9-day VIX (${fx(d.indices?.VIX9D?.last)}) above the 30-day, so traders pay most for the next week`);
  if (finite(r.vixVix3m)) (r.vixVix3m >= 1 ? s : r.vixVix3m <= 0.88 ? c : []).push(r.vixVix3m >= 1 ? `the curve inverted (VIX ÷ VIX3M ${fx(r.vixVix3m, 2)})` : `a steep upward curve (VIX ÷ VIX3M ${fx(r.vixVix3m, 2)})`);
  if (finite(pc?.pct1y?.equity)) (pc.pct1y.equity >= 75 ? s : pc.pct1y.equity <= 25 ? c : []).push(`equity put/call ${fx(pc.ma10?.equity ?? pc.latest?.equity, 2)} (10-day) at the ${ord(pc.pct1y.equity)} percentile`);
  const label = s.length >= 2 ? "Stressed" : c.length >= 2 ? "Calm" : "Mixed";
  return { label, s, c, color: label === "Stressed" ? "var(--oc-bad)" : label === "Calm" ? "var(--oc-good)" : "var(--oc-4)" };
}

function Headline({ d }) {
  const t = temperature(d), skew = d.indices?.SKEW;
  const parts = [...t.s, ...t.c];
  return (
    <p className="ohead-line">
      <span className="otag" style={{ borderColor: t.color, color: "var(--text-primary)", marginRight: 6 }}><i className="okpi-dot" style={{ background: t.color, display: "inline-block", marginRight: 4 }} aria-hidden="true" />{t.label}</span>
      {parts.length ? `${parts.join("; ")}.` : "No reading stands out against the past year."}
      {finite(skew?.pct?.y1) && skew.pct.y1 >= 80 && ` SKEW ${fx(skew.last, 0)} near its 1-year high says protection against a crash is still being bought.`}
      {finite(skew?.pct?.y1) && skew.pct.y1 <= 20 && ` SKEW ${fx(skew.last, 0)} near its 1-year low says crash protection is cheap.`}
    </p>
  );
}

function Kpis({ d }) {
  const i = d.indices || {}, r = d.term?.ratios || {}, pc = d.putCall || {}, spy = d.scan?.rows?.find(x => x.symbol === "SPY");
  const pctSub = x => (x ? `${ord(x.pct?.y1)} pct 1y · ${ord(x.pct?.all)} all` : "");
  return (
    <div className="okpis">
      <Kpi label="VIX" value={fx(i.VIX?.last)} sub={`${signed(i.VIX?.change, 2)} · ${pctSub(i.VIX)}`} />
      <Kpi label="9-day ÷ 30-day" value={fx(r.vix9dVix, 2)} sub={finite(r.vix9dVix) ? (r.vix9dVix > 1 ? "next week dearest" : "normal: below 1") : ""} tone={finite(r.vix9dVix) && r.vix9dVix > 1 ? "var(--oc-bad)" : undefined} />
      <Kpi label="VIX ÷ VIX3M" value={fx(r.vixVix3m, 2)} sub={d.term?.state ? `${d.term.state}` : ""} tone={d.term?.state === "inverted" ? "var(--oc-bad)" : undefined} />
      <Kpi label="VVIX" value={fx(i.VVIX?.last, 0)} sub={pctSub(i.VVIX)} />
      <Kpi label="SKEW" value={fx(i.SKEW?.last, 0)} sub={pctSub(i.SKEW)} />
      <Kpi label="Equity put/call" value={fx(pc.latest?.equity, 2)} sub={`10-day ${fx(pc.ma10?.equity, 2)} · ${ord(pc.pct1y?.equity)} pct 1y`} />
      <Kpi label="SPX put/call" value={fx(pc.latest?.spx, 2)} sub={`10-day ${fx(pc.ma10?.spx, 2)} · ${ord(pc.pct1y?.spx)} pct 1y`} />
      <Kpi label="SPY 25Δ skew" value={finite(spy?.rr25) ? `${fx(spy.rr25)} pts` : "—"} sub="put IV minus call IV, 30 days" />
    </div>
  );
}

function TermCard({ d }) {
  const pts = d.term?.points || [];
  const rows = TENORS.map(([key, label]) => { const p = pts.find(x => x.key === key) || {}; return { label, today: p.last, monthAgo: p.monthAgo, avg1y: p.avg1y }; });
  const first = rows[0]?.today, lastV = rows.at(-1)?.today;
  const finding = finite(first) && finite(lastV)
    ? `${d.term?.state === "inverted" ? "Inverted" : d.term?.state === "flat" ? "Flat" : "Upward-sloping (contango)"}: ${fx(first)} for the next 9 days rising to ${fx(lastV)} for a year${d.term?.state === "inverted" ? ", the shape of a market paying up for near-term protection" : ", the usual shape when no near-term shock is priced"}.`
    : "Term structure unavailable.";
  return (
    <VizCard eyebrow="Cboe VIX family · S&P 500 implied volatility by horizon" title="Volatility term structure" finding={finding}
      table={<MiniTable columns={[{ key: "label", label: "Horizon" }, { key: "today", label: "Today", fmt: v => fx(v, 2) }, { key: "monthAgo", label: "Month ago", fmt: v => fx(v, 2) }, { key: "avg1y", label: "1-yr average", fmt: v => fx(v, 2) }]} rows={rows} />}>
      <Legend items={[["Today", C[1]], ["A month ago", C[2]], ["1-year average", C[3]]]} />
      <div className="ochart"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 26, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} padding={{ left: 12, right: 12 }} interval={0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={42} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [fx(v, 2), n]} />
          <Line dataKey="avg1y" name="1-year average" stroke={C[3]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--card-bg)", fill: C[3] }} isAnimationActive={false} />
          <Line dataKey="monthAgo" name="A month ago" stroke={C[2]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--card-bg)", fill: C[2] }} isAnimationActive={false} />
          <Line dataKey="today" name="Today" stroke={C[1]} strokeWidth={2.5} dot={{ r: 5, strokeWidth: 2, stroke: "var(--card-bg)", fill: C[1] }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer></div>
    </VizCard>
  );
}

function VixCard({ d }) {
  const [span, setSpan] = useState(252);
  const vix = d.indices?.VIX;
  const data = lastN(vix?.history, span).map(([dd, v]) => ({ d: dd, v }));
  const ratio = lastN(d.term?.ratioHistory, span).map(([dd, v]) => ({ d: dd, v }));
  const inverted = ratio.filter(r => r.v >= 1).length;
  const rMin = Math.min(0.75, ...ratio.map(r => r.v).filter(finite)), rMax = Math.max(1.1, ...ratio.map(r => r.v).filter(finite));
  const ratioTicks = []; for (let t = Math.ceil(rMin * 10) / 10; t <= rMax + 1e-9; t = Math.round((t + 0.1) * 10) / 10) ratioTicks.push(t);
  return (
    <VizCard eyebrow="Cboe · daily close" title="VIX and its curve" right={<Seg label="Span" value={span} onChange={setSpan} options={[[126, "6m"], [252, "1y"], [756, "3y"]]} />}
      finding={vix ? `VIX ${fx(vix.last)} against a 1-year average of ${fx(vix.avg1y)}; the curve (VIX ÷ VIX3M, below) was inverted on ${inverted} of the last ${ratio.length} days shown.` : "VIX history unavailable."}
      table={<MiniTable columns={[{ key: "d", label: "Date" }, { key: "v", label: "VIX", fmt: v => fx(v, 2) }, { key: "r", label: "VIX ÷ VIX3M", fmt: v => fx(v, 3) }]} rows={[...data].reverse().slice(0, 120).map(r => ({ ...r, r: ratio.find(x => x.d === r.d)?.v }))} />}>
      <Legend items={[["VIX", C[1]], ["1-year average", "var(--text-muted)", true]]} />
      <div className="ochart" style={{ height: 170 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }} syncId="vix">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={[0, "auto"]} width={42} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={v => [fx(v, 2), "VIX"]} />
          {finite(vix?.avg1y) && <ReferenceLine y={vix.avg1y} stroke="var(--text-muted)" strokeDasharray="4 3" />}
          <Line dataKey="v" name="VIX" stroke={C[1]} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer></div>
      <div className="onote" style={{ margin: "4px 0 0" }}>VIX ÷ VIX3M: above 1 (shaded) the next month is priced dearer than the next three, a stress signal</div>
      <div className="ochart-sm" style={{ height: 110 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={ratio} margin={{ top: 6, right: 20, left: 0, bottom: 0 }} syncId="vix">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={[lo => Math.min(0.75, Math.floor(lo * 20) / 20), hi => Math.max(1.1, Math.ceil(hi * 20) / 20)]} ticks={ratioTicks} width={42} tickFormatter={v => v.toFixed(2)} />
          <ReferenceArea y1={1} y2={2} fill="var(--oc-bad)" fillOpacity={0.08} ifOverflow="hidden" />
          <ReferenceLine y={1} stroke="var(--text-muted)" />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={v => [fx(v, 3), "VIX ÷ VIX3M"]} />
          <Line dataKey="v" name="VIX ÷ VIX3M" stroke={C[1]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer></div>
    </VizCard>
  );
}

function PutCallCard({ d }) {
  const [span, setSpan] = useState(252);
  const hist = d.putCall?.history || [];
  const eq = ma(hist, "equity", 10), spx = ma(hist, "spx", 10);
  const data = hist.map((r, i) => ({ d: r.d, equity: eq[i], spx: spx[i], eqRaw: r.equity })).slice(-span);
  const pc = d.putCall || {};
  const tilt = v => (!finite(v) ? "" : v >= 75 ? "put-heavy: hedging is in demand" : v <= 25 ? "call-heavy: little hedging, often a sign of complacency" : "middle of its range");
  return (
    <VizCard eyebrow="Cboe daily market statistics · 10-day averages" title="Put/call ratios" right={<Seg label="Span" value={span} onChange={setSpan} options={[[126, "6m"], [252, "1y"], [504, "2y"]]} />}
      finding={pc.latest ? `Equity options: ${fx(pc.latest.equity, 2)} puts per call on ${dayLabel(pc.latest.date)} (10-day ${fx(pc.ma10?.equity, 2)}, ${ord(pc.pct1y?.equity)} percentile of the year, ${tilt(pc.pct1y?.equity)}). S&P 500 index options: ${fx(pc.latest.spx, 2)}, where puts usually dominate because institutions hedge there.` : "Put/call history unavailable."}
      table={<MiniTable columns={[{ key: "d", label: "Date" }, { key: "eqRaw", label: "Equity (day)", fmt: v => fx(v, 2) }, { key: "equity", label: "Equity 10d", fmt: v => fx(v, 2) }, { key: "spx", label: "SPX 10d", fmt: v => fx(v, 2) }]} rows={[...data].reverse()} />}>
      <Legend items={[["Equity options, 10-day", C[1]], ["SPX index options, 10-day", C[2]]]} />
      <div className="ochart"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={42} tickFormatter={v => v.toFixed(1)} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={(v, n) => [fx(v, 2), n]} />
          <Line dataKey="spx" name="SPX index options, 10-day" stroke={C[2]} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="equity" name="Equity options, 10-day" stroke={C[1]} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer></div>
    </VizCard>
  );
}

function CrossAssetCard({ d }) {
  const rows = CROSS.map(([key, label]) => {
    const x = d.indices?.[key]; if (!x) return { key, label };
    const y1 = lastN(x.history, 252).map(r => r[1]);
    return { key, label, last: x.last, change: x.change, min: Math.min(...y1), max: Math.max(...y1), p25: quantile(y1, 0.25), p75: quantile(y1, 0.75), avg: x.avg1y, pct: x.pct?.y1, spark: lastN(x.history, 90).map(r => r[1]) };
  });
  const hot = rows.filter(r => finite(r.pct) && r.pct >= 80).map(r => r.label), cold = rows.filter(r => finite(r.pct) && r.pct <= 20).map(r => r.label);
  return (
    <VizCard eyebrow="Cboe volatility indices · where today sits in the past year" title="Volatility across markets"
      finding={`${hot.length ? `Near 1-year highs: ${hot.join(", ")}. ` : ""}${cold.length ? `Near 1-year lows: ${cold.join(", ")}.` : ""}${!hot.length && !cold.length ? "Every gauge sits inside the middle of its 1-year range." : ""}`}
      table={<MiniTable columns={[{ key: "label", label: "Gauge" }, { key: "last", label: "Last", fmt: v => fx(v, 2) }, { key: "min", label: "1y low", fmt: v => fx(v, 1) }, { key: "avg", label: "1y avg", fmt: v => fx(v, 1) }, { key: "max", label: "1y high", fmt: v => fx(v, 1) }, { key: "pct", label: "Pct", fmt: v => ord(v) }]} rows={rows} />}>
      <div className="otable-wrap"><table className="otable">
        <thead><tr><th style={{ textAlign: "left" }}>Gauge</th><th style={{ textAlign: "right" }}>Last</th><th style={{ textAlign: "right" }}>Day</th><th style={{ textAlign: "left" }}>1-year range · avg tick · middle 50% bar</th><th style={{ textAlign: "right" }}>Pct</th><th style={{ textAlign: "left" }}>90 days</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.key}>
            <td style={{ textAlign: "left" }}>{r.label} <span className="otag">{r.key}</span></td>
            <td style={{ textAlign: "right" }}>{fx(r.last, 2)}</td>
            <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{signed(r.change, 2)}</td>
            <td style={{ textAlign: "left" }}><RangeStrip min={r.min} max={r.max} p25={r.p25} p75={r.p75} avg={r.avg} value={r.last} width={150} /></td>
            <td style={{ textAlign: "right" }}>{ord(r.pct)}</td>
            <td style={{ textAlign: "left" }}><Spark values={r.spark} /></td>
          </tr>))}
        </tbody>
      </table></div>
    </VizCard>
  );
}

// the volatility-and-skew board: one row per name, heat cells keep their numbers (ink on a tint)
const COLS = [
  { key: "symbol", label: "Name", sort: r => r.symbol },
  { key: "chgPct", label: "Price", title: "Today's price change", sort: r => r.chgPct },
  { key: "iv30", label: "IV 30d", title: "Cboe 30-day implied volatility", sort: r => r.iv30 },
  { key: "iv30Chg", label: "IV chg", title: "Change in 30-day IV today, vol points", sort: r => r.iv30Chg },
  { key: "slope", label: "Term 90−30", title: "90-day minus 30-day ATM IV, vol points: negative (inverted) means the next month is priced dearer, usually an event such as earnings, or stress", sort: r => r.slope },
  { key: "rr25", label: "25Δ skew", title: "25-delta put IV minus 25-delta call IV at ~30 days: positive means puts are dearer", sort: r => r.rr25 },
  { key: "pcVol", label: "P/C vol", title: "Put volume ÷ call volume today", sort: r => r.pcVol },
  { key: "pcOi", label: "P/C OI", title: "Put open interest ÷ call open interest", sort: r => r.pcOi },
  { key: "vol", label: "Contracts", title: "Total option volume today", sort: r => r.vol },
  { key: "prem", label: "Premium", title: "Dollar premium traded today (volume × mid × 100)", sort: r => r.prem },
  { key: "move", label: "Implied move", title: "ATM straddle ÷ price at the nearest expiry at least 5 days out", sort: r => r.move?.pct },
  { key: "earnings", label: "Earnings", sort: r => r.earnings || "9999" },
  { key: "term", label: "IV by expiry", sort: null },
];
function Board({ d, onInspect }) {
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState({ key: "prem", dir: -1 });
  // slope: 90-day ATM IV (interpolated over expiries at least 20 days out; the shortest ones are noisy)
  // minus the 30-day level (ours, else Cboe's)
  const slopeOf = r => { const t = (r.ivTerm || []).filter(p => p.dte >= 20), v90 = ivAt(t, 90), v30 = finite(r.ivCm30) ? r.ivCm30 : r.iv30; return t.length >= 2 && finite(v90) && finite(v30) ? v90 - v30 : null; };
  const all = (d.scan?.rows || []).map(r => ({ ...r, slope: slopeOf(r), vol: (r.callVol || 0) + (r.putVol || 0), prem: (r.premCall || 0) + (r.premPut || 0) }));
  const rows = all.filter(r => group === "all" || (group === "watch" ? r.watch : r.group === group));
  const col = COLS.find(c => c.key === sort.key);
  const sorted = [...rows].sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x == null) - (y == null) || (typeof x === "string" ? x.localeCompare(y) : (x - y)) * sort.dir; });
  const ivs = all.map(r => r.iv30).filter(finite).sort((a, b) => a - b);
  const rank = v => (finite(v) && ivs.length > 1 ? ivs.findIndex(x => x >= v) / (ivs.length - 1) : null);
  const soon = r => r.earnings && (Date.parse(r.earnings) - Date.now()) / 864e5 <= 45;
  const steep = [...all].filter(r => finite(r.rr25)).sort((a, b) => b.rr25 - a.rr25).slice(0, 3).map(r => `${r.symbol} ${fx(r.rr25)}`);
  const inv = all.filter(r => finite(r.slope) && r.slope < -1).sort((a, b) => a.slope - b.slope).map(r => r.symbol);
  const inverted = inv.length > 10 ? [...inv.slice(0, 10), `${inv.length - 10} more`] : inv;
  return (
    <VizCard eyebrow={`${all.length} names · Cboe delayed chains · scan ${d.scanBuilt ? dayLabel(d.scanBuilt.slice(0, 10)) + " " + d.scanBuilt.slice(11, 16) + " UTC" : "pending"}`} title="Volatility and skew board"
      right={<Seg label="Group" value={group} onChange={setGroup} options={GROUPS} />}
      finding={`Steepest put skew: ${steep.join(", ") || "—"} vol points.${inverted.length ? ` 30-day volatility above 90-day, most inverted first (an event such as earnings, or stress): ${inverted.join(", ")}.` : " No name has its 30-day volatility above its 90-day."} Click a row to open its implied ranges.`}
      note="Cells keep their numbers; the tint is a guide. IV level shades darker blue by rank across the scan. Elsewhere red marks the stressed side and blue the calm side: price down, IV up, an inverted term, puts dearer than calls and put-heavy trading are red. P/C shades on a log scale around 1. Earnings within 45 days are flagged.">
      <div className="otable-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
        <table className="otable">
          <thead><tr>{COLS.map(c => <th key={c.key} title={c.title} style={{ textAlign: c.key === "symbol" ? "left" : "right" }}>{c.sort ? <button type="button" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>{c.label}{sort.key === c.key ? (sort.dir < 0 ? " ▾" : " ▴") : ""}</button> : c.label}</th>)}</tr></thead>
          <tbody>{sorted.map(r => (
            <tr key={r.symbol} className="oclick" onClick={() => onInspect?.(r.symbol)} title={`Open ${r.symbol}'s implied ranges`}>
              <td style={{ textAlign: "left" }}><strong>{r.symbol}</strong> <span className="onote">{r.label || r.name || ""}</span>{r.watch && <span className="otag" style={{ marginLeft: 4 }}>watch</span>}</td>
              <td style={{ textAlign: "right", background: divBg(finite(r.chgPct) ? -r.chgPct / 3 : null) }}>{signed(r.chgPct, 1, "%")}</td>
              <td style={{ textAlign: "right", background: seqBg(rank(r.iv30)) }}>{fx(r.iv30, 1)}</td>
              <td style={{ textAlign: "right", background: divBg(finite(r.iv30Chg) ? r.iv30Chg / 3 : null) }}>{signed(r.iv30Chg, 1)}</td>
              <td style={{ textAlign: "right", background: divBg(finite(r.slope) ? -r.slope / 5 : null) }}>{signed(r.slope, 1)}</td>
              <td style={{ textAlign: "right", background: divBg(finite(r.rr25) ? r.rr25 / 8 : null) }}>{signed(r.rr25, 1)}</td>
              <td style={{ textAlign: "right", background: divBg(finite(r.pcVol) && r.pcVol > 0 ? Math.log2(r.pcVol) / 1.5 : null) }}>{fx(r.pcVol, 2)}</td>
              <td style={{ textAlign: "right", background: divBg(finite(r.pcOi) && r.pcOi > 0 ? Math.log2(r.pcOi) / 1.5 : null) }}>{fx(r.pcOi, 2)}</td>
              <td style={{ textAlign: "right" }}>{intK(r.vol)}</td>
              <td style={{ textAlign: "right" }}>{usdK(r.prem)}</td>
              <td style={{ textAlign: "right" }}>{r.move ? `±${fx(r.move.pct, 1)}%` : "—"}<span className="onote"> {r.move ? `${r.move.dte}d` : ""}</span></td>
              <td style={{ textAlign: "right" }}>{r.earnings ? <span className={soon(r) ? "otag" : ""} style={soon(r) ? { borderColor: "var(--oc-2)" } : undefined}>{dayLabel(r.earnings)}</span> : "—"}</td>
              <td style={{ textAlign: "left" }}><Spark values={(r.ivTerm || []).filter(p => p.dte >= 7 && p.dte <= 200).map(p => p.iv)} width={80} /></td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </VizCard>
  );
}

function SkewCard({ d }) {
  const rows = d.scan?.rows || [];
  const options = rows.filter(r => r.smile?.points?.length >= 5).map(r => r.symbol);
  const [names, setNames] = useState(["SPY", "QQQ", "IWM"]);
  const shown = names.filter(n => options.includes(n)).slice(0, 3);
  const series = shown.map(s => ({ s, pts: rows.find(r => r.symbol === s).smile.points.filter(p => p.m >= 0.75 && p.m <= 1.2 && finite(p.iv)).map(p => ({ m: p.m, iv: p.iv })) }));
  const at90 = x => { const p = x.pts.reduce((a, b) => (Math.abs(b.m - 0.9) < Math.abs(a.m - 0.9) ? b : a), x.pts[0]); const atm = x.pts.reduce((a, b) => (Math.abs(b.m - 1) < Math.abs(a.m - 1) ? b : a), x.pts[0]); return p && atm ? p.iv - atm.iv : null; };
  const pick = (i, v) => setNames(n => { const c = [...n]; c[i] = v; return c; });
  return (
    <VizCard eyebrow="Implied volatility by strike · nearest ~30-day expiry" title="Skew curves"
      right={<span style={{ display: "flex", gap: 4 }}>{[0, 1, 2].map(i => <select key={i} value={names[i] || ""} onChange={e => pick(i, e.target.value)} aria-label={`Series ${i + 1}`} className="ochip">{options.map(o => <option key={o}>{o}</option>)}</select>)}</span>}
      finding={series.length ? `Puts 10% below the price cost ${series.map(x => `${fx(at90(x), 1)} pts more than at the money for ${x.s}`).join(", ")}. A steeper left side means protection is dearer.` : "Skew curves unavailable."}
      table={<MiniTable columns={[{ key: "s", label: "Name" }, { key: "m", label: "Strike ÷ price", fmt: v => fx(v, 3) }, { key: "iv", label: "IV %", fmt: v => fx(v, 1) }]} rows={series.flatMap(x => x.pts.map(p => ({ s: x.s, ...p })))} />}>
      <Legend items={series.map((x, i) => [x.s, C[i + 1]])} />
      <div className="ochart"><ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="m" type="number" domain={[0.75, 1.2]} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => `${Math.round(v * 100)}%`} allowDuplicatedCategory={false} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={42} />
          <ReferenceLine x={1} stroke="var(--text-muted)" label={{ value: "price", position: "insideTop", fill: "var(--text-muted)", fontSize: 10 }} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={v => `Strike at ${Math.round(v * 100)}% of price`} formatter={(v, n) => [`${fx(v, 1)}%`, n]} />
          {series.map((x, i) => <Line key={x.s} data={x.pts} dataKey="iv" name={x.s} stroke={C[i + 1]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer></div>
    </VizCard>
  );
}

function PremiumCard({ d }) {
  const rows = (d.scan?.rows || []).map(r => ({ s: r.symbol, calls: r.premCall || 0, puts: r.premPut || 0 })).filter(r => r.calls + r.puts > 0).sort((a, b) => b.calls + b.puts - (a.calls + a.puts)).slice(0, 15);
  const tc = rows.reduce((a, r) => a + r.calls, 0), tp = rows.reduce((a, r) => a + r.puts, 0);
  return (
    <VizCard eyebrow="Today · dollar premium (volume × mid × 100)" title="Where the premium traded"
      finding={rows.length ? `Calls took ${Math.round((100 * tc) / (tc + tp || 1))}% of the ${usdK(tc + tp)} traded across these ${rows.length} names; ${rows[0].s} led with ${usdK(rows[0].calls + rows[0].puts)}.` : "No premium data yet."}
      table={<MiniTable columns={[{ key: "s", label: "Name" }, { key: "calls", label: "Calls", fmt: usdK }, { key: "puts", label: "Puts", fmt: usdK }]} rows={rows} />}>
      <Legend items={[["Calls", C[1]], ["Puts", C[2]]]} />
      <div style={{ width: "100%", height: Math.max(180, rows.length * 20 + 30), fontSize: 11 }}><ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, left: 6, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid stroke="var(--border-subtle)" horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={usdK} />
          <YAxis type="category" dataKey="s" tick={axisTick} tickLine={false} axisLine={false} width={44} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [usdK(v), n]} cursor={{ fill: "var(--bg-subtle)" }} />
          <Bar dataKey="calls" name="Calls" stackId="p" fill={C[1]} stroke="var(--card-bg)" strokeWidth={2} isAnimationActive={false} />
          <Bar dataKey="puts" name="Puts" stackId="p" fill={C[2]} stroke="var(--card-bg)" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer></div>
    </VizCard>
  );
}

function UnusualCard({ d, onInspect }) {
  const [only, setOnly] = useState("all"), [zone, setZone] = useState("near");
  // the largest premiums are mostly deep in-the-money, long-dated contracts (rolls, hedges, stock
  // replacement); "near the money" keeps |delta| 0.15-0.60, where a new position is a clearer bet
  const near = u => finite(u.delta) && Math.abs(u.delta) >= 0.15 && Math.abs(u.delta) <= 0.6;
  const base = (d.scan?.unusual || []).filter(u => only === "all" || (d.scan?.rows || []).find(r => r.symbol === u.symbol)?.watch);
  const rows = base.filter(u => zone === "all" || near(u));
  const top = rows[0];
  return (
    <VizCard eyebrow="Volume well above open interest · today's cumulative volume · direction unknown" title="Unusual activity"
      right={<><Seg label="Strikes" value={zone} onChange={setZone} options={[["near", `Near the money (${base.filter(near).length})`], ["all", `Any strike (${base.length})`]]} /><Seg label="Names" value={only} onChange={setOnly} options={[["all", "All scanned"], ["watch", "Watchlist"]]} /></>}
      finding={top ? `Largest: ${top.symbol} ${top.type === "C" ? "calls" : "puts"} at ${fx(top.strike, top.strike < 10 ? 2 : 0)} expiring ${expLabel(top.expiryDate)}, ${intK(top.vol)} contracts against ${intK(top.oi)} open (${fx(top.ratio, 1)}×), ${usdK(top.premium)} of premium.` : "No contract met the unusual-activity rule in this snapshot."}
      note="Rule: at least 500 contracts, volume above 1.5× open interest, at least $100k of premium; near the money means an absolute delta of 0.15 to 0.60. Volume above open interest suggests new positions, but a snapshot cannot tell buyers from sellers: 'last at' only says where the latest trade printed against the current quote.">
      <div className="otable-wrap">
        <MiniTable maxHeight={420} rows={rows} columns={[
          { key: "symbol", label: "Name", fmt: (v, r) => <button type="button" className="ochip" onClick={() => onInspect?.(v)} title={`Open ${v}`}>{v}</button> },
          { key: "type", label: "Contract", fmt: (v, r) => `${r.type === "C" ? "Call" : "Put"} ${fx(r.strike, r.strike < 10 ? 2 : r.strike % 1 ? 1 : 0)} · ${expLabel(r.expiryDate)}` },
          { key: "dte", label: "Days" },
          { key: "m", label: "Strike ÷ price", fmt: v => (finite(v) ? `${Math.round(v * 100)}%` : "—") },
          { key: "vol", label: "Volume", fmt: intK },
          { key: "oi", label: "Open int.", fmt: intK },
          { key: "ratio", label: "Vol ÷ OI", fmt: v => (finite(v) ? `${fx(v, 1)}×` : "new") },
          { key: "premium", label: "Premium", fmt: usdK },
          { key: "iv", label: "IV", fmt: v => (finite(v) ? pctS(v * (v < 5 ? 100 : 1), 0) : "—") },
          { key: "delta", label: "Delta", fmt: v => fx(v, 2) },
          { key: "side", label: "Last at", fmt: v => v || "—" },
        ]} />
      </div>
    </VizCard>
  );
}

export default function MarketView({ onInspect }) {
  const { data: d, error: err } = useOptionsMarket();
  if (!d) return <div className="ocard"><p className="ocard-finding">{err ? `The options market feed is unavailable: ${err}` : "Reading the options market: Cboe volatility indices, put/call statistics and about 50 option chains. The first build takes a minute."}</p></div>;
  return (
    <div>
      <Headline d={d} />
      <Kpis d={d} />
      <div className="ogrid ogrid-2"><TermCard d={d} /><VixCard d={d} /></div>
      <div className="ogrid ogrid-2"><PutCallCard d={d} /><CrossAssetCard d={d} /></div>
      <Board d={d} onInspect={onInspect} />
      <div className="ogrid ogrid-2"><SkewCard d={d} /><PremiumCard d={d} /></div>
      <UnusualCard d={d} onInspect={onInspect} />
      <p className="onote">Sources: Cboe volatility index histories and delayed quotes, Cboe daily market statistics, Cboe delayed option chains (about 15 minutes behind during the session), FMP earnings dates. {d.stale ? "Showing the last saved scan while a new one runs. " : ""}{d.scan?.errors?.length ? `Not scanned: ${d.scan.errors.map(e => e.symbol).join(", ")}.` : ""}</p>
    </div>
  );
}
