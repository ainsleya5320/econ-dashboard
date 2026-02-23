import React from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { US_MORTGAGE_SERIES } from "../lib/constants.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

function HousingTab({ hd, md }) {
  const ph = hd.MSPUS?.history || [];
  const ac = (hd.HOUST?.history || []).map(h => { const r = { d: h.d, HOUST: h.v }; const p = hd.PERMIT?.history?.find(x => x.d === h.d); if (p) r.PERMIT = p.v; return r; });
  return (<>
    <SH>Home Prices</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Median Home Price" value={hd.MSPUS?.current} color="#E8553A" format="dollar" subtitle="Quarterly" date={hd.MSPUS?.lastDate} />
      <RateCard label="Case-Shiller Index" value={hd.CSUSHPINSA?.current} color="#3B82F6" format="index" subtitle="National HPI" date={hd.CSUSHPINSA?.lastDate} />
      <RateCard label="30-Year Mortgage" value={md.MORTGAGE30US?.current} color="#F59E0B" subtitle="Borrowing cost context" date={md.MORTGAGE30US?.lastDate} />
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Median Home Price</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={ph} margin={{ top: 5, right: 8, left: 5, bottom: 0 }}>
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} domain={["auto","auto"]} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate} formatter={v => [`$${v.toLocaleString()}`, "Median Price"]} />
          <Bar dataKey="v" name="Median Price" radius={[4,4,0,0]}>{ph.map((_, i) => <Cell key={i} fill={i === ph.length - 1 ? "#E8553A" : "#E8553A66"} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <SH>Housing Activity</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Housing Starts" value={hd.HOUST?.current} color="#10B981" format="thousands" subtitle="Thousands, SAAR" date={hd.HOUST?.lastDate} small />
      <RateCard label="Building Permits" value={hd.PERMIT?.current} color="#8B5CF6" format="thousands" subtitle="Thousands, SAAR" date={hd.PERMIT?.lastDate} small />
      <RateCard label="Existing Sales" value={hd.EXHOSLUSM495S?.current} color="#F59E0B" format="thousands" subtitle="Thousands, SAAR" date={hd.EXHOSLUSM495S?.lastDate} small />
      <RateCard label="Months Supply" value={hd.MSACSR?.current} color="#D946EF" format="months" subtitle={hd.MSACSR?.current < 4 ? "Tight market" : hd.MSACSR?.current > 6 ? "Buyer's market" : "Balanced"} date={hd.MSACSR?.lastDate} small />
    </div>
    <InfoBox color="#10B981"><strong style={{ color: "#cbd5e1" }}>Months' supply</strong> under 4 = seller's market; over 6 = buyer's market. <strong style={{ color: "#cbd5e1" }}>Starts</strong> and <strong style={{ color: "#cbd5e1" }}>permits</strong> are leading indicators of future supply.</InfoBox>
    <ChartCard data={ac} series={{ HOUST: { label: "Housing Starts", color: "#10B981" }, PERMIT: { label: "Building Permits", color: "#8B5CF6" } }} title="New Construction (Thousands, SAAR)" yFormatter={v => `${v}`} />
    <div style={{ height: 14 }} />
    <ChartCard data={(hd.MSACSR?.history || []).map(h => ({ d: h.d, MSACSR: h.v }))} series={{ MSACSR: { label: "Months' Supply", color: "#D946EF" } }} title="Months' Supply of Homes" yFormatter={v => `${v}`} refLine={6} />
  </>);
}

export default HousingTab;
