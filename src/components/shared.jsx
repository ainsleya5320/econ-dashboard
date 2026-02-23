import React from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";

function fmtDate(d) { if (!d) return ""; const p = d.split("-"); const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1]; return p[2] ? `${mn} ${+p[2]}, ${p[0]}` : `${mn} ${p[0]}`; }

function RateCard({ label, value, flag, color, subtitle, format, small, date }) {
  const disp = () => {
    if (value == null) return "—";
    if (format === "dollar") return `$${(value/1000).toFixed(0)}K`;
    if (format === "bigdollar") { const a = Math.abs(value); if (a >= 1e6) return `$${(value/1e6).toFixed(1)}T`; if (a >= 1e3) return `$${(value/1e3).toFixed(1)}B`; return `$${value.toFixed(0)}M`; }
    if (format === "thousands") return `${(value/1000).toFixed(1)}K`;
    if (format === "months") return value.toFixed(1);
    if (format === "index") return value.toFixed(1);
    if (format === "plain") return value.toLocaleString();
    return `${value.toFixed(2)}%`;
  };
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: small ? "12px 14px" : "16px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {flag && <span style={{ fontSize: small ? 14 : 18 }}>{flag}</span>}
        <span style={{ fontSize: small ? 10 : 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize: small ? 22 : 28, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{disp()}</div>
      {(subtitle || date) && <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{subtitle}{subtitle && date ? " · " : ""}{date && <span style={{ color: "#4ade80" }}>{fmtDate(date)}</span>}</div>}
    </div>
  );
}

function fmtAxisDate(d) { const p = d.split("-"); const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1]; return p[2] ? `${mn} ${+p[2]}` : `${mn} ${p[0]}`; }

function ChartCard({ data, series, title, height = 200, yFormatter, refLine }) {
  if (!data || !data.length) return null;
  const tickInt = Math.max(0, Math.floor(data.length / 8) - 1);
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>{Object.entries(series).map(([k, s]) => <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={s.color} stopOpacity={0.25} /><stop offset="95%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={[dMin => { const pad = Math.max(Math.abs(dMin) * 0.1, 0.5); return Math.floor((dMin - pad) * 10) / 10; }, dMax => { const pad = Math.max(Math.abs(dMax) * 0.1, 0.5); return Math.ceil((dMax + pad) * 10) / 10; }]} tickFormatter={yFormatter || (v => `${v}%`)} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelStyle={{ color: "#94a3b8" }} labelFormatter={fmtDate} formatter={(v, n) => [yFormatter ? yFormatter(v) : `${v.toFixed(2)}%`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          {refLine !== undefined && <ReferenceLine y={refLine} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />}
          {Object.entries(series).map(([k, s]) => <Area key={k} type="monotone" dataKey={k} name={s.label} stroke={s.color} fill={`url(#g-${k})`} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />)}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SH({ children }) { return <h2 style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", fontFamily: fonts.heading, margin: "28px 0 14px", paddingBottom: 7, letterSpacing: -0.3, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{children}</h2>; }
function InfoBox({ color, children }) { return <div style={{ background: `${color}0a`, border: `1px solid ${color}22`, borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}><div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{children}</div></div>; }

export { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox };
