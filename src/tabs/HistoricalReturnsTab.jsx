import React, { useState, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, BarChart, Bar, Cell, ReferenceLine, LineChart, Line, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { HIST_DATA } from "../lib/constants.js";
import { SH, InfoBox } from "../components/shared.jsx";

const ASSET_CLASSES = [
  { key: "sp", label: "S&P 500", color: "#E8553A" },
  { key: "sc", label: "Small Cap", color: "#F97316" },
  { key: "tb", label: "T-Bills", color: "#10B981" },
  { key: "bond", label: "10Y T-Bond", color: "#3B82F6" },
  { key: "baa", label: "Baa Corp Bond", color: "#8B5CF6" },
  { key: "re", label: "Real Estate", color: "#D946EF" },
  { key: "gold", label: "Gold", color: "#F59E0B" },
];

const CUM_KEYS = { sp: "spCum", sc: "scCum", tb: "tbCum", bond: "bondCum", baa: "baaCum", re: "reCum", gold: "goldCum" };

function HistoricalReturnsTab() {
  const [startYear, setStartYear] = useState(1928);
  const [endYear, setEndYear] = useState(2025);
  const [view, setView] = useState("table");
  const [barAsset, setBarAsset] = useState("sp");
  const minY = 1928, maxY = 2025;

  const filtered = HIST_DATA.filter(d => d.y >= startYear && d.y <= endYear);
  const years = filtered.length;

  const stats = {};
  ASSET_CLASSES.forEach(ac => {
    const vals = filtered.map(d => d[ac.key]).filter(v => v != null);
    const n = vals.length;
    if (!n) { stats[ac.key] = {}; return; }
    const arith = vals.reduce((s, v) => s + v, 0) / n;
    const cumKey = CUM_KEYS[ac.key];
    const firstCum = filtered.find(d => d[cumKey] != null);
    const lastCum = [...filtered].reverse().find(d => d[cumKey] != null);
    let geo = null;
    if (firstCum && lastCum && firstCum !== lastCum) {
      const startVal = firstCum[cumKey] / (1 + firstCum[ac.key]);
      const endVal = lastCum[cumKey];
      if (startVal > 0 && endVal > 0) { geo = Math.pow(endVal / startVal, 1 / n) - 1; }
    }
    const best = Math.max(...vals);
    const worst = Math.min(...vals);
    const bestYr = filtered[vals.indexOf(best)]?.y;
    const worstYr = filtered[vals.indexOf(worst)]?.y;
    const positiveYrs = vals.filter(v => v > 0).length;
    stats[ac.key] = { arith, geo, best, worst, bestYr, worstYr, positiveYrs, n };
  });

  const growthData = [];
  const running = {};
  ASSET_CLASSES.forEach(ac => { running[ac.key] = 100; });
  filtered.forEach(d => {
    const row = { d: String(d.y) };
    ASSET_CLASSES.forEach(ac => {
      const r = d[ac.key];
      if (r != null) running[ac.key] *= (1 + r);
      row[ac.key] = Math.round(running[ac.key] * 100) / 100;
    });
    growthData.push(row);
  });

  const barData = filtered.map(d => ({ d: String(d.y), v: d[barAsset] })).filter(r => r.v != null);
  const premData = filtered.map(d => ({ d: String(d.y), stb: d.stb, sbo: d.sbo, scp: d.scp }));

  const viewBtns = [
    { id: "table", label: "Summary Table" },
    { id: "growth", label: "Growth of $100" },
    { id: "bars", label: "Annual Returns" },
    { id: "premiums", label: "Risk Premiums" },
  ];

  return (<>
    <SH>Historical Returns (1928–2025)</SH>
    <InfoBox color="#E8553A">
      <strong style={{ color: "#cbd5e1" }}>Source: Aswath Damodaran, NYU Stern.</strong> Annual returns on major asset classes including dividends/coupons reinvested. S&P 500, small cap (bottom decile), T-Bills, 10-year T-Bonds, Baa corporate bonds, residential real estate (Case-Shiller), and gold.
    </InfoBox>

    {/* Year range selector */}
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>From</span>
        <input type="number" min={minY} max={maxY} value={startYear} onChange={e => setStartYear(Math.max(minY, Math.min(+e.target.value, endYear)))}
          style={{ width: 70, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 8px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, textAlign: "center" }} />
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>to</span>
        <input type="number" min={minY} max={maxY} value={endYear} onChange={e => setEndYear(Math.max(startYear, Math.min(+e.target.value, maxY)))}
          style={{ width: 70, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 8px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, textAlign: "center" }} />
        <span style={{ fontSize: 11, color: "#475569", fontFamily: fonts.mono }}>({years} yrs)</span>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {[["All", 1928, 2025], ["50Y", 1976, 2025], ["25Y", 2001, 2025], ["10Y", 2016, 2025]].map(([lbl, s, e]) => (
          <button key={lbl} onClick={() => { setStartYear(s); setEndYear(e); }}
            style={{ padding: "5px 10px", fontSize: 10, fontFamily: fonts.mono, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, background: startYear === s && endYear === e ? "rgba(232,85,58,0.2)" : "rgba(255,255,255,0.03)", color: startYear === s && endYear === e ? "#E8553A" : "#94a3b8", cursor: "pointer" }}>{lbl}</button>
        ))}
      </div>
    </div>

    {/* View toggle */}
    <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
      {viewBtns.map(v => (
        <button key={v.id} onClick={() => setView(v.id)} style={{
          flex: 1, padding: "8px 10px", border: "none", borderRadius: 8,
          background: view === v.id ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
          color: view === v.id ? "#f1f5f9" : "#64748b", fontSize: 11, fontWeight: view === v.id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", boxShadow: view === v.id ? "0 2px 6px rgba(0,0,0,0.3)" : "none",
        }}>{v.label}</button>
      ))}
    </div>

    {/* SUMMARY TABLE */}
    {view === "table" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr>
              {["Asset Class", "Arith Avg", "Geo Avg", "Best Year", "Worst Year", "% Positive"].map((h, i) => (
                <th key={h} style={{ padding: "11px 10px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#141829" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ASSET_CLASSES.map((ac, ri) => {
              const s = stats[ac.key] || {};
              return (
                <tr key={ac.key} style={{ borderBottom: ri < ASSET_CLASSES.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "11px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: ac.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>{ac.label}</span>
                  </td>
                  <td style={{ padding: "11px 10px", fontSize: 13, fontFamily: fonts.mono, color: (s.arith||0) >= 0 ? "#10B981" : "#EF4444", textAlign: "right", fontWeight: 600 }}>{s.arith != null ? `${(s.arith*100).toFixed(2)}%` : "—"}</td>
                  <td style={{ padding: "11px 10px", fontSize: 13, fontFamily: fonts.mono, color: (s.geo||0) >= 0 ? "#10B981" : "#EF4444", textAlign: "right", fontWeight: 600 }}>{s.geo != null ? `${(s.geo*100).toFixed(2)}%` : "—"}</td>
                  <td style={{ padding: "11px 10px", fontSize: 12, fontFamily: fonts.mono, color: "#10B981", textAlign: "right" }}>{s.best != null ? `${(s.best*100).toFixed(1)}% (${s.bestYr})` : "—"}</td>
                  <td style={{ padding: "11px 10px", fontSize: 12, fontFamily: fonts.mono, color: "#EF4444", textAlign: "right" }}>{s.worst != null ? `${(s.worst*100).toFixed(1)}% (${s.worstYr})` : "—"}</td>
                  <td style={{ padding: "11px 10px", fontSize: 12, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{s.n ? `${((s.positiveYrs/s.n)*100).toFixed(0)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Equity Risk Premiums ({startYear}–{endYear})</div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              { label: "Stocks − T.Bills (Arith)", vals: filtered.map(d => d.stb).filter(v => v != null) },
              { label: "Stocks − T.Bonds (Arith)", vals: filtered.map(d => d.sbo).filter(v => v != null) },
              { label: "Small Cap Premium", vals: filtered.map(d => d.scp).filter(v => v != null) },
            ].map(p => {
              const a = p.vals.length ? p.vals.reduce((s,v)=>s+v,0)/p.vals.length : null;
              return (
                <div key={p.label}>
                  <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono }}>{p.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{a != null ? `${(a*100).toFixed(2)}%` : "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {/* GROWTH OF $100 */}
    {view === "growth" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Growth of $100 ({startYear}–{endYear})</div>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={growthData} margin={{ top: 5, right: 8, left: 10, bottom: 0 }}>
            <defs>{ASSET_CLASSES.map(ac => <linearGradient key={ac.key} id={`gh-${ac.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ac.color} stopOpacity={0.15} /><stop offset="95%" stopColor={ac.color} stopOpacity={0} /></linearGradient>)}</defs>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(1, Math.floor(years/12))} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} scale="log" domain={["auto","auto"]} tickFormatter={v => v >= 1000000 ? `$${(v/1000000).toFixed(0)}M` : v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v.toFixed(0)}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} labelStyle={{ color: "#94a3b8" }} formatter={(v, n) => [`$${v >= 1000 ? v.toLocaleString(undefined,{maximumFractionDigits:0}) : v.toFixed(2)}`, n]} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <ReferenceLine y={100} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
            {ASSET_CLASSES.map(ac => <Area key={ac.key} type="monotone" dataKey={ac.key} name={ac.label} stroke={ac.color} fill={`url(#gh-${ac.key})`} strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />)}
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, padding: "8px 12px 4px" }}>Y-axis is logarithmic to show relative growth across orders of magnitude.</div>
      </div>
    )}

    {/* ANNUAL RETURNS BAR CHART */}
    {view === "bars" && (<>
      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {ASSET_CLASSES.map(ac => (
          <button key={ac.key} onClick={() => setBarAsset(ac.key)} style={{
            padding: "6px 12px", fontSize: 11, fontFamily: fonts.heading, border: "none", borderRadius: 6,
            background: barAsset === ac.key ? ac.color + "33" : "rgba(255,255,255,0.03)",
            color: barAsset === ac.key ? ac.color : "#94a3b8", cursor: "pointer", fontWeight: barAsset === ac.key ? 600 : 400,
          }}>{ac.label}</button>
        ))}
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>{ASSET_CLASSES.find(a=>a.key===barAsset)?.label} Annual Returns</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 8, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(1, Math.floor(barData.length/15))} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${(v*100).toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${(v*100).toFixed(2)}%`, "Return"]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
            <Bar dataKey="v" name="Return" radius={[2,2,0,0]}>
              {barData.map((d, i) => <Cell key={i} fill={d.v >= 0 ? ASSET_CLASSES.find(a=>a.key===barAsset)?.color || "#10B981" : "#EF4444"} fillOpacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>)}

    {/* RISK PREMIUMS */}
    {view === "premiums" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Equity Risk Premiums ({startYear}–{endYear})</div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={premData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gp-stb" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#E8553A" stopOpacity={0.2} /><stop offset="95%" stopColor="#E8553A" stopOpacity={0} /></linearGradient>
              <linearGradient id="gp-sbo" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} /><stop offset="95%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient>
              <linearGradient id="gp-scp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F59E0B" stopOpacity={0.2} /><stop offset="95%" stopColor="#F59E0B" stopOpacity={0} /></linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(1, Math.floor(premData.length/12))} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${(v*100).toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`${(v*100).toFixed(2)}%`, n]} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
            <Area type="monotone" dataKey="stb" name="Stocks − Bills" stroke="#E8553A" fill="url(#gp-stb)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="sbo" name="Stocks − Bonds" stroke="#3B82F6" fill="url(#gp-sbo)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="scp" name="Small Cap Premium" stroke="#F59E0B" fill="url(#gp-scp)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <InfoBox color="#3B82F6">
          <strong style={{ color: "#cbd5e1" }}>Equity risk premium</strong> = extra return stocks earned over "risk-free" assets. <strong style={{ color: "#cbd5e1" }}>Stocks − Bills</strong> is the premium over cash. <strong style={{ color: "#cbd5e1" }}>Stocks − Bonds</strong> is the premium over 10-year treasuries. The <strong style={{ color: "#cbd5e1" }}>small cap premium</strong> is the extra return of the smallest stocks over the S&P 500.
        </InfoBox>
      </div>
    )}

    {/* Year-by-year data table */}
    <SH>Year-by-Year Returns</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", maxHeight: 500 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "#141829", zIndex: 2 }}>
            <th style={{ padding: "10px 8px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", left: 0, background: "#141829", zIndex: 3 }}>YEAR</th>
            {ASSET_CLASSES.map(ac => (
              <th key={ac.key} style={{ padding: "10px 6px", fontSize: 10, color: ac.color, fontFamily: fonts.mono, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{ac.label.toUpperCase()}</th>
            ))}
            <th style={{ padding: "10px 6px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>INFLATION</th>
          </tr>
        </thead>
        <tbody>
          {[...filtered].reverse().map((d, ri) => (
            <tr key={d.y} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
              <td style={{ padding: "7px 8px", fontSize: 12, fontFamily: fonts.mono, color: "#94a3b8", fontWeight: 600, position: "sticky", left: 0, background: ri % 2 === 0 ? "#141829" : "#131625", zIndex: 1 }}>{d.y}</td>
              {ASSET_CLASSES.map(ac => {
                const v = d[ac.key];
                return (
                  <td key={ac.key} style={{ padding: "7px 6px", fontSize: 12, fontFamily: fonts.mono, textAlign: "right", color: v == null ? "#334155" : v >= 0 ? "#10B981" : "#EF4444", background: v != null && Math.abs(v) > 0.3 ? (v > 0 ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)") : "transparent" }}>
                    {v != null ? `${(v*100).toFixed(1)}%` : "—"}
                  </td>
                );
              })}
              <td style={{ padding: "7px 6px", fontSize: 12, fontFamily: fonts.mono, textAlign: "right", color: d.inf != null ? (d.inf > 0.05 ? "#EF4444" : "#94a3b8") : "#334155" }}>
                {d.inf != null ? `${(d.inf*100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}


export default HistoricalReturnsTab;
