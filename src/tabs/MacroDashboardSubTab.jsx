import React, { useEffect, useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

/*
 * MacroDashboardSubTab — the U.S. Economy tab's at-a-glance landing.
 * Headline tiles (click → drill-down subtab), recession lights,
 * growth/inflation regime quadrant, and real-rate verdicts.
 * Data: /api/macro-dashboard (batched FRED, precomputed composites).
 */

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8";

// Tiny dependency-free sparkline
function Spark({ values, color = INDIGO, h = 26 }) {
  const v = (values || []).filter(x => x != null && isFinite(x));
  if (v.length < 3) return <div style={{ height: h }} />;
  const min = Math.min(...v), max = Math.max(...v), range = (max - min) || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tile({ label, value, sub, spark, sparkColor, pct, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: cardBg, border: hover ? "1px solid rgba(129,140,248,0.45)" : cardBorder, borderRadius: 14, padding: "12px 14px", cursor: onClick ? "pointer" : "default", transition: "border 0.12s", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {pct != null && <span style={{ fontSize: 9, color: "#a5b4fc", fontFamily: fonts.mono, whiteSpace: "nowrap" }}>{pct}th %ile</span>}
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.4, marginTop: 3, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      <div style={{ marginTop: 6 }}><Spark values={spark} color={sparkColor || INDIGO} /></div>
    </div>
  );
}

// Recession lights — each returns { tone: 'green'|'amber'|'red', note }
function lightFor(id, c) {
  switch (id) {
    case "curve": {
      const v = c.spread2s10s;
      if (v == null) return null;
      return v > 25 ? { tone: "green", note: "un-inverted" } : v >= 0 ? { tone: "amber", note: "flat" } : { tone: "red", note: "inverted" };
    }
    case "sahm": {
      const v = c.sahm;
      if (v == null) return null;
      return v < 0.3 ? { tone: "green", note: "no trigger" } : v < 0.5 ? { tone: "amber", note: "approaching 0.50" } : { tone: "red", note: "triggered" };
    }
    case "claims": {
      const v = c.claimsYoY;
      if (v == null) return null;
      return v < 5 ? { tone: "green", note: "stable" } : v <= 20 ? { tone: "amber", note: "rising" } : { tone: "red", note: "surging" };
    }
    case "policy": {
      const v = c.realFFR;
      if (v == null) return null;
      return v < 0.5 ? { tone: "green", note: "≈ neutral / easy" } : v <= 1.5 ? { tone: "amber", note: "restrictive" } : { tone: "red", note: "very restrictive" };
    }
    case "housing": {
      const v = c.houstYoY;
      if (v == null) return null;
      return v > 0 ? { tone: "green", note: "expanding" } : v >= -10 ? { tone: "amber", note: "softening" } : { tone: "red", note: "contracting" };
    }
    default: return null;
  }
}
const TONE_C = { green: GREEN, amber: AMBER, red: RED };

function RegimeQuadrant({ path }) {
  if (!path || path.length < 1) return null;
  const W = 300, H = 240, padL = 34, padR = 12, padT = 20, padB = 30;
  const gw = W - padL - padR, gh = H - padT - padB;
  const X0 = 2, Y0 = 2.5;                 // trend growth / comfortable inflation
  const xr = [-2, 6], yr = [0, 6];
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = g => padL + ((cl(g, xr[0], xr[1]) - xr[0]) / (xr[1] - xr[0])) * gw;
  const y = i => padT + (1 - (cl(i, yr[0], yr[1]) - yr[0]) / (yr[1] - yr[0])) * gh;
  const cx = x(X0), cy = y(Y0);
  const last = path[path.length - 1];
  const line = path.map(p => `${x(p.growth)},${y(p.inflation)}`).join(" ");
  const q = (last.growth >= X0)
    ? (last.inflation >= Y0 ? "Overheating" : "Goldilocks")
    : (last.inflation >= Y0 ? "Stagflation" : "Recessionary");
  const qColor = q === "Goldilocks" ? GREEN : q === "Overheating" ? AMBER : q === "Stagflation" ? RED : "#94a3b8";
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Macro Regime — Growth vs Inflation</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: qColor, fontFamily: fonts.heading }}>{q}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
        <rect x={padL} y={padT} width={gw} height={gh} fill="none" stroke="var(--border-subtle)" />
        <line x1={cx} y1={padT} x2={cx} y2={padT + gh} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
        <line x1={padL} y1={cy} x2={padL + gw} y2={cy} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
        <text x={padL + 6} y={padT + 12} fontSize="9" fill={RED} fontFamily="monospace">Stagflation</text>
        <text x={padL + gw - 6} y={padT + 12} fontSize="9" fill={AMBER} fontFamily="monospace" textAnchor="end">Overheating</text>
        <text x={padL + 6} y={padT + gh - 6} fontSize="9" fill="#94a3b8" fontFamily="monospace">Recessionary</text>
        <text x={padL + gw - 6} y={padT + gh - 6} fontSize="9" fill={GREEN} fontFamily="monospace" textAnchor="end">Goldilocks</text>
        <polyline points={line} fill="none" stroke={INDIGO} strokeWidth="1.2" opacity="0.5" />
        {path.map((p, i) => (
          <circle key={p.d} cx={x(p.growth)} cy={y(p.inflation)} r={i === path.length - 1 ? 6 : 2.5}
            fill={i === path.length - 1 ? INDIGO : "rgba(129,140,248,0.45)"}
            stroke={i === path.length - 1 ? "#f1f5f9" : "none"} strokeWidth="1.5" />
        ))}
        <text x={padL + gw / 2} y={H - 6} fontSize="9" fill="var(--text-muted)" fontFamily="monospace" textAnchor="middle">Real GDP growth (QoQ SAAR) →</text>
        <text x={10} y={padT + gh / 2} fontSize="9" fill="var(--text-muted)" fontFamily="monospace" textAnchor="middle" transform={`rotate(-90 10 ${padT + gh / 2})`}>CPI YoY →</text>
      </svg>
      <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 2 }}>
        Dot = latest quarter ({last.d.slice(0, 7)}: {last.growth.toFixed(1)}% growth, {last.inflation.toFixed(1)}% CPI). Trail = last {path.length} quarters. Crosshairs at 2% trend growth / 2.5% inflation.
      </div>
    </div>
  );
}

function MacroDashboardSubTab({ go }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    fetch(`/api/macro-dashboard${force ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(!!d.error); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(false); }, []);

  if (loading && !data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading macro dashboard…</div>;
  if (error || !data?.series) return <InfoBox color="#F97316">Unable to load macro data — FRED may be temporarily unavailable.</InfoBox>;

  const s = data.series, c = data.computed || {};
  const fmtP = (v, dp = 1) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;

  const tiles = [
    { label: "Real GDP Growth", value: s.A191RL1Q225SBEA ? `${fmtP(s.A191RL1Q225SBEA.current)}` : "—", sub: `QoQ SAAR · ${s.A191RL1Q225SBEA?.lastDate?.slice(0, 7) ?? ""}`, spark: s.A191RL1Q225SBEA?.sparkRaw, pct: s.A191RL1Q225SBEA?.pctRaw, goTo: "gdp" },
    { label: "CPI Inflation", value: c.cpiYoY != null ? `${c.cpiYoY.toFixed(1)}%` : "—", sub: `Core ${c.coreCpiYoY?.toFixed(1) ?? "—"}% · PCE core ${c.corePceYoY?.toFixed(1) ?? "—"}%`, spark: s.CPIAUCSL?.sparkYoY, sparkColor: c.cpiYoY > 3 ? RED : INDIGO, pct: s.CPIAUCSL?.pctYoY, goTo: "cpi" },
    { label: "Unemployment", value: s.UNRATE ? `${s.UNRATE.current.toFixed(1)}%` : "—", sub: `Payrolls ${c.payroll3mo != null ? `+${c.payroll3mo}K/mo` : "—"} (3m avg)`, spark: s.UNRATE?.sparkRaw, pct: s.UNRATE?.pctRaw, goTo: "labor" },
    { label: "Fed Funds", value: s.FEDFUNDS ? `${s.FEDFUNDS.current.toFixed(2)}%` : "—", sub: `Real ${c.realFFR != null ? `${c.realFFR >= 0 ? "+" : ""}${c.realFFR.toFixed(2)}pp` : "—"} vs core PCE`, spark: s.FEDFUNDS?.sparkRaw, pct: s.FEDFUNDS?.pctRaw, goTo: "rates" },
    { label: "30Y Mortgage", value: s.MORTGAGE30US ? `${s.MORTGAGE30US.current.toFixed(2)}%` : "—", sub: s.MORTGAGE30US?.lastDate ?? "", spark: s.MORTGAGE30US?.sparkRaw, pct: s.MORTGAGE30US?.pctRaw, goTo: "housing" },
    { label: "Home Prices", value: fmtP(c.homePriceYoY), sub: "Case-Shiller YoY", spark: s.CSUSHPINSA?.sparkYoY, pct: s.CSUSHPINSA?.pctYoY, goTo: "housing" },
    { label: "Jobless Claims", value: s.IC4WSA ? `${Math.round(s.IC4WSA.current / 1000)}K` : "—", sub: `4-wk avg · ${fmtP(c.claimsYoY)} YoY`, spark: s.IC4WSA?.sparkRaw, sparkColor: (c.claimsYoY ?? 0) > 10 ? RED : INDIGO, pct: s.IC4WSA?.pctRaw, goTo: "labor" },
    { label: "Consumer Sentiment", value: s.UMCSENT ? s.UMCSENT.current.toFixed(1) : "—", sub: `U. Michigan · ${fmtP(s.UMCSENT?.yoy)} YoY`, spark: s.UMCSENT?.sparkRaw, pct: s.UMCSENT?.pctRaw, goTo: "consumer" },
    { label: "Federal Deficit", value: s.FYFSGDA188S ? `${Math.abs(s.FYFSGDA188S.current).toFixed(1)}%` : "—", sub: `of GDP · FY${s.FYFSGDA188S?.lastDate?.slice(0, 4) ?? ""}`, spark: s.FYFSGDA188S?.sparkRaw, pct: s.FYFSGDA188S?.pctRaw, goTo: "budget" },
  ];

  const LIGHTS = [
    { id: "curve",   name: "Yield Curve (2s10s)", val: c.spread2s10s != null ? `${c.spread2s10s >= 0 ? "+" : ""}${c.spread2s10s} bp` : "—" },
    { id: "sahm",    name: "Sahm Rule",           val: c.sahm != null ? c.sahm.toFixed(2) : "—" },
    { id: "claims",  name: "Jobless Claims YoY",  val: fmtP(c.claimsYoY) },
    { id: "policy",  name: "Real Policy Rate",    val: c.realFFR != null ? `${c.realFFR >= 0 ? "+" : ""}${c.realFFR.toFixed(2)}pp` : "—" },
    { id: "housing", name: "Housing Starts YoY",  val: fmtP(c.houstYoY) },
  ].map(l => ({ ...l, ...(lightFor(l.id, c) || { tone: "amber", note: "n/a" }) }));

  const reds = LIGHTS.filter(l => l.tone === "red").length;
  const ambers = LIGHTS.filter(l => l.tone === "amber").length;
  const overall = reds >= 2 ? { label: "Recession risk elevated", color: RED }
    : reds === 1 || ambers >= 3 ? { label: "Watchful", color: AMBER }
    : { label: "Expansion intact", color: GREEN };

  const realCards = [
    { label: "Real 10Y Yield", v: c.real10Y, unit: "pp", verdict: c.real10Y == null ? "—" : c.real10Y > 1 ? "Bonds pay well above inflation" : c.real10Y > 0 ? "Thin real cushion over inflation" : "Negative real yield", color: c.real10Y == null ? "#94a3b8" : c.real10Y > 1 ? GREEN : c.real10Y > 0 ? AMBER : RED },
    { label: "Real Policy Rate", v: c.realFFR, unit: "pp", verdict: c.realFFR == null ? "—" : c.realFFR < 0 ? "Accommodative — stimulus" : c.realFFR < 0.75 ? "Roughly neutral" : c.realFFR < 1.5 ? "Restrictive" : "Very restrictive", color: c.realFFR == null ? "#94a3b8" : c.realFFR < 0.75 ? INDIGO : c.realFFR < 1.5 ? AMBER : RED },
    { label: "Real Wage Growth", v: c.realWages, unit: "pp", verdict: c.realWages == null ? "—" : c.realWages > 0 ? "Purchasing power growing" : "Wages losing to inflation", color: c.realWages == null ? "#94a3b8" : c.realWages > 0 ? GREEN : RED },
  ];

  return (<>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>
        The whole economy on one screen — click any tile to drill into its subtab.
      </div>
      <button onClick={() => load(true)} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* 1 · Headline tiles */}
    <SH>Headline Indicators</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginBottom: 18 }}>
      {tiles.map(t => <Tile key={t.label} {...t} onClick={go ? () => go(t.goTo) : undefined} />)}
    </div>

    {/* 2 · Recession lights */}
    <SH>Recession Dial</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: overall.color, display: "inline-block" }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: overall.color, fontFamily: fonts.heading }}>{overall.label}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>{reds} red · {ambers} amber · {LIGHTS.length - reds - ambers} green</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        {LIGHTS.map(l => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 9, borderLeft: `3px solid ${TONE_C[l.tone]}` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: TONE_C[l.tone], flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: "var(--text-secondary)", fontFamily: fonts.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 700 }}>{l.val} <span style={{ fontWeight: 400, color: TONE_C[l.tone], fontSize: 10 }}>{l.note}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* 3 · Regime quadrant + real rates */}
    <SH>Regime &amp; Real Rates</SH>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(240px, 1fr)", gap: 14, marginBottom: 18, alignItems: "start" }}>
      <RegimeQuadrant path={c.regimePath} />
      <div style={{ display: "grid", gap: 10 }}>
        {realCards.map(rc => (
          <div key={rc.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{rc.label}</div>
              <div style={{ fontSize: 11, color: rc.color, fontFamily: fonts.mono, marginTop: 3 }}>{rc.verdict}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: rc.color, fontFamily: fonts.heading, whiteSpace: "nowrap" }}>
              {rc.v != null ? `${rc.v >= 0 ? "+" : ""}${rc.v.toFixed(2)}${rc.unit}` : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>Reading the dashboard.</strong>
      &nbsp;Percentile badges rank today&apos;s reading within each series&apos; full history — high unemployment percentile is bad, high sentiment percentile is good.
      &nbsp;The <strong>Sahm rule</strong> triggers at 0.50 (unemployment&apos;s 3-mo average rising half a point off its low) and has flagged every US recession since 1970 with almost no false positives.
      &nbsp;The <strong>regime quadrant</strong> maps growth against inflation — asset allocation lives in which quadrant you&apos;re in, and the trail shows the direction of travel.
      &nbsp;All data from FRED; cached 4 hours.
    </InfoBox>
  </>);
}

export default MacroDashboardSubTab;
