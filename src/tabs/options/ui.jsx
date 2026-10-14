import React, { useState } from "react";

// ============================================================================
// Shared pieces for the denser Options views (Market, ranges at a glance,
// Strategies): a compact card whose chart always has a table twin, KPI tiles,
// a 1-year range strip, sparklines, diverging heat cells and formatters.
// Colors come from the validated --oc-* tokens in OptionsResearch.css (the
// dataviz reference palette, checked against both dashboard surfaces):
// categorical slots in fixed order, a blue/red diverging pair with a gray
// midpoint. Text always wears text tokens, never a series color.
// ============================================================================

export const finite = v => typeof v === "number" && Number.isFinite(v);
export const fx = (v, dp = 1) => (finite(v) ? v.toFixed(dp) : "—");
export const pctS = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
export const signed = (v, dp = 1, unit = "") => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}${unit}` : "—");
export const ord = n => { if (!finite(n)) return "—"; const v = Math.round(n), t = v % 100; return `${v}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][v % 10] || "th"}`; };
export const usdK = v => { if (!finite(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return s + (a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `$${Math.round(a / 1e3)}k` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a)}`); };
export const usd = (v, dp = 2) => (finite(v) ? `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}` : "—");
export const intK = v => (!finite(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : v.toLocaleString("en-US"));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}` : "—");
export const monLabel = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}` : "");

// chart chrome: recessive solid hairlines, muted ticks
export const axisTick = { fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" };
export const gridProps = { stroke: "var(--border-subtle)", vertical: false };
export const tipStyle = { background: "var(--tooltip-bg)", border: "1px solid var(--border-subtle)", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-number)" };
export const tipLabel = { color: "var(--text-primary)", fontWeight: 600 };
export const C = { 1: "var(--oc-1)", 2: "var(--oc-2)", 3: "var(--oc-3)", 4: "var(--oc-4)", 5: "var(--oc-5)", muted: "var(--text-muted)" };

// A compact card: eyebrow, title, a one-line finding, the chart, and a "Table" toggle that swaps in
// the same numbers as a table (every chart has a table twin; tooltips never gate a value).
export function VizCard({ eyebrow, title, finding, right, table, children, note, style }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="ocard" style={style}>
      <header className="ocard-head">
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div className="ocard-eyebrow">{eyebrow}</div>}
          <h3 className="ocard-title">{title}</h3>
        </div>
        <div className="ocard-tools">
          {right}
          {table && <button type="button" className="ochip" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}>{asTable ? "Chart" : "Table"}</button>}
        </div>
      </header>
      {finding && <p className="ocard-finding">{finding}</p>}
      {asTable && table ? <div className="otable-wrap">{table}</div> : children}
      {note && <p className="ocard-note">{note}</p>}
    </section>
  );
}

// a plain table from columns [{ key, label, fmt?, align? }] and rows
export function MiniTable({ columns, rows, maxHeight = 320 }) {
  return (
    <div style={{ maxHeight, overflow: "auto" }}>
      <table className="otable">
        <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.align || (c === columns[0] ? "left" : "right") }}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{columns.map(c => <td key={c.key} style={{ textAlign: c.align || (c === columns[0] ? "left" : "right") }}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? "—"}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// KPI tile: label, value, a context line (percentile, change), optional status word
export function Kpi({ label, value, sub, tone, title }) {
  return (
    <div className="okpi" title={title}>
      <span className="okpi-label">{label}</span>
      <strong className="okpi-value">{value}</strong>
      {sub && <span className="okpi-sub">{tone && <i className="okpi-dot" style={{ background: tone }} aria-hidden="true" />}{sub}</span>}
    </div>
  );
}

// Where today sits within a window: a hairline from min to max, the middle 50% as a thicker bar,
// a tick at the average and a dot (with a surface ring) at the latest value.
export function RangeStrip({ min, max, p25, p75, avg, value, width = 160, height = 18, color = C[1] }) {
  if (![min, max, value].every(finite) || max <= min) return <span className="onote">—</span>;
  const x = v => 4 + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (width - 8);
  return (
    <svg width={width} height={height} role="img" aria-label={`latest ${value}, range ${min} to ${max}`} style={{ display: "block", overflow: "visible" }}>
      <line x1={x(min)} x2={x(max)} y1={height / 2} y2={height / 2} stroke="var(--text-muted)" strokeWidth="1" />
      {finite(p25) && finite(p75) && <rect x={x(p25)} y={height / 2 - 3} width={Math.max(1, x(p75) - x(p25))} height="6" rx="3" fill="var(--text-muted)" opacity="0.45" />}
      {finite(avg) && <line x1={x(avg)} x2={x(avg)} y1={height / 2 - 6} y2={height / 2 + 6} stroke="var(--text-secondary)" strokeWidth="1.5" />}
      <circle cx={x(value)} cy={height / 2} r="5" fill={color} stroke="var(--card-bg)" strokeWidth="2" />
    </svg>
  );
}

// a tiny line without axes (one series, its color names it)
export function Spark({ values, width = 90, height = 22, color = C[1], ref0 }) {
  const v = (values || []).filter(finite);
  if (v.length < 2) return <span className="onote">—</span>;
  const lo = Math.min(...v, ref0 ?? Infinity), hi = Math.max(...v, ref0 ?? -Infinity), span = hi - lo || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * (width - 2) + 1},${height - 2 - ((y - lo) / span) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block" }}>
      {finite(ref0) && <line x1="0" x2={width} y1={height - 2 - ((ref0 - lo) / span) * (height - 4)} y2={height - 2 - ((ref0 - lo) / span) * (height - 4)} stroke="var(--border-subtle)" strokeWidth="1" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Diverging cell: the text stays ink; the background mixes the pole into the gray midpoint by |t| (0..1).
export function divBg(t) {
  if (!finite(t) || t === 0) return "transparent";
  const a = Math.min(1, Math.abs(t)), pole = t > 0 ? "var(--oc-pos)" : "var(--oc-neg)";
  return `color-mix(in srgb, ${pole} ${Math.round(12 + a * 48)}%, var(--oc-mid))`;
}
// Sequential cell (one hue, light→dark): 0..1
export function seqBg(t) {
  if (!finite(t)) return "transparent";
  return `color-mix(in srgb, var(--oc-1) ${Math.round(8 + Math.min(1, Math.max(0, t)) * 52)}%, var(--card-bg))`;
}

// a two-to-five-way segmented control
export function Seg({ value, options, onChange, label }) {
  return (
    <div className="oseg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

// legend chips for >= 2 series (identity is never color alone: the label sits beside the swatch)
export function Legend({ items }) {
  return (
    <div className="olegend">
      {items.map(([label, color, dashed]) => (
        <span key={label}><i style={{ background: dashed ? "transparent" : color, borderTop: dashed ? `2px dashed ${color}` : "none" }} aria-hidden="true" />{label}</span>
      ))}
    </div>
  );
}
