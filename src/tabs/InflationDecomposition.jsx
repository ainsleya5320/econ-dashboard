import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../lib/styles.js";
import { fin, label, note, tip, axis, pc, pp, fmtMon, th, td, tdL, tableStyle, Panel, Note } from "../components/dense.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// INFLATION DECOMPOSITION — what PCE inflation is made of. Each month's bar is
// the published rate split into the contributions of six pieces that do not
// overlap and together are the whole index (four of them for core); the line is
// the published rate itself, so the bars reach it.
//   window   twelve months, three months annualised, or the single month
//   measure  headline, or core (the same four core pieces, weights rebased)
//   table    each piece's share of spending, its own rate, what it adds now and
//            a year ago, and how far that is from what it would add at a 2% pace
// Data: /api/inflation-decomp (server/inflationDecomp.js): FRED's monthly BEA
// series, contributions computed there. Colours are the validated categorical
// slots (--oc-1…5, fixed order up the stack) with the one residual goods piece
// in neutral gray; the table carries every value for light mode and print.
// ============================================================================

const PIECES = {
  services: { label: "Services ex energy & housing", short: "Core services", color: "var(--oc-1)", what: "Health care, transport, restaurants, recreation, financial and other services: mostly wages" },
  housing: { label: "Housing", short: "Housing", color: "var(--oc-2)", what: "Rent and owners' equivalent rent" },
  durables: { label: "Durable goods", short: "Durables", color: "var(--oc-3)", what: "Vehicles, furnishings, electronics, recreational goods" },
  otherGoods: { label: "Other core goods", short: "Other goods", color: "var(--text-muted)", what: "Nondurable goods other than food and energy: clothing, household supplies, medicines" },
  food: { label: "Food at home", short: "Food", color: "var(--oc-4)", what: "Food and beverages bought for home (restaurants are in services)" },
  energy: { label: "Energy", short: "Energy", color: "var(--oc-5)", what: "Gasoline and other fuels, electricity and gas" },
};
const ORDER = ["services", "housing", "durables", "otherGoods", "food", "energy"];
const MODES = { yoy: ["12-month", "over twelve months"], m3: ["3-month annualised", "over three months, annualised"], m1: ["1-month", "in the month, not annualised"] };
const RANGES = { 36: "3 years", 60: "5 years", 120: "10 years", 180: "15 years" };
const btn = on => ({ cursor: "pointer", border: "1px solid var(--border-subtle)", background: on ? "var(--oc-1)" : "transparent", color: on ? "#fff" : "var(--text-secondary)", font: `10.5px ${fonts.mono}`, padding: "3px 8px", borderRadius: 5 });
const Toggle = ({ value, onChange, options, name }) => (
  <span role="group" aria-label={name} style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>
    {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} style={btn(value === v)}>{text}</button>)}
  </span>
);
const Swatch = ({ color }) => <i aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: color, marginRight: 5, verticalAlign: "baseline" }} />;

export default function InflationDecomposition() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [base, setBase] = useState("headline"), [mode, setMode] = useState("yoy"), [range, setRange] = useState(60);
  useEffect(() => { let live = true; fetch("/api/inflation-decomp").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);

  const names = useMemo(() => ORDER.filter(n => base === "headline" || (n !== "food" && n !== "energy")), [base]);
  const rows = useMemo(() => (d ? d.series[base][mode].slice(-range) : []), [d, base, mode, range]);
  if (err) return <Panel title="What it is made of — contributions to PCE inflation"><div style={{ ...note, padding: "18px 6px" }}>The decomposition could not be loaded: {err}</div></Panel>;
  if (!d) return <Panel title="What it is made of — contributions to PCE inflation"><div style={{ ...note, padding: "30px 6px", textAlign: "center" }}>Loading the PCE components…</div></Panel>;

  const t = d.table[base], by = Object.fromEntries(t.pieces.map(p => [p.id, p]));
  const measure = base === "headline" ? "PCE" : "Core PCE", annual = mode !== "m1";
  const top = [...t.pieces].sort((a, b) => b.contribution - a.contribution), mover = [...t.pieces].filter(p => fin(p.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const excess = [...t.pieces].sort((a, b) => b.vsTarget - a.vsTarget)[0], gap = t.total - t.target;
  const vmax = Math.max(0.05, ...t.pieces.map(p => Math.abs(p.vsTarget)));
  const dp = annual ? 2 : 3;

  const Hover = ({ active, label: l }) => {
    const r = active && rows.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "var(--text-secondary)", minWidth: 210 }}>
        <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 12 }}>{fmtMon(l)} · {measure} {pc(r.total, 2)}</div>
        <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 4 }}>{MODES[mode][1]} · percentage points</div>
        {[...names].reverse().map(n => (
          <div key={n} style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 10.5, lineHeight: 1.55 }}>
            <span><Swatch color={PIECES[n].color} />{PIECES[n].label}</span><span style={{ color: "var(--text-primary)" }}>{pp(r[n], dp)}</span>
          </div>
        ))}
        {Math.abs(r.resid) >= 0.015 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}><span>not attributed</span><span>{pp(r.resid, dp)}</span></div>}
      </div>
    );
  };

  return (
    <Panel title={`What it is made of — each piece's contribution to ${measure} inflation`} right={`through ${fmtMon(d.asOf)} · percentage points`} pad="10px 12px 8px">
      <div className="options-research">
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-primary)", margin: "2px 0 8px", maxWidth: 900 }}>
          {measure} inflation is {pc(t.total, 1)} over twelve months{fin(t.yearAgo) ? `, against ${pc(t.yearAgo, 1)} a year ago` : ""}. {PIECES[top[0].id].label} adds {top[0].contribution.toFixed(2)} points and {PIECES[top[1].id].label.toLowerCase()} {top[1].contribution.toFixed(2)}.
          {mover && Math.abs(mover.change) >= 0.05 ? ` The biggest change on the year is ${PIECES[mover.id].label.toLowerCase()}, ${mover.change > 0 ? "up" : "down"} ${Math.abs(mover.change).toFixed(2)} points.` : ""}
          {gap > 0.1 && excess.vsTarget > 0 ? ` Of the ${gap.toFixed(1)} points above a 2% pace, ${PIECES[excess.id].label.toLowerCase()} accounts for ${excess.vsTarget.toFixed(2)}.` : ""}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          <Toggle name="Measure" value={base} onChange={setBase} options={[["headline", "Headline"], ["core", "Core"]]} />
          <Toggle name="Window" value={mode} onChange={setMode} options={Object.entries(MODES).map(([k, v]) => [k, v[0]])} />
          <Toggle name="Range" value={range} onChange={v => setRange(+v)} options={Object.entries(RANGES).map(([k, v]) => [+k, v])} />
        </div>
        <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", marginBottom: 2 }}>
          {names.map(n => <span key={n} title={PIECES[n].what}><Swatch color={PIECES[n].color} />{PIECES[n].label}</span>)}
          <span><i aria-hidden="true" style={{ display: "inline-block", width: 14, height: 0, borderTop: "2px solid var(--text-primary)", marginRight: 5, verticalAlign: "middle" }} />{measure}, as published</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={rows} stackOffset="sign" margin={{ top: 8, right: 10, left: -8, bottom: 0 }} barCategoryGap={rows.length > 72 ? "8%" : "16%"}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={x => fmtMon(x).replace(" 20", " ’")} minTickGap={44} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(annual ? 0 : 1)}%`} width={40} />
            <Tooltip content={<Hover />} cursor={{ fill: "var(--border-subtle)", opacity: 0.35 }} />
            {annual && <ReferenceLine y={2} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: "2%", position: "insideTopRight", fontSize: 9, fill: "var(--text-muted)", fontFamily: fonts.mono }} />}
            <ReferenceLine y={0} stroke="var(--text-muted)" />
            {names.map(n => <Bar key={n} dataKey={n} name={PIECES[n].label} stackId="c" fill={PIECES[n].color} stroke="var(--card-bg)" strokeWidth={rows.length > 72 ? 0.5 : 1} isAnimationActive={false} />)}
            <Line dataKey="total" name={measure} stroke="var(--text-primary)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--card-bg)", strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>

        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={tableStyle}>
            <thead><tr>{th("piece", "left")}{th("share of spending")}{th("its own rate, 12m")}{th("adds now")}{th("a year ago")}{th("change")}{th("3m annualised")}{th("against a 2% pace", "left")}</tr></thead>
            <tbody>
              {[...names].reverse().map(n => {
                const p = by[n], w = (Math.abs(p.vsTarget) / vmax) * 56;
                return (
                  <tr key={n} style={{ borderTop: "1px solid var(--border-subtle)" }} title={PIECES[n].what}>
                    {tdL(<><Swatch color={PIECES[n].color} />{PIECES[n].label}</>, "var(--text-primary)")}
                    {td(pc(p.weight * 100, 1), "var(--text-secondary)")}
                    {td(p.implied ? <span title="Implied: what it adds over its share of spending (no monthly price index is published for this piece)">≈ {pc(p.rate, 1)}</span> : pc(p.rate, 1))}
                    {td(pp(p.contribution, 2), "var(--text-primary)", { fontWeight: 600 })}
                    {td(pp(p.yearAgo, 2), "var(--text-secondary)")}
                    {td(pp(p.change, 2), !fin(p.change) || Math.abs(p.change) < 0.05 ? "var(--text-muted)" : "var(--text-primary)")}
                    {td(pp(p.threeMonth, 2), "var(--text-secondary)")}
                    <td style={{ padding: "4px 6px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <svg width={120} height={12} role="img" aria-label={`${pp(p.vsTarget, 2)} points against a 2% pace`} style={{ display: "block" }}>
                          <line x1={60} x2={60} y1={0} y2={12} stroke="var(--text-muted)" />
                          <rect x={p.vsTarget >= 0 ? 61 : 59 - w} y={2} width={Math.max(1, w)} height={8} rx={2} fill={p.vsTarget >= 0 ? "var(--oc-pos)" : "var(--oc-neg)"} />
                        </svg>
                        <span style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)" }}>{pp(p.vsTarget, 2)}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "1px solid var(--text-muted)" }}>
                {tdL(`${measure}, as published`, "var(--text-primary)", { fontWeight: 600 })}
                {td("100%", "var(--text-secondary)")}
                {td(pc(t.total, 1))}
                {td(pp(t.total, 2), "var(--text-primary)", { fontWeight: 600 })}
                {td(pp(t.yearAgo, 2), "var(--text-secondary)")}
                {td(fin(t.yearAgo) ? pp(t.total - t.yearAgo, 2) : "—")}
                {td(pp(t.threeMonth, 2), "var(--text-secondary)")}
                {tdL(`${pp(gap, 2)} from 2%`, "var(--text-secondary)", { fontSize: 10.5 })}
              </tr>
            </tbody>
          </table>
        </div>
        <Note>
          A piece adds its share of spending times its own price change, so a small piece moving a lot (energy) can add as much as a large one moving a little (services).
          "Against a 2% pace" is what the piece adds less what it would add if its prices rose 2% a year: positive is pushing inflation above target, and the column sums to the gap.
          {base === "core" ? " Core leaves out food and energy; the four pieces' shares are of core spending." : ""} Housing and other core goods are differences between published aggregates, not published lines.
          Computed from BEA's monthly price indexes and spending on FRED as a chained month-by-month sum; over {fmtMon(d.from)} to {fmtMon(d.asOf)} the pieces miss the published rate by {d.fit.meanGap.toFixed(2)} points on average and {d.fit.maxGap.toFixed(2)} at most, shown as "not attributed" where it is visible.
        </Note>
      </div>
    </Panel>
  );
}
