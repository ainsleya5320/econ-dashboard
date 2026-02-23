import React from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { CPI_SERIES } from "../lib/constants.js";
import { fmtDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

function CpiTab({ cd }) {
  const ic = (cd.CPIAUCSL?.history || []).map(h => { const r = { d: h.d }; ["CPIAUCSL","CPILFESL","PCEPI","PCEPILFE"].forEach(k => { const m = cd[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; }); return r; });
  const sv = cd.T10Y2Y?.current;
  const sc = sv != null ? (sv < 0 ? "#EF4444" : sv < 0.5 ? "#F59E0B" : "#10B981") : "#64748b";
  return (<>
    <SH>Inflation Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="CPI (YoY)" value={cd.CPIAUCSL?.yoy} color="#E8553A" subtitle="All items" date={cd.CPIAUCSL?.lastDate} />
      <RateCard label="Core CPI (YoY)" value={cd.CPILFESL?.yoy} color="#3B82F6" subtitle="Less food & energy" date={cd.CPILFESL?.lastDate} />
      <RateCard label="PCE (YoY)" value={cd.PCEPI?.yoy} color="#F97316" subtitle="All items (PCE)" date={cd.PCEPI?.lastDate} />
      <RateCard label="Core PCE (YoY)" value={cd.PCEPILFE?.yoy} color="#10B981" subtitle="Fed's target measure" date={cd.PCEPILFE?.lastDate} />
    </div>
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
