import React, { useEffect, useMemo, useState } from "react";
import { finite, C, VizCard, Kpi, Seg, Legend } from "./options/ui.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// FOUR MARKETS — the Cockpit's macro read, in the manner Stanley Druckenmiller
// describes: stocks, bonds, currencies and commodities read together, the
// markets as the forecast, liquidity first, the trend respected, and position
// size set by how clear the picture is. The rules are this dashboard's.
//   header     the regime (easing or tightening × improving or deteriorating),
//              clarity and the stance it maps to, beside the Cockpit's own
//              valuation lens: what you are paid, and how sure you can be
//   markets    one card per market: the chart read (price against its 40-week
//              average, momentum) and the signals it gives, each with what it
//              says and what it means for an equity book
//   map        the two axes as a plane with the past six months' path, and
//              every week since 2000 as a strip coloured by regime
//   playbook   what each market did over the next 26 weeks from past weeks in
//              each regime, and whether clarity helped
// Data: /api/cross-asset (server/crossAsset.js). Supportive readings are blue
// (--oc-1), headwinds orange (--oc-2); regimes use the four categorical slots
// in a fixed order. Every grade is also written out.
// ============================================================================

const CELL_ORDER = ["easing-improving", "easing-deteriorating", "tightening-improving", "tightening-deteriorating"];
const CELL_COLOR = { "easing-improving": "var(--oc-3)", "easing-deteriorating": "var(--oc-1)", "tightening-improving": "var(--oc-4)", "tightening-deteriorating": "var(--oc-2)" };
const MARKET_NAME = { stocks: "Stocks", bonds: "Bonds", currencies: "Currencies", commodities: "Commodities" };
const STATE = { uptrend: ["Uptrend", C[1]], downtrend: ["Downtrend", C[2]], "turning up": ["Turning up", "var(--text-muted)"], "turning down": ["Turning down", "var(--text-muted)"] };
const pct = (v, dp = 0) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const sc = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}` : "—");
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const left = { textAlign: "left" }, right = { textAlign: "right" };
// an axis near zero is on the line between two regimes, and says so
const axisWord = (v, up, down) => (!finite(v) ? "unread" : Math.abs(v) < 0.25 ? `on the line, leaning ${v >= 0 ? up : down}` : v >= 0 ? up : down);

// one score on the shared −2…+2 scale: blue to the right (supportive), orange to the left (a headwind)
function ScoreBar({ v, width = 110 }) {
  const mid = width / 2, s = x => (Math.min(2, Math.abs(x)) / 2) * (mid - 2);
  return (
    <svg width={width} height={12} role="img" aria-label={finite(v) ? `score ${sc(v)}` : "no reading"} style={{ display: "block" }}>
      <line x1={mid} x2={mid} y1={0} y2={12} stroke="var(--text-muted)" />
      {finite(v) && v !== 0 && <rect x={v > 0 ? mid + 1 : mid - 1 - s(v)} y={2} width={Math.max(2, s(v))} height={8} rx={2} fill={v > 0 ? C[1] : C[2]} />}
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

function MarketCard({ m, signals, oil }) {
  const t = m.trend, [stateLabel, stateColor] = STATE[t?.state] || ["No read", "var(--text-muted)"];
  const mine = signals.filter(s => s.market === m.market);
  return (
    <section style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div><strong style={{ font: "600 14px var(--font-body)", color: "var(--text-primary)" }}>{MARKET_NAME[m.market]}</strong> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.note}</span></div>
        <span className="otag" style={{ display: "inline-flex", alignItems: "center", gap: 5, borderColor: stateColor, color: "var(--text-primary)" }}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: stateColor, display: "inline-block" }} />{stateLabel}</span>
      </div>
      <PriceChart series={m.series} color={stateColor === "var(--text-muted)" ? "var(--text-secondary)" : stateColor} />
      {t && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, fontFamily: "var(--font-number)", color: "var(--text-secondary)", margin: "2px 0 6px" }}>
        <span title="Against its 40-week average">vs 40-wk avg <b style={{ color: "var(--text-primary)" }}>{pct(t.vsMa, 1)}</b></span>
        <span>13 wk <b style={{ color: "var(--text-primary)" }}>{pct(t.m13, 1)}</b></span>
        <span>26 wk <b style={{ color: "var(--text-primary)" }}>{pct(t.m26, 1)}</b></span>
        <span>52 wk <b style={{ color: "var(--text-primary)" }}>{pct(t.m52, 1)}</b></span>
        <span title="Distance from the 52-week high">from high <b style={{ color: "var(--text-primary)" }}>{pct(t.fromHigh, 1)}</b></span>
      </div>}
      <div style={{ display: "grid", gap: 7 }}>
        {mine.map(s => (
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
        {m.market === "commodities" && finite(oil?.change13) && <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6, fontSize: 11.5, color: "var(--text-secondary)" }}>Oil (WTI) ${oil.level} · {pct(oil.change13, 1)} over 13 weeks. <span style={{ color: "var(--text-muted)" }}>{oil.note}.</span></div>}
      </div>
    </section>
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
  const years = rows.map((r, i) => [r[0].slice(0, 4), i]).filter(([y], i, a) => i === 0 || y !== a[i - 1][0]).filter(([y]) => +y % 4 === 0)
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

export default function FourMarkets({ erp }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [show, setShow] = useState("markets");
  useEffect(() => { let live = true; fetch("/api/cross-asset").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  const byMarket = useMemo(() => (d ? Object.fromEntries(d.markets.map(m => [m.market, m])) : {}), [d]);
  if (err) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Four markets</h3><p className="ocard-finding">The cross-asset read could not be built: {err}</p></section></div>;
  if (!d) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Four markets</h3><p className="onote">Reading stocks, bonds, currencies and commodities… (the first build fetches 27 years of history and can take a minute)</p></section></div>;

  const n = d.now, cellColor = CELL_COLOR[n.cell], here = d.playbook.cells[n.cell];
  const liqSig = d.signals.filter(s => s.axis === "liquidity" && finite(s.score)), grSig = d.signals.filter(s => s.axis === "growth" && finite(s.score));
  const against = s => s.filter(x => Math.sign(x.score) !== Math.sign(s === liqSig ? n.liquidity : n.growth));
  const dissent = [...against(liqSig), ...against(grSig)];
  const erpPct = erp?.percentile, paid = finite(erpPct) ? (erpPct >= 60 ? "well paid" : erpPct <= 40 ? "poorly paid" : "fairly paid") : null;
  const highClar = d.playbook.clarity.at(-1), lowClar = d.playbook.clarity[0];

  return (
    <div className="options-research">
      <VizCard eyebrow={`Stocks · bonds · currencies · commodities · weekly to ${day(d.asOf)}`} title="Four markets: is the wind at your back, and how sure can you be?"
        finding={`${n.cellLabel}, for ${n.weeksInCell} week${n.weeksInCell === 1 ? "" : "s"}: liquidity ${axisWord(n.liquidity, "easing", "tightening")} (${sc(n.liquidity)}), growth signals ${axisWord(n.growth, "improving", "deteriorating")} (${sc(n.growth)}). Clarity ${n.clarity} of 100${dissent.length ? `, held down by ${dissent.length} signal${dissent.length === 1 ? "" : "s"} pointing the other way (${dissent.slice(0, 4).map(s => s.label).join("; ")}${dissent.length > 4 ? "; and more" : ""})` : ""}. ${paid ? `Your valuation lens says equities are ${paid} (ERP in the ${erpPct}th percentile); ` : ""}this read says ${n.stance?.label.toLowerCase()}.`}
        right={<Seg label="View" value={show} onChange={setShow} options={[["markets", "Four markets"], ["map", "Regime map"], ["playbook", "Playbook"]]} />}
        style={{ marginBottom: 0 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Regime" value={n.cellLabel} sub={`since ${day(n.since)}`} tone={cellColor} />
          <Kpi label="Stance" value={n.stance?.label || "—"} sub={n.stance?.note} />
          <Kpi label="Clarity" value={`${n.clarity}/100`} sub={`liquidity signals agree ${Math.round((n.liqAgree || 0) * 100)}%, growth ${Math.round((n.growthAgree || 0) * 100)}%${n.flips ? `; ${n.flips} regime change${n.flips === 1 ? "" : "s"} in 8 weeks` : ""}`} />
          {finite(erpPct) && <Kpi label="Paid to own stocks?" value={`${erpPct}th pct`} sub={`equity risk premium ${erp.currentErp > 0 ? "+" : ""}${erp.currentErp?.toFixed(2)}pp: valuation, not timing`} />}
          {here && <Kpi label="Stocks after this regime" value={pct(here.markets.stocks.median, 1)} sub={`median next 26 weeks, up ${Math.round((here.markets.stocks.up || 0) * 100)}% of the time (${here.runs} episodes)`} />}
        </div>

        {show === "markets" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 10 }}>
          {["stocks", "bonds", "currencies", "commodities"].map(k => byMarket[k] && <MarketCard key={k} m={byMarket[k]} signals={d.signals} oil={d.context?.oil} />)}
        </div>}

        {show === "map" && <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <RegimeMap history={d.history} cells={d.cells} />
            <div style={{ flex: "1 1 240px", fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
              <p style={{ margin: "0 0 6px" }}>Across: liquidity, the average of {liqSig.length} signals ({sc(n.liquidity)}). Up: growth ahead as the markets price it, the average of {grSig.length} ({sc(n.growth)}). The dots are the past six months, faint to strong.</p>
              <p style={{ margin: 0 }}>Druckenmiller's best-known rule sits on this plane: the strongest equity markets come when money is easing and the economy ahead is improving; the hardest when money tightens into weakness. The playbook tab shows what the record since 2000 says about each corner.</p>
            </div>
          </div>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Every week since 2000 · colour is the regime, height is clarity</div>
            <HistoryStrip history={d.history} cells={d.cells} />
          </div>
        </div>}

        {show === "playbook" && <div style={{ display: "grid", gap: 12 }}>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Regime</th><th style={right}>Share of weeks</th><th style={right}>Episodes</th>{["stocks", "bonds", "currencies", "commodities"].map(k => <th key={k} style={right}>{MARKET_NAME[k]} next 26 wk</th>)}</tr></thead>
              <tbody>{CELL_ORDER.map(k => { const c = d.playbook.cells[k]; return (
                <tr key={k} style={{ background: k === n.cell ? "var(--bg-subtle)" : undefined }}>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-primary)", fontWeight: k === n.cell ? 600 : 400 }}><i aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: CELL_COLOR[k], marginRight: 6 }} />{d.cells[k].label}{k === n.cell ? " (now)" : ""}</td>
                  <td style={right}>{finite(c.share) ? `${Math.round(c.share * 100)}%` : "—"}</td><td style={right}>{c.runs}</td>
                  {["stocks", "bonds", "currencies", "commodities"].map(m => <td key={m} style={right} title={`${c.markets[m].n} weeks; mean ${pct(c.markets[m].mean, 1)}`}>{pct(c.markets[m].median, 1)}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>up {finite(c.markets[m].up) ? Math.round(c.markets[m].up * 100) : "—"}%</div></td>)}
                </tr>); })}</tbody>
            </table>
          </div>
          <p className="onote" style={{ margin: 0 }}>Median return over the 26 weeks after every past week in each regime, and how often it was positive. Stocks: S&amp;P 500; bonds: long Treasuries; currencies: the dollar; commodities: a broad basket. One regime spans many overlapping weeks, so the episodes column is the honest count of separate data points.</p>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Clarity</th><th style={right}>Weeks</th><th style={right}>Stocks, median next 26 wk</th><th style={right}>Spread</th><th style={right}>Worst</th><th style={right}>Growth axis pointed the right way</th></tr></thead>
              <tbody>{d.playbook.clarity.map(b => <tr key={b.label}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{b.label}</td><td style={right}>{b.weeks}</td><td style={right}>{pct(b.median, 1)}</td><td style={right}>{pct(b.spread, 1)}</td><td style={right}>{pct(b.worst, 1)}</td><td style={right}>{finite(b.pointedRight) ? `${Math.round(b.pointedRight * 100)}%` : "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="onote" style={{ margin: 0 }}>Does doubt deserve its place? In clear weeks the growth axis called the direction of the next 26 weeks of stocks {Math.round((highClar.pointedRight || 0) * 100)}% of the time against {Math.round((lowClar.pointedRight || 0) * 100)}% in murky ones, and the worst outcome was {pct(highClar.worst, 0)} against {pct(lowClar.worst, 0)}. Clear weeks are rare ({highClar.weeks} of them), so read this as a tendency, not a rule.</p>
        </div>}

        <details style={{ marginTop: 10 }}>
          <summary className="onote" style={{ cursor: "pointer" }}>How this is read, and what it is not</summary>
          <ul className="onote" style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
            {d.method.map((m, i) => <li key={i}>{m}</li>)}
            <li>The framing follows what Druckenmiller has said in public over many years (liquidity over earnings, markets as the forecast, the trend, size by conviction); the signals, thresholds and weights are this dashboard's choices, not his.</li>
            <li>Source: {d.source}.{d.errors?.length ? ` Feeds that failed this build (older prices used): ${d.errors.join("; ")}.` : ""}</li>
          </ul>
        </details>
      </VizCard>
    </div>
  );
}
