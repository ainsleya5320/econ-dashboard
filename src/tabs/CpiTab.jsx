import React, { useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { CPI_SERIES, CPI_COMPONENTS, PCE_COMPONENTS } from "../lib/constants.js";
import { fmtDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

/* ── tiny clickable wrapper around RateCard ── */
function ClickableCard({ onClick, expanded, children }) {
  return (
    <div onClick={onClick} style={{ cursor: "pointer", position: "relative" }}>
      {children}
      <div style={{ position: "absolute", top: 8, right: 12, fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
        {expanded ? "▲ hide" : "▼ details"}
      </div>
    </div>
  );
}

/* ── horizontal bar row for a single component ── */
function ComponentBar({ label, value, color, maxAbs }) {
  if (value == null) return null;
  const pct = maxAbs > 0 ? Math.abs(value) / maxAbs : 0;
  const isNeg = value < 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <div style={{ width: 140, fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ flex: 1, height: 18, background: "rgba(255,255,255,0.04)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          [isNeg ? "right" : "left"]: "50%",
          width: `${pct * 50}%`,
          background: isNeg ? "#EF4444" : color,
          borderRadius: 4,
          opacity: 0.85,
          transition: "width 0.4s ease"
        }} />
        {/* center zero line */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.15)" }} />
      </div>
      <div style={{ width: 54, fontSize: 11, fontWeight: 600, color: isNeg ? "#f87171" : "#4ade80", fontFamily: fonts.mono, textAlign: "right", flexShrink: 0 }}>
        {value > 0 ? "+" : ""}{value.toFixed(1)}%
      </div>
    </div>
  );
}

/* ── expandable component breakdown panel ── */
function ComponentPanel({ components, cd, headline, headlineColor }) {
  const items = Object.entries(components)
    .map(([id, m]) => ({ id, label: m.label, color: m.color, yoy: cd[id]?.yoy }))
    .filter(x => x.yoy != null)
    .sort((a, b) => b.yoy - a.yoy);
  if (!items.length) return <div style={{ padding: 12, color: "#475569", fontSize: 11, fontFamily: fonts.mono }}>Loading component data...</div>;
  const maxAbs = Math.max(...items.map(x => Math.abs(x.yoy)), 0.1);
  return (
    <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, animation: "fadeIn 0.3s ease" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: headlineColor, fontFamily: fonts.heading, marginBottom: 10, letterSpacing: 0.3 }}>{headline}</div>
      {items.map(x => <ComponentBar key={x.id} label={x.label} value={x.yoy} color={x.color} maxAbs={maxAbs} />)}
      <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 8 }}>
        Latest: {cd[items[0]?.id]?.lastDate ? fmtDate(cd[items[0].id].lastDate) : "—"} · YoY % change
      </div>
    </div>
  );
}

function CpiTab({ cd }) {
  const [expandCPI, setExpandCPI] = useState(false);
  const [expandPCE, setExpandPCE] = useState(false);

  const ic = (cd.CPIAUCSL?.history || []).map(h => { const r = { d: h.d }; ["CPIAUCSL","CPILFESL","PCEPI","PCEPILFE"].forEach(k => { const m = cd[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; }); return r; });
  const sv = cd.T10Y2Y?.current;
  const sc = sv != null ? (sv < 0 ? "#EF4444" : sv < 0.5 ? "#F59E0B" : "#10B981") : "#64748b";
  return (<>
    <SH>Inflation Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <ClickableCard onClick={() => setExpandCPI(v => !v)} expanded={expandCPI}>
        <RateCard label="CPI (YoY)" value={cd.CPIAUCSL?.yoy} color="#E8553A" subtitle="All items · click for breakdown" date={cd.CPIAUCSL?.lastDate} />
      </ClickableCard>
      <RateCard label="Core CPI (YoY)" value={cd.CPILFESL?.yoy} color="#3B82F6" subtitle="Less food & energy" date={cd.CPILFESL?.lastDate} />
      <ClickableCard onClick={() => setExpandPCE(v => !v)} expanded={expandPCE}>
        <RateCard label="PCE (YoY)" value={cd.PCEPI?.yoy} color="#F97316" subtitle="All items · click for breakdown" date={cd.PCEPI?.lastDate} />
      </ClickableCard>
      <RateCard label="Core PCE (YoY)" value={cd.PCEPILFE?.yoy} color="#10B981" subtitle="Fed's target measure" date={cd.PCEPILFE?.lastDate} />
    </div>
    {expandCPI && <ComponentPanel components={CPI_COMPONENTS} cd={cd} headline="CPI Component Breakdown — YoY %" headlineColor="#E8553A" />}
    {expandPCE && <ComponentPanel components={PCE_COMPONENTS} cd={cd} headline="PCE Component Breakdown — YoY %" headlineColor="#F97316" />}
    <InfoBox color="#3B82F6"><strong style={{ color: "#cbd5e1" }}>Why three measures?</strong> CPI tracks consumer prices including volatile food/energy. Core CPI strips those out. The Fed prefers Core PCE because it captures broader spending and adjusts for substitution. Fed target: 2% Core PCE.</InfoBox>
    <ChartCard data={ic} series={{ CPIAUCSL: { label: "CPI All Items", color: "#E8553A" }, CPILFESL: { label: "Core CPI", color: "#3B82F6" }, PCEPI: { label: "PCE All Items", color: "#F97316" }, PCEPILFE: { label: "Core PCE", color: "#10B981" } }} title="Inflation Measures — YoY %" refLine={2} />
    <SH>Market Inflation Expectations</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="10-Year Breakeven" value={cd.T10YIE?.current} color="#F59E0B" subtitle="Market-implied inflation" date={cd.T10YIE?.lastDate} />
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: sc, borderRadius: "14px 14px 0 0" }} />
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>10Y-2Y YIELD SPREAD</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: sc, fontFamily: fonts.heading }}>{sv != null ? `${sv > 0 ? "+" : ""}${sv.toFixed(2)}%` : "—"}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{sv != null ? (sv < 0 ? "⚠ Inverted — recession signal" : sv < 0.5 ? "Flat — cautious" : "Normal — expansion") : ""}</div>
      </div>
    </div>
    <InfoBox color="#F59E0B"><strong style={{ color: "#cbd5e1" }}>Breakeven inflation</strong> = what bond traders expect inflation to average over 10 years. The <strong style={{ color: "#cbd5e1" }}>yield spread</strong> (10Y minus 2Y) historically inverts before recessions.</InfoBox>
    <ChartCard data={(cd.T10YIE?.history || []).map(h => ({ d: h.d, T10YIE: h.v }))} series={{ T10YIE: { label: "10Y Breakeven", color: "#F59E0B" } }} title="10-Year Breakeven Inflation Rate" refLine={2} />
    <div style={{ height: 14 }} />
    <ChartCard data={(cd.T10Y2Y?.history || []).map(h => ({ d: h.d, T10Y2Y: h.v }))} series={{ T10Y2Y: { label: "10Y-2Y Spread", color: "#8B5CF6" } }} title="Yield Curve Spread (10Y - 2Y)" refLine={0} />
  </>);
}

export default CpiTab;
