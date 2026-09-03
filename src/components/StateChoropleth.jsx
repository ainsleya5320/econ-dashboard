import React, { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { choroplethColor, STATE_NAMES, FIPS_TO_STATE, US_TOPO_URL } from "../lib/constants.js";
import { fmtDate, SH } from "./shared.jsx";

// ============================================================================
// STATE CHOROPLETH — reusable U.S. state map + ranking table
// Extracted from the U.S. Economy → State-Level tab so Real Estate can use
// the same map with its own metric set. `metrics` is a slice of
// CHOROPLETH_METRICS; `cache` is App's choroplethCache ({ metricKey: { ST:
// {v,d}, _national } }); `metric`/`setMetric` is App's shared selection —
// if the shared key isn't in this map's list, the first metric is used.
// ============================================================================

export default function StateChoropleth({ title, metrics, metric, setMetric, cache, loading, progress, note }) {
  const [tooltipContent, setTooltipContent] = useState("");
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [tableSortCol, setTableSortCol] = useState("rank");
  const [tableSortAsc, setTableSortAsc] = useState(true);

  const activeKey = metrics.some(m => m.key === metric) ? metric : metrics[0]?.key;
  useEffect(() => { if (activeKey && activeKey !== metric) setMetric(activeKey); }, [activeKey, metric, setMetric]);
  const metricCfg = metrics.find(m => m.key === activeKey);
  const data = cache[activeKey] || {};
  const nationalData = data._national;
  const stateEntries = useMemo(() => Object.entries(data).filter(([k]) => k !== "_national"), [data]);
  const values = stateEntries.map(([, d]) => d.v).filter(v => v != null);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const avgVal = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  const ranked = useMemo(() => {
    const arr = stateEntries.map(([st, d]) => ({ st, v: d.v, d: d.d })).filter(x => x.v != null);
    arr.sort((a, b) => (metricCfg?.sortAsc ? a.v - b.v : b.v - a.v));
    return arr.map((x, i) => ({ ...x, rank: i + 1 }));
  }, [stateEntries, metricCfg]);
  const rankOf = st => { const r = ranked.find(x => x.st === st); return r ? r.rank : null; };

  const tableRows = useMemo(() => {
    const rows = [...ranked];
    if (tableSortCol === "rank") return tableSortAsc ? rows : [...rows].reverse();
    if (tableSortCol === "state") { rows.sort((a, b) => (STATE_NAMES[a.st] || a.st).localeCompare(STATE_NAMES[b.st] || b.st)); return tableSortAsc ? rows : rows.reverse(); }
    if (tableSortCol === "value") { rows.sort((a, b) => a.v - b.v); return tableSortAsc ? rows : rows.reverse(); }
    return rows;
  }, [ranked, tableSortCol, tableSortAsc]);
  const toggleSort = col => { if (tableSortCol === col) setTableSortAsc(!tableSortAsc); else { setTableSortCol(col); setTableSortAsc(col === "state"); } };
  const sortArrow = col => (tableSortCol === col ? (tableSortAsc ? " ▲" : " ▼") : "");
  // difference vs national, formatted with the metric's own formatter
  const fmtDiff = d => (d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${metricCfg.fmt(Math.abs(d))}`);

  if (!metricCfg) return null;
  const th = (label, col, align = "left", extra = {}) => (
    <th onClick={col ? () => toggleSort(col) : undefined} style={{ padding: "10px 12px", fontSize: 10, color: col ? "#818cf8" : "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, textAlign: align, cursor: col ? "pointer" : "default", userSelect: "none", ...extra }}>{label}{col ? sortArrow(col) : ""}</th>
  );

  return (<>
    {title && <SH>{title}</SH>}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {metrics.map(m => (
        <button key={m.key} onClick={() => setMetric(m.key)}
          style={{ padding: "7px 14px", borderRadius: 8, border: activeKey === m.key ? "1px solid #818cf8" : "1px solid rgba(255,255,255,0.08)", background: activeKey === m.key ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.03)", color: activeKey === m.key ? "#c7d2fe" : "#94a3b8", fontSize: 11, fontFamily: fonts.mono, cursor: "pointer", fontWeight: activeKey === m.key ? 600 : 400, transition: "all 0.15s ease" }}>
          {m.label}
        </button>
      ))}
    </div>
    {note && <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 10, lineHeight: 1.5 }}>{note}</div>}

    {/* National benchmark card */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>National {metricCfg.label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>
          {nationalData ? metricCfg.fmt(nationalData.v) : loading ? "..." : "—"}
        </div>
        {nationalData?.d && <div style={{ fontSize: 9, color: "#4ade80", fontFamily: fonts.mono, marginTop: 2 }}>{fmtDate(nationalData.d)}</div>}
      </div>
      {values.length > 0 && (<>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>State Avg</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.mono }}>{metricCfg.fmt(avgVal)}</div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>Lowest</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: metricCfg.sortAsc ? "#4ade80" : "#f87171", fontFamily: fonts.mono }}>{metricCfg.fmt(minVal)}</div>
          <div style={{ fontSize: 9, color: "var(--text-secondary)", fontFamily: fonts.mono }}>{ranked.length ? STATE_NAMES[ranked[metricCfg.sortAsc ? 0 : ranked.length - 1]?.st] || "" : ""}</div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>Highest</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: metricCfg.sortAsc ? "#f87171" : "#4ade80", fontFamily: fonts.mono }}>{metricCfg.fmt(maxVal)}</div>
          <div style={{ fontSize: 9, color: "var(--text-secondary)", fontFamily: fonts.mono }}>{ranked.length ? STATE_NAMES[ranked[metricCfg.sortAsc ? ranked.length - 1 : 0]?.st] || "" : ""}</div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 20 }}>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>States</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.mono }}>{ranked.length}</div>
        </div>
      </>)}
    </div>

    {/* Map card */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 14, position: "relative" }}>
      {loading && (
        <div style={{ position: "absolute", top: 12, right: 16, fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, zIndex: 10, background: "rgba(15,23,42,0.9)", padding: "4px 10px", borderRadius: 6 }}>{progress}</div>
      )}
      <ComposableMap projection="geoAlbersUsa" style={{ width: "100%", height: "auto" }} projectionConfig={{ scale: 1000 }}>
        <Geographies geography={US_TOPO_URL}>
          {({ geographies }) => geographies.map(geo => {
            const stCode = FIPS_TO_STATE[geo.id];
            if (!stCode) return null;
            const stData = data[stCode];
            const fill = stData ? choroplethColor(stData.v, minVal, maxVal, metricCfg.scale || "blue") : "#1e293b";
            return (
              <Geography key={geo.rsmKey} geography={geo}
                onMouseEnter={e => {
                  const name = STATE_NAMES[stCode] || stCode;
                  const rank = rankOf(stCode);
                  const val = stData ? metricCfg.fmt(stData.v) : "No data";
                  setTooltipContent(`${name}: ${val}${rank ? ` (#${rank} of ${ranked.length})` : ""}`);
                  setTooltipPos({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltipContent("")}
                style={{
                  default: { fill, stroke: "#0f172a", strokeWidth: 0.5, outline: "none", transition: "fill 0.2s ease" },
                  hover: { fill, stroke: "#e2e8f0", strokeWidth: 1.5, outline: "none", cursor: "pointer", filter: "brightness(1.3)" },
                  pressed: { fill, outline: "none" },
                }}
              />
            );
          })}
        </Geographies>
      </ComposableMap>
      {tooltipContent && (
        <div style={{ position: "fixed", left: tooltipPos.x + 14, top: tooltipPos.y - 12, background: "#0f172aee", border: "1px solid rgba(129,140,248,0.3)", borderRadius: 8, padding: "6px 12px", pointerEvents: "none", zIndex: 1000, fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.heading, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          {tooltipContent}
        </div>
      )}
      {values.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginTop: 8, padding: "0 20px" }}>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, minWidth: 60, textAlign: "right" }}>{metricCfg.fmt(minVal)}</span>
          <div style={{ flex: 1, maxWidth: 300, height: 10, borderRadius: 5, background: `linear-gradient(to right, ${choroplethColor(minVal, minVal, maxVal, metricCfg.scale)}, ${choroplethColor((minVal + maxVal) / 2, minVal, maxVal, metricCfg.scale)}, ${choroplethColor(maxVal, minVal, maxVal, metricCfg.scale)})` }} />
          <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, minWidth: 60 }}>{metricCfg.fmt(maxVal)}</span>
        </div>
      )}
      {!values.length && !loading && <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, textAlign: "center", padding: 10 }}>No state data yet for this metric — it loads state by state from FRED on first use (about a minute).</div>}
    </div>

    {/* Sortable state table */}
    {tableRows.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(129,140,248,0.08)" }}>
              {th("Rank", "rank", "left", { width: 50 })}{th("State", "state")}{th(metricCfg.label, "value", "right")}{th("vs Natl", null, "right", { width: 90 })}{th("Date", null, "left", { width: 90 })}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => {
              const diff = nationalData ? row.v - nationalData.v : null;
              const diffColor = diff == null || diff === 0 ? "#64748b" : metricCfg.sortAsc ? (diff > 0 ? "#f87171" : "#4ade80") : (diff > 0 ? "#4ade80" : "#f87171");
              return (
                <tr key={row.st} style={{ borderBottom: i < tableRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b" }}>{row.rank}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: choroplethColor(row.v, minVal, maxVal, metricCfg.scale), marginRight: 8, verticalAlign: "middle" }} />
                    {STATE_NAMES[row.st] || row.st}<span style={{ color: "#64748b", fontSize: 10, marginLeft: 6 }}>{row.st}</span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: fonts.mono, color: "var(--text-primary)", textAlign: "right", fontWeight: 600 }}>{metricCfg.fmt(row.v)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: diffColor, textAlign: "right" }}>{fmtDiff(diff)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#64748b" }}>{fmtDate(row.d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </>);
}
