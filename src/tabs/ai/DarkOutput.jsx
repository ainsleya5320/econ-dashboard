import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, ComposedChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "../options/ui.jsx";
import { useAiPulse } from "../AiPulseTab.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// DARK OUTPUT — after SemiAnalysis, "AI Dark Output: The Visible Cost of
// Invisible Output" (May 2026). AI's costs are easy to see (chips, power,
// tokens, jobs); much of its output is not, because national accounts count
// services by receipts and wages, not by units of work done. When AI does a
// task a paid person did, the receipt vanishes; when it does work nobody
// paid for, there was never a receipt; only where the seller keeps the old
// price does the gain show up, as margin. So the tracker reads fingerprints:
//   jobs vs pay    in AI-exposed industries, employment falling relative to the
//                  economy while average pay rises (junior staff leave the
//                  sample), against low-exposure controls
//   juniors        recent-graduate unemployment and job postings in exposed
//                  occupations against all postings
//   spending       Census revenue of legal, accounting, IT and consulting
//                  services deflated by their own producer prices, against the
//                  pre-ChatGPT trend: less spending on intellectual work
//   captured?      labor's share of income, profits' share of GDP, productivity
//                  and software investment: whether firms keep the savings
//                  (S&P earnings) or pass them on (invisible deflation)
// Data: /api/dark-output (server/darkOutput.js: BLS, Census QSS, Indeed Hiring
// Lab, New York Fed, FRED); token spend from the AI pulse feed.
// ============================================================================

const SIGNAL = { "dark output": ["dark output", "var(--oc-5)"], captured: ["captured", C[3]], "nothing yet": ["nothing yet", "var(--text-muted)"], "no data": ["no data", "var(--text-muted)"] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tick = p => { const s = String(p); return /^\d{4}-\d{2}/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${s.slice(2, 4)}` : s.replace(/^(\d{4})-Q(\d)$/, "Q$2 $1"); };
const year = p => String(p).slice(0, 4);
// the first period of each year, so a year label never repeats
const yearTicks = rows => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y)) return false; seen.add(y); return true; }).map(r => r.p); };
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
// merge several [[period, value]] series onto one row-per-period table
const merge = (named, from) => {
  const by = new Map();
  for (const [k, pts] of Object.entries(named)) for (const [p, v] of pts || []) { if (from && String(p) < from) continue; const r = by.get(p) || { p }; r[k] = v; by.set(p, r); }
  return [...by.values()].sort((a, b) => String(a.p).localeCompare(String(b.p)));
};
const lastV = pts => (pts || []).filter(p => finite(p[1])).at(-1)?.[1] ?? null;

// The fingerprint map: each industry's change in employment share since 2022 against its change in relative pay
function FingerprintMap({ rows }) {
  const [hover, setHover] = useState(null);
  const pts = rows.filter(r => finite(r.empChg) && finite(r.wageRelChg));
  if (pts.length < 2) return <p className="onote">Not enough industries with both employment and pay to draw the map.</p>;
  const W = 560, H = 340, L = 50, B = 34, T = 14, R = 16;
  const ext = Math.max(5, ...pts.flatMap(p => [Math.abs(p.empChg), Math.abs(p.wageRelChg)])) * 1.1;
  const x = v => L + ((v + ext) / (2 * ext)) * (W - L - R), y = v => H - B - ((v + ext) / (2 * ext)) * (H - B - T);
  const ticks = [-ext, -ext / 2, 0, ext / 2, ext].map(v => Math.round(v));
  // selective direct labels: right of the dot, else left, else none (hover and the table still name it)
  const placed = [], labels = {};
  for (const p of [...pts].sort((a, b) => Math.abs(b.empChg) + Math.abs(b.wageRelChg) - Math.abs(a.empChg) - Math.abs(a.wageRelChg))) {
    const t = p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label, w = t.length * 5.6, cx = x(p.empChg), cy = y(p.wageRelChg);
    const boxes = [[cx + 8, cy - 8, w, 12, "start"], [cx - 8 - w, cy - 8, w, 12, "end"], [cx - w / 2, cy - 21, w, 12, "middle"], [cx - w / 2, cy + 9, w, 12, "middle"]];
    const hit = (b, o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3];
    const dots = pts.filter(o => o !== p).map(o => [x(o.empChg) - 6, y(o.wageRelChg) - 6, 12, 12]);
    const ok = boxes.find(b => b[0] >= 0 && b[0] + b[2] <= W && !placed.some(o => hit(b, o)) && !dots.some(o => hit(b, o)));
    if (ok) { placed.push(ok); labels[p.id] = { t, x: ok[4] === "start" ? cx + 8 : ok[4] === "end" ? cx - 8 : cx, y: ok[1] + 11, anchor: ok[4] }; }
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxWidth: 680 }} role="img" aria-label="Change in employment share against change in relative pay since 2022, by industry">
        <rect x={L} y={T} width={x(0) - L} height={y(0) - T} fill="var(--oc-5)" opacity="0.08" />
        <text x={L + 6} y={T + 14} fontSize="10.5" fill="var(--text-secondary)">fewer jobs, higher average pay: the fingerprint</text>
        {ticks.map(t => (<g key={t}>
          <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke={t === 0 ? "var(--text-muted)" : "var(--border-subtle)"} />
          <text x={x(t)} y={H - B + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">{t > 0 ? "+" : ""}{t}%</text>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--text-muted)" : "var(--border-subtle)"} />
          <text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-number)">{t > 0 ? "+" : ""}{t}%</text>
        </g>))}
        <text x={W - R} y={H - 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">change in share of private employment since 2022 →</text>
        <text x={L} y={T - 3} fontSize="10" fill="var(--text-muted)">↑ change in pay relative to all private workers</text>
        {pts.map(p => (
          <g key={p.id} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(p.empChg)} cy={y(p.wageRelChg)} r="11" fill="transparent" />
            {p.role === "context"
              ? <circle cx={x(p.empChg)} cy={y(p.wageRelChg)} r={hover?.id === p.id ? 6.5 : 5} fill="var(--card-bg)" stroke="var(--text-muted)" strokeWidth="2"><title>{`${p.label} (context): employment share ${signed(p.empChg, 1, "%")}, relative pay ${signed(p.wageRelChg, 1, "%")} since 2022`}</title></circle>
              : <circle cx={x(p.empChg)} cy={y(p.wageRelChg)} r={hover?.id === p.id ? 7 : 5.5} fill={p.exposed ? C[1] : "var(--text-muted)"} stroke="var(--card-bg)" strokeWidth="2"><title>{`${p.label}: employment share ${signed(p.empChg, 1, "%")}, relative pay ${signed(p.wageRelChg, 1, "%")} since 2022`}</title></circle>}
            {labels[p.id] && <text x={labels[p.id].x} y={labels[p.id].y} textAnchor={labels[p.id].anchor} fontSize="10" fill="var(--text-secondary)">{labels[p.id].t}</text>}
          </g>
        ))}
      </svg>
      <div className="onote" style={{ margin: 0, minHeight: 18 }}>{hover ? `${hover.label} (NAICS ${hover.naics}): employment share ${signed(hover.empChg, 1, "%")}, relative pay ${signed(hover.wageRelChg, 1, "%")} since 2022` : "Hover an industry. Blue: AI-exposed; grey: low-exposure controls; hollow: context (the AI build-out, temp staffing), pooled in neither."}</div>
    </div>
  );
}

function MiniPair({ ind, from }) {
  const data = merge({ emp: ind.empShareIdx, wage: ind.wageRelIdx }, from);
  return (
    <section className="ocard" style={{ padding: "8px 10px 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
        <strong style={{ font: "600 12.5px var(--font-body)" }}>{ind.label}{ind.role !== "exposed" && <span className="onote" style={{ margin: 0, fontWeight: 400 }}> · {ind.role}</span>}</strong>
        <span className="onote" style={{ margin: 0 }}>jobs {signed(ind.empChg, 0, "%")} · pay {finite(ind.wageRelChg) ? signed(ind.wageRelChg, 0, "%") : "—"}</span>
      </div>
      <div style={{ height: 80 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="p" hide /><YAxis hide domain={["auto", "auto"]} />
          <ReferenceLine y={100} stroke="var(--border-subtle)" />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={(v, n) => [fx(v, 1), n === "emp" ? "Employment share" : "Relative pay"]} />
          <Line dataKey="emp" stroke={C[1]} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="wage" stroke={C[2]} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer></div>
    </section>
  );
}

export default function DarkOutput() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [from, setFrom] = useState("2019");
  const pulse = useAiPulse();
  useEffect(() => {
    let alive = true;
    fetch("/api/dark-output").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.built) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const labor = d?.labor, post = d?.postings, jun = d?.juniors, svc = d?.services, mac = d?.macro;
  const laborChart = useMemo(() => merge({ expEmp: labor?.composite?.empShareIdx, expWage: labor?.composite?.wageRelIdx, ctlEmp: labor?.controls?.empShareIdx, ctlWage: labor?.controls?.wageRelIdx }, from), [labor, from]);
  const postCats = useMemo(() => (post?.categories || []).filter(c => c.exposed).sort((a, b) => (a.vsTotal ?? 9) - (b.vsTotal ?? 9)).slice(0, 5), [post]);
  const postChart = useMemo(() => merge({ total: post?.total, ...Object.fromEntries(postCats.map(c => [c.id, c.points])) }, from), [post, postCats, from]);
  const junChart = useMemo(() => merge(Object.fromEntries((jun?.series || []).map(s => [s.id, s.points])), from), [jun, from]);
  const svcChart = useMemo(() => merge({ real: svc?.composite?.realIdx, trend: svc?.composite?.trendIdx }, from), [svc, from]);
  const ppiChart = useMemo(() => merge({ exposed: mac?.exposedPpi, services: mac?.servicesPpi }, from), [mac, from]);
  const prodChart = useMemo(() => (mac?.productivityYoy || []).filter(([p]) => String(p) >= from).map(([p, v]) => ({ p, v })), [mac, from]);
  const shareChart = useMemo(() => merge({ labor: mac?.laborShare, profits: mac?.profitsShare }, from), [mac, from]);
  const swChart = useMemo(() => merge({ sw: mac?.software, trend: mac?.softwareTrend }, from), [mac, from]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The dark-output tracker is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading BLS, Census, Indeed and New York Fed data…</p></div></div>;

  const score = d.scorecard || [];
  const counts = Object.fromEntries(Object.keys(SIGNAL).map(k => [k, score.filter(s => s.signal === k).length]));
  // the AI pulse reports 52-week token growth as a % change; shown as a multiple
  const tokenGrowth = finite(pulse?.tokens?.growth?.w52) ? 1 + pulse.tokens.growth.w52 / 100 : null;
  const fromOpts = [["2015", "2015"], ["2019", "2019"], ["2022", "2022"]];
  const exp = labor?.industries?.filter(i => i.role === "exposed") || [];
  const ctx = labor?.industries?.filter(i => i.role === "context") || [];
  const ctl = labor?.industries?.filter(i => i.role === "control") || [];
  const purchased = (svc?.industries || []).filter(i => i.role === "purchased"), vendors = (svc?.industries || []).filter(i => i.role === "ai-vendor");
  const lc = s => s[0].toLowerCase() + s.slice(1);

  return (
    <div className="options-research">
      <p className="ohead-line">
        AI&apos;s costs are easy to see; much of its output is not, because the statistics count services by receipts and wages, not by work done. SemiAnalysis calls the missing part <strong>dark output</strong>. This page reads its fingerprints: {counts["dark output"]} of {score.length} point to dark output, {counts.captured} to gains captured as margin, {counts["nothing yet"]} show nothing yet.
      </p>

      <VizCard eyebrow="Each fingerprint, read from the latest data" title="Scorecard"
        finding="Dark output means the work is happening but the statistics can't see it (receipts vanish, prices don't fall). Captured means firms keep the savings, which shows up in margins and S&P earnings. Nothing yet means the data hasn't moved from its pre-ChatGPT path."
        right={<Seg label="From" value={from} onChange={setFrom} options={fromOpts} />}>
        <div style={{ display: "grid", gap: 0 }}>{score.map(s => { const [lbl, col] = SIGNAL[s.signal] || [s.signal, "var(--text-muted)"]; return (
          <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 3, padding: "9px 0", borderTop: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="otag" style={{ borderColor: col, color: "var(--text-primary)", minWidth: 84, textAlign: "center" }}>{lbl}</span>
              <strong style={{ font: "600 13px var(--font-body)", color: "var(--text-primary)" }}>{s.label}</strong>
            </div>
            <div style={{ font: "400 12.5px/1.5 var(--font-body)", color: "var(--text-secondary)" }}>{s.reading}</div>
            <div className="onote" style={{ margin: 0 }}>{s.why}</div>
          </div>
        ); })}</div>
        {finite(tokenGrowth) && <p className="ocard-note">The visible cost side for comparison: tokens processed on OpenRouter are up {fx(tokenGrowth, 1)}× since the week of {pulse.tokens.growth.w52Since || "a year ago"} (AI Economy → Tokens).</p>}
      </VizCard>

      <div className="ogrid ogrid-2" style={{ marginTop: 12 }}>
        <VizCard eyebrow={`BLS payrolls · AI-exposed industries pooled vs low-exposure controls · 2022 = 100 · ${labor?.asOf || ""}`} title="Jobs against pay"
          finding={labor ? `Exposed industries' share of private employment is ${signed(labor.composite?.empChg, 1, "%")} since 2022: ${signed(labor.composite?.shareSince2022, 2, "%")} a year, against ${signed(labor.composite?.sharePre, 2, "%")} a year in 2015–19. Their pay relative to all private workers is ${signed(labor.composite?.wageRelChg, 1, "%")} (${signed(labor.composite?.wageRelChgFixed, 1, "%")} holding 2022's industry mix fixed). The fingerprint is the blue line falling while the orange rises: fewer people, higher average pay, because the cheapest work leaves the sample first.` : "BLS data unavailable."}
          table={<MiniTable columns={[{ key: "p", label: "Month", fmt: tick }, { key: "expEmp", label: "Exposed jobs share", fmt: v => fx(v, 1) }, { key: "expWage", label: "Exposed relative pay", fmt: v => fx(v, 1) }, { key: "ctlEmp", label: "Controls jobs share", fmt: v => fx(v, 1) }, { key: "ctlWage", label: "Controls relative pay", fmt: v => fx(v, 1) }]} rows={[...laborChart].reverse()} />}>
          <Legend items={[["Exposed: share of jobs", C[1]], ["Exposed: relative pay", C[2]], ["Controls: share of jobs", C[1], true], ["Controls: relative pay", C[2], true]]} />
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={laborChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(laborChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={(v, n) => [fx(v, 1), { expEmp: "Exposed: share of jobs", expWage: "Exposed: relative pay", ctlEmp: "Controls: share of jobs", ctlWage: "Controls: relative pay" }[n]]} />
              <ReferenceLine y={100} stroke="var(--text-muted)" />
              <ReferenceLine x="2022-11" stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "ChatGPT", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />
              <Line dataKey="ctlEmp" stroke={C[1]} strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="ctlWage" stroke={C[2]} strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="expEmp" stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="expWage" stroke={C[2]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="Each industry since 2022 · BLS" title="The fingerprint map"
          finding={(() => {
            const corner = exp.filter(i => i.empChg < 0 && i.wageRelChg > 0), bar = corner.filter(i => i.empChg <= -3 && i.wageRelChg >= 1);
            return `Industries in the shaded corner lost share of jobs while their average pay rose relative to the economy. ${corner.length ? `Exposed industries there now: ${corner.map(i => lc(i.label)).join(", ")}` : "No exposed industry is there now"}${corner.length ? `; ${bar.length ? `${bar.map(i => lc(i.label)).join(" and ")} clear${bar.length === 1 ? "s" : ""}` : "none clears"} the scorecard's bar (share of jobs down 3% or more, relative pay up 1% or more).` : "."}`;
          })()}
          table={<MiniTable columns={[{ key: "label", label: "Industry" }, { key: "naics", label: "NAICS" }, { key: "exposed", label: "Exposed", fmt: v => (v ? "yes" : "control") }, { key: "empChg", label: "Jobs share since 2022", fmt: v => signed(v, 1, "%") }, { key: "wageRelChg", label: "Relative pay since 2022", fmt: v => signed(v, 1, "%") }]} rows={labor?.industries || []} />}>
          <FingerprintMap rows={labor?.industries || []} />
        </VizCard>
      </div>
      {exp.length > 0 && (<>
        <div className="ocard-eyebrow" style={{ margin: "4px 0 6px" }}>Industry by industry · blue share of jobs, orange relative pay · 2022 = 100</div>
        <div className="omini-grid" style={{ marginBottom: 12 }}>{[...exp, ...ctx, ...ctl].map(i => <MiniPair key={i.id} ind={i} from={from} />)}</div>
      </>)}

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`Indeed Hiring Lab · job postings, seasonally adjusted, Feb 2020 = 100 · ${post?.asOf || ""}`} title="Postings in exposed occupations"
          finding={post ? `The five exposed categories furthest below the overall market: ${postCats.map(c => `${c.label} ${fx(lastV(c.points), 0)} (${fx((c.vsTotal ?? 0) * 100, 0)}% of the market's level)`).join(", ")}; all postings ${fx(lastV(post.total), 0)}.` : "Indeed postings unavailable."}
          table={<MiniTable columns={[{ key: "label", label: "Category" }, { key: "exposed", label: "Exposed", fmt: v => (v ? "yes" : "no") }, { key: "points", label: "Latest", fmt: v => fx(lastV(v), 1) }, { key: "vsTotal", label: "vs all postings", fmt: v => (finite(v) ? `${fx(v * 100, 0)}%` : "—") }, { key: "chg1y", label: "1-yr change", fmt: v => signed(v, 0, "%") }]} rows={post?.categories || []} />}>
          <Legend items={[["All postings", "var(--text-muted)", true], ...postCats.map((c, i) => [c.label, C[i + 1]])]} />
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={postChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(postChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [fx(v, 1), n === "total" ? "All postings" : postCats.find(c => c.id === n)?.label || n]} />
              <ReferenceLine y={100} stroke="var(--border-subtle)" />
              <Line dataKey="total" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              {postCats.map((c, i) => <Line key={c.id} dataKey={c.id} stroke={C[i + 1]} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow={`New York Fed · unemployment rate, %, 3-month average · ${jun?.asOf || ""}`} title="The junior squeeze"
          finding={jun ? `Recent college graduates' unemployment minus all workers': ${signed(jun.gap?.now, 2, " pts")} now against ${signed(jun.gap?.preAI, 2, " pts")} on average in 2015–19 and ${signed(jun.gap?.at2022, 2, " pts")} in 2022, so part of the widening came before ChatGPT. Against young workers without a degree the graduates' edge has shrunk from ${signed(jun.gapYoung?.preAI, 1, " pts")} to ${signed(jun.gapYoung?.now, 1, " pts")}. Entry-level knowledge work is where substitution shows first.` : "New York Fed data unavailable."}
          table={<MiniTable columns={[{ key: "p", label: "Month", fmt: tick }, ...(jun?.series || []).map(s => ({ key: s.id, label: s.label, fmt: v => pct(v) }))]} rows={[...junChart].reverse()} />}>
          <Legend items={(jun?.series || []).slice(0, 4).map((s, i) => [s.label, C[i + 1]])} />
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={junChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(junChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={(v, n) => [pct(v), (jun?.series || []).find(s => s.id === n)?.label || n]} />
              {(jun?.series || []).slice(0, 4).map((s, i) => <Line key={s.id} dataKey={s.id} stroke={C[i + 1]} strokeWidth={s.id === "recentGrads" ? 2.25 : 1.5} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`Census Quarterly Services Survey ÷ BLS producer prices · 2022 = 100 · ${svc?.asOf || ""}`} title="Spending on intellectual work"
          finding={svc ? `Real revenue of purchased professional work (legal, accounting, IT design, consulting, advertising), pooled, is ${signed(svc.composite?.gapToTrend, 1, "%")} against its 2015–2022 trend: ${purchased.map(i => `${lc(i.label)} ${signed(i.gapToTrend, 0, "%")}`).join(", ")}. Below trend while AI use climbs is the "less spending on intellectual work" your thesis predicts; whether it is dark output or captured depends on the panels below. Where AI spending lands instead: ${vendors.map(i => `${lc(i.label)} ${signed(i.gapToTrend, 0, "%")}`).join(", ")} against their own (steep) trends.` : "Census QSS unavailable."}
          table={<MiniTable columns={[{ key: "label", label: "Industry" }, { key: "role", label: "Role" }, { key: "gapToTrend", label: "Real vs trend", fmt: v => signed(v, 1, "%") }, { key: "revPerWorkerPre", label: "Real rev/worker 2015–19, %/yr", fmt: v => signed(v, 1) }, { key: "revPerWorkerSince2022", label: "Since 2022, %/yr", fmt: v => signed(v, 1) }, { key: "revenue", label: "Latest revenue, $bn/qtr", fmt: v => fx(lastV(v), 1) }, { key: "deflator", label: "Deflated by" }]} rows={svc?.industries || []} />}>
          <Legend items={[["Real revenue, exposed services", C[1]], ["2015–2022 trend", "var(--text-muted)", true]]} />
          <div className="ochart" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={svcChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(svcChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={(v, n) => [fx(v, 1), n === "real" ? "Real revenue" : "Trend"]} />
              <Line dataKey="trend" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="real" stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="BLS producer price indexes · 2022 = 100" title="Are the prices falling?"
          finding={mac?.exposedPpi ? `Prices of the exposed services ${signed(lastV(mac.exposedPpi) - 100, 1, "%")} since 2022 against ${signed(lastV(mac.servicesPpi) - 100, 1, "%")} for all services. If AI made this work cheaper and the price indexes don't fall, either firms are keeping the margin or, as SemiAnalysis argues, the indexes track wages rather than units of work.` : "PPI data unavailable."}
          table={<MiniTable columns={[{ key: "p", label: "Month", fmt: tick }, { key: "exposed", label: "Exposed services", fmt: v => fx(v, 1) }, { key: "services", label: "All services", fmt: v => fx(v, 1) }]} rows={[...ppiChart].reverse()} />}>
          <Legend items={[["Exposed services", C[1]], ["All services", "var(--text-muted)", true]]} />
          <div className="ochart" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={ppiChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(ppiChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={(v, n) => [fx(v, 1), n === "exposed" ? "Exposed services" : "All services"]} />
              <ReferenceLine y={100} stroke="var(--border-subtle)" />
              <Line dataKey="services" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="exposed" stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <div className="ocard-eyebrow" style={{ margin: "4px 0 6px" }}>Captured or passed on? The S&amp;P question</div>
      <div className="ogrid ogrid-3">
        <VizCard eyebrow="BLS nonfarm business · % · FRED corporate profits ÷ GDP" title="Who keeps the income"
          finding={mac ? `Labor's share of business income is ${signed(mac.laborShareChg, 1, "%")} since 2022; after-tax corporate profits are ${pct(lastV(mac.profitsShare))} of GDP (${signed(mac.profitsShareChg, 1, " pts")})${finite(mac.compShareChg) ? `, and pay is ${pct(lastV(mac.compShare))} of national income (${signed(mac.compShareChg, 1, " pts")})` : ""}. A falling labor share with rising profits is AI's savings being captured by owners, the case for S&P margins; flat shares mean nothing has shifted yet.` : ""}
          table={<MiniTable columns={[{ key: "p", label: "Quarter", fmt: tick }, { key: "labor", label: "Labor share", fmt: v => fx(v, 1) }, { key: "profits", label: "Profits % GDP", fmt: v => pct(v) }]} rows={[...shareChart].reverse()} />}>
          <Legend items={[["Labor share (index)", C[1]]]} />
          <div className="ochart-sm" style={{ height: 120 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={shareChart} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} /><XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(shareChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={v => [fx(v, 1), "Labor share"]} />
              <Line dataKey="labor" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer></div>
          <Legend items={[["Corporate profits, % of GDP", C[3]]]} />
          <div className="ochart-sm" style={{ height: 120 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={shareChart} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} /><XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(shareChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} allowDecimals={false} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={v => [pct(v), "Profits % of GDP"]} />
              <Line dataKey="profits" stroke={C[3]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="BLS nonfarm business labor productivity · % change on a year" title="Measured productivity"
          finding={mac?.productivity ? `Productivity has grown ${pct(mac.productivity.since2023, 2)} a year since late 2022 against ${pct(mac.productivity.pre, 2)} in the 2010s (2009Q4–2019Q4). Faster measured productivity means some of the gain is visible; if the fingerprints above move and this doesn't, that gap is dark output.` : ""}
          table={<MiniTable columns={[{ key: "p", label: "Quarter", fmt: tick }, { key: "v", label: "% y/y", fmt: v => pct(v) }]} rows={[...prodChart].reverse()} />}>
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={prodChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} /><XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(prodChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={v => [pct(v), "Productivity, y/y"]} />
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              {finite(mac?.productivity?.pre) && <ReferenceLine y={mac.productivity.pre} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "2010–19 avg", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
              <Bar dataKey="v" isAnimationActive={false}>{prodChart.map(r => <Cell key={r.p} fill={r.v < 0 ? "var(--oc-pos)" : C[1]} />)}</Bar>
            </ComposedChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="BEA private fixed investment in software, $bn SAAR · via FRED" title="Software investment vs trend"
          finding={mac?.software ? `Software investment is ${signed(mac.softwareGap, 1, "%")} against its pre-2023 trend. SemiAnalysis's point: over a third of AI tokens go to computing and maths, yet measured software output hasn't broken from trend, a sign of new dark output.` : "Software investment unavailable (FRED)."}
          table={<MiniTable columns={[{ key: "p", label: "Quarter", fmt: tick }, { key: "sw", label: "Software, $bn", fmt: v => fx(v, 0) }, { key: "trend", label: "Trend", fmt: v => fx(v, 0) }]} rows={[...swChart].reverse()} />}>
          <Legend items={[["Software investment", C[1]], ["Pre-2023 trend", "var(--text-muted)", true]]} />
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={swChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} /><XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(swChart)} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={tick} formatter={(v, n) => [`$${fx(v, 0)}bn`, n === "sw" ? "Software" : "Trend"]} />
              <Line dataKey="trend" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="sw" stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>
      {d.corporate && <p className="onote">S&amp;P 500, matched sample of {d.corporate.n}: revenue per employee ${d.corporate.revPerEmployee?.[0]?.[1]}k → ${d.corporate.revPerEmployee?.[1]?.[1]}k ({signed(d.corporate.revPerEmployeeChg, 1, "%")}), headcount {signed(d.corporate.employeesChg, 1, "%")}, operating margin {pct(d.corporate.opMargin?.[0]?.[1], 2)} → {pct(d.corporate.opMargin?.[1]?.[1], 2)}. {d.corporate.note}</p>}
      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      <p className="onote">Sources: {(d.sources || []).map(s => `${s.label} (${s.from === "live" ? "fetched" : `${s.from} copy`} ${String(s.fetched || "").slice(0, 10)})`).join("; ")}. Job postings data: Indeed Hiring Lab.</p>
      <p className="onote">Framework: SemiAnalysis, &quot;AI Dark Output: The Visible Cost of Invisible Output&quot; (Malcolm Spittler and Dylan Patel, May 2026). Exposure is classified by industry, not task, so each exposed industry still contains plenty of work AI doesn&apos;t touch. Average pay rises can be composition (juniors leaving) or real raises; the controls help separate the two. Census revenue is nominal and deflated by producer price indexes, which for services largely track labor costs. {d.note || ""}</p>
    </div>
  );
}
