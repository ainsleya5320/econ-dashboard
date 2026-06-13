import React, { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis, AreaChart, Area } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import FearGreedGauge from "../components/FearGreedGauge.jsx";

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

function OverviewTab() {
  const [data, setData] = useState(null);
  const [indexYields, setIndexYields] = useState([]);
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
    ])
      .then(([summary, yields]) => {
        setData(summary);
        if (Array.isArray(yields)) setIndexYields(yields);
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

  return (<>
    {/* Header row: title + last-update badge + refresh button */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>Market Pulse</div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>
          A live snapshot of the things you should know before the open.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
          Updated {fmtTimeAgo(data.asOf)}
          <span style={{ display: "none" }}>{tick}</span>
        </span>
        <button onClick={() => load(true)} style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "5px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", cursor: "pointer" }}>↻ Refresh</button>
      </div>
    </div>

    {/* INDEXES — hero row, large tiles */}
    <SH>Equity Indexes</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 18 }}>
      {indexes.map(item => (
        <HeroTile key={item.symbol} item={item} fmt={item.symbol === "^VIX" || item.symbol === "VIX" ? "vix" : "stock"} />
      ))}
    </div>

    {/* Two-column row: Interest Rates + Earnings Yields */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
      <div>
        <SH>Interest Rates</SH>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {rates.map(r => <RateRow key={r.id} rate={r} />)}
        </div>
      </div>
      <div>
        <SH>Earnings Yields</SH>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {indexYields.map(index => <EarningsYieldRow key={index.symbol} index={index} />)}
        </div>
      </div>
    </div>

    <SH>Market Sentiment</SH>
    <FearGreedGauge />

    {/* COMMODITIES */}
    <SH>Commodities</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 18 }}>
      {commodities.map(item => <HeroTile key={item.symbol} item={item} fmt="commodity" />)}
    </div>

    {/* CRYPTO */}
    <SH>Cryptocurrency</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 18 }}>
      {crypto.map(item => <HeroTile key={item.symbol} item={item} fmt="crypto" />)}
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>What you're looking at.</strong>
      &nbsp;<strong>Equity indexes</strong> show the day's move with a 1-month sparkline — quick view of trend direction.
      &nbsp;<strong>Interest rates</strong> from FRED; the <strong>2s10s spread</strong> is the most-watched recession indicator (negative readings have preceded most US recessions).
      &nbsp;<strong>Commodities</strong> day-changes track Yahoo futures; oil and gold often move opposite stocks in a risk-off environment.
      &nbsp;<strong>Crypto</strong> moves more in 24h than most equities move in a quarter — useful early-warning indicator for risk appetite.
      &nbsp;Drill into any of these on the dedicated tabs (Stocks, Commodities, Economy).
    </InfoBox>
  </>);
}

export default OverviewTab;
