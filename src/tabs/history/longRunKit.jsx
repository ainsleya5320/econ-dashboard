import React, { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceDot } from "recharts";
import { fonts } from "../../lib/styles.js";
import { fin, tip, axis, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// Shared pieces for the Historical tab's long-run sections (Interest rates,
// Inflation, Growth): the /api/long-run hook, series → chart rows (monthly
// series fold to annual averages when the window is long, so a 170-year chart
// stays light), range and series pickers, and a numeric-axis line chart.
// Series arrive as { s: first period, v: [...] }: s is "YYYY-MM" for monthly
// data and a year for annual data.
// ============================================================================

let cache = null, pending = null;
export function useLongRun() {
  const [state, setState] = useState(() => (cache ? { data: cache } : {}));
  useEffect(() => {
    if (cache) return;
    let live = true;
    pending ||= fetch("/api/long-run").then(async r => { const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`); cache = d; return d; });
    pending.then(d => live && setState({ data: d })).catch(e => { pending = null; if (live) setState({ error: e.message }); });
    return () => { live = false; };
  }, []);
  return state;
}

// { s, v } → [[x, value]]: x is the year (annual) or year + (month − 1) / 12
export function points(ser) {
  if (!ser?.v) return [];
  if (typeof ser.s === "number") return ser.v.map((v, i) => [ser.s + i, v]);
  const [y0, m0] = String(ser.s).split("-").map(Number);
  return ser.v.map((v, i) => { const m = m0 - 1 + i; return [y0 + Math.floor(m / 12) + (m % 12) / 12, v]; });
}
export const firstYear = ser => (ser ? (typeof ser.s === "number" ? ser.s : Number(String(ser.s).slice(0, 4))) : null);
export const lastYear = ser => { const p = points(ser); return p.length ? Math.floor(p[p.length - 1][0]) : null; };

// several series → chart rows over [from, to]; monthly data averaged by year
// when annual is true
export function rowsFor(defs, from, to, annual) {
  const byX = new Map();
  for (const d of defs) {
    const acc = new Map();
    for (const [x, v] of points(d.ser)) {
      if (!fin(v) || x < from || x >= to + 1) continue;
      const key = annual ? Math.floor(x) : Math.round(x * 1200) / 1200;
      const a = acc.get(key) || [0, 0];
      a[0] += v; a[1]++;
      acc.set(key, a);
    }
    for (const [x, [s, n]] of acc) {
      const row = byX.get(x) || { x };
      row[d.key] = Math.round((s / n) * 1000) / 1000;
      byX.set(x, row);
    }
  }
  return [...byX.values()].sort((a, b) => a.x - b.x);
}
// rolling mean over the previous n points (x ascending)
export function rolling(rows, key, n, out = `${key}Avg`) {
  for (let i = 0; i < rows.length; i++) {
    const w = rows.slice(Math.max(0, i - n + 1), i + 1).map(r => r[key]).filter(fin);
    rows[i][out] = w.length >= Math.ceil(n * 0.7) ? Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 100) / 100 : null;
  }
  return rows;
}
// ordinary least squares slope of y on x
export function trend(pairs) {
  const p = pairs.filter(([x, y]) => fin(x) && fin(y));
  if (p.length < 10) return null;
  const mx = p.reduce((s, [x]) => s + x, 0) / p.length, my = p.reduce((s, [, y]) => s + y, 0) / p.length;
  let sxy = 0, sxx = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const b = sxy / sxx;
  return { slope: b, at: x => my + b * (x - mx) };
}

export const pct = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
export const spct = (v, dp = 1) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}%` : "—");
export const yearLabel = x => { const y = Math.floor(x), m = Math.round((x - y) * 12); return m ? `${y}-${String(m + 1).padStart(2, "0")}` : String(y); };

const pillStyle = on => ({
  padding: "3px 10px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", fontSize: 10.5, fontFamily: fonts.mono,
  background: on ? "rgba(129,140,248,0.18)" : "var(--bg-subtle)", border: `1px solid ${on ? "#818cf8" : "var(--border-subtle)"}`,
  color: on ? "var(--text-primary)" : "var(--text-secondary)",
});
export function RangePills({ ranges, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} role="group" aria-label="Time range">
      {ranges.map(([label, from]) => <button key={label} aria-pressed={value === from} onClick={() => onChange(from)} style={pillStyle(value === from)}>{label}</button>)}
    </div>
  );
}
// series toggles; each chip carries its line colour as a swatch, so the
// legend and the switch are the same control
export function SeriesChips({ defs, on, toggle }) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }} role="group" aria-label="Series">
      {defs.map(d => {
        const active = on.includes(d.key);
        return (
          <button key={d.key} aria-pressed={active} onClick={() => toggle(d.key)} title={d.note || d.label} style={{ ...pillStyle(active), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: active ? d.color : "var(--border-subtle)", borderTop: d.dash && active ? `1px dashed ${d.color}` : undefined }} />
            {d.label}{d.span ? <span style={{ color: "var(--text-muted)" }}> {d.span}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// numeric-x line chart; lines: [{ key, color, label, width?, dash? }]
export function LongLines({ rows, lines, height = 280, y, log = false, unit = "%", refs = [], dots = [], fmtY, from, to }) {
  const phone = useIsPhone();
  const f = fmtY || (v => (unit === "%" ? `${Number(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%` : Number(v).toLocaleString()));
  return (
    <ResponsiveContainer width="100%" height={chartH(phone, height)}>
      <LineChart data={rows} margin={{ top: 10, right: 10, left: phone ? -16 : -4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="x" type="number" domain={[from ?? "dataMin", to ?? "dataMax"]} allowDecimals={false} tick={axis} tickFormatter={v => String(Math.floor(v))} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={24} />
        <YAxis tick={axis} axisLine={false} tickLine={false} scale={log ? "log" : "auto"} domain={y || (log ? ["auto", "auto"] : ["auto", "auto"])} allowDataOverflow={!!y} tickFormatter={f} width={phone ? 42 : 50} />
        <Tooltip contentStyle={tip} labelFormatter={yearLabel} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }}
          formatter={(v, name) => [f(v), lines.find(l => l.key === name)?.label || name]} />
        {refs.map(({ key, ...r }) => <ReferenceLine key={key || r.y || r.x} {...r} />)}
        {lines.map(l => <Line key={l.key} type="monotone" dataKey={l.key} name={l.key} stroke={l.color} strokeWidth={l.width || 1.6} strokeDasharray={l.dash ? "5 3" : undefined} dot={false} connectNulls={false} isAnimationActive={false} />)}
        {dots.map(d => <ReferenceDot key={`${d.x}-${d.y}`} x={d.x} y={d.y} r={3.5} fill={d.color || "var(--text-primary)"} stroke="var(--card-bg)" strokeWidth={1.5} label={{ value: d.label, position: d.position || "top", fill: "var(--text-secondary)", fontSize: 9.5, fontFamily: fonts.mono }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

// the year range a set of series covers, for the "since" pills
export const span = ser => (ser ? `${firstYear(ser)}–${lastYear(ser) >= new Date().getFullYear() - 1 ? "" : lastYear(ser)}` : "");
