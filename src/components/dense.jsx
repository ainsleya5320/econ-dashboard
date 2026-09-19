import React from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";

// ============================================================================
// DENSE — the shared look the newer panels (Capex Returns, Owner Wealth,
// Special Situations) converged on, pulled out so the older U.S. Economy tabs
// can wear it too: an eyebrow, one sentence that states the finding, a row of
// stat chips, and mono tables that fit a lot of numbers in a little space.
// ============================================================================

export const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8",
  SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", VIOLET = "#a78bfa",
  BLUE = "#60a5fa", ORANGE = "#fb923c", PINK = "#f472b6", TEAL = "#2dd4bf";

export const fin = v => v != null && isFinite(v);

export const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
export const label = { fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
export const note = { fontSize: 9.5, color: "var(--text-muted)", fontFamily: fonts.mono, lineHeight: 1.5 };
export const tip = { background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11 };
// tooltips render over --tooltip-bg in both themes, so their text is always light
export const tipText = "#cbd5e1";
export const axis = { fontSize: 9, fill: "var(--text-muted)", fontFamily: fonts.mono };

// ── formatters ──
export const pc = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
export const pp = (v, dp = 2) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}` : "—");
export const bn = (v, dp = 1) => (!fin(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(dp)}B`);
export const tn = (v, dp = 2) => (!fin(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v / 1000).toFixed(dp)}T`);
// takes $ billions, prints at whatever scale reads best
export const money = v => (!fin(v) ? "—" : Math.abs(v) >= 1000 ? tn(v) : Math.abs(v) >= 1 ? bn(v, 0) : `${v < 0 ? "−" : ""}$${Math.abs(v * 1000).toFixed(0)}M`);
export const kk = (v, dp = 0) => (fin(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}K` : "—");
export const signed = (v, f = x => x.toFixed(1)) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${f(Math.abs(v))}` : "—");
export const upDown = (v, invert = false) => (!fin(v) || v === 0 ? SLATE : (v > 0) !== invert ? GREEN : RED);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtMon = d => { if (!d) return "—"; const p = d.split("-"); return `${MON[+p[1] - 1]} ${p[0]}`; };
export const fmtDay = d => { if (!d) return "—"; const p = d.split("-"); return p[2] ? `${MON[+p[1] - 1]} ${+p[2]}, ${p[0]}` : fmtMon(d); };

// ── table cells ──
export const th = (t, a = "right", extra = {}) => (
  <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: a, fontWeight: 600, borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap", ...extra }}>{t}</th>
);
export const td = (v, color = "var(--text-primary)", extra = {}) => (
  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>
);
export const tdL = (v, color = "var(--text-secondary)", extra = {}) => td(v, color, { textAlign: "left", ...extra });
export const tableStyle = { width: "100%", borderCollapse: "collapse" };
export const rowBorder = { borderTop: "1px solid var(--border-subtle)" };

// ── chips / pills ──
export const Pill = ({ children, color = SLATE, title }) => (
  <span title={title} style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, whiteSpace: "nowrap" }}>{children}</span>
);

export const chip = (name, v, color = "var(--text-primary)", sub) => (
  <div key={name} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", background: "var(--bg-subtle)", borderRadius: 8, minWidth: 108 }}>
    <span style={{ ...label, fontSize: 8.5 }}>{name}</span>
    <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{v}</span>
    {sub && <span style={{ ...note, fontSize: 8.5 }}>{sub}</span>}
  </div>
);

// ── the standard panel header: eyebrow, finding, blurb, meta, chips ──
export function DenseHeader({ eyebrow, headline, blurb, meta, chips, style }) {
  return (
    <div style={{ ...card, marginBottom: 12, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={{ flex: "1 1 460px" }}>
          <div style={label}>{eyebrow}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>{headline}</div>
          {blurb && <div style={{ fontSize: 10.5, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5, maxWidth: 940 }}>{blurb}</div>}
        </div>
        {meta && <div style={{ ...note, textAlign: "right" }}>{meta}</div>}
      </div>
      {chips && chips.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>{chips}</div>}
    </div>
  );
}

// ── a titled card that wraps a chart or a table ──
export function Panel({ title, right, children, pad = "10px 12px 6px", style }) {
  return (
    <div style={{ ...card, padding: pad, marginBottom: 12, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={label}>{title}</div>
          {right && <div style={note}>{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── inline footnote under a panel ──
export const Note = ({ children, style }) => <div style={{ ...note, marginTop: 6, ...style }}>{children}</div>;

// ── where a value sits inside its own history, 0–100 ──
export function pctile(arr, v) {
  if (!fin(v) || !arr || !arr.length) return null;
  const xs = arr.filter(fin);
  if (!xs.length) return null;
  return (xs.filter(x => x <= v).length / xs.length) * 100;
}

// ── a compact position marker for that percentile ──
export function RangeBar({ pct, color = INDIGO, width = 60 }) {
  if (!fin(pct)) return <span style={note}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ position: "relative", width, height: 5, background: "var(--bg-subtle)", borderRadius: 3, display: "inline-block" }}>
        <span style={{ position: "absolute", left: `${Math.max(0, Math.min(98, pct))}%`, top: -2, width: 2, height: 9, background: color, borderRadius: 1 }} />
      </span>
      <span style={{ fontSize: 9, fontFamily: fonts.mono, color: "var(--text-muted)" }}>{pct.toFixed(0)}</span>
    </span>
  );
}

// ── compound annualised rate over n periods of a level series ──
export function annualized(series, n, perYear) {
  if (!series || series.length <= n) return null;
  const a = series[series.length - 1 - n];
  const b = series[series.length - 1];
  if (!a || !b || !fin(a.v) || !fin(b.v) || a.v <= 0) return null;
  return (Math.pow(b.v / a.v, perYear / n) - 1) * 100;
}

// ── plain change over n periods ──
export function change(series, n) {
  if (!series || series.length <= n) return null;
  const a = series[series.length - 1 - n], b = series[series.length - 1];
  if (!a || !b || !fin(a.v) || !fin(b.v)) return null;
  return b.v - a.v;
}

export const last = arr => (arr && arr.length ? arr[arr.length - 1] : null);
export const lastV = arr => { const x = last(arr); return x ? x.v : null; };
export const lastD = arr => { const x = last(arr); return x ? x.d : null; };
export const backV = (arr, n) => (arr && arr.length > n ? arr[arr.length - 1 - n].v : null);
