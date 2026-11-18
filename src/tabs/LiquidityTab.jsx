import React, { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../lib/styles.js";
import { fin, note, tip, axis, fmtDay, chip, DenseHeader, Panel, Note } from "../components/dense.jsx";
import { Spark } from "./options/ui.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// LIQUIDITY — U.S. Economy → Rates & Fed → Liquidity. Is money expanding or
// contracting, where, and how fast? Six layers from the Fed outward (central
// bank, money markets, money and bank credit, the Treasury market, credit, the
// global dollar), each gauge graded by a rule printed beside it, one composite
// and its 13-week change (the impulse), and a test of whether the composite
// has led stocks.
//   header     the verdict, the composite and impulse, and the readings that
//              matter most; a strip of the six layers that links to each
//   composite  the composite and impulse since 2002, and the lead test
//   net liq.   the Fed's assets less the Treasury's account and reverse repos,
//              moved here from Fed balance sheet (its one home)
//   layers     one section each, open and close; closed, a summary line;
//              open, every gauge with its reading, changes, grade, the past
//              six months of grades, three years of history, the rule and the
//              page that owns its full chart
// Data: /api/liquidity (server/liquidity.js). Expanding is blue (--oc-1),
// contracting orange (--oc-2), neutral gray; every grade is also written out.
// Open sections are remembered in this browser only.
// ============================================================================

const GRADE = { expanding: ["Expanding", "var(--oc-1)"], neutral: ["Neutral", "var(--text-muted)"], contracting: ["Contracting", "var(--oc-2)"], none: ["No reading", "var(--border-subtle)"] };
const VERDICT_TONE = { Expanding: "var(--oc-1)", "Leaning easier": "var(--oc-1)", Balanced: "var(--text-muted)", "Leaning tighter": "var(--oc-2)", Contracting: "var(--oc-2)" };
const STORE = "liquidity.open.v1";
const RANGES = [["3Y", 156], ["10Y", 520], ["All", 99999]];
const loadOpen = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { return {}; } };
const saveOpen = o => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* not remembered */ } };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
// short names for the summary lines
const SHORT = { reserveShare: "Reserves / bank assets", rrpBuffer: "Reverse-repo buffer", tga: "Treasury's account", runoff: "Fed securities", facilities: "Emergency facilities", sofrIorb: "SOFR − reserve rate", repoDispersion: "Repo rate spread", repoVolume: "Repo volume", realM2: "Real M2", loans: "Bank loans", deposits: "Deposits", standards: "Banks tightening", termPremium: "Term premium", rateVol: "10-yr volatility", igSpread: "IG spread", hySpread: "HY spread", baa: "Baa spread", nfci: "Chicago Fed conditions", dollar: "Dollar", globalCB: "Fed + ECB + BoJ assets" };
const short = g => SHORT[g.id] || g.label;
const bnFmt = v => (!fin(v) ? "—" : Math.abs(v) >= 1000 ? `${sgn(v) === "−" ? "−" : ""}$${(Math.abs(v) / 1000).toFixed(2)}T` : `${sgn(v) === "−" ? "−" : ""}$${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}bn`);

// a reading in its own units
function fmtValue(g, v = g.value) {
  if (!fin(v)) return "—";
  switch (g.fmt) {
    case "bn": return bnFmt(v);
    case "pct": case "pctpt": return `${v.toFixed(1)}%`;
    case "bp": return `${Math.round(v)} bp`;
    case "pp": return `${v.toFixed(2)}%`;
    case "bpday": return `${v.toFixed(1)} bp/day`;
    default: return v.toFixed(2);
  }
}
// a change in the gauge's own units (a flow measured in percent is a percent change)
function fmtChange(g, v) {
  if (!fin(v)) return "—";
  if (g.kind === "flow" && g.chgHow === "pct") return `${sgn(v)}${Math.abs(v * 100).toFixed(1)}%`;
  switch (g.fmt) {
    case "bn": return `${sgn(v)}${bnFmt(Math.abs(v)).replace("−", "")}`;
    case "pct": case "pctpt": return `${sgn(v)}${Math.abs(v).toFixed(1)} pt`;
    case "bp": return `${sgn(v)}${Math.round(Math.abs(v))} bp`;
    case "pp": return `${sgn(v)}${Math.round(Math.abs(v * 100))} bp`;
    case "bpday": return `${sgn(v)}${Math.abs(v).toFixed(1)}`;
    default: return `${sgn(v)}${Math.abs(v).toFixed(2)}`;
  }
}

function Chip({ grade }) {
  const [label, color] = GRADE[grade] || GRADE.none;
  return <span className="otag" style={{ display: "inline-flex", alignItems: "center", gap: 5, borderColor: color, color: "var(--text-primary)", whiteSpace: "nowrap" }}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />{label}</span>;
}

// the past six months of grades as a row of small squares, oldest first
function GradeStrip({ grades }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }} role="img" aria-label={`grades over the past ${grades.length} weeks`}>
      {grades.map((g, k) => <i key={k} title={GRADE[g]?.[0]} style={{ width: 4, height: 12, borderRadius: 1, background: GRADE[g]?.[1] || "var(--border-subtle)", opacity: g === "neutral" ? 0.45 : 1, display: "inline-block" }} />)}
    </span>
  );
}

function Section({ id, title, summary, open, onToggle, children }) {
  return (
    <section id={`lq-${id}`} style={{ borderTop: "1px solid var(--border-subtle)", scrollMarginTop: 70 }}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "none", border: 0, padding: "8px 2px", cursor: "pointer", textAlign: "left", color: "var(--text-primary)" }}>
        <span aria-hidden="true" style={{ width: 12, color: "var(--text-muted)", fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        <strong style={{ font: `600 13px ${fonts.heading}`, minWidth: 170 }}>{title}</strong>
        <span style={{ flex: "1 1 300px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono }}>{summary}</span>
      </button>
      {open && <div style={{ padding: "2px 2px 12px 22px" }}>{children}</div>}
    </section>
  );
}

function GaugeTable({ gauges }) {
  const [show, setShow] = useState(null);
  return (
    <div className="otable-wrap">
      <table className="otable">
        <thead><tr><th style={{ textAlign: "left" }}>Gauge</th><th style={{ textAlign: "right" }}>Reading</th><th style={{ textAlign: "right" }}>13 wk</th><th style={{ textAlign: "right" }}>52 wk</th><th style={{ textAlign: "left" }}>Grade</th><th style={{ textAlign: "left" }}>Past 26 wk</th><th style={{ textAlign: "left" }}>3 years</th><th style={{ textAlign: "left" }}>Full chart</th></tr></thead>
        <tbody>{gauges.map(g => (
          <React.Fragment key={g.id}>
            <tr className="oclick" onClick={() => setShow(show === g.id ? null : g.id)} title="Show what it says and the grading rule">
              <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 190, fontFamily: "var(--font-body)", color: "var(--text-primary)" }}>{g.label}{g.composite && <span className="otag" style={{ marginLeft: 5 }} title="In the composite">C</span>}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{g.asOf ? `week of ${fmtDay(g.asOf)}` : ""}</div></td>
              <td style={{ textAlign: "right" }}>{fmtValue(g)}</td>
              <td style={{ textAlign: "right" }}>{fmtChange(g, g.change13)}</td>
              <td style={{ textAlign: "right" }}>{fmtChange(g, g.change52)}</td>
              <td style={{ textAlign: "left" }}><Chip grade={g.grade} />{fin(g.z) && <span style={{ marginLeft: 5, fontSize: 10.5, color: "var(--text-muted)" }}>{sgn(g.z)}{Math.abs(g.z).toFixed(1)}σ</span>}</td>
              <td style={{ textAlign: "left" }}><GradeStrip grades={g.grades} /></td>
              <td style={{ textAlign: "left" }}><Spark values={g.series.map(p => p[1])} width={90} height={22} color={GRADE[g.grade]?.[1] || "var(--text-secondary)"} /></td>
              <td style={{ textAlign: "left", fontFamily: "var(--font-body)", color: "var(--text-secondary)", fontSize: 11 }}>{g.home}</td>
            </tr>
            {show === g.id && <tr><td colSpan={8} style={{ textAlign: "left", whiteSpace: "normal", padding: "4px 8px 9px 22px", fontFamily: "var(--font-body)", fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
              {g.says && <div style={{ color: "var(--text-primary)" }}>{g.says}</div>}
              {g.rule && <div style={{ marginTop: 2 }}><span style={{ color: "var(--text-muted)" }}>Rule: </span>{g.rule}</div>}
            </td></tr>}
          </React.Fragment>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function LiquidityTab() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [open, setOpen] = useState(loadOpen), [range, setRange] = useState(520), [nlRange, setNlRange] = useState(260);
  const root = useRef(null);
  useEffect(() => { let live = true; fetch("/api/liquidity").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  const toggle = id => setOpen(o => { const n = { ...o, [id]: !o[id] }; saveOpen(n); return n; });
  const jump = id => { setOpen(o => { const n = { ...o, [id]: true }; saveOpen(n); return n; }); setTimeout(() => root.current?.querySelector(`#lq-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
  const comp = useMemo(() => (d ? d.history.filter(r => fin(r[1])).slice(-range).map(r => ({ d: r[0], c: r[1], i: r[2] })) : []), [d, range]);
  const nl = useMemo(() => (d ? d.netLiquidity.slice(-nlRange).map(r => ({ d: r[0], net: r[1], res: r[2], tga: r[3], rrp: r[4], assets: r[5] })) : []), [d, nlRange]);
  if (err) return <Panel title="Liquidity"><div style={{ ...note, padding: 12 }}>The liquidity read could not be built: {err}</div></Panel>;
  if (!d) return <Panel title="Liquidity"><div style={{ ...note, padding: "24px 6px", textAlign: "center" }}>Reading the Fed, money markets, banks, Treasuries, credit and the dollar…</div></Panel>;

  const by = Object.fromEntries(d.gauges.map(g => [g.id, g])), G = id => by[id];
  const vTone = VERDICT_TONE[d.verdict] || "var(--text-muted)";
  const contracting = d.gauges.filter(g => g.grade === "contracting"), expanding = d.gauges.filter(g => g.grade === "expanding");
  const lead26 = d.lead[26], easy = lead26?.bands[0], tight = lead26?.bands.at(-1);
  const nlLast = d.netLiquidity.at(-1), nlYear = d.netLiquidity.at(-53);
  const btn = on => ({ padding: "3px 9px", borderRadius: 6, cursor: "pointer", fontSize: 9.5, fontFamily: fonts.mono, border: `1px solid ${on ? "var(--oc-1)" : "var(--border-subtle)"}`, background: on ? "var(--oc-1)" : "transparent", color: on ? "#fff" : "var(--text-secondary)" });
  const NlHover = ({ active, label: l }) => { const r = active && nl.find(x => x.d === l); if (!r) return null; return (
    <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "var(--text-secondary)" }}>
      <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 12 }}>{fmtDay(l)} · net liquidity {bnFmt(r.net)}</div>
      <div style={{ fontSize: 10.5, marginTop: 3 }}>total assets {bnFmt(r.assets)} − Treasury's account {bnFmt(r.tga)} − reverse repos {bnFmt(r.rrp)}</div>
      <div style={{ fontSize: 10.5 }}>reserve balances {bnFmt(r.res)}</div>
    </div>); };

  return (
    <div className="options-research" ref={root} style={{ fontFamily: "inherit" }}>
      <DenseHeader
        eyebrow="Liquidity · six layers from the Fed outward"
        headline={<>Liquidity is <span style={{ color: vTone }}>{d.verdict.toLowerCase()}</span>: composite {sgn(d.composite)}{Math.abs(d.composite ?? 0).toFixed(2)}, and its 13-week change {sgn(d.impulse)}{Math.abs(d.impulse ?? 0).toFixed(2)}. {d.counts.contracting} of {d.counts.graded} gauges are contracting, {d.counts.expanding} expanding.</>}
        blurb={`Tightening: ${contracting.map(g => short(g)).slice(0, 6).join("; ") || "none"}. Easing: ${expanding.map(g => short(g)).join("; ") || "none"}. Since ${d.history.find(r => fin(r[1]))?.[0].slice(0, 4)}, when the composite was above +0.5 the S&P 500 rose over the next 26 weeks ${Math.round((easy?.up || 0) * 100)}% of the time (median ${((easy?.median || 0) * 100).toFixed(1)}%); below −0.5, ${Math.round((tight?.up || 0) * 100)}% (median ${((tight?.median || 0) * 100).toFixed(1)}%).`}
        meta={<>week of {fmtDay(d.asOf)} · Fed {fmtDay(d.asOfBy.fed)} · SOFR {fmtDay(d.asOfBy.sofr)}<br />M2 {d.asOfBy.m2?.slice(0, 7)} · loan survey {d.asOfBy.standards?.slice(0, 7)} · FRED</>}
        chips={[
          chip("composite", `${sgn(d.composite)}${Math.abs(d.composite ?? 0).toFixed(2)}`, vTone, `impulse ${sgn(d.impulse)}${Math.abs(d.impulse ?? 0).toFixed(2)} over 13 wk`),
          G("netLiquidity") && chip("net liquidity", fmtValue(G("netLiquidity")), GRADE[G("netLiquidity").grade][1], `${fmtChange(G("netLiquidity"), G("netLiquidity").change52)} over a year`),
          G("reserveShare") && chip("reserves / bank assets", fmtValue(G("reserveShare")), GRADE[G("reserveShare").grade][1], "ample above 13%, scarce below 11%"),
          G("rrpBuffer") && chip("reverse-repo buffer", fmtValue(G("rrpBuffer")), GRADE[G("rrpBuffer").grade][1], G("rrpBuffer").value < 50 ? "drained" : "still absorbing"),
          G("sofrIorb") && chip("SOFR − reserve rate", fmtValue(G("sofrIorb")), GRADE[G("sofrIorb").grade][1], "positive = cash scarce"),
          G("realM2") && chip("real M2, a year", fmtValue(G("realM2")), GRADE[G("realM2").grade][1], `as of ${d.asOfBy.m2?.slice(0, 7)}`),
          G("dollar") && chip("broad dollar, 13 wk", fmtChange(G("dollar"), G("dollar").change13), GRADE[G("dollar").grade][1], "up = tighter for the world"),
        ].filter(Boolean)}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
        {d.layers.map(l => { const t = l.verdict === "expanding" ? "var(--oc-1)" : l.verdict === "contracting" ? "var(--oc-2)" : "var(--text-muted)"; return (
          <button key={l.id} type="button" onClick={() => jump(l.id)} title={l.reads} style={{ textAlign: "left", cursor: "pointer", background: "var(--card-bg)", border: "1px solid var(--border-subtle)", borderLeft: `3px solid ${t}`, borderRadius: 8, padding: "7px 9px", color: "var(--text-primary)" }}>
            <div style={{ font: `600 12px ${fonts.heading}` }}>{l.label}</div>
            <div style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", marginTop: 2 }}>{l.verdict} · {l.expanding}↑ {l.neutral}· {l.contracting}↓</div>
          </button>); })}
      </div>

      <Panel title="The composite and its impulse" right={<span style={{ display: "inline-flex", gap: 4 }}>{RANGES.map(([k, n]) => <button key={k} type="button" onClick={() => setRange(n)} style={btn(range === n)}>{k}</button>)}</span>}>
        <div style={{ display: "flex", gap: 14, fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", marginBottom: 2 }}>
          <span><i style={{ display: "inline-block", width: 14, borderTop: "2px solid var(--oc-1)", verticalAlign: "middle", marginRight: 5 }} />composite (+ = easier)</span>
          <span><i style={{ display: "inline-block", width: 14, borderTop: "2px dashed var(--text-secondary)", verticalAlign: "middle", marginRight: 5 }} />impulse: its change over 13 weeks</span>
        </div>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={comp} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={x => x.slice(0, 7)} minTickGap={50} />
            <YAxis tick={axis} axisLine={false} tickLine={false} domain={[-2, 2]} />
            <ReferenceLine y={0} stroke="var(--text-muted)" />
            <ReferenceLine y={0.5} stroke="var(--oc-1)" strokeDasharray="2 4" />
            <ReferenceLine y={-0.5} stroke="var(--oc-2)" strokeDasharray="2 4" />
            <Tooltip contentStyle={tip} labelFormatter={fmtDay} formatter={(v, n) => [fin(v) ? v.toFixed(2) : "—", n]} />
            <Line dataKey="c" name="Composite" stroke="var(--oc-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="i" name="Impulse" stroke="var(--text-secondary)" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="otable-wrap" style={{ marginTop: 8 }}>
          <table className="otable">
            <thead><tr><th style={{ textAlign: "left" }}>Composite at the time</th>{[13, 26].map(h => <th key={h} style={{ textAlign: "right" }}>S&amp;P next {h} wk, median · up</th>)}<th style={{ textAlign: "right" }}>Weeks</th></tr></thead>
            <tbody>{d.lead[26].bands.map((b, k) => <tr key={b.label}><td style={{ textAlign: "left", fontFamily: "var(--font-body)" }}>{b.label}</td>{[13, 26].map(h => { const x = d.lead[h].bands[k]; return <td key={h} style={{ textAlign: "right" }}>{fin(x.median) ? `${sgn(x.median)}${Math.abs(x.median * 100).toFixed(1)}%` : "—"} · {fin(x.up) ? `${Math.round(x.up * 100)}%` : "—"}</td>; })}<td style={{ textAlign: "right" }}>{b.weeks}</td></tr>)}</tbody>
          </table>
        </div>
        <Note>The composite averages the gauges marked C below, each a 13-week move scored against its own past three years, signed so + is easier. Correlation with the next 13 weeks of the S&amp;P 500: {d.lead[13].corr?.toFixed(2)}; with the next 26: {d.lead[26].corr?.toFixed(2)} ({d.spxSource}). Overlapping windows: a tendency, not a forecast.</Note>
      </Panel>

      <Panel title="Net liquidity: the Fed's assets less the Treasury's account and reverse repos" right={<span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>{nlLast ? `${bnFmt(nlLast[1])} · ${nlYear ? `${fmtChange({ fmt: "bn" }, nlLast[1] - nlYear[1])} on the year` : ""}` : ""}{[["1Y", 52], ["5Y", 260], ["10Y", 520], ["All", 99999]].map(([k, n]) => <button key={k} type="button" onClick={() => setNlRange(n)} style={btn(nlRange === n)}>{k}</button>)}</span>}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={nl} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={x => x.slice(0, 7)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}T`} domain={["auto", "auto"]} />
            <Tooltip content={<NlHover />} />
            <Line dataKey="net" name="Net liquidity" stroke="var(--oc-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <Note>A market shorthand, not an official measure: the part of the Fed's balance sheet left circulating as bank reserves and currency. It moved here from Fed balance sheet, which keeps the accounts line by line. Its 13-week change is the first gauge in the central-bank layer below.</Note>
      </Panel>

      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "4px 12px 4px" }}>
        {d.layers.map(l => { const mine = d.gauges.filter(g => g.layer === l.id); return (
          <Section key={l.id} id={l.id} title={l.label} open={!!open[l.id]} onToggle={toggle}
            summary={<><span style={{ color: l.verdict === "expanding" ? "var(--oc-1)" : l.verdict === "contracting" ? "var(--oc-2)" : "var(--text-secondary)", fontWeight: 600 }}>{l.verdict}</span>
              {mine.map(g => <span key={g.id} title={`${g.label}: ${GRADE[g.grade][0]}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: GRADE[g.grade][1], opacity: g.grade === "neutral" ? 0.5 : 1 }} />{short(g)} {fmtValue(g)}</span>)}</>}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-body)", margin: "0 0 6px" }}>{l.reads}</div>
            <GaugeTable gauges={mine} />
          </Section>); })}
        <Section id="method" title="Method and sources" open={!!open.method} onToggle={toggle} summary={<span>how gauges are graded, what the composite is, what the lead test can and cannot say</span>}>
          <ul style={{ ...note, fontSize: 11, margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {d.method.map((m, k) => <li key={k}>{m}</li>)}
            <li>Grading thresholds are this dashboard's judgment, printed with each gauge (click a row) so they can be argued with.</li>
            <li>Source: {d.source}. The Tightening monitor keeps its own board for auctions and foreign buyers.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
