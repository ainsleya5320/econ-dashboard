import React, { useState, useEffect } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { US_MORTGAGE_SERIES, TREASURY_SERIES } from "../lib/constants.js";
import { fetchFMP } from "../lib/api.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH } from "../components/shared.jsx";

const BOND_ETFS = [
  { symbol: "AGG",  label: "U.S. Aggregate Bond",      color: "#818cf8", category: "Broad" },
  { symbol: "TLT",  label: "20+ Year Treasury",         color: "#6366f1", category: "Treasury" },
  { symbol: "IEF",  label: "7-10 Year Treasury",        color: "#8b5cf6", category: "Treasury" },
  { symbol: "SHY",  label: "1-3 Year Treasury",         color: "#a78bfa", category: "Treasury" },
  { symbol: "TIP",  label: "TIPS (Inflation-Protected)", color: "#f97316", category: "Treasury" },
  { symbol: "LQD",  label: "IG Corporate Bond",         color: "#3b82f6", category: "Corporate" },
  { symbol: "HYG",  label: "High Yield Corporate",      color: "#ef4444", category: "Corporate" },
  { symbol: "MUB",  label: "Municipal Bond",            color: "#22c55e", category: "Muni" },
  { symbol: "BNDX", label: "International Bond",        color: "#14b8a6", category: "International" },
  { symbol: "EMB",  label: "Emerging Markets Bond",     color: "#f59e0b", category: "International" },
];

function RatesTab({ md, td, fmpKey }) {
  const mc = (md.MORTGAGE30US?.history || []).map(h => { const r = { d: h.d }; Object.keys(US_MORTGAGE_SERIES).forEach(k => { const m = md[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; }); return r; });
  const tc = (td.DGS10?.history || []).map(h => { const r = { d: h.d }; Object.keys(TREASURY_SERIES).forEach(k => { const m = td[k]?.history?.find(x => x.d === h.d); if (m) r[k] = m.v; }); return r; });

  const [yieldCurve, setYieldCurve] = useState(null);
  const [bondQuotes, setBondQuotes] = useState(null);

  // Fetch yield curve from FMP treasury-rates (7-day window for reliability)
  useEffect(() => {
    if (!fmpKey) return;
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    fetchFMP(`/treasury-rates?from=${from}&to=${to}`, fmpKey)
      .then(data => {
        if (Array.isArray(data) && data.length) {
          const latest = data[0];
          const points = [
            { label: "1M", months: 1, value: latest.month1 },
            { label: "2M", months: 2, value: latest.month2 },
            { label: "3M", months: 3, value: latest.month3 },
            { label: "6M", months: 6, value: latest.month6 },
            { label: "1Y", months: 12, value: latest.year1 },
            { label: "2Y", months: 24, value: latest.year2 },
            { label: "3Y", months: 36, value: latest.year3 },
            { label: "5Y", months: 60, value: latest.year5 },
            { label: "7Y", months: 84, value: latest.year7 },
            { label: "10Y", months: 120, value: latest.year10 },
            { label: "20Y", months: 240, value: latest.year20 },
            { label: "30Y", months: 360, value: latest.year30 },
          ].filter(p => p.value != null);
          setYieldCurve({ date: latest.date, points });
        }
      })
      .catch(e => console.error("Yield curve fetch error:", e));
  }, [fmpKey]);

  // Fetch bond ETF quotes + profiles (for dividend yield)
  useEffect(() => {
    if (!fmpKey) return;
    Promise.all(
      BOND_ETFS.map(e =>
        Promise.all([
          fetchFMP(`/quote?symbol=${e.symbol}`, fmpKey).then(d => (Array.isArray(d) && d.length) ? d[0] : null).catch(() => null),
          fetchFMP(`/profile?symbol=${e.symbol}`, fmpKey).then(d => (Array.isArray(d) && d.length) ? d[0] : null).catch(() => null),
        ]).then(([quote, profile]) => {
          if (!quote) return null;
          const divYield = (profile?.lastDividend && quote.price) ? (profile.lastDividend / quote.price) * 100 : null;
          return { ...quote, divYield, lastDividend: profile?.lastDividend };
        })
      )
    ).then(results => {
      const map = {};
      results.forEach(d => { if (d?.symbol) map[d.symbol] = d; });
      if (Object.keys(map).length) setBondQuotes(map);
    });
  }, [fmpKey]);

  const chgColor = (v) => v == null ? "#64748b" : v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#64748b";

  return (<>
    <SH>U.S. Treasury Yields</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 14 }}>
      {Object.entries(TREASURY_SERIES).map(([id, m]) => <RateCard key={id} label={m.label} value={td[id]?.current} color={m.color} date={td[id]?.lastDate} small />)}
    </div>
    {/* Yield Curve */}
    {yieldCurve && yieldCurve.points.length > 2 && (<>
      <SH>Treasury Yield Curve {yieldCurve.date ? `(${fmtDate(yieldCurve.date)})` : ""}</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={yieldCurve.points}>
            <defs>
              <linearGradient id="ycGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: fonts.mono }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => `${v.toFixed(1)}%`} domain={["dataMin - 0.2", "dataMax + 0.2"]} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
              formatter={v => [`${v.toFixed(2)}%`, "Yield"]} />
            <Area type="monotone" dataKey="value" stroke="#818cf8" fill="url(#ycGrad)" strokeWidth={2} dot={{ fill: "#818cf8", r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>)}

    <ChartCard data={tc} series={TREASURY_SERIES} title="Treasury Yield Trends" />

    {/* Bond ETFs */}
    {bondQuotes && (<>
      <SH>Bond Market ETFs</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
        {BOND_ETFS.map(e => {
          const q = bondQuotes[e.symbol];
          if (!q) return null;
          return (
            <div key={e.symbol} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: e.color, fontFamily: fonts.mono, fontWeight: 600 }}>{e.symbol}</div>
                <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>{e.category}</div>
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.heading, marginBottom: 4 }}>{e.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>
                  ${q.price?.toFixed(2) ?? "—"}
                </span>
                {q.divYield != null && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: fonts.mono }}>
                    {q.divYield.toFixed(2)}% yield
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(q.changePercentage) }}>
                  Day {q.changePercentage > 0 ? "+" : ""}{q.changePercentage?.toFixed(2)}%
                </span>
                {q.lastDividend != null && (
                  <span style={{ fontSize: 9, fontFamily: fonts.mono, color: "#94a3b8" }}>
                    ${q.lastDividend.toFixed(2)}/yr
                  </span>
                )}
                {q.yearHigh != null && q.yearLow != null && (
                  <span style={{ fontSize: 9, fontFamily: fonts.mono, color: "#64748b" }}>
                    52W: ${q.yearLow.toFixed(0)}-${q.yearHigh.toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>)}

    <SH>U.S. Mortgage Rates</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      {Object.entries(US_MORTGAGE_SERIES).map(([id, m]) => <RateCard key={id} label={m.label} value={md[id]?.current} color={m.color} subtitle="Weekly avg" date={md[id]?.lastDate} />)}
    </div>
    <ChartCard data={mc} series={US_MORTGAGE_SERIES} title="Mortgage Rate Trends" />
  </>);
}

export default RatesTab;
