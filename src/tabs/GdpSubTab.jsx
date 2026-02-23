import React from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fmtDate, RateCard, ChartCard, SH } from "../components/shared.jsx";

function GdpSubTab({ gdpData }) {
  if (!gdpData) return <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading GDP data...</div>;

  // Get latest value from a sorted-desc array
  const latest = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    const sorted = [...arr].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0];
  };

  // Compute period-over-period and YoY changes
  // periodsBack: 1 for MoM/QoQ, yoyBack: periods to go back for YoY (12 for monthly, 4 for quarterly)
  const changes = (arr, yoyBack) => {
    if (!Array.isArray(arr) || arr.length < 2) return { pop: null, popLabel: null, yoy: null };
    const sorted = [...arr].sort((a, b) => b.date.localeCompare(a.date));
    const cur = sorted[0]?.value;
    const prev = sorted[1]?.value;
    const pop = (cur != null && prev != null && prev !== 0) ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    const popLabel = yoyBack <= 4 ? "QoQ" : "MoM";
    // YoY: find entry ~yoyBack periods ago
    const yoyEntry = sorted[yoyBack];
    const yoy = (cur != null && yoyEntry?.value != null && yoyEntry.value !== 0)
      ? ((cur - yoyEntry.value) / Math.abs(yoyEntry.value)) * 100 : null;
    return { pop, popLabel, yoy };
  };

  // Compute changes for absolute-level indicators (unemployment is already a %, use point diff)
  const pointChanges = (arr, yoyBack) => {
    if (!Array.isArray(arr) || arr.length < 2) return { pop: null, popLabel: null, yoy: null, isPoints: true };
    const sorted = [...arr].sort((a, b) => b.date.localeCompare(a.date));
    const cur = sorted[0]?.value;
    const prev = sorted[1]?.value;
    const pop = (cur != null && prev != null) ? cur - prev : null;
    const popLabel = yoyBack <= 4 ? "QoQ" : "MoM";
    const yoyEntry = sorted[yoyBack];
    const yoy = (cur != null && yoyEntry?.value != null) ? cur - yoyEntry.value : null;
    return { pop, popLabel, yoy, isPoints: true };
  };

  const gdpLatest = latest(gdpData.gdp);
  const realLatest = latest(gdpData.real);
  const perCapLatest = latest(gdpData.perCap);
  const unempLatest = latest(gdpData.unemployment);
  const claimsLatest = latest(gdpData.initialClaims);
  const retailLatest = latest(gdpData.retailSales);
  const indProdLatest = latest(gdpData.industrialProd);
  const sentimentLatest = latest(gdpData.sentiment);
  const durableLatest = latest(gdpData.durableGoods);

  const fmtT = (v) => v != null ? `$${(v / 1e3).toFixed(2)}T` : "—";
  const fmtK = (v) => v != null ? `$${(v / 1000).toFixed(1)}K` : "—";
  const fmtPct = (v) => v != null ? `${v.toFixed(1)}%` : "—";
  const fmtNum = (v) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—";
  const fmtM = (v) => v != null ? `$${(v / 1e3).toFixed(1)}B` : "—";

  const cards = [
    { label: "GDP (Nominal)", value: gdpLatest ? fmtT(gdpLatest.value) : "—", date: gdpLatest?.date, color: "#818cf8", ...changes(gdpData.gdp, 4) },
    { label: "Real GDP", value: realLatest ? fmtT(realLatest.value) : "—", date: realLatest?.date, color: "#818cf8", ...changes(gdpData.real, 4) },
    { label: "Real GDP Per Capita", value: perCapLatest ? fmtK(perCapLatest.value) : "—", date: perCapLatest?.date, color: "#818cf8", ...changes(gdpData.perCap, 4) },
    { label: "Unemployment Rate", value: unempLatest ? fmtPct(unempLatest.value) : "—", date: unempLatest?.date, color: "#f87171", ...pointChanges(gdpData.unemployment, 12), invertColor: true },
    { label: "Initial Claims", value: claimsLatest ? fmtNum(claimsLatest.value) : "—", date: claimsLatest?.date, color: "#fb923c", ...changes(gdpData.initialClaims, 52), invertColor: true },
    { label: "Consumer Sentiment", value: sentimentLatest ? fmtNum(sentimentLatest.value) : "—", date: sentimentLatest?.date, color: "#4ade80", ...changes(gdpData.sentiment, 12) },
    { label: "Retail Sales", value: retailLatest ? fmtM(retailLatest.value) : "—", date: retailLatest?.date, color: "#38bdf8", ...changes(gdpData.retailSales, 12) },
    { label: "Durable Goods", value: durableLatest ? fmtM(durableLatest.value) : "—", date: durableLatest?.date, color: "#a78bfa", ...changes(gdpData.durableGoods, 12) },
    { label: "Industrial Production", value: indProdLatest ? fmtNum(indProdLatest.value) : "—", date: indProdLatest?.date, color: "#fbbf24", ...changes(gdpData.industrialProd, 12) },
  ];

  const changeColor = (val, invert) => {
    if (val == null) return "#64748b";
    const positive = invert ? val < 0 : val > 0;
    return val === 0 ? "#64748b" : positive ? "#4ade80" : "#f87171";
  };
  const fmtChange = (val, isPoints) => {
    if (val == null) return null;
    const sign = val > 0 ? "+" : "";
    if (isPoints) return `${sign}${val.toFixed(1)}pp`;
    return `${sign}${val.toFixed(1)}%`;
  };

  // Build chart data from real GDP
  const gdpChart = (gdpData.real || [])
    .filter(d => d.value != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, value: d.value / 1e3 }));

  // Unemployment chart
  const unempChart = (gdpData.unemployment || [])
    .filter(d => d.value != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, value: d.value }));

  // Consumer Sentiment chart
  const sentimentChart = (gdpData.sentiment || [])
    .filter(d => d.value != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, value: d.value }));

  // Retail Sales chart
  const retailChart = (gdpData.retailSales || [])
    .filter(d => d.value != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, value: d.value / 1e3 }));

  return (<>
    <SH>Economic Overview (FMP)</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 16 }}>
      {cards.map(c => {
        const popStr = fmtChange(c.pop, c.isPoints);
        const yoyStr = fmtChange(c.yoy, c.isPoints);
        return (
        <div key={c.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: c.color, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{c.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{c.value}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            {popStr && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: changeColor(c.pop, c.invertColor) }}>{c.popLabel} {popStr}</span>}
            {yoyStr && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: changeColor(c.yoy, c.invertColor) }}>YoY {yoyStr}</span>}
          </div>
          {c.date && <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 3 }}>{fmtDate(c.date)}</div>}
        </div>
        );
      })}
    </div>
    {gdpChart.length > 1 && (
      <ChartCard data={gdpChart} series={{ value: { label: "Real GDP", color: "#818cf8" } }} title="Real GDP ($T)" yFormatter={v => `$${v.toFixed(1)}T`} />
    )}
    {unempChart.length > 1 && (
      <ChartCard data={unempChart} series={{ value: { label: "Unemployment Rate", color: "#f87171" } }} title="Unemployment Rate (%)" yFormatter={v => `${v.toFixed(1)}%`} />
    )}
    {sentimentChart.length > 1 && (
      <ChartCard data={sentimentChart} series={{ value: { label: "Consumer Sentiment", color: "#4ade80" } }} title="U. of Michigan Consumer Sentiment" yFormatter={v => v.toFixed(0)} />
    )}
    {retailChart.length > 1 && (
      <ChartCard data={retailChart} series={{ value: { label: "Retail Sales", color: "#38bdf8" } }} title="Retail Sales ($B)" yFormatter={v => `$${v.toFixed(0)}B`} />
    )}
  </>);
}

export default GdpSubTab;
