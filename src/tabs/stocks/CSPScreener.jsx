import React, { useState, useEffect, useMemo, useCallback } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { fetchOptionsChain } from "../../lib/api.js";
import { SH, InfoBox } from "../../components/shared.jsx";

const TARGET_DTES = [30, 60, 90, 180, 365];
const DTE_LABELS = ["~30d", "~60d", "~90d", "~6mo", "~1yr"];
const DTE_COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899"];

function fmtPct(v) { return v != null ? `${v.toFixed(1)}%` : "—"; }
function fmtDollar(v) { return v != null ? `$${v.toFixed(2)}` : "—"; }

function ivColor(iv) {
  if (iv == null) return "#475569";
  if (iv >= 60) return "#ef4444";
  if (iv >= 40) return "#f59e0b";
  if (iv >= 25) return "#4ade80";
  return "#94a3b8";
}

function yieldColor(y) {
  if (y == null) return "#475569";
  if (y >= 30) return "#ef4444";
  if (y >= 15) return "#f59e0b";
  if (y >= 8) return "#4ade80";
  return "#94a3b8";
}

export default function CSPScreener({ tickers }) {
  const [cspData, setCspData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [viewMode, setViewMode] = useState("iv"); // "iv" | "yield" | "premium"

  const fetchAll = useCallback(async () => {
    if (!tickers.length) return;
    setLoading(true);
    setCspData([]);
    const results = [];
    // Fetch in batches of 3 for CBOE rate limits
    const BATCH = 3;
    for (let i = 0; i < tickers.length; i += BATCH) {
      const batch = tickers.slice(i, i + BATCH);
      setProgress(`Loading ${i + 1}–${Math.min(i + BATCH, tickers.length)} of ${tickers.length}...`);
      const batchResults = await Promise.all(batch.map(async (ticker) => {
        try {
          const { options, spot } = await fetchOptionsChain(ticker);
          const puts = options.filter(o => o.type === "P");
          if (!puts.length) return { symbol: ticker, spot, error: false, empty: true };
          const availableDTEs = [...new Set(puts.map(p => p.dte))].sort((a, b) => a - b);
          const row = { symbol: ticker, spot, error: false, empty: false, maturities: [] };

          for (let t = 0; t < TARGET_DTES.length; t++) {
            const targetDTE = TARGET_DTES[t];
            // Find nearest expiry within ±50% of target (or ±15 days for short-dated)
            const tolerance = Math.max(15, targetDTE * 0.5);
            const candidates = availableDTEs.filter(d => Math.abs(d - targetDTE) <= tolerance);
            if (!candidates.length) {
              row.maturities.push(null);
              continue;
            }
            const nearestDTE = candidates.reduce((best, d) =>
              Math.abs(d - targetDTE) < Math.abs(best - targetDTE) ? d : best, candidates[0]);

            // Find ATM put at that expiry
            const atDTE = puts.filter(o => o.dte === nearestDTE);
            const atmPut = atDTE.reduce((best, o) =>
              !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best, null);

            if (atmPut && atmPut.bid > 0) {
              const annYield = (atmPut.bid / atmPut.strike) * (365 / nearestDTE) * 100;
              row.maturities.push({
                iv: atmPut.iv * 100,
                bid: atmPut.bid,
                ask: atmPut.ask,
                strike: atmPut.strike,
                dte: nearestDTE,
                delta: atmPut.delta,
                oi: atmPut.oi,
                vol: atmPut.vol,
                annYield,
                breakeven: atmPut.strike - atmPut.bid,
                cushion: ((spot - (atmPut.strike - atmPut.bid)) / spot) * 100,
              });
            } else {
              row.maturities.push(null);
            }
          }
          return row;
        } catch (e) {
          console.warn(`CSP: ${ticker} failed:`, e.message);
          return { symbol: ticker, spot: null, error: true, empty: false, maturities: Array(TARGET_DTES.length).fill(null) };
        }
      }));
      results.push(...batchResults);
      // Small delay between batches
      if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 500));
    }
    setCspData(results);
    setLoading(false);
    setProgress("");
  }, [tickers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    if (!sortCol) return cspData;
    return [...cspData].sort((a, b) => {
      let av, bv;
      if (sortCol === "spot") { av = a.spot; bv = b.spot; }
      else {
        // Format: "iv_2", "yield_1", "premium_0"
        const [metric, idxStr] = sortCol.split("_");
        const idx = parseInt(idxStr);
        const am = a.maturities?.[idx];
        const bm = b.maturities?.[idx];
        if (metric === "iv") { av = am?.iv; bv = bm?.iv; }
        else if (metric === "yield") { av = am?.annYield; bv = bm?.annYield; }
        else if (metric === "premium") { av = am?.bid; bv = bm?.bid; }
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [cspData, sortCol, sortDir]);

  const btnStyle = (active) => ({
    background: active ? "#818cf8" : "rgba(255,255,255,0.05)",
    border: "1px solid " + (active ? "#818cf8" : "rgba(255,255,255,0.1)"),
    color: active ? "#0f172a" : "#94a3b8",
    padding: "5px 14px", fontSize: 10, fontWeight: 600, cursor: "pointer",
    fontFamily: fonts.heading, borderRadius: 6,
  });

  const thStyle = (col) => ({
    padding: "10px 8px", fontSize: 9, fontFamily: fonts.mono,
    color: sortCol === col ? "#e2e8f0" : "#64748b",
    textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer", whiteSpace: "nowrap", letterSpacing: 0.5,
    textTransform: "uppercase", userSelect: "none",
  });

  const getMetricValue = (mat) => {
    if (!mat) return null;
    if (viewMode === "iv") return mat.iv;
    if (viewMode === "yield") return mat.annYield;
    if (viewMode === "premium") return mat.bid;
    return null;
  };

  const fmtMetric = (mat) => {
    if (!mat) return "—";
    if (viewMode === "iv") return fmtPct(mat.iv);
    if (viewMode === "yield") return fmtPct(mat.annYield);
    if (viewMode === "premium") return fmtDollar(mat.bid);
    return "—";
  };

  const metricColor = (mat) => {
    if (!mat) return "#475569";
    if (viewMode === "iv") return ivColor(mat.iv);
    if (viewMode === "yield") return yieldColor(mat.annYield);
    return "#cbd5e1";
  };

  return (<>
    <SH>Cash-Secured Put Screener</SH>
    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>ATM implied volatility &amp; put premiums across maturities.</strong> Higher IV = larger premium for selling puts. Annualized yield = (put bid / strike) × (365/DTE). Break-even = strike − premium collected. Data from CBOE options chains.
    </InfoBox>

    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Show:</span>
      <button onClick={() => setViewMode("iv")} style={btnStyle(viewMode === "iv")}>ATM IV %</button>
      <button onClick={() => setViewMode("yield")} style={btnStyle(viewMode === "yield")}>Ann. Yield %</button>
      <button onClick={() => setViewMode("premium")} style={btnStyle(viewMode === "premium")}>Put Premium $</button>
      <div style={{ marginLeft: "auto" }}>
        <button onClick={fetchAll} disabled={loading} style={{ ...btnStyle(false), opacity: loading ? 0.5 : 1, cursor: loading ? "wait" : "pointer" }}>
          {loading ? progress || "Loading..." : "↻ Refresh"}
        </button>
      </div>
    </div>

    {loading && (
      <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontFamily: fonts.mono, fontSize: 12 }}>
        {progress || "Fetching options chains..."}
        <div style={{ marginTop: 8, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, maxWidth: 300, margin: "8px auto 0" }}>
          <div style={{ height: "100%", background: "#818cf8", borderRadius: 2, width: `${(cspData.length / tickers.length) * 100}%`, transition: "width 0.3s" }} />
        </div>
      </div>
    )}

    {sorted.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle("symbol"), textAlign: "left", cursor: "default", position: "sticky", left: 0, background: "#141829", zIndex: 2 }}>Ticker</th>
              <th onClick={() => toggleSort("spot")} style={{ ...thStyle("spot") }}>
                Spot{sortCol === "spot" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </th>
              {TARGET_DTES.map((dte, i) => {
                const colKey = `${viewMode}_${i}`;
                return (
                  <th key={i} onClick={() => toggleSort(colKey)} style={{ ...thStyle(colKey), borderLeft: i === 0 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                    <span style={{ color: DTE_COLORS[i] }}>●</span> {DTE_LABELS[i]}
                    {sortCol === colKey ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isExpanded = expanded === row.symbol;
              return (
                <React.Fragment key={row.symbol}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "10px 10px", fontSize: 12, fontFamily: fonts.mono, color: row.error ? "#f87171" : "#818cf8", fontWeight: 600, position: "sticky", left: 0, background: "#161a30", zIndex: 1 }}>
                      {row.symbol} {isExpanded ? "▾" : "▸"}
                    </td>
                    <td style={{ padding: "10px 8px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right" }}>
                      {row.spot ? fmtDollar(row.spot) : "—"}
                    </td>
                    {TARGET_DTES.map((_, i) => {
                      const mat = row.maturities?.[i];
                      return (
                        <td key={i} style={{ padding: "10px 8px", fontSize: 12, fontFamily: fonts.mono, textAlign: "right", color: metricColor(mat), fontWeight: mat ? 500 : 400, borderLeft: i === 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                          {row.error ? "err" : row.empty ? "—" : fmtMetric(mat)}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Expanded detail row */}
                  {isExpanded && !row.error && !row.empty && (
                    <tr>
                      <td colSpan={2 + TARGET_DTES.length} style={{ padding: 0, background: "rgba(15,23,42,0.6)" }}>
                        <div style={{ padding: "14px 16px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: `repeat(${TARGET_DTES.length}, 1fr)`, gap: 10 }}>
                            {TARGET_DTES.map((_, i) => {
                              const m = row.maturities?.[i];
                              if (!m) return (
                                <div key={i} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <div style={{ fontSize: 10, color: DTE_COLORS[i], fontFamily: fonts.mono, fontWeight: 700, marginBottom: 6 }}>{DTE_LABELS[i]}</div>
                                  <div style={{ fontSize: 11, color: "#475569" }}>No data</div>
                                </div>
                              );
                              return (
                                <div key={i} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <div style={{ fontSize: 10, color: DTE_COLORS[i], fontFamily: fonts.mono, fontWeight: 700, marginBottom: 8 }}>{DTE_LABELS[i]} ({m.dte}d actual)</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                                    <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Strike</span>
                                    <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, textAlign: "right" }}>${m.strike}</span>
                                    <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>IV</span>
                                    <span style={{ fontSize: 11, color: ivColor(m.iv), fontFamily: fonts.mono, textAlign: "right", fontWeight: 600 }}>{m.iv.toFixed(1)}%</span>
                                    <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Bid / Ask</span>
                                    <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, textAlign: "right" }}>${m.bid.toFixed(2)} / ${m.ask.toFixed(2)}</span>
                                    <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Ann. Yield</span>
                                    <span style={{ fontSize: 11, color: yieldColor(m.annYield), fontFamily: fonts.mono, textAlign: "right", fontWeight: 600 }}>{m.annYield.toFixed(1)}%</span>
                                    <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Break-even</span>
                                    <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, textAlign: "right" }}>${m.breakeven.toFixed(2)}</span>
                                    <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Cushion</span>
                                    <span style={{ fontSize: 11, color: "#4ade80", fontFamily: fonts.mono, textAlign: "right" }}>{m.cushion.toFixed(1)}%</span>
                                    {m.delta != null && <>
                                      <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Delta</span>
                                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, textAlign: "right" }}>{m.delta.toFixed(3)}</span>
                                    </>}
                                    {m.oi != null && <>
                                      <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>Open Int</span>
                                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, textAlign: "right" }}>{m.oi.toLocaleString()}</span>
                                    </>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    {!loading && sorted.length > 0 && (
      <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 6 }}>
        Click any row to expand full put details. ATM = nearest strike to spot price. Cushion = % stock can drop before you lose money. Sort by clicking column headers.
      </div>
    )}
  </>);
}
