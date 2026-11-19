import React, { useEffect, useState } from "react";
import { finite, C, VizCard, Kpi, Spark, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// COMPUTE BALANCE: shortage or glut? The signals this dashboard already
// collects, read the way a commodity desk reads a market and graded by a rule
// printed beside each one: what old supply fetches, the forward curve, whether
// any can be had today, and whether orders are outrunning deliveries. The
// verdict is the count of signals, not a score. Under it, the growth race: the
// yearly multiples at which demand and supply are growing, side by side and
// not netted (dollars, tokens and chips are different units).
// Data: /api/compute-balance (server/computeBalance.js), which holds none of
// its own: each row names the chart it summarises. Shortage is orange and glut
// blue (--oc-2 / --oc-1), balanced gray; the grade is always written out.
// ============================================================================

const GRADE = { shortage: ["Shortage", C[2]], balanced: ["Balanced", "var(--text-muted)"], glut: ["Glut", C[1]], none: ["No reading", "var(--border-subtle)"] };
const GROUPS = [["price", "What supply fetches"], ["availability", "Whether you can get any"], ["orders", "Orders against deliveries"]];
const VERDICT = { shortage: "Short", "leaning short": "Leaning short", balanced: "Balanced", "leaning long": "Leaning to glut", glut: "Glut", "no data": "No data" };
const left = { textAlign: "left" }, right = { textAlign: "right" };
const day = d => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : d || "");

function Chip({ grade }) {
  const [label, color] = GRADE[grade] || GRADE.none;
  return <span className="otag" style={{ display: "inline-flex", alignItems: "center", gap: 5, borderColor: color, color: "var(--text-primary)" }}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />{label}</span>;
}

// yearly multiples on one log scale, so 2× and 30× can share a row
function Multiples({ rows, max, color }) {
  const W = 190, x = v => (Math.log(Math.max(1, v)) / Math.log(max)) * W;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {rows.map(r => (
        <div key={r.label} title={r.note} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 200px 52px", gap: 8, alignItems: "center", fontSize: 12 }}>
          <span style={{ fontFamily: "var(--font-body)", color: "var(--text-primary)" }}>{r.label}{r.forecast && <span className="otag" style={{ marginLeft: 5 }}>forecast</span>}{r.extrapolated && <span className="otag" style={{ marginLeft: 5 }}>{r.months === 1 ? "1 month" : `${r.months} months`}, annualised</span>}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{r.note}</div></span>
          <svg width={200} height={12} role="img" aria-label={`${r.multiple} times a year`} style={{ display: "block" }}>
            <line x1={0} x2={0} y1={0} y2={12} stroke="var(--text-muted)" />
            <rect x={1} y={2} width={Math.max(2, x(r.multiple))} height={8} rx={2} fill={color} opacity={r.forecast || r.extrapolated ? 0.45 : 1} />
          </svg>
          <strong style={{ fontFamily: "var(--font-number)", textAlign: "right" }}>{r.multiple}×</strong>
        </div>
      ))}
    </div>
  );
}

export default function ComputeBalance() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [open, setOpen] = useState(null);
  useEffect(() => { let live = true; fetch("/api/compute-balance").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The compute balance board could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading the compute market…</p></div>;

  const c = d.counts, dissent = d.signals.filter(s => (c.shortage >= c.glut ? s.grade === "glut" : s.grade === "shortage"));
  const majority = c.shortage >= c.glut ? "shortage" : "glut";
  const max = Math.max(4, ...[...d.growth.demand, ...d.growth.supply].map(r => r.multiple)) * 1.1;
  const first = d.history[0], changed = d.history.length > 1 && d.history.at(-2).verdict !== d.history.at(-1).verdict;

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`${d.graded} signals graded · built ${day(d.built)}`} title="Shortage or glut?"
        finding={`${c[majority]} of ${d.graded} signals read ${majority}${c.balanced ? `, ${c.balanced} balanced` : ""}${dissent.length ? `, and ${dissent.length} the other way (${dissent.map(s => s.label.toLowerCase()).join("; ")})` : ""}. A glut shows first in what is easiest to replace: old chips, spot prices and the far end of the curve. A shortage shows as the opposite, and as rationing.`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Verdict" value={VERDICT[d.verdict] || d.verdict} sub={changed ? `changed from ${VERDICT[d.history.at(-2).verdict]}` : first ? `on file since ${day(first.d)}` : "the count of signals, not a score"} tone={GRADE[majority][1]} />
          <Kpi label="Shortage" value={c.shortage} sub="signals" tone={GRADE.shortage[1]} />
          <Kpi label="Balanced" value={c.balanced} sub="signals" />
          <Kpi label="Glut" value={c.glut} sub="signals" tone={GRADE.glut[1]} />
          {c.ungraded > 0 && <Kpi label="No reading" value={c.ungraded} sub="feed missing or too short" />}
        </div>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={left}>Signal</th><th style={left}>Reading</th><th style={left}>Grade</th><th style={left}>History</th><th style={left}>Rule</th></tr></thead>
            <tbody>{GROUPS.map(([g, title]) => (
              <React.Fragment key={g}>
                <tr><td colSpan={5} style={{ ...left, background: "var(--bg-subtle)", fontFamily: "var(--font-body)", fontWeight: 600, color: "var(--text-primary)" }}>{title}</td></tr>
                {d.signals.filter(s => s.group === g).map(s => (
                  <React.Fragment key={s.id}>
                    <tr className="oclick" onClick={() => setOpen(open === s.id ? null : s.id)} title="Show what this signal means">
                      <td style={{ ...left, whiteSpace: "normal", minWidth: 220, fontFamily: "var(--font-body)", color: "var(--text-primary)" }}>{s.label}</td>
                      <td style={{ ...left, whiteSpace: "normal", minWidth: 200 }}>{s.reading}{s.asOf && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{day(s.asOf)}</div>}</td>
                      <td style={left}><Chip grade={s.grade} /></td>
                      <td style={left}>{s.series?.filter(p => finite(p[1])).length > 2 ? <Spark values={s.series.map(p => p[1])} width={90} height={22} color={GRADE[s.grade][1]} /> : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td style={{ ...left, whiteSpace: "normal", minWidth: 200, fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--text-secondary)" }}>{s.rule || "—"}</td>
                    </tr>
                    {open === s.id && <tr><td colSpan={5} style={{ ...left, whiteSpace: "normal", padding: "4px 7px 9px 22px", fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{s.detail}{s.home ? <span style={{ color: "var(--text-muted)" }}> Chart: {s.home}.</span> : null}</td></tr>}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}</tbody>
          </table>
        </div>
        <Legend items={[["Shortage", GRADE.shortage[1]], ["Balanced", GRADE.balanced[1]], ["Glut", GRADE.glut[1]]]} />
        <p className="onote" style={{ marginTop: 6 }}>Click a row for what the signal means and where its chart is. {d.note}{d.errors.length ? ` Feeds that failed this build: ${d.errors.join("; ")}.` : ""}</p>
      </VizCard>

      <VizCard eyebrow="Yearly multiples · log scale · not netted" title="The growth race: demand against supply"
        finding="A shortage ends when supply grows faster than demand for long enough. These are the growth rates on file for each side. They are in different units (tokens, dollars of revenue, dollars of capex, hardware sales), and each new chip does more work than the last, so read the columns against each other and do not subtract them."
        style={{ marginBottom: 12 }}>
        <div className="ogrid ogrid-2" style={{ gap: 18 }}>
          <div><div className="ocard-eyebrow" style={{ marginBottom: 6 }}>Demand</div><Multiples rows={d.growth.demand} max={max} color={C[2]} /></div>
          <div><div className="ocard-eyebrow" style={{ marginBottom: 6 }}>Supply</div><Multiples rows={d.growth.supply} max={max} color={C[1]} /></div>
        </div>
        <Legend items={[["Demand", C[2]], ["Demand, under a year of readings scaled up", `color-mix(in srgb, ${C[2]} 45%, transparent)`], ["Supply", C[1]], ["Supply, a forecast", `color-mix(in srgb, ${C[1]} 45%, transparent)`]]} />
      </VizCard>
    </div>
  );
}
