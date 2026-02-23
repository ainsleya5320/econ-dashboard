import React from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { CONSUMER_SERIES } from "../lib/constants.js";
import { fmtDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

const DELINQ_SERIES = { DRCCLACBS: CONSUMER_SERIES.DRCCLACBS, DRSFRMACBS: CONSUMER_SERIES.DRSFRMACBS, DRCRELEXFACBS: CONSUMER_SERIES.DRCRELEXFACBS, DRBLACBS: CONSUMER_SERIES.DRBLACBS };
const CREDIT_SERIES = { TOTALSL: CONSUMER_SERIES.TOTALSL, REVOLSL: CONSUMER_SERIES.REVOLSL, NONREVSL: CONSUMER_SERIES.NONREVSL };
const NW_DIST_SERIES = { WFRBST01134: CONSUMER_SERIES.WFRBST01134, WFRBSN09192: CONSUMER_SERIES.WFRBSN09192, WFRBSN40188: CONSUMER_SERIES.WFRBSN40188, WFRBSB50215: CONSUMER_SERIES.WFRBSB50215 };

function ConsumerTab({ csm }) {
  // Delinquency chart data
  const dqChart = (csm.DRCCLACBS?.history || []).map(h => {
    const r = { d: h.d, DRCCLACBS: h.v };
    ["DRSFRMACBS", "DRCRELEXFACBS", "DRBLACBS"].forEach(k => { const m = csm[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; });
    return r;
  });

  // Consumer credit chart data
  const crChart = (csm.TOTALSL?.history || []).map(h => {
    const r = { d: h.d, TOTALSL: h.v };
    ["REVOLSL", "NONREVSL"].forEach(k => { const m = csm[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; });
    return r;
  });

  // Net worth distribution (SCF 2022 data, Fed Distributional Financial Accounts)
  const nwDist = [
    { group: "Top 1%", threshold: "> $13.7M", median: "$27.5M", mean: "$38.0M", color: "#E8553A" },
    { group: "Top 2–5%", threshold: "$3.8M – $13.7M", median: "$6.0M", mean: "$7.2M", color: "#F97316" },
    { group: "Top 5–10%", threshold: "$1.9M – $3.8M", median: "$2.7M", mean: "$2.8M", color: "#F59E0B" },
    { group: "Top 10–25%", threshold: "$680K – $1.9M", median: "$1.1M", mean: "$1.2M", color: "#6366F1" },
    { group: "25–50th Pctl", threshold: "$176K – $680K", median: "$375K", mean: "$400K", color: "#3B82F6" },
    { group: "50–75th Pctl", threshold: "$44K – $176K", median: "$97K", mean: "$107K", color: "#8B5CF6" },
    { group: "Bottom 25%", threshold: "< $44K", median: "$5.5K", mean: "$3.5K", color: "#10B981" },
  ];

  // Net worth share over time chart
  const nwDistKeys = ["WFRBST01134", "WFRBSN09192", "WFRBSN40188", "WFRBSB50215"];
  const nwTimeChart = (csm.WFRBST01134?.history || []).map(h => {
    const r = { d: h.d };
    nwDistKeys.forEach(k => { const m = csm[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; });
    return r;
  });

  // Income distribution reference data (Census Bureau / SCF 2022–2023)
  const incDist = [
    { group: "Top 1%", threshold: "> $500K", median: "$785K", color: "#E8553A" },
    { group: "Top 5%", threshold: "> $290K", median: "$380K", color: "#F97316" },
    { group: "Top 10%", threshold: "> $210K", median: "$260K", color: "#F59E0B" },
    { group: "Top 25%", threshold: "> $130K", median: "$165K", color: "#6366F1" },
    { group: "Median (50th)", threshold: "$80K", median: "$80.6K", color: "#3B82F6" },
    { group: "25th Pctl", threshold: "$38K", median: "$38K", color: "#8B5CF6" },
    { group: "Bottom 20%", threshold: "< $30K", median: "$17K", color: "#10B981" },
  ];

  // Median HH income chart
  const incChart = (csm.MEHOINUSA672N?.history || []).map(h => ({ d: h.d, MEHOINUSA672N: h.v }));

  // Savings rate chart
  const savChart = (csm.PSAVERT?.history || []).map(h => ({ d: h.d, PSAVERT: h.v }));

  return (<>
    {/* Savings & Debt Overview */}
    <SH>Consumer Health Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Savings Rate" value={csm.PSAVERT?.current} color="#3B82F6" subtitle="Personal savings %" date={csm.PSAVERT?.lastDate} />
      <RateCard label="Household Net Worth" value={csm.TNWBSHNO?.current} color="#10B981" format="bigdollar" subtitle="Fed Flow of Funds" date={csm.TNWBSHNO?.lastDate} />
      <RateCard label="Household Debt/GDP" value={csm.HDTGPDUSQ163N?.current} color="#8B5CF6" subtitle="Quarterly %" date={csm.HDTGPDUSQ163N?.lastDate} />
      <RateCard label="Consumer Credit" value={csm.TOTALSL?.current} color="#6366F1" format="bigdollar" subtitle="Total outstanding" date={csm.TOTALSL?.lastDate} />
    </div>
    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Personal savings rate</strong> is disposable income minus spending as a % of disposable income. Higher = more consumer cushion. Pre-COVID average was ~7%. <strong style={{ color: "#cbd5e1" }}>Household Debt/GDP</strong> peaked at 100% in 2009.
    </InfoBox>
    <ChartCard data={savChart} series={{ PSAVERT: { label: "Personal Savings Rate", color: "#3B82F6" } }} title="Personal Savings Rate (%)" yFormatter={v => `${v}%`} />

    {/* Delinquency Rates */}
    <SH>Delinquency Rates</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Consumer Loans" value={csm.DRCCLACBS?.current} color="#E8553A" subtitle="All consumer" date={csm.DRCCLACBS?.lastDate} />
      <RateCard label="Credit Cards" value={csm.DRCRELEXFACBS?.current} color="#D946EF" subtitle="Revolving" date={csm.DRCRELEXFACBS?.lastDate} />
      <RateCard label="Mortgages" value={csm.DRSFRMACBS?.current} color="#F97316" subtitle="Single-family" date={csm.DRSFRMACBS?.lastDate} />
      <RateCard label="Business Loans" value={csm.DRBLACBS?.current} color="#F59E0B" subtitle="Commercial" date={csm.DRBLACBS?.lastDate} />
    </div>
    <InfoBox color="#E8553A">
      <strong style={{ color: "#cbd5e1" }}>Delinquency rates</strong> measure the % of loans 30+ days past due. Rising delinquencies signal consumer stress. Credit card delinquency is the most volatile and first to spike in downturns.
    </InfoBox>
    <ChartCard data={dqChart} series={DELINQ_SERIES} title="Delinquency Rates by Loan Type (%)" yFormatter={v => `${v}%`} />

    {/* Consumer Credit */}
    <SH>Consumer Credit Outstanding</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Total Credit" value={csm.TOTALSL?.current} color="#6366F1" format="bigdollar" subtitle="All consumer" date={csm.TOTALSL?.lastDate} small />
      <RateCard label="Revolving (Cards)" value={csm.REVOLSL?.current} color="#EC4899" format="bigdollar" subtitle="Credit cards" date={csm.REVOLSL?.lastDate} small />
      <RateCard label="Non-Revolving" value={csm.NONREVSL?.current} color="#14B8A6" format="bigdollar" subtitle="Auto, student, etc." date={csm.NONREVSL?.lastDate} small />
    </div>
    <ChartCard data={crChart} series={CREDIT_SERIES} title="Consumer Credit Outstanding ($B)" yFormatter={v => `$${v.toLocaleString()}B`} />

    {/* Net Worth Distribution - Individual Dollar Terms */}
    <SH>Household Net Worth by Percentile</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Total HH Net Worth" value={csm.TNWBSHNO?.current} color="#10B981" format="bigdollar" subtitle="Fed Flow of Funds" date={csm.TNWBSHNO?.lastDate} />
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead>
          <tr>
            {["Percentile", "Net Worth Range", "Median", "Mean"].map(h => (
              <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: h === "Percentile" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nwDist.map((row, i) => (
            <tr key={row.group} style={{ borderBottom: i < nwDist.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: row.color, fontWeight: 600 }}>{row.group}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{row.threshold}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#e2e8f0", textAlign: "right", fontWeight: 600 }}>{row.median}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right" }}>{row.mean}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>Source: Federal Reserve Survey of Consumer Finances (2022).</strong> Net worth = total assets minus total liabilities. Median is more representative than mean within each group, as wealth is heavily right-skewed. The bottom 25% median of $5.5K reflects many households with student debt, medical debt, or negative net worth.
    </InfoBox>
    <ChartCard data={nwTimeChart} series={NW_DIST_SERIES} title="Net Worth Share Over Time (%)" yFormatter={v => `${v}%`} />

    {/* Household Income Distribution */}
    <SH>Household Income Distribution</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Median HH Income" value={csm.MEHOINUSA672N?.current} color="#F2A93B" format="dollar" subtitle="Census Bureau, annual" date={csm.MEHOINUSA672N?.lastDate} />
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
        <thead>
          <tr>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Percentile</th>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Threshold</th>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Median Income</th>
          </tr>
        </thead>
        <tbody>
          {incDist.map((row, i) => (
            <tr key={row.group} style={{ borderBottom: i < incDist.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: row.color, fontWeight: 600 }}>{row.group}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right" }}>{row.threshold}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#e2e8f0", textAlign: "right", fontWeight: 600 }}>{row.median}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <InfoBox color="#F2A93B">
      <strong style={{ color: "#cbd5e1" }}>Income thresholds</strong> are approximate, based on Census Bureau Current Population Survey and Survey of Consumer Finances (2023). Median household income from FRED (MEHOINUSA672N) is updated annually.
    </InfoBox>
    <ChartCard data={incChart} series={{ MEHOINUSA672N: { label: "Median Household Income", color: "#F2A93B" } }} title="Median Household Income ($)" yFormatter={v => `$${(v/1000).toFixed(0)}K`} />
  </>);
}

export default ConsumerTab;
