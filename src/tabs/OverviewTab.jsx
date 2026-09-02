import React, { useEffect, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis, AreaChart, Area, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { InfoBox } from "../components/shared.jsx";
import FearGreedGauge from "../components/FearGreedGauge.jsx";
import { fetchOptionsChain, fetchFMP } from "../lib/api.js";
import DAMODARAN from "../lib/damodaran.json";
import { EarningsWeekAhead } from "./stocks/ResearchPanels.jsx";
import { chainModel, chainHeadline } from "./AIEconomyTab.jsx";

// ============================================================================
// COCKPIT — "front page" layout (2026-09 revamp, option B)
// The answers first, the evidence one click down:
//   1. Verdict band — five tiles: regime · valuation · sentiment · AI chain ·
//      profits engine. Each is one word + the numbers it came from + a link
//      to the tab that owns it.
//   2. Today (the tape on one shared bar scale + your watchlist's movers) beside
//      Week Ahead (expected range, watchlist earnings, rates).
//   3. Evidence — the full ERP hero, yield curve, earnings yields, Fear & Greed
//      components and the commodities strip, folded into collapsed rows.
// ============================================================================

const fmtPct = (v, dp = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`);
const TONE_COLOR = { success: "#10b981", neutral: "#818cf8", warning: "#f59e0b", danger: "#ef4444" };
// Mirrors StocksTab: the watchlist is shared via this localStorage key.
const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "BRK-B", "JPM", "V"];
function loadTickers() {
  try { const s = localStorage.getItem("econ-dash-tickers"); return s ? JSON.parse(s) : DEFAULT_TICKERS; } catch { return DEFAULT_TICKERS; }
}

// ── Sparkline: tiny line chart, color tracks direction ───────────────────────
function Sparkline({ data, color = "#10b981", height = 24, width = "100%" }) {
  if (!data || data.length < 2) return <div style={{ height, width }} />;
  const series = data.map((v, i) => ({ i, v }));
  const ys = data.filter(v => v != null);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.08 || 0.5;
  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <YAxis hide domain={[minY - pad, maxY + pad]} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Regime: derived from cross-asset moves (equities × VIX × gold × crypto) ──
function computeRegime(indexes, commodities, crypto) {
  const by = s => indexes.find(i => i.symbol === s);
  const spy = by("SPY"), qqq = by("QQQ"), iwm = by("IWM"), dia = by("DIA");
  const vix = indexes.find(i => /VIX/.test(i.symbol || ""));
  const gold = commodities.find(c => c.symbol === "GC=F");
  const oil = commodities.find(c => c.symbol === "CL=F");
  const btc = crypto.find(c => c.symbol === "BTC");
  if (!spy) return null;
  const eqs = [spy, qqq, iwm, dia].filter(Boolean);
  const eqAvg = eqs.reduce((s, i) => s + (i.changePct || 0), 0) / (eqs.length || 1) * 100;
  const vixChg = (vix?.changePct ?? 0) * 100;
  const upCount = eqs.filter(i => (i.changePct || 0) > 0).length;
  const sorted = [...eqs].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  const leader = sorted[0], laggard = sorted[sorted.length - 1];

  let regime, color, note;
  if (eqAvg <= -0.8 && vixChg > 5) { regime = "Risk-Off"; color = "#f87171"; note = `broad selloff (${upCount}/${eqs.length} up) with a vol bid`; }
  else if (eqAvg >= 0.8 && vixChg < 0) { regime = "Risk-On"; color = "#4ade80"; note = `broad advance (${upCount}/${eqs.length} up), vol offered`; }
  else if (Math.abs(eqAvg) < 0.25) { regime = "Quiet Tape"; color = "#818cf8"; note = "indexes little changed"; }
  else { regime = "Mixed Tape"; color = "#fbbf24"; note = `${leader.symbol} leads, ${laggard.symbol} lags — rotation, not direction`; }
  if (eqAvg < -0.5 && (gold?.changePct ?? 0) > 0.3) note += " · safe-haven bid in gold";
  if (eqAvg < -0.5 && (btc?.changePct ?? -1) > 0.5) note += " · crypto shrugging it off";

  const spyChg = (spy.changePct || 0) * 100;
  const rows = [
    { label: "S&P (SPY)", chg: spyChg },
    qqq && { label: "Nasdaq (QQQ)", chg: qqq.changePct * 100 },
    iwm && { label: "Russell (IWM)", chg: iwm.changePct * 100 },
    dia && { label: "Dow (DIA)", chg: dia.changePct * 100 },
    vix && { label: `VIX ${vix.price?.toFixed(1)}`, chg: vixChg, invert: true },
    gold && { label: "Gold", chg: gold.changePct * 100 },
    oil && { label: "Oil (WTI)", chg: oil.changePct * 100 },
    btc && { label: "Bitcoin", chg: btc.changePct * 100 },
  ].filter(Boolean);
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.chg)));
  return { regime, color, note, spy, spyChg, vixChg, upCount, n: eqs.length, rows, maxAbs };
}

// One diverging bar on a shared scale — length is the size of the move.
function BarRow({ label, chg, invert, maxAbs }) {
  const up = chg >= 0;
  const good = invert ? !up : up;
  const c = good ? "#4ade80" : "#f87171";
  const w = Math.min(50, (Math.abs(chg) / maxAbs) * 50);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 96, fontSize: 10.5, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, position: "relative", height: 14 }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.14)" }} />
        <div style={{ position: "absolute", top: 2, bottom: 2, borderRadius: 3, background: c, opacity: 0.85, left: up ? "50%" : `${50 - w}%`, width: `${w}%` }} />
      </div>
      <span style={{ width: 58, fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color: c, flexShrink: 0, textAlign: "right" }}>{fmtPct(chg)}</span>
    </div>
  );
}

// ── Compact rate row (evidence: rates section) ──────────────────────────────
function RateRow({ rate }) {
  const val = rate.value;
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{rate.name}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, lineHeight: 1.15 }}>
          {val != null ? (rate.unit === "bp" ? `${val.toFixed(0)} bp` : `${val.toFixed(2)}%`) : "—"}
        </div>
        {rate.change != null && (
          <div style={{ fontSize: 9, color: rate.change >= 0 ? "#10b981" : "#f87171", fontFamily: fonts.mono, marginTop: 1 }}>
            {rate.change >= 0 ? "+" : ""}{(rate.change * 100).toFixed(0)} bp · ~1mo
          </div>
        )}
      </div>
      <div style={{ flex: 1, maxWidth: 80, minWidth: 50 }}>
        {rate.spark && rate.spark.length > 1 && (
          <Sparkline data={rate.spark} color={rate.change == null ? "#818cf8" : rate.change >= 0 ? "#10b981" : "#f87171"} height={32} />
        )}
      </div>
    </div>
  );
}

function EarningsYieldRow({ index }) {
  const chg = index.changePct;
  const chgColor = chg > 0 ? "#10b981" : chg < 0 ? "#f87171" : "#64748b";
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>
          {index.flag} {index.name}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: index.earningsYield != null ? "#4ade80" : "var(--text-muted)", fontFamily: fonts.heading, letterSpacing: -0.3, lineHeight: 1.15 }}>
          {index.earningsYield != null ? `${index.earningsYield.toFixed(2)}%` : "—"}
        </div>
        {index.earningsYield != null && (
          <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 4, overflow: "hidden", maxWidth: 110 }}>
            <div style={{ width: `${Math.min(100, (index.earningsYield / 10) * 100)}%`, height: "100%", background: "#4ade80", borderRadius: 2, opacity: 0.8 }} />
          </div>
        )}
        <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 3 }}>
          {index.pe != null ? `P/E ${index.pe.toFixed(1)}` : "P/E unavailable"}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {chg != null && (
          <div style={{ fontSize: 10, fontWeight: 600, color: chgColor, fontFamily: fonts.mono }}>
            {chg > 0 ? "+" : ""}{(chg * 100).toFixed(2)}%
          </div>
        )}
        {index.price != null && (
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>
            ${index.price.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtTimeAgo(ts) {
  if (!ts) return "";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

// ── Implied move: ±1σ expected range from ATM IV, as rows with an ETF toggle ─
// Same math as the Options page tiles, computed from the CBOE options chain.
const IMOVE_ETFS = [
  { sym: "SPY", label: "S&P 500" },
  { sym: "QQQ", label: "Nasdaq 100" },
  { sym: "IWM", label: "Russell 2000" },
];

function ImpliedMoveRows() {
  const [sel, setSel] = useState("SPY");
  const [chain, setChain] = useState({}); // cache keyed by symbol
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (chain[sel]) return; // already fetched
    let cancelled = false;
    setLoading(true); setErr(false);
    fetchOptionsChain(sel)
      .then(d => { if (!cancelled) setChain(c => ({ ...c, [sel]: d })); })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const moves = useMemo(() => {
    const d = chain[sel];
    if (!d || !d.options?.length || !d.spot) return [];
    const spot = d.spot;
    const byDte = {};
    d.options.filter(o => o.type === "C").forEach(o => {
      if (!byDte[o.dte] || Math.abs(o.strike - spot) < Math.abs(byDte[o.dte].strike - spot)) byDte[o.dte] = o;
    });
    const ts = Object.values(byDte).map(o => ({ dte: o.dte, iv: o.iv * 100 })).filter(t => t.iv != null).sort((a, b) => a.dte - b.dte);
    if (!ts.length) return [];
    const targets = [{ label: "1 day", dte: 1 }, { label: "1 week", dte: 7 }, { label: "1 month", dte: 30 }, { label: "3 months", dte: 90 }];
    return targets.map(t => {
      let best = null, minDiff = Infinity;
      for (const x of ts) { const diff = Math.abs(x.dte - t.dte); if (diff < minDiff) { minDiff = diff; best = x; } }
      if (!best || best.iv == null) return null;
      const sigma = spot * (best.iv / 100) * Math.sqrt(t.dte / 365);
      return { label: t.label, iv: best.iv, expectedMove: sigma, pctMove: (sigma / spot) * 100, upper: spot + sigma, lower: spot - sigma };
    }).filter(Boolean);
  }, [chain, sel]);

  const chipStyle = active => ({
    padding: "2px 8px", borderRadius: 6, border: `1px solid ${active ? "#818cf8" : "rgba(255,255,255,0.1)"}`,
    background: active ? "#818cf8" : "rgba(255,255,255,0.05)", color: active ? "#0f172a" : "#94a3b8",
    fontSize: 9.5, fontWeight: 600, fontFamily: fonts.mono, cursor: "pointer",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono }}>{sel} expected range (±1σ from ATM IV)</span>
        <div style={{ display: "flex", gap: 4 }}>
          {IMOVE_ETFS.map(e => <button key={e.sym} onClick={() => setSel(e.sym)} style={chipStyle(sel === e.sym)} title={e.label}>{e.sym}</button>)}
        </div>
      </div>
      {loading && !chain[sel] ? (
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, padding: "8px 0" }}>Loading {sel} options chain…</div>
      ) : err || !moves.length ? (
        <div style={{ fontSize: 10, color: "#f59e0b", fontFamily: fonts.mono, padding: "8px 0" }}>Implied-move data unavailable for {sel} right now (options feed may be rate-limited).</div>
      ) : moves.map(im => (
        <div key={im.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>{im.label} <span style={{ color: "#475569" }}>· {im.iv.toFixed(0)}% IV</span></span>
          <span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>±${im.expectedMove.toFixed(2)}</span>
            <span style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono, marginLeft: 8 }}>±{im.pctMove.toFixed(2)}% · ${im.lower.toFixed(0)}–${im.upper.toFixed(0)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Damodaran implied ERP (FCFE) — the PROPER risk premium ──────────────────
// Annual series 1960→ from src/lib/damodaran.json (refresh script, January).
function damodaranSummary() {
  const series = (DAMODARAN.erp || []).filter(r => r.erp != null);
  if (series.length < 20) return null;
  const last = series[series.length - 1];
  const vals = series.map(r => r.erp);
  const pct = Math.round((vals.filter(v => v < last.erp).length / vals.length) * 100);
  const color = pct >= 70 ? "#4ade80" : pct >= 30 ? "#fbbf24" : "#f87171";
  return { series, last, pct, color };
}

function DamodaranErpStrip() {
  const d = damodaranSummary();
  if (!d) return null;
  const { series, last, pct, color: dColor } = d;
  const spark = series.map(r => ({ i: r.y, v: +(r.erp * 100).toFixed(2) }));
  const ys = spark.map(p => p.v);
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>
          Damodaran Implied ERP (FCFE) · end-{last.y}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: dColor, fontFamily: fonts.heading, lineHeight: 1 }}>{(last.erp * 100).toFixed(2)}%</span>
          <span style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono }}>
            {pct}th pctile since {series[0].y} · vs 10Y {(last.tbond * 100).toFixed(2)}%
          </span>
        </div>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.5, maxWidth: 520 }}>
          The forward-looking premium (expected cash flows vs today&apos;s index) — the measure Damodaran argues for. It differs from the simple gap above because that gap ignores buybacks and growth; when the two diverge hard, growth expectations are carrying the market.
        </div>
      </div>
      <div style={{ flex: "1 1 220px", minWidth: 180, height: 56 }}>
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="derp-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={dColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={dColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[Math.min(...ys) - 0.3, Math.max(...ys) + 0.3]} />
            <Area type="monotone" dataKey="v" stroke={dColor} fill="url(#derp-grad)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, textAlign: "right", marginTop: -2 }}>{series[0].y}–{last.y} annual · source: Damodaran (updated {DAMODARAN.asOf})</div>
      </div>
    </div>
  );
}

// ── Equity Risk Premium hero (evidence row) ─────────────────────────────────
function ErpHero({ erp }) {
  if (!erp || erp.currentErp == null) return null;
  const color = TONE_COLOR[erp.tone] || "#818cf8";
  const pctile = erp.percentile;
  const spark = (erp.history || []).map(h => ({ i: h.d, v: h.v }));
  const ys = spark.map(p => p.v);
  const minY = ys.length ? Math.min(...ys) : -2, maxY = ys.length ? Math.max(...ys) : 5;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: color }} />
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>
            Equity Risk Premium · S&amp;P 500 vs 10Y
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 32, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -1, lineHeight: 1 }}>
              {erp.currentErp > 0 ? "+" : ""}{erp.currentErp.toFixed(2)}pp
            </span>
            {erp.verdict && (
              <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}1e`, padding: "3px 9px", borderRadius: 6, fontFamily: fonts.mono }}>
                {erp.verdict}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>
            Earnings yield {erp.earningsYield != null ? `${erp.earningsYield.toFixed(2)}%` : "—"} − 10Y treasury {erp.tenYear != null ? `${erp.tenYear.toFixed(2)}%` : "—"}
            {pctile != null && <> · <span style={{ color }}>{pctile}th percentile</span> of 25 yrs</>}
          </div>
        </div>
        {spark.length > 4 && (
          <div style={{ flex: "1 1 220px", minWidth: 180, height: 62 }}>
            <ResponsiveContainer width="100%" height={62}>
              <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="erp-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[Math.min(minY, 0) - 0.3, maxY + 0.3]} />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.6} />
                <Area type="monotone" dataKey="v" stroke={color} fill="url(#erp-grad)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, textAlign: "right", marginTop: -2 }}>25-yr history · dashed = 0 (stocks = bonds)</div>
          </div>
        )}
      </div>
      <DamodaranErpStrip />
    </div>
  );
}

// ── Yield curve mini-viz from the rates the summary already provides ─────────
function YieldCurve({ rates }) {
  const pick = id => rates.find(r => r.id === id)?.value;
  const pts = [
    { label: "Fed", val: pick("DFF") },
    { label: "2Y",  val: pick("DGS2") },
    { label: "10Y", val: pick("DGS10") },
    { label: "30Y", val: pick("DGS30") },
  ].filter(p => p.val != null);
  const spread = rates.find(r => r.id === "spread2s10s")?.value;
  if (pts.length < 2) return null;

  const W = 220, H = 78, padX = 24, padT = 10, padB = 22;
  const vals = pts.map(p => p.val);
  const lo = Math.min(...vals), hi = Math.max(...vals), range = (hi - lo) || 1;
  const x = i => padX + (i / (pts.length - 1)) * (W - padX * 2);
  const y = v => padT + (1 - (v - lo) / range) * (H - padT - padB);
  const line = pts.map((p, i) => `${x(i)},${y(p.val)}`).join(" ");
  const inverted = spread != null && spread < 0;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Yield Curve</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <polyline points={line} fill="none" stroke="#818cf8" strokeWidth="1.6" />
        {pts.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.val)} r="2.6" fill="#818cf8" />
            <text x={x(i)} y={H - 8} fontSize="8" fill="#64748b" textAnchor="middle" fontFamily="monospace">{p.label}</text>
            <text x={x(i)} y={y(p.val) - 6} fontSize="8" fill="#94a3b8" textAnchor="middle" fontFamily="monospace">{p.val.toFixed(2)}</text>
          </g>
        ))}
      </svg>
      {spread != null && (
        <div style={{ fontSize: 11, color: inverted ? "#f87171" : "#4ade80", fontFamily: fonts.mono, marginTop: 2 }}>
          2s10s {spread >= 0 ? "+" : ""}{spread.toFixed(0)} bp · {inverted ? "inverted — recession signal" : "un-inverted"}
        </div>
      )}
    </div>
  );
}

// ── Verdict tile: one word, the numbers it came from, a link to its owner ────
function VerdictTile({ label, verdict, color, why, dest, onOpen }) {
  return (
    <div onClick={onOpen} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden", cursor: onOpen ? "pointer" : "default", minWidth: 0 }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: color }} />
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.4, marginTop: 4, lineHeight: 1.1 }}>{verdict}</div>
      <div style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.45, minHeight: 28 }}>{why}</div>
      {dest && <div style={{ fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, marginTop: 6 }}>{dest} →</div>}
    </div>
  );
}

// ── Evidence row: collapsed by default, the summary value stays visible ──────
function Evidence({ title, summary, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={onToggle} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading }}>
          <span style={{ color: "#818cf8", marginRight: 8 }}>{open ? "▾" : "▸"}</span>{title}
        </span>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: "right" }}>{summary}</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

const cardTitle = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };

function OverviewTab({ fmpKey, onNavigate, onTicker }) {
  const [data, setData] = useState(null);
  const [indexYields, setIndexYields] = useState([]);
  const [erp, setErp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0); // for re-rendering "X min ago" timestamp
  // Verdict sources — each loads independently so the page fills in progressively
  const [fg, setFg] = useState(null);
  const [kalecki, setKalecki] = useState(null);
  const [chain, setChain] = useState({ or: null, ornn: null, semi: null, mem: null });
  const [quotes, setQuotes] = useState(null);
  const [openEv, setOpenEv] = useState({});
  const tickers = useMemo(loadTickers, []);

  const load = (force = false) => {
    setLoading(true);
    Promise.all([
      fetch(`/api/dashboard-summary${force ? "?refresh=1" : ""}`).then(r => {
        if (!r.ok) throw new Error("Dashboard summary unavailable");
        return r.json();
      }),
      fetch(`/api/index-pe${force ? "?refresh=1" : ""}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
      fetch(`/api/erp${force ? "?refresh=1" : ""}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ])
      .then(([summary, yields, erpData]) => {
        setData(summary);
        if (Array.isArray(yields)) setIndexYields(yields);
        if (erpData && !erpData.error) setErp(erpData);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load(false);
    const refresh = setInterval(() => load(false), 60 * 1000);
    return () => clearInterval(refresh);
  }, []);

  // Verdict feeds: all server-cached, fetched once per visit (not on the 60s loop)
  useEffect(() => {
    const setC = k => d => setChain(c => ({ ...c, [k]: d }));
    fetch("/api/fear-greed").then(r => r.json()).then(d => { if (!d.error) setFg(d); }).catch(() => {});
    fetch("/api/kalecki").then(r => r.json()).then(d => { if (!d.error) setKalecki(d); }).catch(() => {});
    fetch("/api/or-rankings-history").then(r => r.json()).then(setC("or")).catch(() => {});
    fetch("/api/ornn").then(r => r.json()).then(d => { if (!d.error) setC("ornn")(d); }).catch(() => {});
    fetch("/api/semi-h100").then(r => r.json()).then(d => { if (!d.error) setC("semi")(d); }).catch(() => {});
    fetch("/api/memory").then(r => r.json()).then(d => { if (!d.error) setC("mem")(d); }).catch(() => {});
  }, []);

  // Watchlist day moves: one FMP quote per ticker, once per visit
  useEffect(() => {
    if (!fmpKey || !tickers.length) return;
    let alive = true;
    Promise.all(tickers.map(t =>
      fetchFMP(`/quote?symbol=${t}`, fmpKey).then(d => (Array.isArray(d) && d.length ? d[0] : null)).catch(() => null)
    )).then(qs => { if (alive) setQuotes(qs.filter(Boolean)); });
    return () => { alive = false; };
  }, [fmpKey, tickers]);

  // Re-render every 30s so the "X min ago" label stays current
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const regime = useMemo(() => data ? computeRegime(data.indexes || [], data.commodities || [], data.crypto || []) : null, [data]);
  const chainC = useMemo(() => chainModel(chain.or, chain.ornn, chain.semi, chain.mem), [chain]);
  const chainH = useMemo(() => chainHeadline(chainC), [chainC]);
  const dam = useMemo(damodaranSummary, []);
  const movers = useMemo(() => {
    const rows = (quotes || []).map(q => ({ sym: q.symbol, chg: q.changePercentage ?? q.changesPercentage ?? null })).filter(r => r.chg != null);
    return {
      up: rows.filter(r => r.chg > 0).sort((a, b) => b.chg - a.chg).slice(0, 3),
      down: rows.filter(r => r.chg < 0).sort((a, b) => a.chg - b.chg).slice(0, 3),
      n: rows.length, nUp: rows.filter(r => r.chg > 0).length,
    };
  }, [quotes]);

  if (loading && !data) {
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading market snapshot…</div>;
  }
  if (error || !data) {
    return <InfoBox color="#F97316">Unable to load market snapshot. Try refresh, or check that the dev server is running.</InfoBox>;
  }

  const { commodities = [], crypto = [], rates = [] } = data;
  const tape = [...commodities.map(c => ({ ...c, kind: "commodity" })), ...crypto.map(c => ({ ...c, kind: "crypto" }))];
  const rateVal = id => rates.find(r => r.id === id)?.value;
  const spread = rateVal("spread2s10s");
  const toggle = k => setOpenEv(o => ({ ...o, [k]: !o[k] }));

  // Sentiment zone (same thresholds as the gauge)
  const fgScore = fg?.composite ?? null;
  const fgLabel = fgScore == null ? "—" : fgScore < 25 ? "Extreme Fear" : fgScore < 45 ? "Fear" : fgScore < 55 ? "Neutral" : fgScore < 75 ? "Greed" : "Extreme Greed";
  const fgColor = fgScore == null ? "#64748b" : fgScore < 45 ? "#f87171" : fgScore < 55 ? "#fbbf24" : "#4ade80";
  const comp = k => { const v = fg?.components?.[k]; return v == null ? null : Math.round(typeof v === "number" ? v : v.score); };

  // Profits engine (Kalecki-Levy) — short form of the tab's verdict
  const kv = kalecki?.verdict;
  const kLatest = kalecki?.latest;
  const fiscalDriven = kLatest ? kLatest.gov > kLatest.inv : null;
  const erpColor = erp ? (TONE_COLOR[erp.tone] || "#818cf8") : "#64748b";

  const strip = v => v == null ? "—" : `${v.toFixed(2)}%`;
  const tapeSummary = tape.slice(0, 3).map(t => `${t.name} ${t.changePct != null ? fmtPct(t.changePct * 100, 1) : "—"}`).join(" · ");

  return (<>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>Cockpit</span>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>The answers first — the evidence one click down.</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
          Updated {fmtTimeAgo(data.asOf)}<span style={{ display: "none" }}>{tick}</span>
        </span>
        <button onClick={() => load(true)} title="Re-pull the market snapshot" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "4px 9px", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-secondary)", cursor: "pointer" }}>↻</button>
      </div>
    </div>

    {/* 1 · VERDICT BAND */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
      <VerdictTile label="Regime" verdict={regime?.regime ?? "—"} color={regime?.color ?? "#64748b"}
        why={regime ? `SPY ${fmtPct(regime.spyChg)} · ${regime.upCount}/${regime.n} indexes up · VIX ${fmtPct(regime.vixChg, 1)}` : "waiting for the tape"} />
      <VerdictTile label="Valuation" verdict={erp?.verdict ?? "…"} color={erpColor}
        why={erp ? `ERP ${erp.currentErp > 0 ? "+" : ""}${erp.currentErp.toFixed(2)}pp · ${erp.percentile}th pct of 25 yrs${dam ? ` · Damodaran ${(dam.last.erp * 100).toFixed(2)}%` : ""}` : "loading equity risk premium"}
        dest="Stocks" onOpen={() => onNavigate?.("stocks")} />
      <VerdictTile label="Sentiment" verdict={fgScore != null ? `${fgLabel} · ${Math.round(fgScore)}` : "…"} color={fgColor}
        why={fg ? `vol ${comp("vix") ?? "—"} · momentum ${comp("momentum") ?? "—"} · junk demand ${comp("junkBond") ?? "—"} · breadth ${comp("breadth") ?? "—"}` : "loading Fear & Greed"}
        dest="Components" onOpen={() => setOpenEv(o => ({ ...o, fg: true }))} />
      <VerdictTile label="AI Chain" verdict={chainH.label} color={chainH.color}
        why={chainH.why || "loading token demand, H100 and memory feeds"} dest="AI Economy" onOpen={() => onNavigate?.("ai")} />
      <VerdictTile label="Profits Engine" verdict={kv ? kv.label.split(" — ")[0] : "…"} color={kv?.color ?? "#64748b"}
        why={kLatest ? `${kLatest.actual.toFixed(1)}% of GDP · p${kalecki.pct} · ${fiscalDriven ? "deficit is the largest engine" : "investment is the largest engine"}` : "loading Kalecki-Levy identity"}
        dest="U.S. Economy" onOpen={() => onNavigate?.("economy")} />
    </div>

    {/* 2 · TODAY + WEEK AHEAD */}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.15fr) minmax(280px, 1fr)", gap: 12, marginBottom: 18, alignItems: "start" }}>
      {/* Today: the tape on one shared scale + the watchlist's movers */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={cardTitle}>Today</span>
          {regime && <span style={{ fontSize: 10, fontWeight: 700, color: regime.color, background: `${regime.color}1e`, padding: "2px 9px", borderRadius: 6, fontFamily: fonts.mono }}>{regime.regime}</span>}
        </div>
        {regime ? (<>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
            {regime.rows.map(r => <BarRow key={r.label} label={r.label} chg={r.chg} invert={r.invert} maxAbs={regime.maxAbs} />)}
          </div>
          <div style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>
            {regime.note} · <span style={{ color: "#475569" }}>bars share one scale — length is the size of the move · VIX colored inverted</span>
          </div>
        </>) : <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 8 }}>Tape unavailable.</div>}

        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={cardTitle}>Watchlist movers</span>
            <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>
              {quotes ? `${movers.nUp} of ${movers.n} up · shared with Stocks & Options` : fmpKey ? "loading quotes…" : "add an FMP key to see quotes"}
            </span>
          </div>
          {quotes && movers.n > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 6 }}>
              {[["Up", movers.up, "#4ade80"], ["Down", movers.down, "#f87171"]].map(([hdr, list, c]) => (
                <div key={hdr}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: c, fontFamily: fonts.mono }}>{hdr}</div>
                  {list.length ? list.map(r => (
                    <button key={r.sym} onClick={() => onTicker?.(r.sym)} title={`Open ${r.sym} in Stocks`} style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "3px 0", background: "none", border: "none", cursor: "pointer", fontFamily: fonts.mono }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{r.sym}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{fmtPct(r.chg)}</span>
                    </button>
                  )) : <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, padding: "3px 0" }}>none</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Week ahead: what's priced, what's scheduled, what money costs */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
        <span style={cardTitle}>Week ahead</span>
        <div style={{ marginTop: 8 }}><ImpliedMoveRows /></div>
        <div style={{ marginTop: 12 }}>
          <EarningsWeekAhead tickers={tickers} fmpKey={fmpKey} />
        </div>
        <div style={{ paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={cardTitle}>Rates</span>
          <div style={{ display: "flex", gap: 16, marginTop: 5, flexWrap: "wrap" }}>
            {[["Fed", "DFF"], ["2Y", "DGS2"], ["10Y", "DGS10"], ["30Y mtg", "MORTGAGE30US"]].map(([l, id]) => (
              <div key={id}>
                <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{strip(rateVal(id))}</div>
              </div>
            ))}
          </div>
          {spread != null && (
            <div style={{ fontSize: 10, color: spread < 0 ? "#f87171" : "#4ade80", fontFamily: fonts.mono, marginTop: 4 }}>
              2s10s {spread >= 0 ? "+" : ""}{spread.toFixed(0)} bp · {spread < 0 ? "inverted — recession signal" : "un-inverted"}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* 3 · EVIDENCE — folded */}
    <div style={{ ...cardTitle, marginBottom: 8 }}>Show the evidence</div>
    <Evidence title="Equity risk premium — 25-yr history + Damodaran implied" open={!!openEv.erp} onToggle={() => toggle("erp")}
      summary={erp ? `${erp.currentErp > 0 ? "+" : ""}${erp.currentErp.toFixed(2)}pp${dam ? ` · ${(dam.last.erp * 100).toFixed(2)}%` : ""}` : "—"}>
      {erp ? <ErpHero erp={erp} /> : <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading equity risk premium…</div>}
    </Evidence>
    <Evidence title="Yield curve & rates" open={!!openEv.rates} onToggle={() => toggle("rates")}
      summary={`Fed ${strip(rateVal("DFF"))} → 10Y ${strip(rateVal("DGS10"))} → 30Y ${strip(rateVal("DGS30"))}`}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1.4fr)", gap: 14, alignItems: "start" }}>
        <YieldCurve rates={rates} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {rates.filter(r => ["DFF", "DGS10", "MORTGAGE30US", "DGS2"].includes(r.id)).map(r => <RateRow key={r.id} rate={r} />)}
        </div>
      </div>
    </Evidence>
    <Evidence title="Earnings yield by index" open={!!openEv.ey} onToggle={() => toggle("ey")}
      summary={indexYields.filter(i => i.earningsYield != null).map(i => `${i.symbol} ${i.earningsYield.toFixed(2)}%`).join(" · ") || "—"}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {indexYields.map(index => <EarningsYieldRow key={index.symbol} index={index} />)}
      </div>
      <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 6 }}>bars on a shared 0–10% scale — longer = cheaper</div>
    </Evidence>
    <Evidence title="Fear & Greed components" open={!!openEv.fg} onToggle={() => toggle("fg")}
      summary={fgScore != null ? `${Math.round(fgScore)} · ${fgLabel}` : "—"}>
      <FearGreedGauge />
    </Evidence>
    <Evidence title="Commodities & crypto" open={!!openEv.cm} onToggle={() => toggle("cm")} summary={tapeSummary || "—"}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "6px 4px", display: "flex", flexWrap: "wrap" }}>
        {tape.map(item => {
          const up = item.changePct != null && item.changePct >= 0;
          const c = up ? "#4ade80" : "#f87171";
          const px = item.kind === "crypto" && item.price >= 1000 ? `${(item.price / 1000).toFixed(1)}k`
            : item.price >= 1000 ? item.price.toFixed(0) : item.price?.toFixed(2);
          return (
            <div key={item.symbol} style={{ padding: "6px 12px", borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", minWidth: 92 }}>
              <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4 }}>{item.name}</span>
              <span style={{ fontSize: 12, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: 600 }}>
                {px} <span style={{ color: c, fontWeight: 600 }}>{item.changePct != null ? `${up ? "+" : ""}${(item.changePct * 100).toFixed(1)}%` : ""}</span>
              </span>
            </div>
          );
        })}
      </div>
    </Evidence>
  </>);
}

export default OverviewTab;
