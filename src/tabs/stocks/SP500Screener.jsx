import React, { useState, useEffect, useMemo } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";

const COLS = [
  { key: "symbol", label: "Ticker", align: "left", width: 70 },
  { key: "name", label: "Name", align: "left", width: 160, truncate: true },
  { key: "sector", label: "Sector", align: "left", width: 120, truncate: true },
  { key: "price", label: "Price", fmt: "dollar", width: 70 },
  { key: "changePct", label: "Day %", fmt: "chgpct", width: 65 },
  { key: "mktCap", label: "Mkt Cap", fmt: "bigdollar", width: 85 },
  { key: "pe", label: "P/E", fmt: "num1", width: 55 },
  { key: "peg", label: "PEG", fmt: "num2", width: 55 },
  { key: "earningsYield", label: "Earn Yld", fmt: "pct", width: 68 },
  { key: "fcfYield", label: "FCF Yld", fmt: "pct", width: 65 },
  { key: "roe", label: "ROE", fmt: "pct", width: 58 },
  { key: "roic", label: "ROIC", fmt: "pct", width: 58 },
  { key: "evEbitda", label: "EV/EBITDA", fmt: "num1", width: 75 },
  { key: "grossMargin", label: "Gross Mgn", fmt: "pct", width: 72 },
  { key: "netMargin", label: "Net Mgn", fmt: "pct", width: 65 },
  { key: "divYield", label: "Div Yld", fmt: "pct", width: 60 },
];

function fmtVal(v, fmt) {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (isNaN(v)) return "—";
  if (fmt === "dollar") return `$${v.toFixed(2)}`;
  if (fmt === "bigdollar") {
    const a = Math.abs(v);
    if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  }
  if (fmt === "pct") return `${(v * 100).toFixed(1)}%`;
  if (fmt === "chgpct") return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  if (fmt === "num1") return v.toFixed(1);
  if (fmt === "num2") return v.toFixed(2);
  return String(v);
}

const PRESETS = [
  { label: "All", filter: () => true },
  { label: "Value", filter: (s) => s.pe != null && s.pe > 0 && s.pe < 15 && s.fcfYield != null && s.fcfYield > 0.05 },
  { label: "Growth", filter: (s) => s.roe != null && s.roe > 0.15 && s.netMargin != null && s.netMargin > 0.1 },
  { label: "Dividend", filter: (s) => s.divYield != null && s.divYield > 0.02 },
  { label: "Quality", filter: (s) => s.roic != null && s.roic > 0.15 && s.grossMargin != null && s.grossMargin > 0.4 },
];

function SP500Screener({ onSelectStock }) {
  const [stocks, setStocks] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortCol, setSortCol] = useState("mktCap");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("All");
  const [preset, setPreset] = useState("All");

  useEffect(() => {
    setLoading(true);
    fetch("/api/sp500-screener")
      .then((r) => r.json())
      .then((d) => {
        if (d.stocks && Array.isArray(d.stocks)) {
          setStocks(d.stocks);
          setLastUpdated(d.lastUpdated);
        } else if (Array.isArray(d)) {
          // fallback for raw array response
          setStocks(d);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError("Failed to load S&P 500 data: " + e.message);
        setLoading(false);
      });
  }, []);

  const sectors = useMemo(() => {
    const s = new Set(stocks.map((x) => x.sector).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [stocks]);

  const filtered = useMemo(() => {
    const presetFn = PRESETS.find((p) => p.label === preset)?.filter || (() => true);
    return stocks.filter((s) => {
      if (sectorFilter !== "All" && s.sector !== sectorFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !(s.symbol || "").toLowerCase().includes(q) &&
          !(s.name || "").toLowerCase().includes(q)
        )
          return false;
      }
      return presetFn(s);
    });
  }, [stocks, sectorFilter, search, preset]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortCol],
        bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir(col === "symbol" || col === "name" || col === "sector" ? "asc" : "desc");
    }
  };

  // Stats
  const medianOf = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const pes = filtered.map((s) => s.pe).filter((v) => v != null && v > 0 && v < 200);
  const roes = filtered.map((s) => s.roe).filter((v) => v != null);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>Loading S&P 500 Screener…</div>
        <div style={{ fontSize: 12, color: "#475569" }}>
          First load fetches ~500 tickers (3 API calls each). This may take 2-3 minutes.
          <br />Subsequent loads use cached data (refreshes every 6 hours).
        </div>
      </div>
    );
  }

  if (error) {
    return <div style={{ color: "#f87171", fontSize: 13, padding: 20, fontFamily: fonts.heading }}>{error}</div>;
  }

  return (
    <>
      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Stocks Loaded", value: stocks.length, color: "#818cf8" },
          { label: "Showing", value: filtered.length, color: "#3b82f6" },
          { label: "Median P/E", value: pes.length ? medianOf(pes).toFixed(1) : "—", color: "#10b981" },
          {
            label: "Last Updated",
            value: lastUpdated ? new Date(lastUpdated).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—",
            color: "#f59e0b",
          },
        ].map((t) => (
          <div
            key={t.label}
            style={{
              background: cardBg,
              border: cardBorder,
              borderLeft: `3px solid ${t.color}`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{t.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker or name…"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 12px",
            color: "#e2e8f0",
            fontSize: 12,
            fontFamily: fonts.mono,
            outline: "none",
            width: 180,
          }}
        />
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          style={{
            background: "#1e293b",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 12px",
            color: "#e2e8f0",
            fontSize: 12,
            fontFamily: fonts.mono,
            outline: "none",
          }}
        >
          {sectors.map((s) => (
            <option key={s} value={s}>{s === "All" ? "All Sectors" : s}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 4, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.03)", padding: 2 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.label)}
              style={{
                padding: "6px 12px",
                border: "none",
                borderRadius: 6,
                background: preset === p.label ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
                color: preset === p.label ? "#e2e8f0" : "#64748b",
                fontSize: 11,
                fontWeight: preset === p.label ? 600 : 400,
                fontFamily: fonts.heading,
                cursor: "pointer",
                transition: "all 0.15s",
                boxShadow: preset === p.label ? "0 2px 6px rgba(0,0,0,0.3)" : "none",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", maxHeight: 600 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{
                    padding: "10px 8px",
                    fontSize: 10,
                    color: sortCol === col.key ? "#e2e8f0" : "#64748b",
                    fontFamily: fonts.mono,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    textAlign: col.align || "right",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    position: "sticky",
                    top: 0,
                    background: "#141829",
                    width: col.width,
                    zIndex: 2,
                  }}
                >
                  {col.label}
                  {sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr
                key={row.symbol}
                style={{
                  borderBottom: ri < sorted.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {COLS.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: "8px 8px",
                      fontSize: 12,
                      fontFamily: col.key === "symbol" ? fonts.mono : fonts.heading,
                      color:
                        col.key === "symbol"
                          ? "#818cf8"
                          : col.key === "changePct"
                          ? row.changePct > 0
                            ? "#4ade80"
                            : row.changePct < 0
                            ? "#f87171"
                            : "var(--text-muted)"
                          : "var(--text-primary)",
                      textAlign: col.align || "right",
                      fontWeight: col.key === "symbol" || col.key === "changePct" ? 600 : 400,
                      whiteSpace: "nowrap",
                      overflow: col.truncate ? "hidden" : undefined,
                      textOverflow: col.truncate ? "ellipsis" : undefined,
                      maxWidth: col.truncate ? col.width : undefined,
                    }}
                  >
                    {col.key === "symbol" ? (
                      <span
                        onClick={() => onSelectStock?.(row.symbol)}
                        style={{
                          cursor: onSelectStock ? "pointer" : "default",
                          borderBottom: onSelectStock ? "1px dashed rgba(129,140,248,0.4)" : "none",
                          paddingBottom: 1,
                        }}
                        onMouseEnter={(e) => onSelectStock && (e.target.style.color = "#a5b4fc")}
                        onMouseLeave={(e) => onSelectStock && (e.target.style.color = "#818cf8")}
                      >
                        {row.symbol}
                      </span>
                    ) : (
                      fmtVal(row[col.key], col.fmt)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 10 }}>
        {filtered.length} stocks shown • Click column headers to sort • Click ticker to view detail • Median ROE: {roes.length ? (medianOf(roes) * 100).toFixed(1) + "%" : "—"} • Data cached 6 hours, 3 FMP calls/ticker
      </div>
    </>
  );
}

export default SP500Screener;
