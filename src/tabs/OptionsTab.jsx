import React, { useEffect, useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import CSPScreener from "./stocks/CSPScreener.jsx";
import { VolSurface } from "./StocksTab.jsx";

// Default symbol shown when Vol Surface opens. SPY is the canonical demo since
// every strike has tight bids and the surface is rich with structure.
const DEFAULT_VOL_SYMBOL = "SPY";
// Quick-pick buttons for common chains. Click → loads that symbol's surface.
const POPULAR_VOL_SYMBOLS = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "GOOGL"];

function OptionsTab() {
  const [view, setView] = useState("surface"); // "surface" | "csp"

  // Vol-surface lookup state
  const [symbol, setSymbol] = useState(() => {
    try { return localStorage.getItem("opt-vol-symbol") || DEFAULT_VOL_SYMBOL; }
    catch { return DEFAULT_VOL_SYMBOL; }
  });
  const [symInput, setSymInput] = useState("");

  // CSP screener shares the same persisted watchlist as StocksTab (via /api/tickers)
  const [tickers, setTickers] = useState([]);
  const [tickerInput, setTickerInput] = useState("");

  // Load watchlist tickers on mount
  useEffect(() => {
    fetch("/api/tickers")
      .then(r => r.json())
      .then(saved => { if (Array.isArray(saved) && saved.length) setTickers(saved); })
      .catch(() => {
        try { const saved = localStorage.getItem("econ-dash-tickers"); if (saved) setTickers(JSON.parse(saved)); } catch {}
      });
  }, []);

  // Persist watchlist changes (mirrors StocksTab behavior)
  useEffect(() => {
    if (!tickers.length) return;
    try { localStorage.setItem("econ-dash-tickers", JSON.stringify(tickers)); } catch {}
    fetch("/api/tickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tickers) }).catch(() => {});
  }, [tickers]);

  // Persist current vol-surface symbol
  useEffect(() => {
    try { localStorage.setItem("opt-vol-symbol", symbol); } catch {}
  }, [symbol]);

  const submitSymbol = () => {
    const s = symInput.trim().toUpperCase();
    if (s) { setSymbol(s); setSymInput(""); }
  };
  const addTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !tickers.includes(t)) { setTickers(prev => [...prev, t]); setTickerInput(""); }
  };
  const removeTicker = (t) => setTickers(prev => prev.filter(x => x !== t));

  const viewToggle = (
    <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", marginBottom: 16, background: "rgba(255,255,255,0.03)", padding: 3 }}>
      {[["surface", "📈 Vol Surface"], ["csp", "💰 Cash-Secured Puts"]].map(([id, label]) => (
        <button key={id} onClick={() => setView(id)} style={{
          flex: 1, padding: "10px 16px", border: "none", borderRadius: 8,
          background: view === id ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
          color: view === id ? "var(--text-primary)" : "#64748b", fontSize: 12, fontWeight: view === id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.2s",
          boxShadow: view === id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
        }}>{label}</button>
      ))}
    </div>
  );

  return (<>
    {viewToggle}

    {view === "surface" && (<>
      {/* Symbol lookup + popular chains */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Symbol:</label>
          <input
            value={symInput}
            onChange={e => setSymInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitSymbol()}
            placeholder={symbol}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, outline: "none", width: 120 }}
          />
          <button onClick={submitSymbol} style={{ background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading }}>Load</button>
          <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginLeft: 6 }}>
            Currently viewing <strong style={{ color: "#818cf8" }}>{symbol}</strong>
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginRight: 4 }}>Quick chains:</span>
          {POPULAR_VOL_SYMBOLS.map(s => (
            <button key={s} onClick={() => setSymbol(s)} style={{
              background: symbol === s ? "#818cf8" : "rgba(255,255,255,0.05)",
              border: "1px solid " + (symbol === s ? "#818cf8" : "rgba(255,255,255,0.1)"),
              color: symbol === s ? "#0f172a" : "#94a3b8",
              padding: "3px 10px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, borderRadius: 6,
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* The Vol Surface — its own ticker-driven view with all the new tools
          (Implied Move, Greeks, Max Pain, etc.) baked in. */}
      <VolSurface symbol={symbol} spot={null} />
    </>)}

    {view === "csp" && (<>
      {/* Ticker watchlist (shared with Stocks tab) */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>CSP Watchlist:</label>
          <input
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTicker()}
            placeholder="Add ticker (e.g. COST)"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, outline: "none", width: 140 }}
          />
          <button onClick={addTicker} style={{ background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading }}>Add</button>
          <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>
            Shared with Stocks → Watchlist
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tickers.map(t => (
            <span key={t} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#c7d2fe", display: "flex", alignItems: "center", gap: 6 }}>
              {t}
              <span onClick={() => removeTicker(t)} style={{ cursor: "pointer", color: "#f87171", fontWeight: 700, fontSize: 13 }}>×</span>
            </span>
          ))}
          {tickers.length === 0 && (
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>No tickers yet — add one above to scan for cash-secured put opportunities.</span>
          )}
        </div>
      </div>

      <CSPScreener tickers={tickers} />
    </>)}

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>Options workflow.</strong>
      &nbsp;<strong>Vol Surface</strong>: pick any ticker, scan the IV heatmap / smile / term structure, check the <strong>Implied Move</strong> for the time horizon you care about, look at <strong>Greeks</strong> across strikes to find the highest-gamma / best Delta exposure, and use <strong>Max Pain</strong> to size strikes near pin-risk magnets.
      &nbsp;<strong>Cash-Secured Puts</strong>: filter your watchlist for the best premium-yielding strikes. The watchlist syncs across Stocks → Watchlist and Options → CSP so you only have to maintain one list.
    </InfoBox>
  </>);
}

export default OptionsTab;
