import React, { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { STATE_NAMES, FIPS_TO_STATE, US_TOPO_URL } from "../lib/constants.js";
import { fmtDate, SH } from "./shared.jsx";

// ============================================================================
// STATE CHOROPLETH — U.S. state map + ranking table, shared by
// U.S. Economy → Regional → States and Real Estate → map.
//
// Colour, rebuilt Sept 2026. The old version interpolated linearly from
// rgb(30,41,59) — the card background, and also the "no data" fill — so half
// the states faded into the page and a state at the minimum was indistinguish-
// able from a state with no reading at all. It also scaled on raw min→max, so
// one outlier squashed the other forty-nine into a single indistinct shade.
//
// Now: one validated sequential ramp for magnitude (blue, five steps, monotone
// lightness with visible gaps, low end clearing 2:1 against the dark surface),
// a diverging blue↔red ramp with a neutral grey midpoint for the "vs national"
// view, and QUANTILE bins so the whole ramp is always in use no matter how
// skewed the distribution. The legend carries the real value breakpoints and a
// count per bin, so binning never hides the shape of the data.
// ============================================================================

// Sequential — magnitude. Validated (dataviz --mode dark --ordinal): monotone
// lightness, every adjacent gap ≥ 0.06, low end 2.15:1 against the surface.
const SEQ = ["#184f95", "#256abf", "#3987e5", "#86b6ef", "#cde2fb"];
// Diverging — polarity around the national reading. Neutral grey midpoint;
// poles separate at ΔE 18.5 under deuteranopia (floor 8) and 25.1 normal.
const DIV = ["#86b6ef", "#3987e5", "#1c5cab", "#3a3a38", "#8f3030", "#d03b3b", "#e66767"];
const NO_DATA = "#242a36";   // deliberately grey-of-slate: no ramp step is near it
const STROKE = "#0b1120";

const GOOD = "#4ade80", BAD = "#f87171", SLATE = "#94a3b8", DIM = "#475569", INDIGO = "#818cf8";
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const quantile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export default function StateChoropleth({ title, metrics, metric, setMetric, cache, loading, progress, note: hint }) {
  const [tip, setTip] = useState(null);
  const [sortCol, setSortCol] = useState("rank");
  const [sortAscending, setSortAscending] = useState(true);
  const [mode, setMode] = useState("level"); // level | vs

  const activeKey = metrics.some(m => m.key === metric) ? metric : metrics[0]?.key;
  useEffect(() => { if (activeKey && activeKey !== metric) setMetric(activeKey); }, [activeKey, metric, setMetric]);
  const cfg = metrics.find(m => m.key === activeKey);
  const data = cache[activeKey] || {};
  const national = data._national;

  const stats = useMemo(() => {
    const entries = Object.entries(data).filter(([k]) => k !== "_national" && fin(data[k]?.v));
    const values = entries.map(([, d]) => d.v).sort((a, b) => a - b);
    const natl = fin(national?.v) ? national.v : null;
    // "better" is the direction the metric's own sort says is good
    const sign = cfg?.sortAsc ? -1 : 1;
    const rows = entries.map(([st, d]) => ({ st, v: d.v, d: d.d, diff: natl == null ? null : d.v - natl, edge: natl == null ? null : (d.v - natl) * sign }));
    rows.sort((a, b) => (cfg?.sortAsc ? a.v - b.v : b.v - a.v));
    rows.forEach((r, i) => { r.rank = i + 1; });
    // quantile breaks: the whole ramp is used however skewed the data
    const breaks = SEQ.map((_, i) => quantile(values, (i + 1) / SEQ.length));
    const binOf = v => { for (let i = 0; i < breaks.length; i++) if (v <= breaks[i]) return i; return breaks.length - 1; };
    // diverging bins are symmetric about the national reading, scaled to the widest deviation
    const maxDev = rows.length && natl != null ? Math.max(...rows.map(r => Math.abs(r.edge))) || 1 : 1;
    const divOf = edge => {
      if (edge == null) return 3;
      const t = Math.max(-1, Math.min(1, edge / maxDev));      // −1 worst … +1 best
      return Math.round((1 - (t + 1) / 2) * (DIV.length - 1)); // best → index 0 (blue)
    };
    const counts = SEQ.map((_, i) => rows.filter(r => binOf(r.v) === i).length);
    return { rows, values, natl, breaks, binOf, divOf, counts, maxDev, byState: Object.fromEntries(rows.map(r => [r.st, r])) };
  }, [data, cfg, national]);

  const colourFor = r => (r == null ? NO_DATA : mode === "vs" ? (stats.natl == null ? NO_DATA : DIV[stats.divOf(r.edge)]) : SEQ[stats.binOf(r.v)]);

  const tableRows = useMemo(() => {
    const rows = [...stats.rows];
    if (sortCol === "state") rows.sort((a, b) => (STATE_NAMES[a.st] || a.st).localeCompare(STATE_NAMES[b.st] || b.st));
    else if (sortCol === "value") rows.sort((a, b) => a.v - b.v);
    else if (sortCol === "diff") rows.sort((a, b) => (a.diff ?? 0) - (b.diff ?? 0));
    return sortAscending ? rows : rows.reverse();
  }, [stats.rows, sortCol, sortAscending]);
  const toggleSort = col => { if (sortCol === col) setSortAscending(!sortAscending); else { setSortCol(col); setSortAscending(col === "state" || col === "rank"); } };
  const arrow = col => (sortCol === col ? (sortAscending ? " ▲" : " ▼") : "");

  if (!cfg) return null;
  const fmt = v => (fin(v) ? cfg.fmt(v) : "—");
  const fmtDiff = d => (d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${cfg.fmt(Math.abs(d))}`);
  const { rows, values, natl, breaks, counts } = stats;
  const best = rows[0], worst = rows[rows.length - 1];
  const median = values.length ? quantile(values, 0.5) : null;
  const th = (text, col, align = "left", extra = {}) => (
    <th key={text} onClick={col ? () => toggleSort(col) : undefined}
      style={{ padding: "7px 10px", fontSize: 8.5, color: col === sortCol ? "#c7d2fe" : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: col ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap", ...extra }}>
      {text}{col ? arrow(col) : ""}
    </th>
  );
  const chips = [
    ["state median", fmt(median)],
    ["range", values.length ? `${fmt(values[0])} – ${fmt(values[values.length - 1])}` : "—"],
    ["states", `${rows.length}`],
    ...(cfg.src || cfg.cadence ? [["source", [cfg.src, cfg.cadence].filter(Boolean).join(" · ")]] : []),
  ];

  return (<>
    {title && <SH>{title}</SH>}

    {/* metric rail, grouped by category */}
    {(metrics.some(m => m.cat) ? [...new Set(metrics.map(m => m.cat || ""))] : [""]).map(cat => (
      <div key={cat || "all"} style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6, alignItems: "center" }}>
        {cat && <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.6, width: 64, flexShrink: 0 }}>{cat}</span>}
        {metrics.filter(m => (m.cat || "") === cat).map(m => {
          const on = activeKey === m.key;
          return (
            <button key={m.key} onClick={() => setMetric(m.key)} style={{
              padding: "4px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
              background: on ? "rgba(129,140,248,0.18)" : "rgba(255,255,255,0.03)", border: `1px solid ${on ? INDIGO : "rgba(255,255,255,0.08)"}`,
              color: on ? "#e2e8f0" : "#64748b", fontFamily: fonts.heading, fontSize: 11, fontWeight: on ? 600 : 400,
            }}>{m.label}</button>
          );
        })}
      </div>
    ))}
    {hint && <div style={{ ...note, marginBottom: 10 }}>{hint}</div>}

    {/* headline card */}
    <div style={{ ...card, padding: "14px 18px", marginBottom: 12, display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(300px, 1.4fr)", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>National {cfg.label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 3 }}>
          {national ? fmt(national.v) : loading ? "…" : "—"}
        </div>
        {national?.d && <div style={{ ...note, marginTop: 2 }}>as of {fmtDate(national.d)}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
          {chips.map(([t, v]) => <span key={t} style={{ fontSize: 9.5, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}
        </div>
      </div>
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          {[["Best", best, GOOD], ["Worst", worst, BAD]].map(([t, r, c]) => (
            <div key={t}>
              <div style={label}>{t}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 2 }}>{fmt(r?.v)}</div>
              <div style={{ fontSize: 10, color: SLATE, fontFamily: fonts.mono }}>{STATE_NAMES[r?.st] || r?.st}</div>
            </div>
          ))}
          <div>
            <div style={label}>Spread</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 2 }}>{fin(values[values.length - 1] - values[0]) ? cfg.fmt(values[values.length - 1] - values[0]) : "—"}</div>
            <div style={{ fontSize: 10, color: SLATE, fontFamily: fonts.mono }}>highest − lowest</div>
          </div>
        </div>
      )}
    </div>

    {/* map */}
    <div style={{ ...card, padding: "10px 14px", marginBottom: 12, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {[["level", "Level"], ["vs", "vs national"]].map(([m, t]) => {
            const on = mode === m, ok = m === "level" || natl != null;
            return (
              <button key={m} disabled={!ok} onClick={() => setMode(m)} title={ok ? "" : "no national reading for this metric"} style={{
                padding: "3px 10px", borderRadius: 999, cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.4,
                background: on ? "rgba(129,140,248,0.18)" : "rgba(255,255,255,0.03)", border: `1px solid ${on ? INDIGO : "rgba(255,255,255,0.08)"}`,
                color: on ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, fontSize: 10,
              }}>{t}</button>
            );
          })}
        </div>
        {loading && <span style={{ fontSize: 10, color: INDIGO, fontFamily: fonts.mono }}>loading{progress ? ` ${progress}` : ""}…</span>}
      </div>

      <ComposableMap projection="geoAlbersUsa" style={{ width: "100%", height: "auto" }} projectionConfig={{ scale: 1000 }}>
        <Geographies geography={US_TOPO_URL}>
          {({ geographies }) => geographies.map(geo => {
            const st = FIPS_TO_STATE[geo.id];
            if (!st) return null;
            const r = stats.byState[st];
            const fill = colourFor(r);
            return (
              <Geography key={geo.rsmKey} geography={geo}
                onMouseEnter={e => setTip({ st, x: e.clientX, y: e.clientY })}
                onMouseMove={e => setTip(t => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                onMouseLeave={() => setTip(null)}
                style={{
                  default: { fill, stroke: STROKE, strokeWidth: 0.6, outline: "none", transition: "fill 0.2s ease" },
                  hover: { fill, stroke: "#f8fafc", strokeWidth: 1.6, outline: "none", cursor: "pointer" },
                  pressed: { fill, stroke: "#f8fafc", strokeWidth: 1.6, outline: "none" },
                }} />
            );
          })}
        </Geographies>
      </ComposableMap>

      {tip && (() => {
        const r = stats.byState[tip.st];
        return (
          <div style={{ position: "fixed", left: tip.x + 14, top: tip.y - 10, background: "#0f172af2", border: "1px solid rgba(129,140,248,0.35)", borderRadius: 8, padding: "7px 11px", pointerEvents: "none", zIndex: 50, fontFamily: fonts.mono, fontSize: 11, color: "#e2e8f0", whiteSpace: "nowrap", boxShadow: "0 6px 20px rgba(0,0,0,0.45)" }}>
            <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{STATE_NAMES[tip.st] || tip.st}</div>
            {r ? (<>
              <div style={{ marginTop: 2 }}>{fmt(r.v)} · #{r.rank} of {rows.length}</div>
              {r.diff != null && <div style={{ color: r.edge > 0 ? GOOD : r.edge < 0 ? BAD : SLATE }}>{fmtDiff(r.diff)} vs national</div>}
            </>) : <div style={{ marginTop: 2, color: SLATE }}>no reading</div>}
          </div>
        );
      })()}

      {/* binned legend — swatch, real breakpoint, and how many states sit in it */}
      {rows.length > 0 && mode === "level" && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
            {SEQ.map((c, i) => {
              const lo = i === 0 ? values[0] : breaks[i - 1];
              const maxCount = Math.max(...counts, 1);
              return (
                <div key={c} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ height: 18, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", height: `${Math.max(8, (counts[i] / maxCount) * 100)}%`, background: c, opacity: 0.35, borderRadius: "2px 2px 0 0" }} />
                  </div>
                  <div style={{ height: 9, background: c, borderRadius: 2 }} />
                  <div style={{ fontSize: 8.5, color: DIM, fontFamily: fonts.mono, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cfg.fmt(lo)}</div>
                  <div style={{ fontSize: 8.5, color: "#64748b", fontFamily: fonts.mono }}>{counts[i]} state{counts[i] === 1 ? "" : "s"}</div>
                </div>
              );
            })}
          </div>
          <div style={{ ...note, marginTop: 5 }}>Five equal-count bins, so the whole scale is used however skewed the spread is — the labels are the real value at each break, and the bars above show how many states land in each. Dark is low, light is high{cfg.sortAsc ? "; for this metric lower is better" : "; for this metric higher is better"}. Grey states have no reading.</div>
        </div>
      )}
      {rows.length > 0 && mode === "vs" && natl != null && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {DIV.map(c => <div key={c} style={{ flex: 1, height: 9, background: c, borderRadius: 2 }} />)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 9, color: GOOD, fontFamily: fonts.mono }}>better than national</span>
            <span style={{ fontSize: 9, color: SLATE, fontFamily: fonts.mono }}>{fmt(natl)}</span>
            <span style={{ fontSize: 9, color: BAD, fontFamily: fonts.mono }}>worse</span>
          </div>
          <div style={{ ...note, marginTop: 5 }}>Distance from the national reading, scaled to the widest deviation ({cfg.fmt(stats.maxDev)}). Blue is better on this metric, red worse, grey at the national number — the direction follows the metric, so {cfg.sortAsc ? "lower" : "higher"} counts as better here.</div>
        </div>
      )}
      {!rows.length && !loading && <div style={{ ...note, textAlign: "center", padding: 12 }}>No state data yet for this metric — it loads state by state and fills in as it arrives.</div>}
    </div>

    {/* table */}
    {tableRows.length > 0 && (
      <div style={{ ...card, padding: "6px 8px", marginBottom: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Rank", "rank", "left", { width: 46 })}{th("State", "state")}{th(cfg.label, "value", "right")}{th("vs national", "diff", "right")}{th("Position", null, "left", { width: 110 })}{th("As of", null, "left", { width: 78 })}</tr></thead>
          <tbody>
            {tableRows.map(r => {
              const pct = rows.length > 1 ? Math.round(((rows.length - r.rank) / (rows.length - 1)) * 100) : 50;
              return (
                <tr key={r.st} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }}>
                  <td style={{ padding: "4px 10px", fontSize: 10.5, fontFamily: fonts.mono, color: DIM }}>{r.rank}</td>
                  <td style={{ padding: "4px 10px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: colourFor(r), marginRight: 8, verticalAlign: "middle", border: "1px solid rgba(255,255,255,0.12)" }} />
                    {STATE_NAMES[r.st] || r.st}<span style={{ color: DIM, fontSize: 9, marginLeft: 6 }}>{r.st}</span>
                  </td>
                  <td style={{ padding: "4px 10px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-primary)", textAlign: "right", fontWeight: 700 }}>{fmt(r.v)}</td>
                  <td style={{ padding: "4px 10px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: r.diff == null || r.diff === 0 ? SLATE : r.edge > 0 ? GOOD : BAD }}>{fmtDiff(r.diff)}</td>
                  <td style={{ padding: "4px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ position: "relative", flex: 1, minWidth: 46, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                        <div style={{ position: "absolute", left: `calc(${pct}% - 2px)`, top: -2, width: 4, height: 8, borderRadius: 1, background: colourFor(r) }} />
                      </div>
                      <span style={{ fontSize: 8.5, color: DIM, fontFamily: fonts.mono, width: 24, textAlign: "right" }}>p{pct}</span>
                    </div>
                  </td>
                  <td style={{ padding: "4px 10px", fontSize: 9.5, fontFamily: fonts.mono, color: DIM }}>{fmtDate(r.d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </>);
}
