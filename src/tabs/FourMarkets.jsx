import React, { useEffect, useMemo, useRef, useState } from "react";
import { finite, C, VizCard, Kpi, Seg, Legend, Spark } from "./options/ui.jsx";
import "./options/OptionsResearch.css";
import { CELL_ORDER, CELL_COLOR, STATE, CURVE_COLOR, TURN_COLOR, Chip, ScoreBar } from "./regime/shared.jsx";

// ============================================================================
// FOUR MARKETS — Regime Map → Four markets: the macro read, in the manner Stanley Druckenmiller
// describes: stocks, bonds, currencies and commodities read together, the
// markets as the forecast, liquidity first, the trend respected, and position
// size set by how clear the picture is. The rules are this dashboard's.
//   header     the regime (easing or tightening × improving or deteriorating),
//              clarity and the stance it maps to, beside the Cockpit's own
//              valuation lens; then a row of links to every section
//   sections   each opens and closes, and shows a one-line summary when closed:
//     markets      one per market: the chart read (trend, breakout, momentum,
//                  rank among the four), the signals it gives with what each
//                  means for an equity book, and its instruments (sectors and
//                  regions; yields and bond funds; currencies one by one;
//                  metals, energy and baskets) with breakout, relative
//                  strength and a year's sparkline
//     curve        the yield-curve regime (bull or bear, steepening or
//                  flattening) over 13 and 4 weeks, two years of the 2s10s
//                  spread, every week since 1990, and what followed each
//     turn         the Fed turn: in a selloff, is the Fed blinking or holding
//                  firm? Three tells, the state, and every past episode
//     leaderboard  every instrument ranked by blended momentum
//     map          the liquidity-growth plane, and every week since 2000
//     playbook     what each market did next in each regime; did clarity help
//     method       the rules
// Which sections are open is remembered in this browser only.
// Data: /api/cross-asset (server/crossAsset.js). Supportive readings and
// strength are blue (--oc-1), headwinds and weakness orange (--oc-2); regimes
// use the four categorical slots in a fixed order. Every grade is written out.
// ============================================================================

const MARKETS = ["stocks", "bonds", "currencies", "commodities"];
const MARKET_NAME = { stocks: "Stocks", bonds: "Bonds", currencies: "Currencies", commodities: "Commodities" };
const EVENT_TONE = { "new-high": C[1], "cross-up": C[1], "near-high": C[1], "new-low": C[2], "cross-down": C[2], "near-low": C[2] };
const SECTIONS = [["stocks", "Stocks"], ["bonds", "Bonds"], ["currencies", "Currencies"], ["commodities", "Commodities"], ["curve", "Yield curve"], ["turn", "Fed turn"], ["leaders", "Momentum leaderboard"], ["map", "Liquidity × growth plane"], ["playbook", "Playbook"], ["method", "Method"]];
const STORE = "fourMarkets.open.v1";
const TELLS = [["twoYear", "2-year yield falling hard"], ["dollar", "Dollar rolling over"], ["curve", "Curve bull-steepening"]];
const pct = (v, dp = 0) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const bp = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v * 100))} bp` : "—");
const sc = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}` : "—");
const ord = n => { const t = n % 100; return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`; };
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const num = v => (!finite(v) ? "—" : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(v < 10 ? 4 : 2));
const tone = v => (!finite(v) || v === 0 ? "var(--text-muted)" : v > 0 ? C[1] : C[2]);
const left = { textAlign: "left" }, right = { textAlign: "right" };
// the breakout read in a few words, for the dense tables (the full sentence is the hover)
const SHORT = { "new-high": "New 52-wk high", "new-low": "New 52-wk low", "cross-up": "Above 40-wk avg", "cross-down": "Below 40-wk avg", "near-high": "Top of range", "near-low": "Bottom of range" };
const shortRead = b => (!b?.event ? "Inside range" : SHORT[b.event] + (b.cross && b.event.startsWith("cross") ? ` (${b.cross.weeksAgo ? `${b.cross.weeksAgo} wk ago` : "this wk"})` : ""));
const axisWord = (v, up, down) => (!finite(v) ? "unread" : Math.abs(v) < 0.25 ? `on the line, leaning ${v >= 0 ? up : down}` : v >= 0 ? up : down);
const loadOpen = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { return {}; } };
const saveOpen = o => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* private window: not remembered */ } };

// where the close sits in its 52-week range: a hairline from low to high and a dot
function RangeDot({ pos, width = 70 }) {
  if (!finite(pos)) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const x = 4 + pos * (width - 8);
  return (
    <svg width={width} height={12} role="img" aria-label={`${Math.round(pos * 100)}% of the way from the 52-week low to the high`} style={{ display: "block" }}>
      <line x1={4} x2={width - 4} y1={6} y2={6} stroke="var(--border-subtle)" strokeWidth={2} />
      <circle cx={x} cy={6} r={4} fill={pos >= 0.9 ? C[1] : pos <= 0.1 ? C[2] : "var(--text-secondary)"} stroke="var(--card-bg)" strokeWidth={1.5} />
    </svg>
  );
}

// two years of weekly prices with the 40-week average dashed
function PriceChart({ series, color }) {
  const pts = series.filter(p => finite(p[1]));
  if (pts.length < 10) return <div className="onote" style={{ height: 70 }}>Not enough history.</div>;
  const W = 260, H = 70, vals = pts.flatMap(p => [p[1], p[2]]).filter(finite), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = i => 2 + (i / (series.length - 1)) * (W - 4), y = v => 4 + (1 - (v - lo) / span) * (H - 8);
  const line = k => series.map((p, i) => (finite(p[k]) ? `${x(i)},${y(p[k])}` : null)).filter(Boolean).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Two years of weekly closes with the 40-week average" style={{ display: "block", height: H }}>
      <polyline points={line(2)} fill="none" stroke="var(--text-muted)" strokeWidth="1.2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <polyline points={line(1)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// a section that opens and closes; its summary line stays visible when closed
function Section({ id, title, summary, open, onToggle, children }) {
  return (
    <section id={`fm-${id}`} style={{ borderTop: "1px solid var(--border-subtle)", scrollMarginTop: 70 }}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "none", border: 0, padding: "8px 2px", cursor: "pointer", textAlign: "left", color: "var(--text-primary)" }}>
        <span aria-hidden="true" style={{ width: 12, color: "var(--text-muted)", fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        <strong style={{ font: "600 13.5px var(--font-body)", minWidth: 110 }}>{title}</strong>
        <span style={{ flex: "1 1 300px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--text-secondary)", fontFamily: "var(--font-number)" }}>{summary}</span>
      </button>
      {open && <div style={{ padding: "2px 2px 12px 22px" }}>{children}</div>}
    </section>
  );
}

function SignalList({ signals }) {
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {signals.map(s => (
        <div key={s.id} style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-body)" }}>{s.label} <span className="otag" style={{ marginLeft: 3 }}>{s.axis}</span></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ScoreBar v={s.score} /><span style={{ width: 38, textAlign: "right", fontSize: 11, fontFamily: "var(--font-number)", color: "var(--text-secondary)" }}>{sc(s.score)}</span></span>
          </div>
          {s.says ? <>
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45, marginTop: 2 }}>{s.says}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-primary)", lineHeight: 1.45 }}><span style={{ color: "var(--text-muted)" }}>For an equity book: </span>{s.equity}</div>
          </> : <div className="onote">No reading yet.</div>}
        </div>
      ))}
    </div>
  );
}

// the instruments under a market, grouped; yields get their own columns
function InstrumentTable({ rows, showRs, total }) {
  const groups = [...new Set(rows.map(r => r.group))];
  const yields = rows[0]?.kind === "yield";
  return (
    <div className="otable-wrap">
      <table className="otable">
        <thead>{yields
          ? <tr><th style={left}>Yield</th><th style={right}>Level</th><th style={right}>13 wk</th><th style={right}>52 wk</th><th style={left}>52-wk range</th><th style={left}>Year</th><th style={left}>Read</th></tr>
          : <tr><th style={left}>Instrument</th><th style={right}>Last</th><th style={right}>13 wk</th><th style={right}>26 wk</th><th style={right}>52 wk</th><th style={left}>Trend</th><th style={left}>Breakout read</th><th style={left}>52-wk range</th><th style={left}>Year</th><th style={right} title={`Blended momentum rank among ${total} instruments`}>Mom. rank</th>{showRs && <th style={right} title="13-week move against the S&P 500">vs S&amp;P</th>}</tr>}</thead>
        <tbody>{groups.map(g => (
          <React.Fragment key={g}>
            <tr><td colSpan={yields ? 7 : showRs ? 11 : 10} style={{ ...left, background: "var(--bg-subtle)", fontFamily: "var(--font-body)", fontWeight: 600, color: "var(--text-primary)", fontSize: 11.5 }}>{g}</td></tr>
            {rows.filter(r => r.group === g).map(r => yields ? (
              <tr key={r.id}>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{r.label}</td>
                <td style={right}>{finite(r.level) ? `${r.level.toFixed(2)}%` : "—"}</td>
                <td style={{ ...right, color: tone(r.change13) }}>{bp(r.change13)}</td>
                <td style={{ ...right, color: tone(r.change52) }}>{bp(r.change52)}</td>
                <td style={left}><RangeDot pos={r.pos} /></td>
                <td style={left}><Spark values={r.spark} width={80} height={20} color="var(--text-secondary)" /></td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{r.read || "—"}</td>
              </tr>
            ) : (
              <tr key={r.id}>
                <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 150 }}>{r.label} <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-number)", fontSize: 10.5 }}>{r.src === "fmp" ? r.id : ""}{r.invert ? "per $" : ""}</span></td>
                <td style={right}>{num(r.level)}</td>
                <td style={{ ...right, color: tone(r.trend?.m13) }}>{pct(r.trend?.m13, 1)}</td>
                <td style={{ ...right, color: tone(r.trend?.m26) }}>{pct(r.trend?.m26, 1)}</td>
                <td style={{ ...right, color: tone(r.trend?.m52) }}>{pct(r.trend?.m52, 1)}</td>
                <td style={left}>{r.trend ? <Chip label={STATE[r.trend.state][0]} color={STATE[r.trend.state][1]} /> : "—"}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: r.breakout?.event ? "var(--text-primary)" : "var(--text-muted)" }} title={[r.breakout?.label, r.beatsCash === false && r.trend?.m26 > 0 ? "up over 26 weeks, but by less than a 3-month bill paid" : null].filter(Boolean).join("; ") || undefined}>{r.breakout?.event && <i aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: EVENT_TONE[r.breakout.event], marginRight: 5 }} />}{shortRead(r.breakout)}{r.beatsCash === false && r.trend?.m26 > 0 ? <span style={{ color: "var(--text-muted)" }}> · trails cash</span> : null}</td>
                <td style={left}><RangeDot pos={r.breakout?.pos} /></td>
                <td style={left}><Spark values={r.spark} width={80} height={20} color={STATE[r.trend?.state]?.[1] || "var(--text-secondary)"} /></td>
                <td style={right}>{r.rank ? ord(r.rank) : "—"}</td>
                {showRs && <td style={{ ...right, color: tone(r.rs?.change13) }} title={r.rs?.newHigh ? "Its ratio to the S&P 500 is at a 52-week high" : undefined}>{r.rs ? `${pct(r.rs.change13, 1)}${r.rs.newHigh ? " ▲" : r.rs.newLow ? " ▼" : ""}` : "—"}</td>}
              </tr>
            ))}
          </React.Fragment>
        ))}</tbody>
      </table>
    </div>
  );
}

// the plane: liquidity across, growth up; the last 26 weeks as a path ending at today
function RegimeMap({ history, cells }) {
  const W = 300, H = 230, pad = 26, X = v => pad + ((Math.max(-2, Math.min(2, v)) + 2) / 4) * (W - 2 * pad), Y = v => H - pad - ((Math.max(-2, Math.min(2, v)) + 2) / 4) * (H - 2 * pad);
  const path = history.slice(-26).filter(r => finite(r[1]) && finite(r[2])), last = path.at(-1);
  const corner = [["easing-improving", W - pad - 4, pad + 12, "end"], ["easing-deteriorating", W - pad - 4, H - pad - 6, "end"], ["tightening-improving", pad + 4, pad + 12, "start"], ["tightening-deteriorating", pad + 4, H - pad - 6, "start"]];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Liquidity against growth, the past six months" style={{ display: "block", maxWidth: 380 }}>
      {corner.map(([k, x, y, a]) => <text key={k} x={x} y={y} textAnchor={a} style={{ fontSize: 9.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{cells[k].label}</text>)}
      <line x1={X(0)} x2={X(0)} y1={pad - 6} y2={H - pad + 6} stroke="var(--text-muted)" />
      <line x1={pad - 6} x2={W - pad + 6} y1={Y(0)} y2={Y(0)} stroke="var(--text-muted)" />
      <text x={W - pad + 4} y={Y(0) + 14} textAnchor="end" style={{ fontSize: 9, fill: "var(--text-secondary)", fontFamily: "var(--font-number)" }}>easier money →</text>
      <text x={X(0) + 4} y={pad - 10} style={{ fontSize: 9, fill: "var(--text-secondary)", fontFamily: "var(--font-number)" }}>↑ stronger growth ahead</text>
      <polyline points={path.map(r => `${X(r[1])},${Y(r[2])}`).join(" ")} fill="none" stroke="var(--text-secondary)" strokeWidth="1.2" opacity="0.6" />
      {path.slice(0, -1).map((r, i) => <circle key={r[0]} cx={X(r[1])} cy={Y(r[2])} r={2.2} fill="var(--text-secondary)" opacity={0.25 + (0.6 * i) / path.length}><title>{`${day(r[0])}: liquidity ${sc(r[1])}, growth ${sc(r[2])}`}</title></circle>)}
      {last && <circle cx={X(last[1])} cy={Y(last[2])} r={6} fill={CELL_COLOR[CELL_ORDER[last[4]]] || "var(--text-primary)"} stroke="var(--card-bg)" strokeWidth={2}><title>{`${day(last[0])}: liquidity ${sc(last[1])}, growth ${sc(last[2])}`}</title></circle>}
    </svg>
  );
}

// every week since 2000 as a thin band coloured by regime, with clarity as the band's height
function HistoryStrip({ history, cells }) {
  const rows = history.filter(r => r[4] != null), W = 640, H = 46, bw = W / rows.length;
  const years = rows.map((r, i) => [r[0].slice(0, 4), i]).filter(([y], i, a) => i === 0 || y !== a[i - 1][0]).filter(([y]) => +y % 4 === 0);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img" aria-label="Regime by week since 2000; taller marks are clearer weeks" style={{ display: "block", height: H + 14 }}>
        {rows.map((r, i) => { const h = 8 + ((r[3] ?? 0) / 100) * (H - 8); return <rect key={r[0]} x={i * bw} y={H - h} width={bw + 0.3} height={h} fill={CELL_COLOR[CELL_ORDER[r[4]]]}><title>{`${day(r[0])}: ${cells[CELL_ORDER[r[4]]].label}, clarity ${r[3] ?? "—"}`}</title></rect>; })}
        {years.map(([y, i]) => <text key={y} x={i * bw} y={H + 11} style={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{y}</text>)}
      </svg>
      <Legend items={CELL_ORDER.map(k => [cells[k].label, CELL_COLOR[k]])} />
    </div>
  );
}

// one label per week, as far back as the record goes, as a thin coloured band
function LabelStrip({ rows, colors, names, title }) {
  const W = 640, H = 22, bw = W / Math.max(1, rows.length);
  const years = rows.map((r, i) => [r[0].slice(0, 4), i]).filter(([y], i, a) => i === 0 || y !== a[i - 1][0]).filter(([y]) => +y % 4 === 0);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img" aria-label={title} style={{ display: "block", height: H + 14 }}>
      {rows.map((r, i) => <rect key={r[0]} x={i * bw} y={0} width={bw + 0.3} height={H} fill={colors[r[1]]}><title>{`${day(r[0])}: ${names[r[1]]?.label}`}</title></rect>)}
      {years.map(([y, i]) => <text key={y} x={i * bw} y={H + 11} style={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{y}</text>)}
    </svg>
  );
}

// two years of the 10-year minus 2-year spread, the zero line, and the 13-week regime as a band underneath
function CurveChart({ series, regimes }) {
  const [hover, setHover] = useState(null);
  const pts = series.filter(p => finite(p[1]));
  if (pts.length < 10) return <div className="onote" style={{ height: 90 }}>Not enough history.</div>;
  const W = 300, H = 92, band = 8, vals = [...pts.map(p => p[1]), 0], lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = i => 2 + (i / (series.length - 1)) * (W - 4), y = v => 4 + (1 - (v - lo) / span) * (H - band - 12), bw = (W - 4) / series.length;
  const h = hover != null ? series[hover] : null;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="The 10-year minus 2-year Treasury spread over two years, with the curve regime underneath" style={{ display: "block", height: H }}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - r.left) / r.width) * (series.length - 1))))); }} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--text-muted)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <polyline points={series.map((p, i) => (finite(p[1]) ? `${x(i)},${y(p[1])}` : null)).filter(Boolean).join(" ")} fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {series.map((p, i) => p[2] && <rect key={p[0]} x={2 + i * bw} y={H - band} width={bw + 0.3} height={band} fill={CURVE_COLOR[p[2]]} />)}
        {h && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--text-muted)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div style={{ fontSize: 11, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 16 }}>{h ? <>{day(h[0])}: 2s10s <b style={{ color: "var(--text-primary)" }}>{finite(h[1]) ? `${h[1].toFixed(2)} pp` : "—"}</b>{h[2] ? ` · ${regimes[h[2]].label}` : ""}</> : <>10-year minus 2-year over two years; the dashed line is zero (inverted below it). Hover for a week.</>}</div>
    </div>
  );
}

// what each market did over the next 26 weeks after every past week with each label
function BookTable({ book, order, names, colors, current, first }) {
  return (
    <div className="otable-wrap">
      <table className="otable">
        <thead><tr><th style={left}>{first}</th><th style={right}>Share of weeks</th><th style={right}>Episodes</th>{MARKETS.map(k => <th key={k} style={right}>{MARKET_NAME[k]} next 26 wk</th>)}</tr></thead>
        <tbody>{order.map(k => { const c = book[k]; return c && (
          <tr key={k} style={{ background: k === current ? "var(--bg-subtle)" : undefined }}>
            <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-primary)", fontWeight: k === current ? 600 : 400 }}><i aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: colors[k], marginRight: 6 }} />{names[k].label}{k === current ? " (now)" : ""}</td>
            <td style={right}>{finite(c.share) ? `${Math.round(c.share * 100)}%` : "—"}</td><td style={right}>{c.runs}</td>
            {MARKETS.map(m => <td key={m} style={right} title={`${c.markets[m].n} weeks`}>{pct(c.markets[m].median, 1)}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>up {finite(c.markets[m].up) ? Math.round(c.markets[m].up * 100) : "—"}%</div></td>)}
          </tr>); })}</tbody>
      </table>
    </div>
  );
}

export default function FourMarkets({ erp }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [open, setOpen] = useState(loadOpen), [leadFilter, setLeadFilter] = useState("");
  const root = useRef(null);
  useEffect(() => { let live = true; fetch("/api/cross-asset").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  const byMarket = useMemo(() => (d ? Object.fromEntries(d.markets.map(m => [m.market, m])) : {}), [d]);
  const toggle = id => setOpen(o => { const n = { ...o, [id]: !o[id] }; saveOpen(n); return n; });
  const setAll = v => { const n = Object.fromEntries(SECTIONS.map(([id]) => [id, v])); saveOpen(n); setOpen(n); };
  const jump = id => { setOpen(o => { const n = { ...o, [id]: true }; saveOpen(n); return n; }); setTimeout(() => root.current?.querySelector(`#fm-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
  if (err) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Four markets</h3><p className="ocard-finding">The cross-asset read could not be built: {err}</p></section></div>;
  if (!d) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Four markets</h3><p className="onote">Reading stocks, bonds, currencies and commodities… (the first build fetches 27 years of history and can take a minute)</p></section></div>;

  const n = d.now, cellColor = CELL_COLOR[n.cell], here = d.playbook.cells[n.cell];
  const liqSig = d.signals.filter(s => s.axis === "liquidity" && finite(s.score)), grSig = d.signals.filter(s => s.axis === "growth" && finite(s.score));
  const dissent = [...liqSig.filter(s => Math.sign(s.score) !== Math.sign(n.liquidity)), ...grSig.filter(s => Math.sign(s.score) !== Math.sign(n.growth))];
  const erpPct = erp?.percentile, paid = finite(erpPct) ? (erpPct >= 60 ? "well paid" : erpPct <= 40 ? "poorly paid" : "fairly paid") : null;
  const highClar = d.playbook.clarity.at(-1), lowClar = d.playbook.clarity[0];
  const inst = m => d.instruments.filter(x => x.market === m);
  const leaders = d.instruments.filter(x => x.rank && (!leadFilter || x.market === leadFilter)).sort((a, b) => a.rank - b.rank);
  const cv = d.curve, tn = d.turn;
  const breakouts = d.instruments.filter(x => x.breakout?.newHigh).length, breakdowns = d.instruments.filter(x => x.breakout?.newLow).length;

  const marketSummary = m => {
    const mk = byMarket[m], t = mk?.trend, list = inst(m).filter(x => x.kind !== "yield"), sig = d.signals.filter(s => s.market === m && finite(s.score));
    const up = list.filter(x => x.trend?.state === "uptrend").length, highs = list.filter(x => x.breakout?.newHigh).length, lows = list.filter(x => x.breakout?.newLow).length;
    return <>
      {t && <Chip label={STATE[t.state][0]} color={STATE[t.state][1]} />}
      {mk?.breakout?.event && <Chip label={mk.breakout.label.split(":")[0].replace(/ its 40-week average.*/, " 40-wk avg")} color={EVENT_TONE[mk.breakout.event]} />}
      {t && <span>26 wk <b style={{ color: tone(t.m26) }}>{pct(t.m26, 1)}</b> · 52 wk <b style={{ color: tone(t.m52) }}>{pct(t.m52, 1)}</b></span>}
      {mk?.rank && <span>{ord(mk.rank)} of 4 on momentum</span>}
      {sig.length > 0 && <span>signals {sig.filter(s => s.score > 0).length} supportive / {sig.filter(s => s.score < 0).length} headwind</span>}
      {list.length > 0 && <span>{up} of {list.length} in uptrends{highs ? ` · ${highs} new high${highs === 1 ? "" : "s"}` : ""}{lows ? ` · ${lows} new low${lows === 1 ? "" : "s"}` : ""}</span>}
    </>;
  };

  return (
    <div className="options-research" ref={root}>
      <VizCard eyebrow={`Stocks · bonds · currencies · commodities · weekly to ${day(d.asOf)}`} title="Four markets: is the wind at your back, and how sure can you be?"
        finding={`${n.cellLabel}, for ${n.weeksInCell} week${n.weeksInCell === 1 ? "" : "s"}: liquidity ${axisWord(n.liquidity, "easing", "tightening")} (${sc(n.liquidity)}), growth signals ${axisWord(n.growth, "improving", "deteriorating")} (${sc(n.growth)}). Clarity ${n.clarity} of 100${dissent.length ? `, held down by ${dissent.length} signal${dissent.length === 1 ? "" : "s"} pointing the other way (${dissent.slice(0, 4).map(s => s.label).join("; ")}${dissent.length > 4 ? "; and more" : ""})` : ""}. ${paid ? `Your valuation lens says equities are ${paid} (ERP in the ${erpPct}th percentile); ` : ""}this read says ${n.stance?.label.toLowerCase()}.`}
        style={{ marginBottom: 0 }}>
        <div className="okpis" style={{ marginBottom: 8 }}>
          <Kpi label="Regime" value={n.cellLabel} sub={`since ${day(n.since)}`} tone={cellColor} />
          <Kpi label="Stance" value={n.stance?.label || "—"} sub={n.stance?.note} />
          <Kpi label="Clarity" value={`${n.clarity}/100`} sub={`liquidity signals agree ${Math.round((n.liqAgree || 0) * 100)}%, growth ${Math.round((n.growthAgree || 0) * 100)}%${n.flips ? `; ${n.flips} regime change${n.flips === 1 ? "" : "s"} in 8 weeks` : ""}`} />
          {finite(erpPct) && <Kpi label="Paid to own stocks?" value={`${erpPct}th pct`} sub={`equity risk premium ${erp.currentErp > 0 ? "+" : ""}${erp.currentErp?.toFixed(2)}pp: valuation, not timing`} />}
          {here && <Kpi label="Stocks after this regime" value={pct(here.markets.stocks.median, 1)} sub={`median next 26 weeks, up ${Math.round((here.markets.stocks.up || 0) * 100)}% of the time (${here.runs} episodes)`} />}
          {d.turn?.now && <Kpi label="Fed turn" value={d.turn.states[d.turn.now.state].label} sub={`S&P ${pct(d.turn.now.drawdown, 1)} from its 52-week high; ${d.turn.now.n} of 3 tells`} tone={d.turn.now.state === "calm" ? undefined : TURN_COLOR[d.turn.now.state]} />}
          {d.curve?.now?.r13 && <Kpi label="Yield curve, 13 wk" value={d.curve.regimes[d.curve.now.r13].label} sub={`2-yr ${bp(d.curve.now.m13.y2)}, 10-yr ${bp(d.curve.now.m13.y10)}`} tone={d.curve.now.r13 === "none" ? undefined : CURVE_COLOR[d.curve.now.r13]} />}
          <Kpi label="Breakouts / breakdowns" value={`${breakouts} / ${breakdowns}`} sub={`new 52-week highs and lows among ${d.instruments.filter(x => x.kind !== "yield").length} instruments`} />
        </div>

        <nav aria-label="Four markets sections" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "4px 0 6px" }}>
          {SECTIONS.map(([id, label]) => <button key={id} type="button" className="ochip" aria-pressed={!!open[id]} onClick={() => jump(id)}>{label}</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" className="ochip" onClick={() => setAll(true)}>Open all</button>
          <button type="button" className="ochip" onClick={() => setAll(false)}>Close all</button>
        </nav>

        {MARKETS.map(m => byMarket[m] && (
          <Section key={m} id={m} title={MARKET_NAME[m]} summary={marketSummary(m)} open={!!open[m]} onToggle={toggle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 14, marginBottom: 10 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-secondary)" }}><span>{byMarket[m].label}: {byMarket[m].note}</span><span>{byMarket[m].breakout?.label || "Inside its range"}</span></div>
                <PriceChart series={byMarket[m].series} color={STATE[byMarket[m].trend?.state]?.[1] || "var(--text-secondary)"} />
                {byMarket[m].trend && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, fontFamily: "var(--font-number)", color: "var(--text-secondary)" }}>
                  <span>vs 40-wk avg <b style={{ color: "var(--text-primary)" }}>{pct(byMarket[m].trend.vsMa, 1)}</b></span>
                  <span>13 wk <b style={{ color: "var(--text-primary)" }}>{pct(byMarket[m].trend.m13, 1)}</b></span>
                  <span>from high <b style={{ color: "var(--text-primary)" }}>{pct(byMarket[m].trend.fromHigh, 1)}</b></span>
                  <span>52-wk range <RangeDot pos={byMarket[m].breakout?.pos} width={60} /></span>
                </div>}
                {m === "commodities" && finite(d.context?.oil?.change13) && <div className="onote" style={{ marginTop: 4 }}>Oil is listed below and not graded as a signal: it moves on supply as much as on demand.</div>}
              </div>
              <SignalList signals={d.signals.filter(s => s.market === m)} />
            </div>
            {m === "bonds" && <div style={{ marginBottom: 10 }}><InstrumentTable rows={inst(m).filter(x => x.kind === "yield")} total={d.ranked} /></div>}
            <InstrumentTable rows={inst(m).filter(x => x.kind !== "yield")} showRs={m === "stocks"} total={d.ranked} />
            {m === "currencies" && <p className="onote" style={{ marginTop: 4 }}>Each currency's reads are on its value in dollars, so up means it strengthened against the dollar; the last price is shown as quoted (per $ where marked).</p>}
            {m === "stocks" && <p className="onote" style={{ marginTop: 4 }}>vs S&amp;P: the 13-week move against the S&amp;P 500; ▲ marks a ratio at a 52-week high, the classic relative-strength breakout.</p>}
          </Section>
        ))}

        {cv && <Section id="curve" title="Yield curve" open={!!open.curve} onToggle={toggle}
          summary={<>
            <Chip label={cv.regimes[cv.now.r13 || "none"].label} color={CURVE_COLOR[cv.now.r13 || "none"]} />
            <span>13 wk: 2-yr <b style={{ color: "var(--text-primary)" }}>{bp(cv.now.m13.y2)}</b>, 10-yr <b style={{ color: "var(--text-primary)" }}>{bp(cv.now.m13.y10)}</b></span>
            <span>2s10s {finite(cv.now.slope) ? `${cv.now.slope.toFixed(2)} pp` : "—"} ({bp(cv.now.slope13)} in 13 wk)</span>
            <span>4 wk: {cv.regimes[cv.now.r4 || "none"].label.toLowerCase()}</span>
          </>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 14, marginBottom: 10 }}>
            <CurveChart series={cv.series} regimes={cv.regimes} />
            <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
              <p style={{ margin: "0 0 6px" }}>To {day(cv.asOf)}: <b style={{ color: "var(--text-primary)" }}>{cv.regimes[cv.now.r13 || "none"].label}</b> over 13 weeks{cv.now.weeks > 1 ? `, ${cv.now.weeks} weeks running` : ", as of this week"}: the 2-year moved {bp(cv.now.m13.y2)} and the 10-year {bp(cv.now.m13.y10)}. {cv.regimes[cv.now.r13 || "none"].says}</p>
              <p style={{ margin: "0 0 6px", color: "var(--text-primary)" }}><span style={{ color: "var(--text-muted)" }}>For an equity book: </span>{cv.regimes[cv.now.r13 || "none"].equity}</p>
              <p style={{ margin: 0 }}>Over the last 4 weeks: {cv.regimes[cv.now.r4 || "none"].label.toLowerCase()} (2-year {bp(cv.now.m4.y2)}, 10-year {bp(cv.now.m4.y10)}). The 4-week read catches a turn first; the 13-week read is the regime.</p>
            </div>
          </div>
          <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>The 13-week curve regime, every week since {cv.history[0]?.[0].slice(0, 4)}</div>
          <LabelStrip rows={cv.history} colors={CURVE_COLOR} names={cv.regimes} title="The yield-curve regime by week" />
          <Legend items={cv.order.map(k => [cv.regimes[k].label, CURVE_COLOR[k]])} />
          <div style={{ marginTop: 8 }}><BookTable book={cv.book} order={cv.order} names={cv.regimes} colors={CURVE_COLOR} current={cv.now.r13} first="Curve regime" /></div>
          <p className="onote">Median return over the 26 weeks after every past week in each regime, and how often it was positive; episodes are the separate runs. Bull steepening has been the worst for stocks because it usually arrives with a recession under way: the front end falls because the Fed is cutting into trouble. It becomes the turn worth waiting for only after the selloff has happened (see Fed turn).</p>
        </Section>}

        {tn?.now && <Section id="turn" title="Fed turn" open={!!open.turn} onToggle={toggle}
          summary={<>
            <Chip label={tn.states[tn.now.state].label} color={TURN_COLOR[tn.now.state]} />
            <span>S&amp;P <b style={{ color: "var(--text-primary)" }}>{pct(tn.now.drawdown, 1)}</b> from its 52-week high</span>
            <span>tells {tn.now.n} of 3</span>
            {tn.lastBlink && <span>last blink {day(tn.lastBlink)}</span>}
          </>}>
          <p style={{ margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>As of {day(tn.asOf)} (the latest close, not just last Friday): <b style={{ color: "var(--text-primary)" }}>{tn.states[tn.now.state].label}</b>{tn.now.weeks > 1 ? ` for ${tn.now.weeks} weeks (since ${day(tn.now.since)})` : ""}. {tn.states[tn.now.state].says} Druckenmiller's question in a selloff is not whether stocks are weak but what the weakness does to the Fed; the turn has historically come when the Fed stops tightening into it.</p>
          <div className="otable-wrap" style={{ marginBottom: 8 }}>
            <table className="otable">
              <thead><tr><th style={left}>Condition</th><th style={left}>Reading</th><th style={left}>Rule</th><th style={left}>Met</th></tr></thead>
              <tbody>
                <tr><td style={{ ...left, fontFamily: "var(--font-body)" }}>Stocks under pressure</td><td style={left}>S&amp;P 500 {pct(tn.now.drawdown, 1)} from its 52-week high</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{Math.round(-tn.rules.stress * 100)}% or more below</td><td style={left}>{tn.now.stress ? "yes" : "no"}</td></tr>
                {TELLS.map(([k, label]) => (
                  <tr key={k}><td style={{ ...left, fontFamily: "var(--font-body)" }}>Tell: {label}</td>
                    <td style={left}>{k === "twoYear" ? `2-year ${bp(tn.now.y2chg)} over ${tn.rules.twoYearWeeks} weeks` : k === "dollar" ? `${pct(tn.now.dollarVsMa, 1)} vs 40-wk avg, ${pct(tn.now.dollar13, 1)} over 13 wk` : `13 wk: ${cv.regimes[cv.now.r13 || "none"].label.toLowerCase()}; 4 wk: ${cv.regimes[cv.now.r4 || "none"].label.toLowerCase()}`}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{k === "twoYear" ? `down ${Math.round(-tn.rules.twoYear * 100)} bp or more` : k === "dollar" ? "below the average and falling" : "bull steepening over either span"}</td>
                    <td style={left}>{tn.now.tells[k] == null ? "—" : tn.now.tells[k] ? "yes" : "no"}</td></tr>
                ))}
                <tr><td style={{ ...left, fontFamily: "var(--font-body)" }}>No cuts priced or made</td><td style={left}>2-year {finite(tn.now.y2) ? `${tn.now.y2.toFixed(2)}%` : "—"} vs fed funds {finite(tn.now.ff) ? `${tn.now.ff.toFixed(2)}%` : "—"} ({bp(tn.now.gap)})</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>2-year at or above fed funds less {Math.round(-tn.rules.firmGap * 100)} bp; fed funds not cut {Math.round(-tn.rules.cut * 100)} bp in {tn.rules.cutWeeks} weeks{tn.now.cutting ? " (it has been)" : ""}; not at the zero bound</td><td style={left}>{tn.now.firm ? "yes" : "no"}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>The state, every week since {tn.history[0]?.[0].slice(0, 4)}</div>
          <LabelStrip rows={tn.history} colors={TURN_COLOR} names={tn.states} title="The Fed-turn state by week" />
          <Legend items={tn.order.map(k => [tn.states[k].label, TURN_COLOR[k]])} />
          <div className="otable-wrap" style={{ marginTop: 8 }}>
            <table className="otable">
              <thead><tr><th style={left}>Episode began</th><th style={left}>State</th><th style={right}>S&amp;P from high</th><th style={right}>Tells</th><th style={right}>S&amp;P next 13 wk</th><th style={right}>26 wk</th><th style={right}>52 wk</th><th style={right}>Worst within 26 wk</th></tr></thead>
              <tbody>{["blink", "firm"].flatMap(k => tn.episodes[k].map(e => ({ ...e, k }))).sort((a, b) => a.d.localeCompare(b.d)).map(e => (
                <tr key={e.k + e.d}>
                  <td style={left}>{day(e.d)}</td>
                  <td style={left}><Chip label={tn.states[e.k].label} color={TURN_COLOR[e.k]} /></td>
                  <td style={right}>{pct(e.drawdown, 1)}</td><td style={right}>{e.tells}</td>
                  <td style={{ ...right, color: tone(e.f13) }}>{pct(e.f13, 1)}</td><td style={{ ...right, color: tone(e.f26) }}>{pct(e.f26, 1)}</td><td style={{ ...right, color: tone(e.f52) }}>{pct(e.f52, 1)}</td>
                  <td style={{ ...right, color: tone(e.worst26) }}>{pct(e.worst26, 1)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <p className="onote">After the Fed blinked ({tn.record.blink.n} episodes) the S&amp;P's median 26-week return was {pct(tn.record.blink.median26, 1)}, up {Math.round((tn.record.blink.up26 || 0) * 100)}% of the time; after it held firm ({tn.record.firm.n}), {pct(tn.record.firm.median26, 1)}, up {Math.round((tn.record.firm.up26 || 0) * 100)}% of the time. Too few episodes for a rule, and the exceptions teach the most: a blink with the economy already breaking (late 2000, early 2008) came too late to stop the fall. The turn is necessary, not sufficient.</p>
        </Section>}

        <Section id="leaders" title="Momentum leaderboard" open={!!open.leaders} onToggle={toggle}
          summary={<>
            <span>Strongest: <b style={{ color: "var(--text-primary)" }}>{leaders[0]?.label}</b> {pct(leaders[0]?.momentum, 1)}</span>
            <span>Weakest: <b style={{ color: "var(--text-primary)" }}>{d.instruments.filter(x => x.rank).sort((a, b) => b.rank - a.rank)[0]?.label}</b></span>
            <span>Four markets: {d.markets.filter(x => x.rank).sort((a, b) => a.rank - b.rank).map(x => MARKET_NAME[x.market]).join(" > ")}</span>
          </>}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <span className="onote">Blended momentum: the average of the 13, 26 and 52-week returns. A 3-month bill paid {pct(d.cash26, 1)} over 26 weeks.</span>
            <Seg label="Market" value={leadFilter} onChange={setLeadFilter} options={[["", "All"], ...MARKETS.map(k => [k, MARKET_NAME[k]])]} />
          </div>
          <div className="otable-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
            <table className="otable">
              <thead><tr><th style={right}>#</th><th style={left}>Instrument</th><th style={left}>Market</th><th style={right}>Blended</th><th style={right}>13 wk</th><th style={right}>26 wk</th><th style={right}>52 wk</th><th style={left}>Beats cash</th><th style={left}>Trend</th><th style={left}>Breakout read</th></tr></thead>
              <tbody>{leaders.map(x => (
                <tr key={x.id}>
                  <td style={{ ...right, color: "var(--text-muted)" }}>{x.rank}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)" }}>{x.label}</td>
                  <td style={{ ...left, color: "var(--text-secondary)" }}>{MARKET_NAME[x.market]}</td>
                  <td style={{ ...right, color: tone(x.momentum), fontWeight: 600 }}>{pct(x.momentum, 1)}</td>
                  <td style={{ ...right, color: tone(x.trend?.m13) }}>{pct(x.trend?.m13, 1)}</td>
                  <td style={{ ...right, color: tone(x.trend?.m26) }}>{pct(x.trend?.m26, 1)}</td>
                  <td style={{ ...right, color: tone(x.trend?.m52) }}>{pct(x.trend?.m52, 1)}</td>
                  <td style={left}>{x.beatsCash == null ? "—" : x.beatsCash ? "yes" : "no"}</td>
                  <td style={left}>{x.trend ? <Chip label={STATE[x.trend.state][0]} color={STATE[x.trend.state][1]} /> : "—"}</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: x.breakout?.event ? "var(--text-primary)" : "var(--text-muted)" }} title={x.breakout?.label || undefined}>{shortRead(x.breakout)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>

        <Section id="map" title="Liquidity × growth plane" open={!!open.map} onToggle={toggle}
          summary={<><Chip label={n.cellLabel} color={cellColor} /><span>liquidity {sc(n.liquidity)} · growth {sc(n.growth)}</span><span>{n.weeksInCell} weeks in this regime</span></>}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <RegimeMap history={d.history} cells={d.cells} />
            <div style={{ flex: "1 1 240px", fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
              <p style={{ margin: "0 0 6px" }}>Across: liquidity, the average of {liqSig.length} signals ({sc(n.liquidity)}). Up: growth ahead as the markets price it, the average of {grSig.length} ({sc(n.growth)}). The dots are the past six months, faint to strong.</p>
              <p style={{ margin: 0 }}>Druckenmiller's best-known rule sits on this plane: the strongest equity markets come when money is easing and the economy ahead is improving; the hardest when money tightens into weakness. The playbook shows what the record since 2000 says about each corner.</p>
            </div>
          </div>
          <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Every week since 2000 · colour is the regime, height is clarity</div>
          <HistoryStrip history={d.history} cells={d.cells} />
        </Section>

        <Section id="playbook" title="Playbook" open={!!open.playbook} onToggle={toggle}
          summary={<><span>In this regime stocks returned a median {pct(here?.markets.stocks.median, 1)} over 26 weeks</span><span>clear weeks called direction {Math.round((highClar.pointedRight || 0) * 100)}% vs {Math.round((lowClar.pointedRight || 0) * 100)}%</span></>}>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Regime</th><th style={right}>Share of weeks</th><th style={right}>Episodes</th>{MARKETS.map(k => <th key={k} style={right}>{MARKET_NAME[k]} next 26 wk</th>)}</tr></thead>
              <tbody>{CELL_ORDER.map(k => { const c = d.playbook.cells[k]; return (
                <tr key={k} style={{ background: k === n.cell ? "var(--bg-subtle)" : undefined }}>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-primary)", fontWeight: k === n.cell ? 600 : 400 }}><i aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: CELL_COLOR[k], marginRight: 6 }} />{d.cells[k].label}{k === n.cell ? " (now)" : ""}</td>
                  <td style={right}>{finite(c.share) ? `${Math.round(c.share * 100)}%` : "—"}</td><td style={right}>{c.runs}</td>
                  {MARKETS.map(m => <td key={m} style={right} title={`${c.markets[m].n} weeks; mean ${pct(c.markets[m].mean, 1)}`}>{pct(c.markets[m].median, 1)}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>up {finite(c.markets[m].up) ? Math.round(c.markets[m].up * 100) : "—"}%</div></td>)}
                </tr>); })}</tbody>
            </table>
          </div>
          <p className="onote">Median return over the 26 weeks after every past week in each regime, and how often it was positive. Stocks: S&amp;P 500; bonds: long Treasuries; currencies: the dollar; commodities: a broad basket. Episodes is the honest count of separate data points.</p>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Clarity</th><th style={right}>Weeks</th><th style={right}>Stocks, median next 26 wk</th><th style={right}>Spread</th><th style={right}>Worst</th><th style={right}>Growth axis pointed the right way</th></tr></thead>
              <tbody>{d.playbook.clarity.map(b => <tr key={b.label}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{b.label}</td><td style={right}>{b.weeks}</td><td style={right}>{pct(b.median, 1)}</td><td style={right}>{pct(b.spread, 1)}</td><td style={right}>{pct(b.worst, 1)}</td><td style={right}>{finite(b.pointedRight) ? `${Math.round(b.pointedRight * 100)}%` : "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="onote">In clear weeks the growth axis called the direction of the next 26 weeks of stocks {Math.round((highClar.pointedRight || 0) * 100)}% of the time against {Math.round((lowClar.pointedRight || 0) * 100)}% in murky ones, and the worst outcome was {pct(highClar.worst, 0)} against {pct(lowClar.worst, 0)}. Clear weeks are rare ({highClar.weeks} of them): a tendency, not a rule.</p>
        </Section>

        <Section id="method" title="Method" open={!!open.method} onToggle={toggle} summary={<span>how each signal, breakout and ranking is computed; what this is not</span>}>
          <ul className="onote" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
            {d.method.map((m, i) => <li key={i}>{m}</li>)}
            <li>The framing follows what Druckenmiller has said in public over many years (liquidity over earnings, markets as the forecast, the trend, size by conviction); the signals, thresholds and weights are this dashboard's choices, not his.</li>
            <li>Source: {d.source}.{d.errors?.length ? ` Feeds that failed this build (older prices used): ${d.errors.join("; ")}.` : ""}</li>
          </ul>
        </Section>
      </VizCard>
    </div>
  );
}
