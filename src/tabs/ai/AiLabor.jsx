import React, { useEffect, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { finite, C, VizCard, Kpi, Legend, axisTick, gridProps, tipStyle, tipLabel } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// AI LABOR — AI Economy → Dark Output: are payrolls paying for AI?
// (server/aiLabor.js). Job cuts employers themselves tie to AI, in place of
// anecdote, and what they could fund.
//   announced   monthly cuts attributed to AI (Challenger), and their share of
//               all announced cuts
//   filed       8-K Item 2.05 restructuring filings by quarter, and those that
//               mention artificial intelligence
//   payroll     12 months of AI-attributed cuts at an assumed cost per job,
//               against the rise in the AI labs' revenue run-rate
//   years       the annual totals since Challenger began tracking the reason
// One measure, one colour: AI-attributed is orange (--oc-2) throughout, totals
// are grey, the labs' revenue is blue.
// ============================================================================

const int = v => (finite(v) ? Math.round(v).toLocaleString("en-US") : "—");
const pct = (v, dp = 0) => (finite(v) ? `${(v * 100).toFixed(dp)}%` : "—");
const bn = v => (finite(v) ? `$${v >= 100 ? Math.round(v) : v.toFixed(1)}B` : "—");
const mon = m => (m ? new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : "");
const monLong = m => (m ? new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—");
const left = { textAlign: "left" }, right = { textAlign: "right" };

export default function AiLabor() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; fetch("/api/ai-labor").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The AI labor read could not be built: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading job-cut reports and restructuring filings…</p></div>;

  const y = d.ytd, p = d.payroll, months = d.months.map(m => ({ ...m, sharePct: finite(m.share) ? Math.round(m.share * 1000) / 10 : null }));
  const peak = [...d.months].filter(m => finite(m.ai)).sort((a, b) => b.ai - a.ai)[0];
  const fil = d.filings.map(f => ({ ...f, other: f.all - f.ai })), done = d.filings.filter(f => !f.partial), last4 = done.slice(-4), prev4 = done.slice(-8, -4), sum = (xs, k) => xs.reduce((s, x) => s + (x[k] || 0), 0);
  const x = finite(y?.aiPrior) && y.aiPrior > 0 ? y.ai / y.aiPrior : null;
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Job cuts employers tie to AI · announced, not measured · through ${monLong(d.latest?.month)}`} title="Are payrolls paying for AI?"
        finding={`U.S. employers attributed ${int(y?.ai)} announced job cuts to AI in the first ${y?.months} months of ${y?.through.slice(0, 4)}${finite(x) ? `, ${x.toFixed(1)}× the same months a year earlier` : ""}, ${pct(y?.total ? y.ai / y.total : null)} of all announced cuts.${peak ? ` The peak was ${monLong(peak.month)} (${int(peak.ai)}); the latest month, ${monLong(d.latest?.month)}, had ${int(d.latest?.ai)}.` : ""}${p ? ` At an assumed ${`$${Math.round(p.cost / 1000)}k`} a job, the past 12 months of cuts free about ${bn(p.usdBn)} a year of payroll${p.labs ? `, against ${bn(p.labs.addedPerYear)} a year of new revenue at the AI labs: payroll could account for about ${pct(p.shareOfNewRevenue)} of it at most` : ""}.` : ""}${d.jolts ? ` They are ${pct(d.jolts.aiShare, 1)} of all layoffs in the economy.` : ""}${last4.length === 4 ? ` Public companies' restructuring filings show no wave: ${sum(last4, "all")} in the past four quarters against ${sum(prev4, "all")} the four before, ${sum(last4, "ai")} of them mentioning AI.` : ""}`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label={`AI-attributed cuts, ${y?.through.slice(0, 4)} to date`} value={int(y?.ai)} sub={`${finite(y?.aiPrior) ? `${int(y.aiPrior)} in the same months of ${+y.through.slice(0, 4) - 1}` : "no comparison a year earlier"}`} tone={C[2]} />
          <Kpi label="Share of announced cuts" value={pct(y?.total ? y.ai / y.total : null)} sub={`of ${int(y?.total)} announced for any reason; ${pct(d.latest?.share)} in ${mon(d.latest?.month)}`} />
          {p && <Kpi label="Payroll freed, a year" value={bn(p.usdBn)} sub={`${int(p.jobs)} cuts in 12 months at $${Math.round(p.cost / 1000)}k; ${bn(p.lowBn)} to ${bn(p.highBn)} at $${Math.round(p.low / 1000)}k to $${Math.round(p.high / 1000)}k`} tone={C[2]} />}
          {p?.labs && <Kpi label="Of the labs' new revenue" value={pct(p.shareOfNewRevenue)} sub={`${bn(p.labs.addedPerYear)} a year added to run-rate (${p.labs.rows.map(r => r.co).join(", ")}); an upper bound`} tone={C[1]} />}
          {d.jolts && <Kpi label="Of all layoffs" value={pct(d.jolts.aiShare, 1)} sub={`the economy lays off and discharges about ${(d.jolts.monthlyAvg / 1e6).toFixed(1)}M a month (JOLTS, ${d.jolts.asOf})`} />}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 14 }}>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Announced cuts attributed to AI · monthly</div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months} margin={{ top: 6, right: 12, bottom: 0, left: -6 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" tick={axisTick} tickFormatter={mon} minTickGap={28} />
                  <YAxis tick={axisTick} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                  <Tooltip cursor={{ fill: "var(--bg-subtle)" }} contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={monLong} formatter={(v, k, e) => [`${int(v)} of ${int(e.payload.total)} announced (${pct(e.payload.share)})`, "Attributed to AI"]} />
                  <Bar dataKey="ai" fill={C[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>AI's share of all announced cuts · monthly</div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={months} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" tick={axisTick} tickFormatter={mon} minTickGap={28} />
                  <YAxis tick={axisTick} tickFormatter={v => `${v}%`} domain={[0, "auto"]} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={monLong} formatter={v => [`${v}%`, "Share attributed to AI"]} />
                  <Line dataKey="sharePct" stroke={C[2]} strokeWidth={2} dot={{ r: 2.5, fill: C[2], strokeWidth: 0 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Restructuring filings (8-K Item 2.05) · quarterly</div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fil} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="q" tick={axisTick} tickFormatter={q => q.replace("-", " ").slice(2)} minTickGap={24} />
                  <YAxis tick={axisTick} />
                  <Tooltip cursor={{ fill: "var(--bg-subtle)" }} contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={(q, e) => `${q.replace("-", " ")}${e?.[0]?.payload?.partial ? " (quarter in progress)" : ""}`} formatter={(v, k) => [v, k]} />
                  <Bar name="Mention artificial intelligence" dataKey="ai" stackId="a" fill={C[2]} stroke="var(--card-bg)" strokeWidth={1} isAnimationActive={false} />
                  <Bar name="Other restructuring filings" dataKey="other" stackId="a" fill="var(--text-muted)" opacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["Mention artificial intelligence", C[2]], ["Other restructuring filings", "var(--text-muted)"]]} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 12 }}>
          {p?.labs && <div style={{ flex: "1.3 1 380px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 6 }}>Payroll freed against new AI revenue · dollars a year</div>
            {(() => { const max = Math.max(p.highBn, p.labs.addedPerYear) * 1.05, w = v => `${(v / max) * 100}%`; return (
              <div style={{ display: "grid", gap: 8 }}>
                <div title={p.why}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "var(--font-body)", color: "var(--text-primary)" }}><span>Payroll freed by AI-attributed cuts, past 12 months</span><strong style={{ fontFamily: "var(--font-number)" }}>{bn(p.usdBn)}</strong></div>
                  <div style={{ position: "relative", height: 12, background: "var(--bg-subtle)", borderRadius: 4 }}>
                    <span style={{ position: "absolute", left: 0, top: 0, height: 12, width: w(p.usdBn), background: C[2], borderRadius: 4 }} />
                    <span title={`${bn(p.lowBn)} to ${bn(p.highBn)}`} style={{ position: "absolute", left: w(p.lowBn), width: `calc(${w(p.highBn)} - ${w(p.lowBn)})`, top: 5, height: 2, background: "var(--text-primary)" }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{int(p.jobs)} announced cuts × ${Math.round(p.cost / 1000)}k a job; the line is ${Math.round(p.low / 1000)}k to ${Math.round(p.high / 1000)}k</div>
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "var(--font-body)", color: "var(--text-primary)" }}><span>New revenue run-rate at the AI labs, a year</span><strong style={{ fontFamily: "var(--font-number)" }}>{bn(p.labs.addedPerYear)}</strong></div>
                  <div style={{ height: 12, background: "var(--bg-subtle)", borderRadius: 4 }}><span style={{ display: "block", height: 12, width: w(p.labs.addedPerYear), background: C[1], borderRadius: 4 }} /></div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{p.labs.rows.map(r => `${r.co} ${bn(r.then)} (${mon(r.thenAt)}) to ${bn(r.now)} (${mon(r.nowAt)})`).join("; ")}</div>
                </div>
              </div>); })()}
            <p className="onote" style={{ marginTop: 6 }}>If every announced cut happened and every dollar saved went to AI, payroll would cover about {pct(p.shareOfNewRevenue)} of the labs' new revenue. The rest has to come from somewhere else: new budgets, other vendors' revenue, or investors' capital.</p>
          </div>}
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>By year · announced cuts</div>
            <div className="otable-wrap">
              <table className="otable">
                <thead><tr><th style={left}>Year</th><th style={right}>All reasons</th><th style={right}>Attributed to AI</th><th style={right}>Share</th></tr></thead>
                <tbody>{d.years.map(r => (
                  <tr key={r.year} title={r.note || undefined}>
                    <td style={left}>{r.year}{/partial/i.test(r.note || "") ? <span style={{ color: "var(--text-muted)" }}> to date</span> : null}</td>
                    <td style={right}>{int(r.totalCuts)}</td><td style={{ ...right, fontWeight: 600 }}>{int(r.aiCuts)}</td><td style={right}>{pct(r.totalCuts ? r.aiCuts / r.totalCuts : null, 1)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <p className="onote" style={{ marginTop: 4 }}>Challenger has tracked AI as a stated reason since May 2023.</p>
          </div>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: {d.source}. Reports reviewed {d.reviewed}.{d.errors?.length ? ` Filing counts that failed this build: ${d.errors.join("; ")}.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}
