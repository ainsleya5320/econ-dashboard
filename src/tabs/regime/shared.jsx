import React from "react";
import { finite, C } from "../options/ui.jsx";

// Shared by the Regime Map page (FourMarkets.jsx, RegimeAnalogs.jsx) and its Cockpit summary (RegimeSummary.jsx), so
// a regime, a curve label or a Fed-turn state is the same colour everywhere. Each family takes the categorical
// slots in a fixed order; the neutral member (quiet, no clear move, no test) is grey.
export const CELL_ORDER = ["easing-improving", "easing-deteriorating", "tightening-improving", "tightening-deteriorating"];
export const CELL_COLOR = { "easing-improving": "var(--oc-3)", "easing-deteriorating": "var(--oc-1)", "tightening-improving": "var(--oc-4)", "tightening-deteriorating": "var(--oc-2)" };
export const STATE = { uptrend: ["Uptrend", C[1]], downtrend: ["Downtrend", C[2]], "turning up": ["Turning up", "var(--text-muted)"], "turning down": ["Turning down", "var(--text-muted)"] };
export const CURVE_COLOR = { "bull-steep": "var(--oc-1)", "bear-flat": "var(--oc-2)", "bull-flat": "var(--oc-3)", "bear-steep": "var(--oc-4)", none: "var(--border-subtle)" };
export const TURN_COLOR = { blink: "var(--oc-1)", firm: "var(--oc-2)", easing: "var(--oc-3)", testing: "var(--oc-4)", calm: "var(--border-subtle)" };
export const REG_COLOR = { credit: "var(--oc-2)", scare: "var(--oc-5)", tightening: "var(--oc-4)", reflation: "var(--oc-3)", easing: "var(--oc-1)", quiet: "var(--text-muted)" };

export function Chip({ label, color }) {
  return <span className="otag" style={{ display: "inline-flex", alignItems: "center", gap: 5, borderColor: color, color: "var(--text-primary)", whiteSpace: "nowrap" }}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />{label}</span>;
}

// one score on the shared −2…+2 scale: blue to the right (supportive), orange to the left (a headwind)
export function ScoreBar({ v, width = 110 }) {
  const mid = width / 2, s = x => (Math.min(2, Math.abs(x)) / 2) * (mid - 2);
  return (
    <svg width={width} height={12} role="img" aria-label={finite(v) ? `score ${v > 0 ? "+" : ""}${v.toFixed(2)}` : "no reading"} style={{ display: "block" }}>
      <line x1={mid} x2={mid} y1={0} y2={12} stroke="var(--text-muted)" />
      {finite(v) && v !== 0 && <rect x={v > 0 ? mid + 1 : mid - 1 - s(v)} y={2} width={Math.max(2, s(v))} height={8} rx={2} fill={v > 0 ? C[1] : C[2]} />}
    </svg>
  );
}
