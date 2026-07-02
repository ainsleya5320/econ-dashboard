import React, { useEffect, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis, AreaChart, Area, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import FearGreedGauge from "../components/FearGreedGauge.jsx";
import { fetchOptionsChain } from "../lib/api.js";

// ── Sparkline: tiny line chart, 60×24px, color tracks direction ──────────────
function Sparkline({ data, color = "#10b981", height = 24, width = "100%" }) {
  if (!data || data.length < 2) return <div style={{ height, width }} />;
  const series = data.map((v, i) => ({ i, v }));
  // Y-axis tightly bounded to data so even tiny moves are visible
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

// ── Filled-area variant for hero tiles (S&P, BTC, etc.) ─────────────────────
function HeroSparkArea({ data, color = "#10b981", height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }} />;
  const series = data.map((v, i) => ({ i, v }));
  const ys = data.filter(v => v != null);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.08 || 0.5;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`g-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[minY - pad, maxY + pad]} />
        <Area type="monotone" dataKey="v" stroke={color} fill={`url(#g-${color.replace("#", "")})`} strokeWidth={1.6} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Hero tile (large, used for major indexes) ───────────────────────────────
function HeroTile({ item, fmt = "stock" }) {
  const chg = item.changePct;
  const up = chg != null && chg >= 0;
  const color = up ? "#10b981" : "#f87171";
  const fmtPrice = v => {
    if (v == null) return "—";
    if (fmt === "stock")     return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (fmt === "crypto")    return v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
    if (fmt === "commodity") return `$${v.toFixed(2)}`;
    if (fmt === "vix")       return v.toFixed(2);
    return String(v);
  };
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", position: "relative", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{item.symbol}</span>
        <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{item.name}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{fmtPrice(item.price)}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: fonts.mono }}>
          {chg != null ? `${up ? "+" : ""}${(chg * 100).toFixed(2)}%` : "—"}
        </span>
      </div>
      <div style={{ height: 40, marginTop: 6 }}>
        <HeroSparkArea data={item.spark} color={color} height={40} />
      </div>
    </div>
  );
}

// ── Compact rate row (interest rates section) ───────────────────────────────
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
        <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 1 }}>
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

// ── Implied Move panel: ±1σ expected range from ATM IV, with ETF toggle ──────
// Same tiles as the Options page, computed from the CBOE options chain.
const IMOVE_ETFS = [
  { sym: "SPY", label: "S&P 500" },
  { sym: "QQQ", label: "Nasdaq 100" },
  { sym: "IWM", label: "Russell 2000" },
];

function ImpliedMovePanel() {
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

  const { moves, spot } = useMemo(() => {
    const d = chain[sel];
    if (!d || !d.options?.length || !d.spot) return { moves: [], spot: null };
    const spot = d.spot;
    // Term structure: ATM-call IV per expiration
    const byDte = {};
    d.options.filter(o => o.type === "C").forEach(o => {
      if (!byDte[o.dte] || Math.abs(o.strike - spot) < Math.abs(byDte[o.dte].strike - spot)) byDte[o.dte] = o;
    });
    const ts = Object.values(byDte)
      .map(o => ({ dte: o.dte, iv: o.iv * 100 }))
      .filter(t => t.iv != null)
      .sort((a, b) => a.dte - b.dte);
    if (!ts.length) return { moves: [], spot };
    const targets = [
      { label: "1 Day",    dte: 1  },
      { label: "1 Week",   dte: 7  },
      { label: "1 Month",  dte: 30 },
      { label: "3 Months", dte: 90 },
    ];
    const moves = targets.map(t => {
      let best = null, minDiff = Infinity;
      for (const x of ts) { const diff = Math.abs(x.dte - t.dte); if (diff < minDiff) { minDiff = diff; best = x; } }
      if (!best || best.iv == null) return null;
      const iv = best.iv / 100;
      const sigma = spot * iv * Math.sqrt(t.dte / 365);
      return { label: t.label, actualDte: best.dte, iv: best.iv, expectedMove: sigma, pctMove: (sigma / spot) * 100, upper: spot + sigma, lower: spot - sigma };
    }).filter(Boolean);
    return { moves, spot };
  }, [chain, sel]);

  const btn = active => ({
    padding: "5px 12px", borderRadius: 7, border: `1px solid ${active ? "#818cf8" : "rgba(255,255,255,0.1)"}`,
    background: active ? "#818cf8" : "rgba(255,255,255,0.05)", color: active ? "#0f172a" : "#94a3b8",
    fontSize: 11, fontWeight: 600, fontFamily: fonts.heading, cursor: "pointer",
  });

  return (<>
    {/* Header row with ETF toggle */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, margin: "28px 0 14px", paddingBottom: 7, borderBottom: "1px solid var(--border-subtle)" }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3 }}>
        Implied Move — Market's Expected Range (±1σ from ATM IV)
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        {IMOVE_ETFS.map(e => (
          <button key={e.sym} onClick={() => setSel(e.sym)} style={btn(sel === e.sym)}>{e.sym} · {e.label}</button>
        ))}
      </div>
    </div>

    {loading && !chain[sel] ? (
      <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading {sel} options chain…</div>
    ) : err || !moves.length ? (
      <InfoBox color="#F97316">Implied-move data unavailable for {sel} right now (options feed may be rate-limited). Try another ETF or refresh.</InfoBox>
    ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 18 }}>
        {moves.map(im => (
          <div key={im.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#818cf8", borderRadius: "14px 14px 0 0" }} />
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
              {im.label} <span style={{ color: "#475569" }}>· {im.actualDte}d @ {im.iv.toFixed(0)}% IV</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading, lineHeight: 1.1 }}>
              ±${im.expectedMove.toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 3 }}>
              ±{im.pctMove.toFixed(2)}% · ${im.lower.toFixed(2)}–${im.upper.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    )}
  </>);
}

// ── Equity Risk Premium hero — the fundamentalist's headline number ──────────
const TONE_COLOR = { success: "#10b981", neutral: "#818cf8", warning: "#f59e0b", danger: "#ef4444" };

function ErpHero({ erp }) {
  if (!erp || erp.currentErp == null) return null;
  const color = TONE_COLOR[erp.tone] || "#818cf8";
  const pctile = erp.percentile;
  const spark = (erp.history || []).map(h => ({ i: h.d, v: h.v }));
  const ys = spark.map(p => p.v);
  const minY = ys.length ? Math.min(...ys) : -2, maxY = ys.length ? Math.max(...ys) : 5;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 20px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
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

function OverviewTab() {
  const [data, setData] = useState(null);
  const [indexYields, setIndexYields] = useState([]);
  const [erp, setErp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0); // for re-rendering "X min ago" timestamp

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

  // Re-render every 30s so the "X min ago" label stays current
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) {
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading market snapshot…</div>;
  }
  if (error || !data) {
    return <InfoBox color="#F97316">Unable to load market snapshot. Try refresh, or check that the dev server is running.</InfoBox>;
  }

  const { indexes = [], commodities = [], crypto = [], rates = [] } = data;

  // Compact tape row for demoted commodities + crypto
  const tape = [...commodities.map(c => ({ ...c, kind: "commodity" })), ...crypto.map(c => ({ ...c, kind: "crypto" }))];

  return (<>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>Cockpit</div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>
          What am I paid to own stocks today — and what's the setup underneath.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
          Updated {fmtTimeAgo(data.asOf)}<span style={{ display: "none" }}>{tick}</span>
        </span>
        <button onClick={() => load(true)} style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "5px 12px", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-secondary)", cursor: "pointer" }}>↻ Refresh</button>
      </div>
    </div>

    {/* 1 · THE HERO — Equity Risk Premium */}
    {erp ? <ErpHero erp={erp} /> : (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 14, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading equity risk premium…</div>
    )}

    {/* 2 · VALUATION — earnings yield across the major indexes */}
    <SH>Valuation — Earnings Yield by Index</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
      {indexYields.map(index => <EarningsYieldRow key={index.symbol} index={index} />)}
    </div>

    {/* 3 · RATES + SENTIMENT */}
    <SH>Rates &amp; Sentiment</SH>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1.4fr)", gap: 14, marginBottom: 18, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 10 }}>
        <YieldCurve rates={rates} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {rates.filter(r => ["DFF", "DGS10", "MORTGAGE30US", "DGS2"].includes(r.id)).map(r => <RateRow key={r.id} rate={r} />)}
        </div>
      </div>
      <FearGreedGauge />
    </div>

    {/* 4 · IMPLIED MOVE */}
    <ImpliedMovePanel />

    {/* 5 · THE TAPE — index prices */}
    <SH>The Tape — Index Prices</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 10, marginBottom: 18 }}>
      {indexes.map(item => (
        <HeroTile key={item.symbol} item={item} fmt={item.symbol === "^VIX" || item.symbol === "VIX" ? "vix" : "stock"} />
      ))}
    </div>

    {/* 6 · DEMOTED — commodities + crypto as a thin strip */}
    <SH>Commodities &amp; Crypto</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "6px 4px", marginBottom: 18, display: "flex", flexWrap: "wrap" }}>
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

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>Reading the cockpit.</strong>
      &nbsp;The <strong>Equity Risk Premium</strong> is the spread you earn owning stocks over risk-free bonds (S&amp;P earnings yield minus the 10-year). Below zero means bonds out-yield stocks on a fundamental basis — a headwind for equity valuations. The percentile shows where today sits in 25 years of history.
      &nbsp;<strong>Earnings yield by index</strong> lets you compare how cheap each market is on a fundamental basis; higher is cheaper.
      &nbsp;The <strong>yield curve</strong> and 2s10s spread frame the rate backdrop; <strong>Fear &amp; Greed</strong> is the contrarian sentiment gauge.
      &nbsp;Commodities and crypto sit at the bottom as context, not the main event.
    </InfoBox>
  </>);
}

export default OverviewTab;
