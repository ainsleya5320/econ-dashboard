import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, LineChart, Line, CartesianGrid } from "recharts";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { GLOBAL_RATE_SERIES } from "../lib/constants.js";
import { fetchFMP } from "../lib/api.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

const Plot = createPlotlyComponent(Plotly);

const INTL_ETFS = [
  { symbol: "EFA",  label: "EAFE (Developed ex-US)", flag: "🌍", color: "#818cf8" },
  { symbol: "VWO",  label: "Emerging Markets",       flag: "🌏", color: "#f97316" },
  { symbol: "EWJ",  label: "Japan",                  flag: "🇯🇵", color: "#ec4899" },
  { symbol: "EWG",  label: "Germany",                flag: "🇩🇪", color: "#fbbf24" },
  { symbol: "EWU",  label: "United Kingdom",         flag: "🇬🇧", color: "#8b5cf6" },
  { symbol: "FXI",  label: "China",                  flag: "🇨🇳", color: "#ef4444" },
  { symbol: "INDA", label: "India",                  flag: "🇮🇳", color: "#f97316" },
  { symbol: "EWZ",  label: "Brazil",                 flag: "🇧🇷", color: "#22c55e" },
  { symbol: "EWY",  label: "South Korea",            flag: "🇰🇷", color: "#14b8a6" },
  { symbol: "EWA",  label: "Australia",              flag: "🇦🇺", color: "#6366f1" },
  { symbol: "EWC",  label: "Canada",                 flag: "🇨🇦", color: "#e11d48" },
  { symbol: "EWL",  label: "Switzerland",            flag: "🇨🇭", color: "#10b981" },
];

const FX_PAIRS = [
  { symbol: "EURUSD", label: "EUR/USD", flag: "🇪🇺", base: "Euro", color: "#3b82f6" },
  { symbol: "GBPUSD", label: "GBP/USD", flag: "🇬🇧", base: "British Pound", color: "#8b5cf6" },
  { symbol: "USDJPY", label: "USD/JPY", flag: "🇯🇵", base: "Japanese Yen", color: "#ec4899", invert: true },
  { symbol: "USDCHF", label: "USD/CHF", flag: "🇨🇭", base: "Swiss Franc", color: "#10b981", invert: true },
  { symbol: "AUDUSD", label: "AUD/USD", flag: "🇦🇺", base: "Australian Dollar", color: "#6366f1" },
  { symbol: "USDCAD", label: "USD/CAD", flag: "🇨🇦", base: "Canadian Dollar", color: "#e11d48", invert: true },
  { symbol: "NZDUSD", label: "NZD/USD", flag: "🇳🇿", base: "New Zealand Dollar", color: "#14b8a6" },
  { symbol: "USDCNY", label: "USD/CNY", flag: "🇨🇳", base: "Chinese Yuan", color: "#ef4444", invert: true },
  { symbol: "USDINR", label: "USD/INR", flag: "🇮🇳", base: "Indian Rupee", color: "#f97316", invert: true },
  { symbol: "USDBRL", label: "USD/BRL", flag: "🇧🇷", base: "Brazilian Real", color: "#22c55e", invert: true },
  { symbol: "USDMXN", label: "USD/MXN", flag: "🇲🇽", base: "Mexican Peso", color: "#d946ef", invert: true },
  { symbol: "USDKRW", label: "USD/KRW", flag: "🇰🇷", base: "South Korean Won", color: "#fbbf24", invert: true },
];

const INTL_SUB_TABS = [
  { id: "markets", label: "Market Overview" },
  { id: "forex", label: "Forex" },
];

function InternationalTab({ fmpKey }) {
  const [intlSub, setIntlSub] = useState("markets");
  const [quotes, setQuotes] = useState(null);
  const [history, setHistory] = useState(null);
  const [sortCol, setSortCol] = useState("ytd");
  const [sortAsc, setSortAsc] = useState(false);
  const [fxQuotes, setFxQuotes] = useState(null);
  const [fxHistory, setFxHistory] = useState(null);
  const [fxSortCol, setFxSortCol] = useState("dayChg");
  const [fxSortAsc, setFxSortAsc] = useState(false);

  // Fetch ETF quotes on mount
  useEffect(() => {
    if (!fmpKey) return;
    Promise.all(
      INTL_ETFS.map(e =>
        fetchFMP(`/quote?symbol=${e.symbol}`, fmpKey)
          .then(data => (Array.isArray(data) && data.length) ? data[0] : null)
          .catch(() => null)
      )
    ).then(results => {
      const map = {};
      results.forEach(d => { if (d?.symbol) map[d.symbol] = d; });
      if (Object.keys(map).length) setQuotes(map);
    });
  }, [fmpKey]);

  // Fetch YTD historical data for ETF performance chart
  useEffect(() => {
    if (!fmpKey) return;
    const ytdStart = `${new Date().getFullYear()}-01-01`;
    Promise.all(
      INTL_ETFS.map(e =>
        fetchFMP(`/historical-price-eod/light?symbol=${e.symbol}&from=${ytdStart}`, fmpKey)
          .then(data => ({ symbol: e.symbol, data: Array.isArray(data) ? data : [] }))
          .catch(() => ({ symbol: e.symbol, data: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.symbol] = r.data; });
      setHistory(map);
    });
  }, [fmpKey]);

  // Fetch forex quotes when forex sub-tab first selected
  useEffect(() => {
    if (intlSub !== "forex" || fxQuotes || !fmpKey) return;
    Promise.all(
      FX_PAIRS.map(p =>
        fetchFMP(`/quote?symbol=${p.symbol}`, fmpKey)
          .then(data => (Array.isArray(data) && data.length) ? data[0] : null)
          .catch(() => null)
      )
    ).then(results => {
      const map = {};
      results.forEach(d => { if (d?.symbol) map[d.symbol] = d; });
      if (Object.keys(map).length) setFxQuotes(map);
    });
  }, [intlSub, fxQuotes, fmpKey]);

  // Fetch forex YTD history when forex sub-tab first selected
  useEffect(() => {
    if (intlSub !== "forex" || fxHistory || !fmpKey) return;
    const ytdStart = `${new Date().getFullYear()}-01-01`;
    Promise.all(
      FX_PAIRS.filter(p => !p.invert).map(p =>
        fetchFMP(`/historical-price-eod/light?symbol=${p.symbol}&from=${ytdStart}`, fmpKey)
          .then(data => ({ symbol: p.symbol, data: Array.isArray(data) ? data : [] }))
          .catch(() => ({ symbol: p.symbol, data: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.symbol] = r.data; });
      setFxHistory(map);
    });
  }, [intlSub, fxHistory, fmpKey]);

  // ETF YTD %
  const ytdPct = useMemo(() => {
    if (!history || !quotes) return {};
    const result = {};
    INTL_ETFS.forEach(e => {
      const hist = history[e.symbol];
      const q = quotes[e.symbol];
      if (!hist?.length || !q) return;
      const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
      const startPrice = sorted[0]?.price;
      if (startPrice && q.price) result[e.symbol] = ((q.price - startPrice) / startPrice) * 100;
    });
    return result;
  }, [history, quotes]);

  // ETF normalized YTD chart
  const chartData = useMemo(() => {
    if (!history) return [];
    const dateSet = new Set();
    INTL_ETFS.forEach(e => { (history[e.symbol] || []).forEach(d => dateSet.add(d.date)); });
    const dates = [...dateSet].sort();
    if (!dates.length) return [];
    const bases = {};
    INTL_ETFS.forEach(e => {
      const sorted = [...(history[e.symbol] || [])].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length) bases[e.symbol] = sorted[0].price;
    });
    const priceLookup = {};
    INTL_ETFS.forEach(e => {
      priceLookup[e.symbol] = {};
      (history[e.symbol] || []).forEach(d => { priceLookup[e.symbol][d.date] = d.price; });
    });
    const lastPrice = {};
    return dates.map(date => {
      const row = { date };
      INTL_ETFS.forEach(e => {
        const p = priceLookup[e.symbol][date];
        if (p != null) lastPrice[e.symbol] = p;
        if (lastPrice[e.symbol] != null && bases[e.symbol]) row[e.symbol] = (lastPrice[e.symbol] / bases[e.symbol]) * 100;
      });
      return row;
    });
  }, [history]);

  // Forex YTD %
  const fxYtdPct = useMemo(() => {
    if (!fxHistory || !fxQuotes) return {};
    const result = {};
    FX_PAIRS.forEach(p => {
      const hist = fxHistory[p.symbol];
      const q = fxQuotes[p.symbol];
      if (!hist?.length || !q) return;
      const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
      const startPrice = sorted[0]?.price;
      if (startPrice && q.price) result[p.symbol] = ((q.price - startPrice) / startPrice) * 100;
    });
    return result;
  }, [fxHistory, fxQuotes]);

  // Forex chart data (major pairs rebased to 100)
  const fxChartData = useMemo(() => {
    if (!fxHistory) return [];
    const majors = FX_PAIRS.filter(p => !p.invert);
    const dateSet = new Set();
    majors.forEach(p => { (fxHistory[p.symbol] || []).forEach(d => dateSet.add(d.date)); });
    const dates = [...dateSet].sort();
    if (!dates.length) return [];
    const bases = {};
    majors.forEach(p => {
      const sorted = [...(fxHistory[p.symbol] || [])].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length) bases[p.symbol] = sorted[0].price;
    });
    const priceLookup = {};
    majors.forEach(p => {
      priceLookup[p.symbol] = {};
      (fxHistory[p.symbol] || []).forEach(d => { priceLookup[p.symbol][d.date] = d.price; });
    });
    const lastPrice = {};
    return dates.map(date => {
      const row = { date };
      majors.forEach(p => {
        const pr = priceLookup[p.symbol][date];
        if (pr != null) lastPrice[p.symbol] = pr;
        if (lastPrice[p.symbol] != null && bases[p.symbol]) row[p.symbol] = (lastPrice[p.symbol] / bases[p.symbol]) * 100;
      });
      return row;
    });
  }, [fxHistory]);

  // ETF sortable table
  const tableRows = useMemo(() => {
    const rows = INTL_ETFS.map(e => ({
      ...e, price: quotes?.[e.symbol]?.price, dayChg: quotes?.[e.symbol]?.changePercentage,
      ytd: ytdPct[e.symbol] ?? null, yearHigh: quotes?.[e.symbol]?.yearHigh, yearLow: quotes?.[e.symbol]?.yearLow,
    }));
    rows.sort((a, b) => {
      let av, bv;
      if (sortCol === "region") { av = a.label; bv = b.label; return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av); }
      av = a[sortCol === "high" ? "yearHigh" : sortCol === "low" ? "yearLow" : sortCol] ?? -Infinity;
      bv = b[sortCol === "high" ? "yearHigh" : sortCol === "low" ? "yearLow" : sortCol] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [quotes, ytdPct, sortCol, sortAsc]);

  // Forex sortable table
  const fxTableRows = useMemo(() => {
    if (!fxQuotes) return [];
    const rows = FX_PAIRS.map(p => {
      const q = fxQuotes[p.symbol];
      return { ...p, price: q?.price, dayChg: q?.changePercentage, ytd: fxYtdPct[p.symbol] ?? null, yearHigh: q?.yearHigh, yearLow: q?.yearLow };
    });
    rows.sort((a, b) => {
      let av, bv;
      if (fxSortCol === "pair") { av = a.label; bv = b.label; return fxSortAsc ? av.localeCompare(bv) : bv.localeCompare(av); }
      av = a[fxSortCol === "high" ? "yearHigh" : fxSortCol === "low" ? "yearLow" : fxSortCol] ?? -Infinity;
      bv = b[fxSortCol === "high" ? "yearHigh" : fxSortCol === "low" ? "yearLow" : fxSortCol] ?? -Infinity;
      return fxSortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [fxQuotes, fxYtdPct, fxSortCol, fxSortAsc]);

  const toggleSort = (col) => { if (sortCol === col) setSortAsc(!sortAsc); else { setSortCol(col); setSortAsc(col === "region"); } };
  const sortArrow = (col) => sortCol === col ? (sortAsc ? " ▲" : " ▼") : "";
  const toggleFxSort = (col) => { if (fxSortCol === col) setFxSortAsc(!fxSortAsc); else { setFxSortCol(col); setFxSortAsc(col === "pair"); } };
  const fxSortArrow = (col) => fxSortCol === col ? (fxSortAsc ? " ▲" : " ▼") : "";
  const chgColor = (v) => v == null ? "#64748b" : v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#64748b";
  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", userSelect: "none" };

  return (<>
    {/* Sub-tab bar */}
    <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
      {INTL_SUB_TABS.map(t => (
        <button key={t.id} onClick={() => setIntlSub(t.id)} style={{
          flex: 1, padding: "8px 10px", border: "none", borderRadius: 8,
          background: intlSub === t.id ? "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(99,102,241,0.1))" : "transparent",
          color: intlSub === t.id ? "#c7d2fe" : "#64748b", fontSize: 12, fontWeight: intlSub === t.id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.15s",
          borderBottom: intlSub === t.id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{t.label}</button>
      ))}
    </div>

    {/* ===== MARKETS SUB-TAB ===== */}
    {intlSub === "markets" && (<>
      {!quotes ? <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading international market data...</div> : (<>
        <SH>International Market Overview</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 16 }}>
          {INTL_ETFS.map(e => {
            const q = quotes[e.symbol];
            const ytd = ytdPct[e.symbol];
            return (
              <div key={e.symbol} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{e.flag}</span>
                  <div>
                    <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600, fontFamily: fonts.heading }}>{e.label}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{e.symbol}</div>
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading, marginBottom: 4 }}>
                  {q?.price != null ? `$${q.price.toFixed(2)}` : "—"}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  {q?.changePercentage != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(q.changePercentage) }}>Day {q.changePercentage > 0 ? "+" : ""}{q.changePercentage.toFixed(2)}%</span>}
                  {ytd != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(ytd) }}>YTD {ytd > 0 ? "+" : ""}{ytd.toFixed(1)}%</span>}
                </div>
              </div>
            );
          })}
        </div>

        {chartData.length > 1 && (<>
          <SH>YTD Performance (Rebased to 100)</SH>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => v.toFixed(0)} domain={["dataMin - 2", "dataMax + 2"]} />
                <ReferenceLine y={100} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
                  formatter={(v, name) => { const etf = INTL_ETFS.find(e => e.symbol === name); return [`${v.toFixed(1)}`, `${etf?.flag || ""} ${etf?.label || name}`]; }}
                  labelFormatter={l => fmtDate(l)}
                />
                {INTL_ETFS.map(e => <Line key={e.symbol} type="monotone" dataKey={e.symbol} stroke={e.color} dot={false} strokeWidth={1.5} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>)}

        <SH>Regional Breakdown</SH>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(129,140,248,0.08)" }}>
                <th onClick={() => toggleSort("region")} style={{ ...thStyle, textAlign: "left" }}>Region{sortArrow("region")}</th>
                <th style={{ ...thStyle, textAlign: "center", width: 50, cursor: "default", color: "#64748b" }}>ETF</th>
                <th onClick={() => toggleSort("price")} style={{ ...thStyle, textAlign: "right", width: 80 }}>Price{sortArrow("price")}</th>
                <th onClick={() => toggleSort("dayChg")} style={{ ...thStyle, textAlign: "right", width: 80 }}>Day %{sortArrow("dayChg")}</th>
                <th onClick={() => toggleSort("ytd")} style={{ ...thStyle, textAlign: "right", width: 80 }}>YTD %{sortArrow("ytd")}</th>
                <th onClick={() => toggleSort("high")} style={{ ...thStyle, textAlign: "right", width: 80 }}>52W Hi{sortArrow("high")}</th>
                <th onClick={() => toggleSort("low")} style={{ ...thStyle, textAlign: "right", width: 80 }}>52W Lo{sortArrow("low")}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => (
                <tr key={r.symbol} style={{ borderBottom: i < tableRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}><span style={{ marginRight: 8 }}>{r.flag}</span>{r.label}</td>
                  <td style={{ padding: "10px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#64748b", textAlign: "center" }}>{r.symbol}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 600 }}>{r.price != null ? `$${r.price.toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.dayChg), textAlign: "right" }}>{r.dayChg != null ? `${r.dayChg > 0 ? "+" : ""}${r.dayChg.toFixed(2)}%` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.ytd), textAlign: "right", fontWeight: 600 }}>{r.ytd != null ? `${r.ytd > 0 ? "+" : ""}${r.ytd.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{r.yearHigh != null ? `$${r.yearHigh.toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{r.yearLow != null ? `$${r.yearLow.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
    </>)}

    {/* ===== FOREX SUB-TAB ===== */}
    {intlSub === "forex" && (<>
      {!fxQuotes ? <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading forex data...</div> : (<>
        <SH>Major Currency Pairs</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 16 }}>
          {FX_PAIRS.map(p => {
            const q = fxQuotes[p.symbol];
            const ytd = fxYtdPct[p.symbol];
            const decimals = (q?.price != null && q.price > 100) ? 2 : 4;
            return (
              <div key={p.symbol} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{p.flag}</span>
                  <div>
                    <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700, fontFamily: fonts.mono }}>{p.label}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.heading }}>{p.base}</div>
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono, marginBottom: 4 }}>
                  {q?.price != null ? q.price.toFixed(decimals) : "—"}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {q?.changePercentage != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(q.changePercentage) }}>Day {q.changePercentage > 0 ? "+" : ""}{q.changePercentage.toFixed(3)}%</span>}
                  {ytd != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(ytd) }}>YTD {ytd > 0 ? "+" : ""}{ytd.toFixed(1)}%</span>}
                  {q?.yearHigh != null && q?.yearLow != null && <span style={{ fontSize: 9, fontFamily: fonts.mono, color: "#64748b" }}>52W: {q.yearLow.toFixed(decimals > 2 ? 3 : 1)}-{q.yearHigh.toFixed(decimals > 2 ? 3 : 1)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Forex YTD chart (major XXX/USD pairs rebased to 100) */}
        {fxChartData.length > 1 && (<>
          <SH>Major Pairs vs USD — YTD (Rebased to 100)</SH>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={fxChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => v.toFixed(1)} domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                <ReferenceLine y={100} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
                  formatter={(v, name) => { const p = FX_PAIRS.find(f => f.symbol === name); return [`${v.toFixed(2)}`, `${p?.flag || ""} ${p?.label || name}`]; }}
                  labelFormatter={l => fmtDate(l)}
                />
                {FX_PAIRS.filter(p => !p.invert).map(p => <Line key={p.symbol} type="monotone" dataKey={p.symbol} stroke={p.color} dot={false} strokeWidth={1.5} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>)}

        {/* Forex sortable table */}
        <SH>All Currency Pairs</SH>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(129,140,248,0.08)" }}>
                <th onClick={() => toggleFxSort("pair")} style={{ ...thStyle, textAlign: "left" }}>Pair{fxSortArrow("pair")}</th>
                <th onClick={() => toggleFxSort("price")} style={{ ...thStyle, textAlign: "right", width: 100 }}>Rate{fxSortArrow("price")}</th>
                <th onClick={() => toggleFxSort("dayChg")} style={{ ...thStyle, textAlign: "right", width: 90 }}>Day %{fxSortArrow("dayChg")}</th>
                <th onClick={() => toggleFxSort("ytd")} style={{ ...thStyle, textAlign: "right", width: 90 }}>YTD %{fxSortArrow("ytd")}</th>
                <th onClick={() => toggleFxSort("high")} style={{ ...thStyle, textAlign: "right", width: 100 }}>52W Hi{fxSortArrow("high")}</th>
                <th onClick={() => toggleFxSort("low")} style={{ ...thStyle, textAlign: "right", width: 100 }}>52W Lo{fxSortArrow("low")}</th>
              </tr>
            </thead>
            <tbody>
              {fxTableRows.map((r, i) => {
                const dec = (r.price != null && r.price > 100) ? 2 : 4;
                return (
                  <tr key={r.symbol} style={{ borderBottom: i < fxTableRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                    <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>
                      <span style={{ marginRight: 8 }}>{r.flag}</span><span style={{ fontFamily: fonts.mono, fontWeight: 700 }}>{r.label}</span>
                      <span style={{ fontSize: 9, color: "#64748b", marginLeft: 8 }}>{r.base}</span>
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 13, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 700 }}>{r.price != null ? r.price.toFixed(dec) : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.dayChg), textAlign: "right" }}>{r.dayChg != null ? `${r.dayChg > 0 ? "+" : ""}${r.dayChg.toFixed(3)}%` : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.ytd), textAlign: "right", fontWeight: 600 }}>{r.ytd != null ? `${r.ytd > 0 ? "+" : ""}${r.ytd.toFixed(1)}%` : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{r.yearHigh != null ? r.yearHigh.toFixed(dec) : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{r.yearLow != null ? r.yearLow.toFixed(dec) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}
    </>)}
  </>);
}


export default InternationalTab;
