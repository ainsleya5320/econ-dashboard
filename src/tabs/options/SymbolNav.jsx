import React, { useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// The symbol cycler shared by the single-name Options views: pick a list
// (your watchlist, the index/sector ETFs, the S&P 500 by market cap, or one
// S&P sector), then step through it with ‹ › or the ← → keys, or jump to any
// name with the search box. The neighbours are handed to onPrefetch so the
// next chain is usually loaded before you press the key.
// ============================================================================

export const ETFS = [
  ["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["IWM", "Russell 2000"], ["DIA", "Dow 30"],
  ["XLK", "Technology"], ["XLF", "Financials"], ["XLE", "Energy"], ["XLV", "Health care"], ["XLY", "Consumer discretionary"],
  ["XLP", "Consumer staples"], ["XLI", "Industrials"], ["XLU", "Utilities"], ["XLB", "Materials"], ["XLRE", "Real estate"],
  ["XLC", "Communication services"], ["SMH", "Semiconductors"], ["TLT", "Long Treasuries"], ["HYG", "High-yield credit"], ["GLD", "Gold"], ["USO", "Oil"],
];
const LIST_KEY = "opt-nav-list";

export default function SymbolNav({ symbol, onSymbol, watchlist = [], sp500 = [], onPrefetch, onMembers, onRefresh, status }) {
  const [list, setList] = useState(() => { try { return localStorage.getItem(LIST_KEY) || "watchlist"; } catch { return "watchlist"; } });
  const [q, setQ] = useState("");
  useEffect(() => { try { localStorage.setItem(LIST_KEY, list); } catch {} }, [list]);

  const names = useMemo(() => {
    const m = new Map(ETFS.map(([s, n]) => [s, n]));
    for (const c of sp500) if (c?.symbol) m.set(c.symbol, c.name);
    return m;
  }, [sp500]);
  const sectors = useMemo(() => [...new Set(sp500.map(c => c.sector).filter(Boolean))].sort(), [sp500]);
  const byCap = useMemo(() => [...sp500].filter(c => c?.symbol).sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0)), [sp500]);
  const members = useMemo(() => {
    if (list === "watchlist") return [...watchlist];
    if (list === "etf") return ETFS.map(([s]) => s);
    if (list === "sp500") return byCap.map(c => c.symbol);
    if (list.startsWith("sector:")) return byCap.filter(c => c.sector === list.slice(7)).map(c => c.symbol);
    return [];
  }, [list, watchlist, byCap]);
  useEffect(() => { onMembers?.(list, members); }, [list, members, onMembers]);
  const idx = members.indexOf(symbol);
  const step = d => {
    if (!members.length) return;
    const next = members[idx < 0 ? (d > 0 ? 0 : members.length - 1) : (idx + d + members.length) % members.length];
    onSymbol(next);
  };

  // ← → step through the list unless you are typing somewhere
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => {
    const onKey = e => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target, tag = t?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (e.key === "ArrowRight") { e.preventDefault(); stepRef.current(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // warm the neighbours' chains
  useEffect(() => {
    if (!onPrefetch || idx < 0 || members.length < 2) return;
    const t = setTimeout(() => onPrefetch([members[(idx + 1) % members.length], members[(idx - 1 + members.length) % members.length]]), 400);
    return () => clearTimeout(t);
  }, [symbol, idx, members, onPrefetch]);

  const go = raw => {
    const s = String(raw || "").trim().toUpperCase().split(/[\s—-]/)[0];
    if (s && /^[A-Z][A-Z0-9.]{0,9}$/.test(s)) { onSymbol(s); setQ(""); }
  };

  return (
    <div className="onav">
      <select value={list} onChange={e => setList(e.target.value)} aria-label="List to step through">
        <option value="watchlist">Watchlist ({watchlist.length})</option>
        <option value="etf">Index &amp; sector ETFs ({ETFS.length})</option>
        <option value="sp500">S&amp;P 500 by size ({byCap.length || "…"})</option>
        {sectors.map(s => <option key={s} value={`sector:${s}`}>S&amp;P 500 · {s}</option>)}
      </select>
      <button type="button" onClick={() => step(-1)} disabled={!members.length} aria-label="Previous name" title="Previous (←)">‹</button>
      <span className="onav-sym">{symbol}</span>
      <button type="button" onClick={() => step(1)} disabled={!members.length} aria-label="Next name" title="Next (→)">›</button>
      <span className="onav-name" title={names.get(symbol) || ""}>{names.get(symbol) || ""}</span>
      <span className="onote" style={{ margin: 0 }}>{idx >= 0 ? `${idx + 1} of ${members.length}` : members.length ? "not in this list" : "list empty"} · ← → to step</span>
      <span style={{ flex: 1 }} />
      <input list="onav-all" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && go(q)} placeholder="Jump to a symbol" aria-label="Jump to a symbol" style={{ width: 170 }} />
      <datalist id="onav-all">
        {[...new Set([...watchlist, ...ETFS.map(([s]) => s), ...byCap.map(c => c.symbol)])].map(s => <option key={s} value={s}>{names.get(s) || ""}</option>)}
      </datalist>
      <button type="button" onClick={() => go(q)} disabled={!q.trim()}>Go</button>
      {onRefresh && <button type="button" onClick={onRefresh} title="Fetch a fresh delayed chain for this name">Refresh</button>}
      {status && <span className="onote" style={{ margin: 0, width: "100%" }}>{status}</span>}
    </div>
  );
}
