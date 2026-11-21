import React, { useEffect, useMemo, useState } from "react";
import { finite, C, VizCard, Kpi, Legend } from "./options/ui.jsx";
import "./options/OptionsResearch.css";
import { REG_COLOR } from "./regime/shared.jsx";

// ============================================================================
// REGIME ANALOGS — Regime Map → Analogs: when has the market looked like
// this before? Each node is 13 weeks of sixteen cross-asset readings; today is
// compared with every earlier node since 1990 (server/regimeAnalogs.js).
//   map        every node, coloured by regime and sized by how violent the 13
//              weeks were; today, its ten closest analogs and the benchmark
//              episodes are marked. Near means alike; distances are not to scale
//   closest    the ten analogs with what the S&P 500 and the Baa spread did
//              next; click one to see why it matches and to trace its path
//   episodes   similarity to a fixed list of stress episodes, high or low
//   why        the readings today and then, side by side
//   after      the S&P 500 over the next 26 weeks from each analog: median,
//              the middle half and the 10th to 90th percentile
//   check      whether analogs have called direction in the past (they have not)
// Regimes take the five categorical slots in a fixed order, with grey for quiet;
// every regime is also written out, never colour alone.
// ============================================================================

const pct = (v, dp = 1) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const bp = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v * 100))} bp` : "—");
const share = v => (finite(v) ? `${Math.round(v * 100)}%` : "—");
const mon = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—");
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const tone = v => (!finite(v) || v === 0 ? "var(--text-muted)" : v > 0 ? C[1] : C[2]);
const left = { textAlign: "left" }, right = { textAlign: "right" };
const zs = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}` : "—");
// the label of a reading inside a sentence: lower case, proper names kept
const nice = t => t.toLowerCase().replace("s&p", "S&P").replace("vix", "VIX").replace("baa", "Baa").replace("wti", "WTI");
const READ = { agree: ["✓", "same direction"], differ: ["✗", "opposite"], "both quiet": ["·", "both quiet"], "one quiet": ["·", "one of them quiet"], missing: ["–", "no reading then"] };

function Dot({ color }) { return <i aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 5 }} />; }

// place labels beside their nodes without overlap: try right, left, above, below; drop optional ones that will not fit
function placeLabels(items, W, H, blockers = []) {
  const placed = [], drawn = [];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const it of items) {
    const w = it.text.length * (it.big ? 6.4 : 5.4) + 4, h = it.big ? 13 : 11;
    // close in first; today's and the analogs' labels may step further out before giving up, the episodes' may not
    const tries = (it.kind === "episode" ? [4] : [4, 14, 26, 40]).flatMap(o => { const g = it.r + o; return [[it.cx + g, it.cy - h / 2, "start"], [it.cx - g - w, it.cy - h / 2, "end"], [it.cx - w / 2, it.cy - g - h, "middle"], [it.cx - w / 2, it.cy + g, "middle"],
      [it.cx + g, it.cy - h - 2, "start"], [it.cx + g, it.cy + 2, "start"], [it.cx - g - w, it.cy - h - 2, "end"], [it.cx - g - w, it.cy + 2, "end"]]; });
    for (const [x, y, anchor] of tries) {
      const box = { x, y, w, h };
      if (x < 2 || y < 2 || x + w > W - 2 || y + h > H - 2 || placed.some(p => hit(p, box)) || blockers.some(p => p.node !== it.node && hit(p, box))) continue;
      placed.push(box);
      drawn.push({ ...box, ...it, anchor, tx: anchor === "start" ? x : anchor === "end" ? x + w : x + w / 2, ty: y + h - 2.5 });
      break;
    }
  }
  return drawn;
}

function RegimeMap({ d, selected, onSelect }) {
  const W = 760, H = 480, pad = 26;
  const [hover, setHover] = useState(null);
  const X = n => pad + n.x * (W - 2 * pad), Y = n => pad + n.y * (H - 2 * pad), R = n => 2.4 + 4.6 * (n.size ?? 0.3);
  const now = d.nodes.length - 1, analogAt = Object.fromEntries(d.analogs.map(a => [a.node, a]));
  const labels = useMemo(() => {
    const items = [{ cx: X(d.nodes[now]), cy: Y(d.nodes[now]), r: 10, text: `Now · ${mon(d.asOf)}`, big: true, kind: "now", node: now }];
    for (const a of d.analogs.slice(0, 5)) items.push({ cx: X(d.nodes[a.node]), cy: Y(d.nodes[a.node]), r: 7, text: `${a.rank}. ${mon(a.d)} · ${Math.round(a.sim * 100)}%`, kind: "analog", node: a.node });
    for (const e of d.episodes) if (!analogAt[e.peak]) items.push({ cx: X(d.nodes[e.peak]), cy: Y(d.nodes[e.peak]), r: R(d.nodes[e.peak]), text: e.label.replace(/ \(.*\)/, ""), kind: "episode", node: e.peak });
    // today and every analog are obstacles too, so a label never sits on top of another marked node
    const ring = (j, r) => ({ node: j, x: X(d.nodes[j]) - r, y: Y(d.nodes[j]) - r, w: 2 * r, h: 2 * r });
    return placeLabels(items, W, H, [ring(now, 13), ...d.analogs.map(a => ring(a.node, 9))]);
  }, [d]);
  const move = e => {
    const b = e.currentTarget.getBoundingClientRect(), mx = ((e.clientX - b.left) / b.width) * W, my = ((e.clientY - b.top) / b.height) * H;
    let best = null, bd = 14 ** 2;
    d.nodes.forEach((n, j) => { const q = (X(n) - mx) ** 2 + (Y(n) - my) ** 2; if (q < bd) { bd = q; best = j; } });
    setHover(best);
  };
  const h = hover != null ? d.nodes[hover] : null;
  return (
    <div style={{ position: "relative", maxWidth: 1000, margin: "0 auto" }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Every 13-week window on record as a node, similar windows near each other; today and its closest analogs are marked" style={{ display: "block" }}
        onMouseMove={move} onMouseLeave={() => setHover(null)} onClick={() => { if (hover != null && analogAt[hover]) onSelect(analogAt[hover].rank); }}>
        {d.edges.map(([a, b]) => <line key={`${a}-${b}`} x1={X(d.nodes[a])} y1={Y(d.nodes[a])} x2={X(d.nodes[b])} y2={Y(d.nodes[b])} stroke="var(--text-muted)" strokeWidth="0.6" opacity="0.16" />)}
        {d.analogs.map(a => <line key={a.rank} x1={X(d.nodes[now])} y1={Y(d.nodes[now])} x2={X(d.nodes[a.node])} y2={Y(d.nodes[a.node])} stroke="var(--text-primary)" strokeWidth={a.rank === selected ? 1.6 : 0.9} opacity={a.rank === selected ? 0.8 : a.rank <= 5 ? 0.38 : 0.2} />)}
        {d.nodes.map((n, j) => j !== now && !analogAt[j] && <circle key={n.d} cx={X(n)} cy={Y(n)} r={R(n)} fill={REG_COLOR[n.regime]} opacity={n.regime === "quiet" ? 0.45 : 0.82} stroke="var(--card-bg)" strokeWidth="0.8" />)}
        {d.analogs.map(a => { const n = d.nodes[a.node]; return <circle key={a.rank} cx={X(n)} cy={Y(n)} r={R(n) + 1.5} fill={REG_COLOR[n.regime]} stroke="var(--text-primary)" strokeWidth={a.rank === selected ? 2.6 : 1.6} style={{ cursor: "pointer" }} />; })}
        <circle cx={X(d.nodes[now])} cy={Y(d.nodes[now])} r={11} fill="none" stroke="var(--text-primary)" strokeWidth="2" />
        <circle cx={X(d.nodes[now])} cy={Y(d.nodes[now])} r={6.5} fill={REG_COLOR[d.nodes[now].regime]} stroke="var(--card-bg)" strokeWidth="1.5" />
        {labels.map(l => <text key={l.text} x={l.tx} y={l.ty} textAnchor={l.anchor} style={{ fontSize: l.big ? 11.5 : 9.5, fontWeight: l.kind === "episode" ? 400 : 600, fill: l.kind === "episode" ? "var(--text-muted)" : "var(--text-primary)", fontFamily: "var(--font-number)", paintOrder: "stroke", stroke: "var(--card-bg)", strokeWidth: 3 }}>{l.text}</text>)}
        {h && <circle cx={X(h)} cy={Y(h)} r={R(h) + 4} fill="none" stroke="var(--text-primary)" strokeWidth="1.2" />}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {h ? <><b style={{ color: "var(--text-primary)" }}>13 weeks to {day(h.d)}</b> · <Dot color={REG_COLOR[h.regime]} />{d.regimes[h.regime].label}, {h.led}-led · {hover === now ? "today" : `similarity to today ${share(h.sim)}`} · more violent than {share(h.size)} of windows</> : <>Hover a node for its date and regime. Near means alike; the layout's distances and directions are not a scale.</>}
      </div>
      <Legend items={d.regimeOrder.map(k => [d.regimes[k].label, REG_COLOR[k]])} />
    </div>
  );
}

// the S&P 500 over the 26 weeks after each analog: the 10–90 and 25–75 bands, the median, and the top three paths
function ForwardChart({ d, selected }) {
  const W = 720, H = 260, m = { l: 40, r: 118, t: 10, b: 24 };
  const [hover, setHover] = useState(null);
  const shown = [...new Set([1, 2, 3, selected])].map(r => d.analogs[r - 1]).filter(Boolean);
  const vals = [...d.bands.flatMap(b => [b.p10, b.p90]), ...shown.flatMap(a => a.path)].filter(finite);
  const lo = Math.min(-0.02, ...vals), hi = Math.max(0.02, ...vals), span = hi - lo;
  const x = h => m.l + (h / 26) * (W - m.l - m.r), y = v => m.t + (1 - (v - lo) / span) * (H - m.t - m.b);
  const step = span > 0.4 ? 0.1 : 0.05, ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const area = (a, b) => [...d.bands.filter(r => finite(r[a])).map(r => `${x(r.h)},${y(r[a])}`), ...d.bands.filter(r => finite(r[b])).reverse().map(r => `${x(r.h)},${y(r[b])}`)].join(" ");
  const line = pts => pts.map((v, h) => (finite(v) ? `${x(h)},${y(v)}` : null)).filter(Boolean).join(" ");
  // direct labels at the right edge, nudged apart
  const ends = [{ key: "median", text: `Median ${pct(d.bands.at(-1).median)}`, v: d.bands.at(-1).median, strong: true }, ...shown.map(a => { const k = a.path.map(finite).lastIndexOf(true); return { key: a.rank, text: `${a.rank}. ${mon(a.d)} ${pct(a.path[k])}`, v: a.path[k], hx: k }; })]
    .filter(e => finite(e.v)).map(e => ({ ...e, py: y(e.v) })).sort((a, b) => a.py - b.py);
  for (let k = 1; k < ends.length; k++) if (ends[k].py - ends[k - 1].py < 13) ends[k].py = ends[k - 1].py + 13;
  const hb = hover != null ? d.bands[hover] : null;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="S&P 500 return over the 26 weeks after each of the ten closest analogs" style={{ display: "block" }}
        onMouseMove={e => { const b = e.currentTarget.getBoundingClientRect(), mx = ((e.clientX - b.left) / b.width) * W; setHover(Math.max(0, Math.min(26, Math.round(((mx - m.l) / (W - m.l - m.r)) * 26)))); }} onMouseLeave={() => setHover(null)}>
        {ticks.map(v => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--text-muted)" : "var(--border-subtle)"} strokeDasharray={v === 0 ? "4 3" : undefined} /><text x={m.l - 6} y={y(v) + 3.5} textAnchor="end" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(Math.round(v * 100))}%</text></g>)}
        {[[0, "Day 0"], [4, "+1 mo"], [13, "+3 mo"], [26, "+6 mo"]].map(([h, t]) => <g key={h}><line x1={x(h)} x2={x(h)} y1={m.t} y2={H - m.b} stroke="var(--border-subtle)" strokeDasharray="2 3" /><text x={x(h)} y={H - 8} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{t}</text></g>)}
        <polygon points={area("p10", "p90")} fill={C[1]} opacity="0.13" />
        <polygon points={area("p25", "p75")} fill={C[1]} opacity="0.24" />
        {shown.map(a => <polyline key={a.rank} points={line(a.path)} fill="none" stroke={a.rank === selected ? C[4] : "var(--text-secondary)"} strokeWidth={a.rank === selected ? 2 : 1.2} opacity={a.rank === selected ? 1 : 0.75} strokeLinejoin="round" />)}
        <polyline points={line(d.bands.map(b => b.median))} fill="none" stroke={C[1]} strokeWidth="2.6" strokeLinejoin="round" />
        {[4, 13, 26].map(h => finite(d.bands[h].median) && <circle key={h} cx={x(h)} cy={y(d.bands[h].median)} r={4} fill={C[1]} stroke="var(--card-bg)" strokeWidth="2" />)}
        {ends.map(e => <text key={e.key} x={W - m.r + 6} y={e.py + 3.5} style={{ fontSize: 10.5, fontWeight: e.strong || e.key === selected ? 600 : 400, fill: e.strong || e.key === selected ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-number)" }}>{e.text}</text>)}
        {hb && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--text-muted)" />}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {hb ? <><b style={{ color: "var(--text-primary)" }}>Week {hb.h}</b>: median {pct(hb.median)} · middle half {pct(hb.p25)} to {pct(hb.p75)} · 10th to 90th {pct(hb.p10)} to {pct(hb.p90)} · {hb.n} analogs{shown.map(a => finite(a.path[hb.h]) ? ` · ${a.rank}. ${pct(a.path[hb.h])}` : "").join("")}</> : <>Hover for a week. The numbered lines are the three closest analogs{selected > 3 ? " and the one selected" : ""}.</>}
      </div>
      <Legend items={[["Median of the ten analogs", C[1]], ["Middle half (25th to 75th)", `color-mix(in srgb, ${C[1]} 37%, transparent)`], ["10th to 90th percentile", `color-mix(in srgb, ${C[1]} 13%, transparent)`], ["Selected analog", C[4]], ["Other top-three analogs", "var(--text-secondary)"]]} />
    </div>
  );
}

// a reading in standard deviations on a ±3 scale
function ZBar({ v, width = 74 }) {
  const mid = width / 2, s = a => (Math.min(3, Math.abs(a)) / 3) * (mid - 2);
  return (
    <svg width={width} height={10} role="img" aria-label={finite(v) ? `${v} standard deviations` : "no reading"} style={{ display: "block" }}>
      <line x1={mid} x2={mid} y1={0} y2={10} stroke="var(--text-muted)" />
      {finite(v) && v !== 0 && <rect x={v > 0 ? mid + 1 : mid - 1 - s(v)} y={2} width={Math.max(1.5, s(v))} height={6} rx={2} fill="var(--text-secondary)" />}
    </svg>
  );
}

export default function RegimeAnalogs() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [sel, setSel] = useState(1);
  useEffect(() => { let live = true; fetch("/api/regime-analogs").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Regime analogs</h3><p className="ocard-finding">The analog read could not be built: {err}</p></section></div>;
  if (!d) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Regime analogs</h3><p className="onote">Comparing today with every 13-week window on record…</p></section></div>;

  const n = d.now, st = n.stats, top = d.analogs[0], a = d.analogs[sel - 1] || top, o6 = d.outcomes.find(o => o.h === 26), bt = d.backtest;
  const agree = a.why.filter(w => w.read === "agree"), differ = a.why.filter(w => w.read === "differ");
  const groups = [...new Set(d.features.map(f => f.group))];
  return (
    <div className="options-research">
      <VizCard eyebrow={`Cross-asset similarity · equities, rates, credit, currencies, commodities, volatility · 13 weeks to ${day(d.asOf)}`} title="When has the market looked like this before?"
        finding={`${n.stressAnalogs} of the ${n.analogs} closest analogs were stress regimes; the closest is ${mon(top.d)} at ${Math.round(top.sim * 100)}% similarity. Today reads ${n.label.toLowerCase()}, ${n.led}-led, more violent than ${share(n.intensityPct)} of 13-week windows since ${d.since.slice(0, 4)}. After the ten analogs the S&P 500's median next six months was ${pct(o6.median)} (up ${share(o6.positive)} of the time), against ${pct(o6.base.median)} (up ${share(o6.base.positive)}) from any week. Read it as a description of where we are: the check at the bottom shows analogs have not called direction.`}
        style={{ marginBottom: 0 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Current regime" value={n.label} sub={`${n.led}-led; stress ${n.stress > 0 ? "+" : ""}${n.stress} (0.6 or more is risk-off)`} tone={REG_COLOR[n.regime]} />
          <Kpi label="Closest match" value={`${mon(top.d)} · ${Math.round(top.sim * 100)}%`} sub={`${d.regimes[top.regime].label}; then S&P ${pct(top.f26)} in 6 months`} />
          <Kpi label="Stress analogs" value={`${n.stressAnalogs} of ${n.analogs}`} sub="closest analogs that were risk-off regimes" />
          <Kpi label="Intensity" value={`${Math.round(n.intensityPct * 100)}th pct`} sub={`how violent the past 13 weeks were, against every window since ${d.since.slice(0, 4)}`} />
          <Kpi label="After the analogs, 6 mo" value={pct(o6.median)} sub={`median S&P; middle half ${pct(o6.p25)} to ${pct(o6.p75)}; ${o6.n} analogs`} />
        </div>

        <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>The regime map · each node is 13 weeks · size is intensity · lines join similar windows</div>
        <RegimeMap d={d} selected={sel} onSelect={setSel} />
        <div style={{ fontSize: 12, lineHeight: 1.6, fontFamily: "var(--font-number)", color: "var(--text-secondary)", margin: "8px 0 12px" }}>
          <span className="ocard-eyebrow" style={{ marginRight: 8 }}>The past 13 weeks</span>
          S&amp;P 500 <b style={{ color: "var(--text-primary)" }}>{pct(st.spx13)}</b> ({pct(st.drawdown)} from its high) · small caps <b style={{ color: "var(--text-primary)" }}>{pct(st.small13)}</b> · 10-year <b style={{ color: "var(--text-primary)" }}>{st.y10?.toFixed(2)}%</b> ({bp(st.y10chg)}) · 2-year {st.y2?.toFixed(2)}% ({bp(st.y2chg)}) · 2s10s {bp(st.curveChg)} · Baa spread <b style={{ color: "var(--text-primary)" }}>{finite(st.baa) ? `${Math.round(st.baa * 100)} bp` : "—"}</b> ({bp(st.baaChg)}) · VIX <b style={{ color: "var(--text-primary)" }}>{st.vix}</b> ({st.vixChg > 0 ? "+" : ""}{st.vixChg}) · rate vol {st.rateVol} bp/yr · dollar {pct(st.dollar13)} · oil {pct(st.oil13)} · gold {pct(st.gold13)}
        </div>

        <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Closest historical periods · what followed · click a row</div>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={right}>#</th><th style={left}>13 weeks to</th><th style={right}>Similarity</th><th style={left}>Regime</th><th style={right}>S&amp;P +1 mo</th><th style={right}>+3 mo</th><th style={right}>+6 mo</th><th style={right}>+12 mo</th><th style={right}>Baa spread +3 mo</th></tr></thead>
            <tbody>{d.analogs.map(x => (
              <tr key={x.rank} className="oclick" onClick={() => setSel(x.rank)} aria-selected={x.rank === sel} style={{ background: x.rank === sel ? "var(--bg-subtle)" : undefined }}>
                <td style={{ ...right, color: "var(--text-muted)" }}>{x.rank}</td>
                <td style={{ ...left, fontWeight: x.rank === sel ? 600 : 400 }}>{mon(x.d)}</td>
                <td style={{ ...right, fontWeight: 600 }}>{Math.round(x.sim * 100)}%</td>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}><Dot color={REG_COLOR[x.regime]} />{d.regimes[x.regime].label}<span style={{ color: "var(--text-muted)" }}> · {x.led}-led</span></td>
                <td style={{ ...right, color: tone(x.f4) }}>{pct(x.f4)}</td><td style={{ ...right, color: tone(x.f13) }}>{pct(x.f13)}</td><td style={{ ...right, color: tone(x.f26) }}>{pct(x.f26)}</td><td style={{ ...right, color: tone(x.f52) }}>{pct(x.f52)}</td>
                <td style={right}>{bp(x.credit13)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="onote" style={{ marginTop: 4 }}>The ten most similar 13-week windows, at least 24 weeks apart and 24 weeks before today. A dash means that much time has not yet passed.</p>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Why #{a.rank} matches · today against the 13 weeks to {day(a.d)}</div>
        <p style={{ margin: "0 0 6px", fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>Direction {Math.round(a.cos * 100)}% alike, magnitude {Math.round(a.mag * 100)}%. {agree.length ? <>Moving the same way: <b style={{ color: "var(--text-primary)" }}>{agree.map(w => nice(w.label)).join(", ")}</b>. </> : null}{differ.length ? <>Opposite: <b style={{ color: "var(--text-primary)" }}>{differ.map(w => nice(w.label)).join(", ")}</b>.</> : "Nothing sizeable moved the opposite way."}</p>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={left}>Reading</th><th style={left}>Today</th><th style={left}>Then</th><th style={left}>Read</th></tr></thead>
            <tbody>{groups.map(g => (
              <React.Fragment key={g}>
                <tr><td colSpan={4} style={{ ...left, background: "var(--bg-subtle)", fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 11.5, color: "var(--text-primary)", textTransform: "capitalize" }}>{g}</td></tr>
                {a.why.filter(w => w.group === g).map(w => (
                  <tr key={w.id}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{w.label}{w.kind === "level" ? "" : <span style={{ color: "var(--text-muted)" }}> · 13-wk change</span>}</td>
                    <td style={left}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ZBar v={w.now} /><span style={{ width: 34, textAlign: "right" }}>{zs(w.now)}</span></span></td>
                    <td style={left}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ZBar v={w.then} /><span style={{ width: 34, textAlign: "right" }}>{zs(w.then)}</span></span></td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: w.read === "agree" || w.read === "differ" ? "var(--text-primary)" : "var(--text-muted)", fontWeight: w.read === "agree" || w.read === "differ" ? 600 : 400 }}>{READ[w.read][0]} {READ[w.read][1]}</td>
                  </tr>))}
              </React.Fragment>))}</tbody>
          </table>
        </div>
        <p className="onote" style={{ marginTop: 4 }}>In standard deviations of each reading's own history, on a ±3 scale. Right of the line is up (or above average, for levels).</p>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>What happened after similar regimes · S&amp;P 500 from each analog's date</div>
        <ForwardChart d={d} selected={sel} />

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 12 }}>
          <div style={{ flex: "1.2 1 380px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Analog outcomes · S&amp;P 500</div>
            <div className="otable-wrap">
              <table className="otable">
                <thead><tr><th style={left}>After</th><th style={right}>Median</th><th style={right}>Up</th><th style={right}>25th</th><th style={right}>75th</th><th style={right} title="What the S&P did from any week on record">Any week</th></tr></thead>
                <tbody>{d.outcomes.map(o => (
                  <tr key={o.h}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{o.label}<span style={{ color: "var(--text-muted)" }}> · {o.n} analogs</span></td>
                    <td style={{ ...right, fontWeight: 600, color: tone(o.median) }}>{pct(o.median)}</td>
                    <td style={right}>{share(o.positive)}</td>
                    <td style={{ ...right, color: tone(o.p25) }}>{pct(o.p25)}</td><td style={{ ...right, color: tone(o.p75) }}>{pct(o.p75)}</td>
                    <td style={{ ...right, color: "var(--text-secondary)" }}>{pct(o.base.median)}, up {share(o.base.positive)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <p className="onote" style={{ marginTop: 6 }}><b style={{ color: "var(--text-primary)" }}>Does this predict?</b> Run at each of {bt.n} past nodes since {mon(bt.from)}, using only analogs whose outcome was already known: the analogs' median called the sign of the next six months {share(bt.signHit)} of the time, when simply saying "up" was right {share(bt.alwaysUp)}. The {bt.whenNegative.n} times the analogs pointed down, the S&amp;P rose {share(bt.whenNegative.positive)} of the time (median {pct(bt.whenNegative.median)}). Rank correlation of the call with the outcome: {bt.rankCorr}. Analogs say what kind of market this is, not where it goes.</p>
          </div>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 6 }}>Similarity to past stress episodes · a fixed list, high or low</div>
            <div style={{ display: "grid", gap: 5 }}>
              {d.episodes.map(e => (
                <div key={e.label} title={`Best match inside the episode: 13 weeks to ${day(e.d)} (${d.regimes[e.regime].label})`} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.3fr) minmax(60px, 1fr) 38px", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <span style={{ fontFamily: "var(--font-body)", color: "var(--text-primary)" }}>{e.label}</span>
                  <span style={{ display: "block", height: 8, borderRadius: 4, background: "var(--bg-subtle)" }}><span style={{ display: "block", height: 8, width: `${Math.round(e.sim * 100)}%`, borderRadius: 4, background: C[1] }} /></span>
                  <strong style={{ textAlign: "right", fontFamily: "var(--font-number)" }}>{Math.round(e.sim * 100)}%</strong>
                </div>))}
            </div>
            <p className="onote" style={{ marginTop: 6 }}>Each bar is the best match inside that episode; hover for the date. Under about 50% the resemblance is weak.</p>
          </div>
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>Method, and how this differs from the Bloomberg version</summary>
          <ul className="onote" style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
            {d.method.map((t, i) => <li key={i}>{t}</li>)}
            <li>Source: {d.source}. History from {mon(d.since)}; {d.nodes.length} nodes.</li>
          </ul>
        </details>
      </VizCard>
    </div>
  );
}
