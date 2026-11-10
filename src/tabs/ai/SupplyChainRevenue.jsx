import React, { useEffect, useState } from "react";
import { finite, signed, C, VizCard, Kpi, Seg, Spark } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// SUPPLY-CHAIN REVENUE: the AI hardware chain's monthly sales. Taiwan-listed
// companies publish each month's revenue by the 10th of the next, so the
// foundry, packagers, server builders and the board, cooling and memory makers
// report five to eight weeks before a hyperscaler says what it spent.
//   links      one small chart per link in the chain: revenue against a year
//              earlier, as a three-month sum (default; quarter-end months run
//              hot for server builders) or the single month. Each on its own
//              scale: read the shape and the zero line, not across panels.
//   companies  every company: latest month, change on the month and the year,
//              three-month and year-to-date growth, two years of revenue
// Data: /api/ai-supply-chain (server/taiwanRevenue.js). The company list is
// hand-kept in the Research Database, so this file names no company.
// ============================================================================

const pctS = (v, dp = 0) => (finite(v) ? signed(v * 100, dp, "%") : "—");
const ntd = v => (!finite(v) ? "—" : v >= 1e9 ? `NT$${(v / 1e9).toFixed(2)}T` : v >= 1e6 ? `NT$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}B` : `NT$${(v / 1e3).toFixed(0)}M`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = m => (m ? `${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}` : "—");
const mShort = m => (m ? `${MON[+m.slice(5) - 1]} ’${m.slice(2, 4)}` : "");
const right = { textAlign: "right" }, left = { textAlign: "left" };
const tone = v => (!finite(v) ? "var(--text-muted)" : v >= 0 ? C[1] : C[2]);

// Growth against a year earlier over time: one line, a zero rule, the latest value marked.
function GrowthPanel({ g, idx, control }) {
  const pts = g.series.map(s => [s[0], s[idx]]).filter(p => finite(p[1]));
  const W = 250, H = 86, pad = { l: 4, r: 40, t: 8, b: 16 };
  const v = pts.map(p => p[1]), lo = Math.min(0, ...v), hi = Math.max(0, ...v), span = hi - lo || 1;
  const x = i => pad.l + (pts.length > 1 ? (i / (pts.length - 1)) * (W - pad.l - pad.r) : 0), y = t => pad.t + (1 - (t - lo) / span) * (H - pad.t - pad.b);
  const last = pts.at(-1), color = control ? "var(--text-muted)" : C[1];
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "8px 10px", minWidth: 0 }} title={g.reads || undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ font: "600 12.5px var(--font-body)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</span>
        <span style={{ font: "600 14px var(--font-number)", color: "var(--text-primary)" }}>{last ? pctS(last[1]) : "—"}</span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 2 }}>{g.members} {g.members === 1 ? "company" : "companies"}{last ? ` · to ${mShort(last[0])}` : ""}</div>
      {pts.length < 2 ? <div className="onote" style={{ height: H }}>Not enough months yet.</div> : (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${g.label}: revenue against a year earlier, latest ${last ? pctS(last[1]) : "n/a"}`} style={{ display: "block" }}>
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--text-muted)" strokeWidth="1" opacity="0.6" />
          <polyline points={pts.map((p, i) => `${x(i)},${y(p[1])}`).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {pts.map((p, i) => <circle key={p[0]} cx={x(i)} cy={y(p[1])} r={i === pts.length - 1 ? 4 : 6} fill={i === pts.length - 1 ? color : "transparent"} stroke={i === pts.length - 1 ? "var(--card-bg)" : "none"} strokeWidth="2"><title>{`${mLabel(p[0])}: ${pctS(p[1], 1)} on a year earlier`}</title></circle>)}
          <text x={W - pad.r + 5} y={y(hi) + 4} style={{ fontSize: 9.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{pctS(hi)}</text>
          {lo < 0 && <text x={W - pad.r + 5} y={y(lo) + 3} style={{ fontSize: 9.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{pctS(lo)}</text>}
          <text x={pad.l} y={H - 3} style={{ fontSize: 9.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{mShort(pts[0][0])}</text>
          <text x={W - pad.r} y={H - 3} textAnchor="end" style={{ fontSize: 9.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{mShort(last[0])}</text>
        </svg>
      )}
    </div>
  );
}

export default function SupplyChainRevenue() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [measure, setMeasure] = useState("yoy3"), [group, setGroup] = useState("");
  useEffect(() => {
    let alive = true, timer = null;
    const load = () => fetch("/api/ai-supply-chain").then(r => r.json()).then(j => {
      if (!alive) return;
      if (j.error && !j.available) setErr(j.error); else { setD(j); if (j.building) timer = setTimeout(load, 12000); }
    }).catch(e => alive && setErr(e.message));
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  if (err) return <div className="options-research"><p className="onote">Supply-chain revenue could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Loading supply-chain revenue…</p></div>;
  if (!d.available) return <div className="options-research"><section className="ocard" style={{ marginBottom: 12 }}><h3 className="ocard-title">Supply-chain monthly revenue</h3><p className="ocard-finding">{d.reason} The company list is hand-kept in the Research Database (data/curated/ai-supply-chain.json).</p></section></div>;

  const idx = measure === "yoy3" ? 3 : 2;
  const gById = Object.fromEntries(d.groups.map(g => [g.id, g]));
  const lead = d.groups.filter(g => g.id !== "control" && g.latest).slice(0, 4), control = gById.control;
  const rows = d.companies.filter(c => !group || c.group === group);
  const building = d.building ? `Building the history: ${d.building.done} of ${d.building.total} months read (the exchange serves these pages slowly; this happens once).` : null;
  const foundry = gById.foundry?.latest;

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <p className="ohead-line">
        Monthly revenue of {d.companies.length} Taiwan-listed companies along the AI hardware chain, to {mLabel(d.asOf)}. They must report by the 10th of the following month,
        so this is the fastest hard number on what was built and shipped: five to eight weeks ahead of any hyperscaler's capex.
        {d.pending.length > 0 && ` Not yet reported for ${mLabel(d.asOf)}: ${d.pending.join(", ")}.`}
      </p>
      {building && <p className="onote" style={{ marginBottom: 8 }}>{building}</p>}
      <div className="okpis">
        {foundry && <Kpi label={`Foundry, ${mShort(foundry.m)}`} value={ntd(foundry.rev)} sub={`${pctS(foundry.yoy)} on a year earlier, ${pctS(foundry.mom)} on the month`} tone={tone(foundry.yoy)} />}
        {lead.filter(g => g.id !== "foundry").slice(0, 3).map(g => <Kpi key={g.id} label={g.label} value={pctS(g.latest.yoy3)} sub={`three months to ${mShort(g.latest.m)} against a year earlier`} tone={tone(g.latest.yoy3)} />)}
        {control?.latest && <Kpi label="Controls (little AI)" value={pctS(control.latest.yoy3)} sub="the same measure without the build-out" />}
      </div>

      <VizCard eyebrow={`By link in the chain · ${measure === "yoy3" ? "three-month sum" : "single month"} against a year earlier`} title="Where the build-out shows up, and how fast"
        finding="One panel per link, each on its own scale: read the direction and the zero line, and compare the latest figures in the corner. A link's total leaves out companies whose revenue is mostly something else, and a month counts only once every company in the link has reported it."
        right={<Seg label="Measure" value={measure} onChange={setMeasure} options={[["yoy3", "Three-month"], ["yoy", "Single month"]]} />}
        table={<table className="otable"><thead><tr><th style={left}>Link</th>{d.months.slice(-12).map(m => <th key={m} style={right}>{mShort(m)}</th>)}</tr></thead><tbody>{d.groups.map(g => <tr key={g.id}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{g.label}</td>{g.series.slice(-12).map(s => <td key={s[0]} style={right}>{pctS(s[idx])}</td>)}</tr>)}</tbody></table>}
        style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
          {d.groups.map(g => <GrowthPanel key={g.id} g={g} idx={idx} control={g.id === "control"} />)}
        </div>
      </VizCard>

      <VizCard eyebrow={`${rows.length} companies · NT$, unaudited, as reported`} title="Company by company"
        right={<Seg label="Link" value={group} onChange={setGroup} options={[["", "All"], ...d.groups.map(g => [g.id, g.label])]} />}
        finding={group ? gById[group]?.reads : "Latest reported month for each company. Three-month and year-to-date growth smooth the quarter-end swings; the line is two years of monthly revenue."}
        style={{ marginBottom: 12 }}>
        <div className="otable-wrap" style={{ maxHeight: 620, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Company</th><th style={left}>Link</th><th style={left}>Month</th><th style={right}>Revenue</th><th style={right}>On the month</th><th style={right}>On the year</th><th style={right}>Three months</th><th style={right}>Year to date</th><th style={left}>Two years</th></tr></thead>
            <tbody>{rows.map(c => (
              <tr key={c.code} style={{ opacity: c.reported ? 1 : 0.65 }}>
                <td style={{ ...left, whiteSpace: "normal", minWidth: 170 }} title={c.note || undefined}>
                  <span style={{ font: "600 12.5px var(--font-body)", color: "var(--text-primary)" }}>{c.name}</span> <span style={{ color: "var(--text-muted)" }}>{c.code}</span>
                  {c.mixed && <span className="otag" style={{ marginLeft: 5 }} title="Mostly other business: charted, but left out of its link's total">mixed</span>}
                  {c.note && <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>{c.note}</div>}
                </td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{gById[c.group]?.label || c.group}</td>
                <td style={left}>{mShort(c.latest?.m)}{!c.reported && c.latest ? <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{mShort(d.asOf)} not in yet</div> : null}</td>
                <td style={right}>{ntd(c.latest?.rev)}</td>
                <td style={{ ...right, color: tone(c.latest?.mom) }}>{pctS(c.latest?.mom)}</td>
                <td style={{ ...right, color: tone(c.latest?.yoy) }}>{pctS(c.latest?.yoy)}</td>
                <td style={{ ...right, color: tone(c.latest?.yoy3) }}>{pctS(c.latest?.yoy3)}</td>
                <td style={{ ...right, color: tone(c.ytdYoy) }}>{pctS(c.ytdYoy)}</td>
                <td style={left}><Spark values={c.series.map(s => s[1])} width={110} height={22} color={c.group === "control" ? "var(--text-muted)" : C[1]} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </VizCard>
      <p className="onote">Source: {d.source}. Company list hand-kept in the Research Database (reviewed {d.reviewed || "—"}).{d.error ? ` Last fetch problem: ${d.error}.` : ""}</p>
    </div>
  );
}
