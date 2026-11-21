import React, { useEffect, useMemo, useState } from "react";
import { finite, C, VizCard, Kpi, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// TOKEN LEDGER — AI Economy → Tokens: every token volume a company has put on
// the record, in tokens per day on one log scale (server/tokenLedger.js; the
// figures are hand-kept in data/ai/token-volumes.json, each with its link).
//   chart      one line per company and scope, a dot per disclosure; the five
//              largest take the colour slots, the rest are grey and labelled
//   table      what each counts, the latest figure, the yearly multiple, who
//              said it and where
//   platforms  what the inference platforms have said about their own scale
// The rows are not comparable and are never summed: the table's "what it
// counts" column is the point.
// ============================================================================

const SLOT = [C[1], C[2], C[3], C[4], C[5]];
const big = v => { if (!finite(v)) return "—"; const u = [[1e18, "quintillion"], [1e15, "quadrillion"], [1e12, "trillion"], [1e9, "billion"], [1e6, "million"]].find(([n]) => v >= n); if (!u) return Math.round(v).toLocaleString("en-US"); const x = v / u[0]; return `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1) : x.toFixed(2)} ${u[1]}`; };
const money = v => (!finite(v) ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const when = d => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return new Date(Date.UTC(+y, +m - 1, +(dd || 15), 12)).toLocaleDateString("en-US", dd ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", year: "numeric" }); };
const left = { textAlign: "left" }, right = { textAlign: "right" };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };

function LedgerChart({ series, colorOf }) {
  const [hover, setHover] = useState(null);
  const W = 1100, H = 430, m = { l: 96, r: 236, t: 10, b: 24 };
  const pts = series.flatMap(s => s.points), t0 = Math.floor(Math.min(...pts.map(p => p.t)) * 2) / 2, t1 = Math.ceil(Math.max(...pts.map(p => p.t)) * 4) / 4 + 0.05;
  const lo = Math.floor(Math.log10(Math.min(...pts.map(p => p.perDay)))), hi = Math.ceil(Math.log10(Math.max(...pts.map(p => p.perDay))));
  const x = t => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r), y = v => m.t + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - m.t - m.b);
  const years = []; for (let yy = Math.ceil(t0); yy <= t1; yy++) years.push(yy);
  const decades = []; for (let e = lo; e <= hi; e++) decades.push(e);
  // direct labels at each line's last point, nudged apart
  const ends = series.map(s => ({ s, py: y(s.latest.perDay) })).sort((a, b) => a.py - b.py);
  for (let k = 1; k < ends.length; k++) if (ends[k].py - ends[k - 1].py < 13) ends[k].py = ends[k - 1].py + 13;
  const move = e => {
    const b = e.currentTarget.getBoundingClientRect(), mx = ((e.clientX - b.left) / b.width) * W, my = ((e.clientY - b.top) / b.height) * H;
    let best = null, bd = 18 ** 2;
    series.forEach(s => s.points.forEach(p => { const q = (x(p.t) - mx) ** 2 + (y(p.perDay) - my) ** 2; if (q < bd) { bd = q; best = { s, p }; } }));
    setHover(best);
  };
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${Math.max(H, ends.at(-1).py + 14)}`} role="img" aria-label="Disclosed token volumes per day by company over time, log scale" style={{ display: "block" }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {decades.map(e => <g key={e}><line x1={m.l} x2={W - m.r} y1={y(10 ** e)} y2={y(10 ** e)} stroke="var(--border-subtle)" opacity={e % 3 === 0 ? 1 : 0.45} /><text x={m.l - 8} y={y(10 ** e) + 3.5} textAnchor="end" style={{ fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{big(10 ** e).replace(/[.]0+ /, " ")}</text></g>)}
        {years.map(yy => <g key={yy}><line x1={x(yy)} x2={x(yy)} y1={m.t} y2={H - m.b} stroke="var(--border-subtle)" strokeDasharray="2 3" /><text x={x(yy)} y={H - 8} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{yy}</text></g>)}
        {series.map(s => { const c = colorOf(s), grey = c === "var(--text-muted)"; return (
          <g key={s.key} opacity={hover && hover.s !== s ? 0.35 : 1}>
            {s.points.length > 1 && <polyline points={s.points.map(p => `${x(p.t)},${y(p.perDay)}`).join(" ")} fill="none" stroke={c} strokeWidth={grey ? 1.3 : 2} strokeDasharray={s.kind === "measured" ? "5 3" : undefined} strokeLinejoin="round" />}
            {s.points.map(p => <circle key={p.asOf + p.value} cx={x(p.t)} cy={y(p.perDay)} r={grey ? 3 : 4} fill={c} stroke="var(--card-bg)" strokeWidth="1.5" />)}
          </g>); })}
        {ends.map(({ s, py }) => <line key={`l${s.key}`} x1={x(s.points.at(-1).t) + 6} y1={y(s.latest.perDay)} x2={W - m.r + 4} y2={py} stroke={colorOf(s)} strokeWidth="0.8" opacity={hover && hover.s !== s ? 0.15 : 0.45} />)}
        {ends.map(({ s, py }) => <text key={s.key} x={W - m.r + 8} y={py + 3.5} style={{ fontSize: 10.5, fontWeight: colorOf(s) === "var(--text-muted)" ? 400 : 600, fill: colorOf(s) === "var(--text-muted)" ? "var(--text-secondary)" : "var(--text-primary)", fontFamily: "var(--font-number)" }}>{s.label.length > 36 ? `${s.label.slice(0, 35)}…` : s.label}</text>)}
        {hover && <circle cx={x(hover.p.t)} cy={y(hover.p.perDay)} r={7} fill="none" stroke="var(--text-primary)" strokeWidth="1.4" />}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {hover ? <><b style={{ color: "var(--text-primary)" }}>{hover.s.label}, {when(hover.p.asOf)}</b> · {big(hover.p.perDay)} tokens a day (stated as {big(hover.p.value)} {hover.p.metric.replace(/^tokens? /, "")}) · {hover.p.statedBy || "—"} · confidence {hover.p.confidence || "—"}</> : <>Hover a dot for the figure as stated and who said it. Tokens per day, log scale: each gridline is ten times the one below.</>}
      </div>
    </div>
  );
}

export default function TokenLedger() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; fetch("/api/token-ledger").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  // the five largest series take the colour slots, by size at first load; the rest are grey
  const slots = useMemo(() => (d ? Object.fromEntries(d.series.slice(0, 5).map((s, i) => [s.key, SLOT[i]])) : {}), [d]);
  if (err) return <div className="options-research"><p className="onote">The token ledger could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading the disclosures…</p></div>;
  if (!d.available) return <div className="options-research"><section className="ocard" style={{ marginBottom: 12 }}><h3 className="ocard-title">The token ledger</h3><p className="ocard-finding">{d.reason} The disclosures are hand-kept in the Research Database (data/curated/ai-token-volumes.json).</p></section></div>;
  if (!d.series.length) return <div className="options-research"><p className="onote">No disclosures on file yet.</p></div>;

  const colorOf = s => slots[s.key] || "var(--text-muted)", top = d.series[0], grown = d.series.filter(s => s.growth && s.kind === "disclosed").sort((a, b) => b.growth.multiple - a.growth.multiple), fast = grown[0];
  const or = d.series.find(s => s.kind === "measured"), median = grown.length ? [...grown].sort((a, b) => a.growth.multiple - b.growth.multiple)[Math.floor((grown.length - 1) / 2)].growth.multiple : null;
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Disclosed token volumes · tokens per day · ${d.counts.points} figures from ${d.counts.entities} companies${d.reviewed ? ` · reviewed ${when(d.reviewed)}` : ""}`} title="The token ledger: what each company says it processes"
        finding={`The largest figure on record is ${top.label}: ${big(top.latest.perDay)} tokens a day as of ${when(top.latest.asOf)}${top.growth ? `, ${top.growth.multiple}× a year since ${when(top.growth.from)}` : ""}.${fast && fast !== top ? ` The fastest grower with two or more disclosures is ${fast.label} at ${fast.growth.multiple}× a year.` : ""}${finite(median) ? ` Across the ${grown.length} companies with a history, the median is ${median}× a year.` : ""}${or ? ` For scale, OpenRouter, the one series measured here, routes ${big(or.latest.perDay)} a day.` : ""} These count different things and are not to be added up.`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Largest on record" value={`${big(top.latest.perDay)}/day`} sub={`${top.label}, ${when(top.latest.asOf)}`} tone={colorOf(top)} />
          {fast && <Kpi label="Fastest disclosed growth" value={`${fast.growth.multiple}× a year`} sub={`${fast.label}, ${when(fast.growth.from)} to ${when(fast.growth.to)}`} />}
          {finite(median) && <Kpi label="Median growth" value={`${median}× a year`} sub={`${grown.length} companies with two or more disclosures at least six months apart`} />}
          {or && <Kpi label="OpenRouter, measured" value={`${big(or.latest.perDay)}/day`} sub={`${or.growth ? `${or.growth.multiple}× a year; ` : ""}week of ${when(or.latest.asOf)}`} />}
        </div>
        <LedgerChart series={d.series} colorOf={colorOf} />
        <Legend items={[...d.series.slice(0, 5).map(s => [s.label, colorOf(s)]), ["Other companies (labelled at the line)", "var(--text-muted)"], ["Measured, not stated", "var(--text-muted)", true]]} />

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>What each figure counts · latest on record</div>
        <div className="otable-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Company</th><th style={left}>What it counts</th><th style={right}>Tokens a day</th><th style={right}>As of</th><th style={right} title="The yearly multiple between the latest figure and the one nearest a year earlier">Per year</th><th style={right}>Figures</th><th style={left}>Said by</th><th style={left}>Conf.</th></tr></thead>
            <tbody>{d.series.map(s => (
              <tr key={s.key}>
                <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 130 }}><i aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colorOf(s), marginRight: 6 }} />{s.label}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 220 }}>{s.scope || "—"}</td>
                <td style={{ ...right, fontWeight: 600 }}>{big(s.latest.perDay)}</td>
                <td style={right}>{when(s.latest.asOf)}</td>
                <td style={right} title={s.growth ? `${when(s.growth.from)} to ${when(s.growth.to)}` : "one disclosure, or less than six months apart"}>{s.growth ? `${s.growth.multiple}×` : "—"}</td>
                <td style={right}>{s.points.length}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 150 }}>{s.latest.statedBy || "—"}{s.latest.url ? <> · <a href={s.latest.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(s.latest.url)}</a></> : null}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.latest.confidence || "—"}</td>
              </tr>))}</tbody>
          </table>
        </div>

        {d.customers?.length > 0 && <>
          <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Customers past a trillion tokens a year · as each cloud counts them</div>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Cloud</th><th style={left}>Measure</th><th style={right}>Customers</th><th style={right}>As of</th><th style={left}>Said by</th></tr></thead>
              <tbody>{d.customers.map((c, i) => (
                <tr key={i}>
                  <td style={{ ...left, fontFamily: "var(--font-body)" }}>{c.entity}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 220 }}>{c.metric}</td>
                  <td style={{ ...right, fontWeight: 600 }}>{c.value}</td><td style={right}>{when(c.asOf)}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 150 }}>{c.statedBy || "—"}{c.url ? <> · <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(c.url)}</a></> : null}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>}

        {d.platforms.length > 0 && <>
          <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Inference platforms · what they have said about their own scale</div>
          <div className="otable-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className="otable">
              <thead><tr><th style={left}>Platform</th><th style={left}>Measure</th><th style={right}>Figure</th><th style={right}>As of</th><th style={left}>Said by</th><th style={left}>Conf.</th><th style={left}>Note</th></tr></thead>
              <tbody>{d.platforms.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...left, fontFamily: "var(--font-body)" }}>{p.entity}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{p.metric}</td>
                  <td style={{ ...right, fontWeight: 600 }}>{p.unit === "USD" || /USD/.test(p.unit || "") ? money(p.value) : p.unit === "percent" ? `${p.value}%` : big(p.value)}</td>
                  <td style={right}>{when(p.asOf)}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 140 }}>{p.statedBy || "—"}{p.url ? <> · <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(p.url)}</a></> : null}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{p.confidence || "—"}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 200 }}>{p.note || ""}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>}
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: {d.source}.</li>
        </ul>
      </VizCard>
    </div>
  );
}
