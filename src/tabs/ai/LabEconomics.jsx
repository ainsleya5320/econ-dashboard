import React, { useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, Kpi, Seg, Legend } from "../options/ui.jsx";
import LABS from "../../data/labFinancials.json";
import "../options/OptionsResearch.css";

// ============================================================================
// LAB ECONOMICS: a frontier lab's filed income statement, read for the question
// the rest of the chain depends on: does selling tokens cover the compute?
//   quarters  revenue against costs by what was bought (compute, people, sales,
//             other), and two margins: revenue after ALL compute (serving and
//             research together) and the operating margin
//   periods   the filing's by-function view, years and half-years: cost of
//             revenue (compute that serves customers) against research and
//             development, so compute splits into serving and research
// Every figure is as filed (src/data/labFinancials.json); the margins and the
// serving/research split are computed here from two filed figures and say so.
// No estimates. Add a lab to the file when it files.
// ============================================================================

// filed in $ millions: under a billion stays in millions
const usdB = v => (!finite(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v) < 1000 ? `${Math.abs(v).toLocaleString("en-US")}M` : `${(Math.abs(v) / 1000).toFixed(Math.abs(v) >= 9950 ? 1 : 2)}B`}`);
const pct = (v, dp = 0) => (finite(v) ? `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const right = { textAlign: "right" }, left = { textAlign: "left" };
const COST = [["compute", "Compute & infrastructure", C[1]], ["personnel", "People", C[2]], ["salesMarketing", "Sales, marketing & partnerships", C[3]], ["otherAll", "Other, incl. one-offs", C[4]]];

export default function LabEconomics() {
  const [id, setId] = useState(LABS.labs[0]?.id);
  const lab = LABS.labs.find(l => l.id === id) || LABS.labs[0];
  if (!lab) return null;
  const q = lab.quarters.map(r => ({ ...r, otherAll: r.other + (r.oneOff || 0), afterCompute: (r.revenue - r.compute) / r.revenue, opMargin: r.operatingIncome / r.revenue, costs: r.compute + r.personnel + r.salesMarketing + r.other + (r.oneOff || 0) }));
  const last = q.at(-1), prev = q.at(-2), yearAgo = q.at(-5);
  const half = lab.periods.at(-1), b = lab.balance;
  const firstProfit = q.find(r => r.operatingIncome > 0);
  const periods = lab.periods.map(p => ({ ...p, gross: (p.revenue - p.costOfRevenue) / p.revenue, research: p.compute - p.costOfRevenue, servingShare: p.costOfRevenue / p.compute, afterCompute: (p.revenue - p.compute) / p.revenue }));
  const oneOff = q.find(r => r.oneOff);

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`${lab.name} · ${lab.source.title}`} title="Does selling tokens cover the compute?"
        finding={`In ${last.label} ${lab.name} kept ${pct(last.afterCompute)} of each revenue dollar after paying for all of its compute, research and serving together, against ${pct(prev.afterCompute)} a quarter earlier${yearAgo ? ` and ${pct(yearAgo.afterCompute)} a year earlier` : ""}. Compute is bought 12 to 18 months ahead, so the bill did not flex: revenue outgrew it.${firstProfit ? ` ${firstProfit.label} was the first quarter with an operating profit (${usdB(firstProfit.operatingIncome)}).` : ""}`}
        right={LABS.labs.length > 1 ? <Seg label="Lab" value={id} onChange={setId} options={LABS.labs.map(l => [l.id, l.name])} /> : null}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label={`Revenue, ${last.label}`} value={usdB(last.revenue)} sub={`${usdB(last.revenue * 4)} annualized; ${(last.revenue / prev.revenue).toFixed(1)}× the prior quarter`} />
          <Kpi label="Kept after all compute" value={pct(last.afterCompute)} sub={`compute was ${pct(last.compute / last.revenue)} of revenue`} tone={last.afterCompute >= 0 ? C[1] : C[2]} />
          <Kpi label="Operating income" value={usdB(last.operatingIncome)} sub={`${pct(last.opMargin)} of revenue`} tone={last.operatingIncome >= 0 ? C[1] : C[2]} />
          <Kpi label={`Cash from operations, ${half.label}`} value={usdB(half.cashOps)} sub={`investing ${usdB(half.cashInvesting)}; raised ${usdB(half.cashFinancing)}`} />
          {b && <Kpi label="Cash & short-term investments" value={usdB(b.cash + b.shortTermInvestments)} sub={`at ${b.asOf}`} />}
        </div>
        <Legend items={[...COST.map(([, label, color]) => [label, color]), ["Revenue", "var(--text-primary)"]]} />
        <div className="ochart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={q} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={v => `$${(v / 1000).toFixed(0)}B`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, name) => [usdB(v), name]} />
              {COST.map(([key, label, color], i) => <Bar key={key} dataKey={key} name={label} stackId="cost" fill={color} stroke="var(--card-bg)" strokeWidth={1} radius={i === COST.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />)}
              <Line dataKey="revenue" name="Revenue" stroke="var(--text-primary)" strokeWidth={2} dot={{ r: 4, fill: "var(--text-primary)", stroke: "var(--card-bg)", strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="onote" style={{ marginTop: 6 }}>
          Bars are operating costs by what was bought; the line is revenue, on the same dollar axis: where the line clears the bar the quarter made an operating profit.
          {oneOff ? ` ${oneOff.label}'s "other" includes a one-off $${(oneOff.oneOff / 1000).toFixed(1)}B (${oneOff.oneOffNote}).` : ""} {lab.netLossNote}
        </p>
      </VizCard>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow="Per dollar of revenue · computed from two filed figures" title="Margins by quarter"
          finding="After all compute: revenue less every dollar of compute and infrastructure, including the compute spent training models. Operating margin takes off people, selling and everything else as well."
          table={<table className="otable"><thead><tr><th style={left}>Quarter</th><th style={right}>Revenue</th><th style={right}>Compute</th><th style={right}>After all compute</th><th style={right}>Operating income</th><th style={right}>Operating margin</th></tr></thead><tbody>{q.map(r => <tr key={r.end}><td style={left}>{r.label}</td><td style={right}>{usdB(r.revenue)}</td><td style={right}>{usdB(r.compute)}</td><td style={right}>{pct(r.afterCompute)}</td><td style={right}>{usdB(r.operatingIncome)}</td><td style={right}>{pct(r.opMargin)}</td></tr>)}</tbody></table>}>
          <Legend items={[["After all compute", C[1]], ["Operating margin", C[2]]]} />
          <div className="ochart ochart-sm">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={q} margin={{ top: 8, right: 44, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={v => `${Math.round(v * 100)}%`} />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, name) => [pct(v), name]} />
                <Line dataKey="afterCompute" name="After all compute" stroke={C[1]} strokeWidth={2} dot={{ r: 4, stroke: "var(--card-bg)", strokeWidth: 2, fill: C[1] }} isAnimationActive={false} />
                <Line dataKey="opMargin" name="Operating margin" stroke={C[2]} strokeWidth={2} dot={{ r: 4, stroke: "var(--card-bg)", strokeWidth: 2, fill: C[2] }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="onote" style={{ marginTop: 6 }}>Latest: {pct(last.afterCompute)} after all compute, {pct(last.opMargin)} operating margin.</p>
        </VizCard>

        <VizCard eyebrow="Years and half-years · the filing's by-function view" title="Serving customers against research"
          finding={`Cost of revenue is the compute that serves customers; the rest of the compute bill is research and training. In ${half.label} serving was ${pct(periods.at(-1).servingShare)} of compute and the gross margin on it ${pct(periods.at(-1).gross)}: the product is profitable to serve, and the money goes into the next model.`}>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Period</th><th style={right}>Revenue</th><th style={right}>Cost of revenue</th><th style={right}>Gross margin</th><th style={right}>Total compute</th><th style={left}>Serving · research</th><th style={right}>R&amp;D</th><th style={right}>Operating income</th><th style={right}>Cash from ops</th></tr></thead>
              <tbody>{periods.map(p => (
                <tr key={p.label}>
                  <td style={left}>{p.label}</td>
                  <td style={right}>{usdB(p.revenue)}</td>
                  <td style={right}>{usdB(p.costOfRevenue)}</td>
                  <td style={{ ...right, color: p.gross >= 0 ? undefined : C[2] }}>{pct(p.gross)}</td>
                  <td style={right} title={p.computeNote}>{usdB(p.compute)}</td>
                  <td style={left} title={`About ${usdB(p.costOfRevenue)} serving customers and ${usdB(p.research)} research and training`}>
                    <span style={{ display: "inline-flex", width: 110, height: 9, borderRadius: 2, overflow: "hidden", verticalAlign: "middle", gap: 2 }} role="img" aria-label={`${pct(p.servingShare)} of compute served customers`}>
                      <i style={{ width: `${Math.max(1, p.servingShare * 100)}%`, background: C[1] }} /><i style={{ flex: 1, background: C[3] }} />
                    </span>
                    <span style={{ marginLeft: 6, color: "var(--text-secondary)" }}>{pct(p.servingShare)}</span>
                  </td>
                  <td style={right}>{usdB(p.rnd)}</td>
                  <td style={{ ...right, color: p.operatingIncome >= 0 ? undefined : C[2] }}>{usdB(p.operatingIncome)}</td>
                  <td style={{ ...right, color: p.cashOps >= 0 ? undefined : C[2] }}>{usdB(p.cashOps)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Legend items={[["Compute serving customers (cost of revenue)", C[1]], ["Research and training (the remainder)", C[3]]]} />
          <p className="onote" style={{ marginTop: 6 }}>{lab.costOfRevenueNote}</p>
        </VizCard>
      </div>

      <p className="onote">
        Source: <a href={lab.source.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)" }}>{lab.name} {lab.source.title}</a> ({lab.source.locator}). {(lab.facts || []).join(" ")}
        {lab.pending ? <> <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>Not yet read in:</strong> {lab.pending}</> : null}
      </p>
    </div>
  );
}
