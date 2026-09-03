import React, { useEffect, useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { InfoBox } from "../components/shared.jsx";
import CSPScreener from "./stocks/CSPScreener.jsx";
import { VolSurface } from "./StocksTab.jsx";
import IncomeView from "./options/IncomeView.jsx";

// ============================================================================
// OPTIONS TAB (2026-09 revamp) — income first, quant tools behind a door
//   Income          the default: premium regime + income ladder + candidate
//                   puts/calls for one symbol (src/tabs/options/IncomeView.jsx)
//   Watchlist scan  the existing cash-secured-put screener across the shared
//                   watchlist (ATM put yields at 5 maturities per name)
//   Vol surface     the original quant view — heatmap / 3D surface / smile /
//                   Greeks / open-interest & max pain — unchanged, just moved
// ============================================================================

const DEFAULT_SYMBOL = "SPY";
const QUICK_SYMBOLS = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "GOOGL"];
const VIEWS = [["income", "Income"], ["watchlist", "Watchlist Scan"], ["surface", "Vol Surface & Greeks"]];

function OptionsTab({ fmpKey }) {
  const [view, setView] = useState("income");

  // the symbol shared by the Income and Vol Surface views (persisted)
  const [symbol, setSymbol] = useState(() => {
    try { return localStorage.getItem("opt-vol-symbol") || DEFAULT_SYMBOL; } catch { return DEFAULT_SYMBOL; }
  });
  const [symInput, setSymInput] = useState("");
  useEffect(() => { try { localStorage.setItem("opt-vol-symbol", symbol); } catch {} }, [symbol]);

  // the screener shares the watchlist with Stocks (via /api/tickers, mirrored to localStorage)
  const [tickers, setTickers] = useState([]);
  const [tickerInput, setTickerInput] = useState("");
  useEffect(() => {
    fetch("/api/tickers")
      .then(r => r.json())
      .then(saved => { if (Array.isArray(saved) && saved.length) setTickers(saved); })
      .catch(() => {
        try { const saved = localStorage.getItem("econ-dash-tickers"); if (saved) setTickers(JSON.parse(saved)); } catch {}
      });
  }, []);
  useEffect(() => {
    if (!tickers.length) return;
    try { localStorage.setItem("econ-dash-tickers", JSON.stringify(tickers)); } catch {}
    fetch("/api/tickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tickers) }).catch(() => {});
  }, [tickers]);

  const submitSymbol = () => { const s = symInput.trim().toUpperCase(); if (s) { setSymbol(s); setSymInput(""); } };
  const addTicker = () => { const t = tickerInput.trim().toUpperCase(); if (t && !tickers.includes(t)) { setTickers(prev => [...prev, t]); setTickerInput(""); } };
  const removeTicker = t => setTickers(prev => prev.filter(x => x !== t));

  const inputStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, outline: "none", width: 130 };
  const btnStyle = { background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading };
  const labelStyle = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };

  const symbolPicker = (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <label style={labelStyle}>Symbol</label>
      <input value={symInput} onChange={e => setSymInput(e.target.value)} onKeyDown={e => e.key === "Enter" && submitSymbol()} placeholder={symbol} style={inputStyle} />
      <button onClick={submitSymbol} style={btnStyle}>Load</button>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginLeft: 6 }}>
        {QUICK_SYMBOLS.map(s => (
          <button key={s} onClick={() => setSymbol(s)} style={{
            background: symbol === s ? "#818cf8" : "rgba(255,255,255,0.05)", border: "1px solid " + (symbol === s ? "#818cf8" : "rgba(255,255,255,0.1)"),
            color: symbol === s ? "#0f172a" : "#94a3b8", padding: "3px 10px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, borderRadius: 6,
          }}>{s}</button>
        ))}
      </div>
      <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>CBOE delayed chain · bid prices</span>
    </div>
  );

  return (<>
    <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", marginBottom: 14, background: "rgba(255,255,255,0.03)", padding: 3 }}>
      {VIEWS.map(([id, text]) => (
        <button key={id} onClick={() => setView(id)} style={{
          flex: 1, padding: "9px 16px", border: "none", borderRadius: 8,
          background: view === id ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
          color: view === id ? "var(--text-primary)" : "#64748b", fontSize: 12, fontWeight: view === id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.2s", boxShadow: view === id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
        }}>{text}</button>
      ))}
    </div>

    {view === "income" && (<>
      {symbolPicker}
      <IncomeView symbol={symbol} fmpKey={fmpKey} />
    </>)}

    {view === "watchlist" && (<>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <label style={labelStyle}>Watchlist</label>
          <input value={tickerInput} onChange={e => setTickerInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="Add ticker (e.g. COST)" style={inputStyle} />
          <button onClick={addTicker} style={btnStyle}>Add</button>
          <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>shared with Stocks → Watchlist and the Cockpit rail</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tickers.map(t => (
            <span key={t} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#c7d2fe", display: "flex", alignItems: "center", gap: 6 }}>
              {t}<span onClick={() => removeTicker(t)} style={{ cursor: "pointer", color: "#f87171", fontWeight: 700, fontSize: 13 }}>×</span>
            </span>
          ))}
          {tickers.length === 0 && <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>No tickers yet — add one above to scan for cash-secured put yields.</span>}
        </div>
      </div>
      <CSPScreener tickers={tickers} />
    </>)}

    {view === "surface" && (<>
      {symbolPicker}
      <VolSurface symbol={symbol} spot={null} />
      <InfoBox color="#818cf8">
        <strong style={{ color: "var(--text-primary)" }}>The quant view.</strong> The IV heatmap and 3D surface show where volatility is priced across strikes and expiries, the smile shows the skew at one expiry, the Greeks show how a position&apos;s value responds to price, time and vol, and the open-interest profile marks the max-pain strike where option holders lose the most at expiration. Useful for structuring a specific trade; the Income view is the place to decide whether to make one.
      </InfoBox>
    </>)}
  </>);
}

export default OptionsTab;
