import React, { useState, useEffect, useRef, useCallback } from "react";
import { fonts } from "../lib/styles.js";

// Typeahead over FMP's full symbol universe: merges search-symbol (ticker
// prefix) + search-name (company name) results, US exchanges first. Selecting
// calls onSelect(symbol). Enter with no highlight submits the raw text
// uppercased, so power users can still type "COST⏎" without waiting.
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "CBOE", "OTC"]);

export default function TickerSearch({ fmpKey, onSelect, placeholder = "Search ticker or company…", inputStyle = {}, boxStyle = {}, icon = true }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // highlighted row
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);
  const seqRef = useRef(0); // stale-response guard

  const runSearch = useCallback(async (query) => {
    if (!fmpKey || query.length < 1) { setResults([]); return; }
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const [bySym, byName] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(query)}&limit=8&apikey=${fmpKey}`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(query)}&limit=8&apikey=${fmpKey}`).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      if (seq !== seqRef.current) return; // a newer query superseded this one
      const seen = new Set();
      const merged = [];
      for (const r of [...(Array.isArray(bySym) ? bySym : []), ...(Array.isArray(byName) ? byName : [])]) {
        if (!r?.symbol || seen.has(r.symbol)) continue;
        seen.add(r.symbol);
        merged.push(r);
      }
      // US listings first (detail view data is deepest there), then the rest
      merged.sort((a, b) => (US_EXCHANGES.has(b.exchange) ? 1 : 0) - (US_EXCHANGES.has(a.exchange) ? 1 : 0));
      setResults(merged.slice(0, 8));
      setOpen(true);
      setHi(-1);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, [fmpKey]);

  // Debounce the query
  useEffect(() => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => runSearch(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  // Close on outside click
  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (symbol) => {
    setQ(""); setResults([]); setOpen(false); setHi(-1);
    onSelect(symbol);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, -1)); }
    else if (e.key === "Enter") {
      if (open && hi >= 0 && results[hi]) pick(results[hi].symbol);
      else if (q.trim()) pick(q.trim().toUpperCase());
    }
    else if (e.key === "Escape") { setOpen(false); setHi(-1); }
  };

  return (
    <div ref={boxRef} style={{ position: "relative", ...boxStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{searching ? "…" : "⌕"}</span>}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (results.length) setOpen(true); }}
          placeholder={placeholder}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 12, fontFamily: fonts.mono, minWidth: 0, ...inputStyle }}
        />
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, minWidth: 300, background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", zIndex: 50, overflow: "hidden" }}>
          {results.map((r, i) => (
            <div key={r.symbol}
              onMouseDown={(e) => { e.preventDefault(); pick(r.symbol); }}
              onMouseEnter={() => setHi(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", background: hi === i ? "rgba(99,102,241,0.15)" : "transparent", borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: fonts.mono, color: "#818cf8", width: 74, flexShrink: 0 }}>{r.symbol}</span>
              <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.heading, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.name}</span>
              <span style={{ fontSize: 9, color: US_EXCHANGES.has(r.exchange) ? "#4ade80" : "#64748b", fontFamily: fonts.mono, flexShrink: 0 }}>{r.exchange}</span>
            </div>
          ))}
          <div style={{ padding: "5px 12px", fontSize: 9, color: "#475569", fontFamily: fonts.mono, background: "rgba(255,255,255,0.02)" }}>
            ↑↓ navigate · Enter select · Esc close
          </div>
        </div>
      )}
    </div>
  );
}
