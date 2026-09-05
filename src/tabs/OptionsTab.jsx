import React, { useEffect, useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { InfoBox } from "../components/shared.jsx";
import { fetchOptionsChain, fetchFMP } from "../lib/api.js";
import CSPScreener from "./stocks/CSPScreener.jsx";
import { VolSurface } from "./StocksTab.jsx";
import ExpectationsView from "./options/ExpectationsView.jsx";
import IncomeView from "./options/IncomeView.jsx";
import WatchlistLadder from "./options/WatchlistLadder.jsx";

// ============================================================================
// OPTIONS TAB (2026-09 revamp) — what the market predicts, then how to get paid
//   Market Expectations  the default: the implied price cone by expiry, the
//                        implied distribution at one horizon, the odds table,
//                        and the analyst target vs the market's own odds
//                        (src/tabs/options/ExpectationsView.jsx)
//   Income               premium regime + income ladder + candidate puts/calls
//                        for the same symbol (options/IncomeView.jsx)
//   Watchlist ladder     best 15–30Δ put and call per watchlist name at ~45d
//                        (options/WatchlistLadder.jsx); the old ATM-yield grid
//                        (CSPScreener) is kept behind a toggle
//   Vol surface          the original quant view, unchanged
// The chain and daily closes are fetched ONCE per symbol here and shared by
// the first two views, so switching between them is instant.
// ============================================================================

const DEFAULT_SYMBOL = "SPY";
const QUICK_SYMBOLS = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "GOOGL"];
const VIEWS = [["expect", "Market Expectations"], ["income", "Income"], ["watchlist", "Watchlist Ladder"], ["surface", "Vol Surface & Greeks"]];

function OptionsTab({ fmpKey }) {
  const [view, setView] = useState("expect");

  // the symbol shared by the single-name views (persisted)
  const [symbol, setSymbol] = useState(() => {
    try { return localStorage.getItem("opt-vol-symbol") || DEFAULT_SYMBOL; } catch { return DEFAULT_SYMBOL; }
  });
  const [symInput, setSymInput] = useState("");
  useEffect(() => { try { localStorage.setItem("opt-vol-symbol", symbol); } catch {} }, [symbol]);

  // one chain + one price history + one consensus target per symbol, shared
  const [chain, setChain] = useState(null);
  const [chainErr, setChainErr] = useState(null);
  const [closes, setCloses] = useState(null);
  const [target, setTarget] = useState(null);
  useEffect(() => {
    let alive = true;
    setChain(null); setChainErr(null); setCloses(null); setTarget(null);
    fetchOptionsChain(symbol).then(d => { if (alive) setChain(d); }).catch(e => { if (alive) setChainErr(e?.message || "chain unavailable"); });
    if (fmpKey) {
      fetchFMP(`/historical-price-eod/full?symbol=${symbol}`, fmpKey).then(d => {
        const rows = Array.isArray(d) ? d : (d?.historical || []);
        const chron = [...rows].filter(r => r.close != null).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        if (alive) setCloses(chron.slice(-130).map(r => ({ date: r.date, close: r.close })));
      }).catch(() => { if (alive) setCloses([]); });
      fetchFMP(`/price-target-consensus?symbol=${symbol}`, fmpKey).then(d => { if (alive && Array.isArray(d) && d.length) setTarget(d[0]); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [symbol, fmpKey]);

  // the screener/ladder share the watchlist with Stocks (via /api/tickers, mirrored to localStorage)
  const [tickers, setTickers] = useState([]);
  const [tickerInput, setTickerInput] = useState("");
  const [showGrid, setShowGrid] = useState(false);
  useEffect(() => {
    fetch("/api/tickers")
      .then(r => r.json())
      .then(saved => { if (Array.isArray(saved) && saved.length) setTickers(saved); })
      .catch(() => { try { const saved = localStorage.getItem("econ-dash-tickers"); if (saved) setTickers(JSON.parse(saved)); } catch {} });
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
      <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>{chain ? `${chain.options.length.toLocaleString()} contracts · CBOE delayed` : chainErr ? "chain unavailable" : "loading chain…"}</span>
    </div>
  );
  const chainState = chainErr
    ? <InfoBox color="#F97316"><strong style={{ color: "#cbd5e1" }}>No chain for {symbol}.</strong> {chainErr} — try another symbol.</InfoBox>
    : !chain ? <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading {symbol} options chain (CBOE)…</div> : null;

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

    {view === "expect" && (<>
      {symbolPicker}
      {chainState || <ExpectationsView symbol={symbol} chain={chain} closes={closes} target={target} />}
    </>)}

    {view === "income" && (<>
      {symbolPicker}
      {chainState || <IncomeView symbol={symbol} fmpKey={fmpKey} chain={chain} closes={closes} />}
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
          {tickers.length === 0 && <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>No tickers yet — add one above to build the ladder.</span>}
        </div>
      </div>
      <WatchlistLadder tickers={tickers} />
      <button onClick={() => setShowGrid(s => !s)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, margin: "4px 0 10px", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading }}>
        <span style={{ color: "#818cf8", marginRight: 8 }}>{showGrid ? "▾" : "▸"}</span>ATM put yields by maturity (the original scan)
      </button>
      {showGrid && <CSPScreener tickers={tickers} />}
    </>)}

    {view === "surface" && (<>
      {symbolPicker}
      <VolSurface symbol={symbol} spot={null} />
      <InfoBox color="#818cf8">
        <strong style={{ color: "var(--text-primary)" }}>The quant view.</strong> The IV heatmap and 3D surface show where volatility is priced across strikes and expiries, the smile shows the skew at one expiry, the Greeks show how a position&apos;s value responds to price, time and vol, and the open-interest profile marks the max-pain strike. Market Expectations reads the same surface out as prices and probabilities; this is the raw material.
      </InfoBox>
    </>)}
  </>);
}

export default OptionsTab;
