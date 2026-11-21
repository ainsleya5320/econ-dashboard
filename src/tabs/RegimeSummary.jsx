import React, { useEffect, useState } from "react";
import { finite, C, Spark } from "./options/ui.jsx";
import "./options/OptionsResearch.css";
import { CELL_ORDER, CELL_COLOR, STATE, CURVE_COLOR, TURN_COLOR, REG_COLOR, Chip, ScoreBar } from "./regime/shared.jsx";

// ============================================================================
// REGIME SUMMARY — the Cockpit's one-card read of the Regime Map page, in the
// order the questions get asked:
//   the wind       where the week sits on the liquidity × growth plane, and
//                  the path it took to get there
//   how sure       clarity on a 0–100 bar cut into the four stances, what this
//                  regime did for stocks before, and whether stocks pay (ERP)
//   the Fed        in a selloff, is the Fed blinking: the trigger and three
//                  tells as a checklist; the yield-curve regime and 2s10s
//   four markets   stocks, bonds, the dollar, commodities: trend, two years of
//                  price, returns, the breakout read, signals for and against
//   signal tape    all twelve signals on one scale, liquidity then growth
//   seen before    the analog regime, the three closest periods, and the S&P's
//                  path after the ten closest
// Everything here is a summary: the charts, tables, rules and records live on
// the Regime Map page, which every block links to. Data: /api/cross-asset and
// /api/regime-analogs.
// ============================================================================

const SIGNAL = { policy: "Cuts priced (2-yr vs fed funds)", realYield: "Real 10-year yield", netLiquidity: "Fed net liquidity", dollar: "Dollar", yen: "Yen carry", copperGold: "Copper vs gold", credit: "Baa credit spread", yield10: "10-year yield", cyclicals: "Cyclicals vs defensives", smallCaps: "Small caps vs S&P", transports: "Transports vs S&P", banks: "Regional banks vs S&P" };
const CELL_MINI = { "easing-improving": "Easing · recovery", "easing-deteriorating": "Easing · slowdown", "tightening-improving": "Tightening · strength", "tightening-deteriorating": "Tightening · weakness" };
const FED_SAYS = { blink: "the Fed is blinking", firm: "the Fed is holding firm", testing: "the Fed is undecided" };
const MARKET_NAME = { stocks: "Stocks", bonds: "Bonds", currencies: "Dollar", commodities: "Commodities" };
const SHORT = { "new-high": "new 52-wk high", "new-low": "new 52-wk low", "cross-up": "back above 40-wk avg", "cross-down": "broke 40-wk avg", "near-high": "top of range", "near-low": "bottom of range" };
const pct = (v, dp = 1) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const bp = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v * 100))} bp` : "—");
const sc = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}` : "—");
const share = v => (finite(v) ? `${Math.round(v * 100)}%` : "—");
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const mon = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—");
const tone = v => (!finite(v) || v === 0 ? "var(--text-muted)" : v > 0 ? C[1] : C[2]);
const word = (v, up, down) => (!finite(v) ? "unread" : Math.abs(v) < 0.25 ? "flat" : v > 0 ? up : down);
const box = { border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "9px 11px 10px", minWidth: 0 };
const small = { fontSize: 11.5, lineHeight: 1.5, color: "var(--text-secondary)" };
const strong = { color: "var(--text-primary)", fontWeight: 600 };
const numFont = { fontFamily: "var(--font-number)" };

function Head({ children, right }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}><span className="ocard-eyebrow">{children}</span>{right}</div>;
}

// the liquidity × growth plane: the past 26 weeks as a path, today as the dot, today's quadrant tinted
function Plane({ d }) {
  const W = 250, H = 168, pad = 12, X = v => pad + ((Math.max(-2, Math.min(2, v)) + 2) / 4) * (W - 2 * pad), Y = v => H - pad - ((Math.max(-2, Math.min(2, v)) + 2) / 4) * (H - 2 * pad);
  const path = d.history.slice(-26).filter(r => finite(r[1]) && finite(r[2])), n = d.now, east = n.liquidity >= 0, north = n.growth >= 0;
  const corner = { "easing-improving": [W - pad - 3, pad + 10, "end"], "easing-deteriorating": [W - pad - 3, H - pad - 5, "end"], "tightening-improving": [pad + 3, pad + 10, "start"], "tightening-deteriorating": [pad + 3, H - pad - 5, "start"] };
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Liquidity ${sc(n.liquidity)} against growth ${sc(n.growth)}: ${n.cellLabel}`} style={{ display: "block", maxWidth: 300 }}>
      <rect x={east ? X(0) : pad} y={north ? pad : Y(0)} width={(W - 2 * pad) / 2} height={(H - 2 * pad) / 2} fill={CELL_COLOR[n.cell]} opacity="0.14" rx="4" />
      <line x1={X(0)} x2={X(0)} y1={pad} y2={H - pad} stroke="var(--text-muted)" opacity="0.7" />
      <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} stroke="var(--text-muted)" opacity="0.7" />
      {CELL_ORDER.map(k => <text key={k} x={corner[k][0]} y={corner[k][1]} textAnchor={corner[k][2]} style={{ fontSize: 9, fill: k === n.cell ? "var(--text-primary)" : "var(--text-muted)", fontWeight: k === n.cell ? 600 : 400, fontFamily: "var(--font-number)" }}>{CELL_MINI[k]}</text>)}
      <polyline points={path.map(r => `${X(r[1])},${Y(r[2])}`).join(" ")} fill="none" stroke="var(--text-secondary)" strokeWidth="1.3" opacity="0.7" strokeLinejoin="round" />
      {path.slice(0, -1).map((r, i) => <circle key={r[0]} cx={X(r[1])} cy={Y(r[2])} r={1.8} fill="var(--text-secondary)" opacity={0.2 + (0.6 * i) / path.length}><title>{`${day(r[0])}: liquidity ${sc(r[1])}, growth ${sc(r[2])}`}</title></circle>)}
      <circle cx={X(n.liquidity)} cy={Y(n.growth)} r={6} fill={CELL_COLOR[n.cell]} stroke="var(--card-bg)" strokeWidth="2"><title>{`Now: liquidity ${sc(n.liquidity)}, growth ${sc(n.growth)}`}</title></circle>
    </svg>
  );
}

// clarity, 0 to 100, on a bar cut at the stance thresholds; the marker is today
function ClarityBar({ clarity, stances }) {
  const bands = [...stances].sort((a, b) => a.min - b.min).map((s, i, a) => ({ ...s, to: a[i + 1]?.min ?? 100 }));
  return (
    <div role="img" aria-label={`Clarity ${clarity} of 100`} style={{ position: "relative", padding: "9px 0 0" }}>
      <div style={{ display: "flex", gap: 2 }}>
        {bands.map((b, i) => { const on = clarity >= b.min && clarity < (b.to === 100 ? 101 : b.to); return (
          <div key={b.label} style={{ flex: b.to - b.min, minWidth: 0 }} title={`${b.min} to ${b.to}: ${b.label}. ${b.note}`}>
            <div style={{ height: 8, borderRadius: 4, background: on ? "var(--text-primary)" : "var(--text-muted)", opacity: on ? 0.9 : 0.18 + i * 0.08 }} />
            <div style={{ fontSize: 9.5, marginTop: 3, color: on ? "var(--text-primary)" : "var(--text-muted)", fontWeight: on ? 600 : 400, fontFamily: "var(--font-number)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label.split(/[ :]/)[0]}</div>
          </div>); })}
      </div>
      <i aria-hidden="true" style={{ position: "absolute", top: 0, left: `calc(${Math.max(1, Math.min(99, clarity))}% - 5px)`, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "7px solid var(--text-primary)" }} />
    </div>
  );
}

// a met / not-met line: filled dot and "yes" when met, hollow and "no" when not
function Check({ met, label, reading }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 6, alignItems: "baseline", fontSize: 11.5 }}>
      <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", border: "1.5px solid var(--text-primary)", background: met ? "var(--text-primary)" : "transparent", opacity: met ? 1 : 0.5 }} />
      <span style={{ color: met ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: met ? 600 : 400 }}>{label}<span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {met == null ? "no reading" : met ? "yes" : "no"}</span></span>
      <span style={{ ...numFont, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{reading}</span>
    </div>
  );
}

// the S&P after the ten analogs: the 10–90 and 25–75 bands and the median, over 26 weeks
function MiniFan({ bands }) {
  const W = 270, H = 92, m = { l: 4, r: 50, t: 6, b: 14 }, v = bands.flatMap(b => [b.p10, b.p90]).filter(finite);
  const lo = Math.min(-0.02, ...v), hi = Math.max(0.02, ...v), x = h => m.l + (h / 26) * (W - m.l - m.r), y = q => m.t + (1 - (q - lo) / (hi - lo)) * (H - m.t - m.b);
  const area = (a, b) => [...bands.filter(r => finite(r[a])).map(r => `${x(r.h)},${y(r[a])}`), ...bands.filter(r => finite(r[b])).reverse().map(r => `${x(r.h)},${y(r[b])}`)].join(" ");
  const end = bands.at(-1);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`S&P 500 over the 26 weeks after the ten closest analogs: median ${pct(end.median)}`} style={{ display: "block", maxWidth: 330 }}>
      <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--text-muted)" strokeDasharray="3 3" />
      <polygon points={area("p10", "p90")} fill={C[1]} opacity="0.13"><title>{`10th to 90th percentile at six months: ${pct(end.p10)} to ${pct(end.p90)}`}</title></polygon>
      <polygon points={area("p25", "p75")} fill={C[1]} opacity="0.24"><title>{`Middle half at six months: ${pct(end.p25)} to ${pct(end.p75)}`}</title></polygon>
      <polyline points={bands.filter(b => finite(b.median)).map(b => `${x(b.h)},${y(b.median)}`).join(" ")} fill="none" stroke={C[1]} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={x(26)} cy={y(end.median)} r={3.5} fill={C[1]} stroke="var(--card-bg)" strokeWidth="1.5" />
      <text x={W - m.r + 6} y={y(end.median) + 3.5} style={{ fontSize: 11, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-number)" }}>{pct(end.median)}</text>
      {[[0, "now"], [13, "+3 mo"], [26, "+6 mo"]].map(([h, t]) => <text key={h} x={x(h)} y={H - 2} textAnchor={h === 0 ? "start" : h === 26 ? "end" : "middle"} style={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{t}</text>)}
    </svg>
  );
}

function OpenLink({ onClick, children }) {
  return <button type="button" onClick={onClick} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--text-secondary)", font: "500 11px var(--font-number)", whiteSpace: "nowrap" }}>{children} →</button>;
}

export default function RegimeSummary({ erp, onOpen }) {
  const [d, setD] = useState(null), [a, setA] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    fetch("/api/cross-asset").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message));
    fetch("/api/regime-analogs").then(r => r.json()).then(j => { if (live && !j.error) setA(j); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const open = v => () => onOpen?.("regime", v);
  if (err) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Regime</h3><p className="ocard-finding">The regime read could not be built: {err}</p></section></div>;
  if (!d) return <div className="options-research"><section className="ocard"><h3 className="ocard-title">Regime</h3><p className="onote">Reading stocks, bonds, currencies and commodities… (the first build of the day can take a minute)</p></section></div>;

  const n = d.now, tn = d.turn?.now, cv = d.curve?.now, here = d.playbook.cells[n.cell];
  const liq = d.signals.filter(s => s.axis === "liquidity"), gr = d.signals.filter(s => s.axis === "growth");
  const erpPct = erp?.percentile, paid = finite(erpPct) ? (erpPct >= 60 ? "well paid" : erpPct <= 40 ? "poorly paid" : "fairly paid") : null;
  const top = a?.analogs?.[0], o6 = a?.outcomes?.find(o => o.h === 26);
  const fed = tn ? d.turn.states[tn.state] : null;
  const headline = `${n.cellLabel}. Stance: ${n.stance?.label.toLowerCase() || "unread"}.`;
  return (
    <div className="options-research">
      <section className="ocard" style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div className="ocard-eyebrow">Regime · the four markets read together · to the close of {day(d.asOf)}</div>
          <OpenLink onClick={open("markets")}>Open the Regime Map</OpenLink>
        </div>
        <h3 className="ocard-title" style={{ marginTop: 2 }}><i aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: CELL_COLOR[n.cell], marginRight: 7 }} />{headline}</h3>
        <p className="ocard-finding" style={{ marginBottom: 10 }}>
          Money is {word(n.liquidity, "easing", "tightening")} ({sc(n.liquidity)}) and the growth signals are {word(n.growth, "improving", "deteriorating")} ({sc(n.growth)}), {n.weeksInCell} week{n.weeksInCell === 1 ? "" : "s"} in this corner. The signals {n.clarity >= 60 ? "agree strongly" : n.clarity >= 40 ? "mostly agree" : n.clarity >= 20 ? "are mixed" : "disagree"}: clarity {n.clarity} of 100.
          {tn ? ` The S&P is ${pct(tn.drawdown)} from its high; ${tn.stress ? `${FED_SAYS[tn.state]} (${tn.n} of 3 tells of a turn)` : "that is short of a selloff, so the Fed is not being tested"}.` : ""}
          {top ? ` The past 13 weeks most resemble ${mon(top.d)} (${Math.round(top.sim * 100)}% similar).` : ""}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(225px, 100%), 1fr))", gap: 10 }}>
          <div style={box}>
            <Head>1 · The wind</Head>
            <Plane d={d} />
            <div style={{ ...small, ...numFont, marginTop: 4 }}>→ easier money <b style={{ color: tone(n.liquidity) }}>{sc(n.liquidity)}</b> · ↑ stronger growth <b style={{ color: tone(n.growth) }}>{sc(n.growth)}</b><br />the line is the past six months</div>
          </div>

          <div style={box}>
            <Head>2 · How sure</Head>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: "700 22px var(--font-number)", color: "var(--text-primary)" }}>{n.clarity}<span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}> / 100</span></span>
              <span style={{ ...small, ...strong }}>{n.stance?.label}</span>
            </div>
            <ClarityBar clarity={n.clarity} stances={d.stances} />
            <div style={{ ...small, marginTop: 7 }}>
              Liquidity signals agree <b style={strong}>{share(n.liqAgree)}</b>, growth <b style={strong}>{share(n.growthAgree)}</b>{n.flips ? <>; the regime changed <b style={strong}>{n.flips}×</b> in 8 weeks</> : null}.
              {here && <><br />After this regime before: S&amp;P <b style={{ color: tone(here.markets.stocks.median) }}>{pct(here.markets.stocks.median)}</b> over 26 weeks (median), up {share(here.markets.stocks.up)}; {here.runs} episodes.</>}
              {paid && <><br />Paid to own stocks? <b style={strong}>{paid}</b>: equity risk premium in its {erpPct}th percentile.</>}
            </div>
          </div>

          <div style={box}>
            <Head>3 · The Fed and the curve</Head>
            {tn && <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}><Chip label={fed.label} color={TURN_COLOR[tn.state]} /><span style={{ ...small, ...numFont }}>{tn.n} of 3 tells</span></div>
              <div style={{ display: "grid", gap: 3 }}>
                <Check met={tn.stress} label="Selloff (8% off the high)" reading={pct(tn.drawdown)} />
                <Check met={tn.tells.twoYear} label="2-year falling hard" reading={`${bp(tn.y2chg)} / 8 wk`} />
                <Check met={tn.tells.dollar} label="Dollar rolling over" reading={`${pct(tn.dollar13)} / 13 wk`} />
                <Check met={tn.tells.curve} label="Bull steepening" reading={cv ? d.curve.regimes[cv.r13 || "none"].label.toLowerCase() : "—"} />
              </div>
              <div style={{ ...small, marginTop: 5 }}>The 2-year sits <b style={strong}>{bp(tn.gap)}</b> {tn.gap >= 0 ? "above" : "below"} fed funds: {tn.gap >= 0.1 ? "hikes priced" : tn.gap <= -0.1 ? "cuts priced" : "nothing priced"}.{d.turn.lastBlink ? ` Last blink ${mon(d.turn.lastBlink)}.` : ""}</div>
            </>}
            {cv && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 7, paddingTop: 7, borderTop: "1px solid var(--border-subtle)" }}>
              <Chip label={d.curve.regimes[cv.r13 || "none"].label} color={CURVE_COLOR[cv.r13 || "none"]} />
              <Spark values={d.curve.series.map(p => p[1])} width={70} height={20} color="var(--text-secondary)" ref0 />
              <span style={{ ...small, ...numFont }}>2s10s {finite(cv.slope) ? `${cv.slope.toFixed(2)} pp` : "—"} · 2-yr {bp(cv.m13.y2)}, 10-yr {bp(cv.m13.y10)} / 13 wk</span>
            </div>}
          </div>
        </div>

        <div style={{ margin: "10px 0 0" }}>
          <Head right={<OpenLink onClick={open("markets")}>Instruments, leaderboard, playbook</OpenLink>}>4 · The four markets</Head>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 10 }}>
            {d.markets.map(m => { const t = m.trend, sig = d.signals.filter(s => s.market === m.market && finite(s.score)), up = sig.filter(s => s.score > 0).length; return (
              <div key={m.market} style={box} title={`${m.label} (${m.note}). ${m.breakout?.label || "Inside its 52-week range."}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <strong style={{ font: "600 12.5px var(--font-body)", color: "var(--text-primary)" }}>{MARKET_NAME[m.market]}</strong>
                  {t && <Chip label={STATE[t.state][0]} color={STATE[t.state][1]} />}
                </div>
                <div style={{ margin: "5px 0 3px" }}><Spark values={m.series.map(p => p[1])} width={150} height={30} color={STATE[t?.state]?.[1] || "var(--text-secondary)"} /></div>
                <div style={{ ...small, ...numFont }}>13 wk <b style={{ color: tone(t?.m13) }}>{pct(t?.m13)}</b> · 26 wk <b style={{ color: tone(t?.m26) }}>{pct(t?.m26)}</b></div>
                <div style={{ ...small, ...numFont }}>{m.breakout?.event ? SHORT[m.breakout.event] : "inside its range"}{m.rank ? ` · ${["", "1st", "2nd", "3rd", "4th"][m.rank]} on momentum` : ""}</div>
                {sig.length > 0 && <div style={{ ...small, ...numFont }}>signals: <b style={strong}>{up}</b> supportive, <b style={strong}>{sig.length - up}</b> against</div>}
              </div>); })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(310px, 100%), 1fr))", gap: 10, marginTop: 10 }}>
          <div style={box}>
            <Head right={<span style={{ ...small, ...numFont, fontSize: 10.5 }}>← headwind · supportive →</span>}>5 · The signal tape</Head>
            {[["Liquidity", liq, n.liquidity], ["Growth ahead", gr, n.growth]].map(([name, list, avg]) => (
              <div key={name} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, ...numFont, color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: 2, marginBottom: 3 }}><span>{name}</span><span>average <b style={{ color: tone(avg) }}>{sc(avg)}</b></span></div>
                {list.map(s => (
                  <div key={s.id} title={s.says ? `${s.says} For an equity book: ${s.equity}` : "No reading yet."} style={{ display: "grid", gridTemplateColumns: "1fr 96px 40px", gap: 6, alignItems: "center", fontSize: 11.5, lineHeight: 1.55 }}>
                    <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{SIGNAL[s.id] || s.label}</span>
                    <ScoreBar v={s.score} width={96} />
                    <span style={{ ...numFont, textAlign: "right", color: "var(--text-secondary)" }}>{sc(s.score)}</span>
                  </div>))}
              </div>))}
            <div style={{ ...small, fontSize: 10.5, color: "var(--text-muted)" }}>Each is the 13-week move in units of its own usual move; hover a row for what it says.</div>
          </div>

          <div style={box}>
            <Head right={<OpenLink onClick={open("analogs")}>The map and all ten</OpenLink>}>6 · Seen before</Head>
            {!a ? <div className="onote">Comparing today with every 13-week window in the record…</div> : <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                <Chip label={a.now.label} color={REG_COLOR[a.now.regime]} />
                <span style={{ ...small, ...numFont }}>{a.now.led}-led · more violent than {share(a.now.intensityPct)} of windows</span>
              </div>
              <div style={{ display: "grid", gap: 2, marginBottom: 6 }}>
                {a.analogs.slice(0, 3).map(x => (
                  <div key={x.rank} title={`${a.regimes[x.regime].label}, ${x.led}-led`} style={{ display: "grid", gridTemplateColumns: "14px 68px 1fr 34px auto", gap: 6, alignItems: "center", fontSize: 11.5, ...numFont }}>
                    <span style={{ color: "var(--text-muted)" }}>{x.rank}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{mon(x.d)}</span>
                    <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--bg-subtle)" }}><span style={{ display: "block", height: 6, width: `${Math.round(x.sim * 100)}%`, borderRadius: 3, background: REG_COLOR[x.regime] }} /></span>
                    <span style={{ textAlign: "right", color: "var(--text-primary)" }}>{Math.round(x.sim * 100)}%</span>
                    <span style={{ color: "var(--text-secondary)" }}>then <b style={{ color: tone(x.f26) }}>{pct(x.f26)}</b> in 6 mo</span>
                  </div>))}
              </div>
              <div className="ocard-eyebrow" style={{ fontSize: 9.5, marginBottom: 2 }}>S&amp;P 500 after the ten closest · median and range</div>
              <MiniFan bands={a.bands} />
              <div style={{ ...small, marginTop: 4 }}>
                <b style={strong}>{a.now.stressAnalogs} of {a.now.analogs}</b> analogs were risk-off regimes. Median six months later <b style={{ color: tone(o6?.median) }}>{pct(o6?.median)}</b>, up {share(o6?.positive)}; from any week {pct(o6?.base.median)}, up {share(o6?.base.positive)}.
                <span style={{ color: "var(--text-muted)" }}> Analogs describe: they called direction {share(a.backtest.signHit)} of the time against {share(a.backtest.alwaysUp)} for always saying up.</span>
              </div>
            </>}
          </div>
        </div>
        {d.errors?.length > 0 && <p className="onote" style={{ marginTop: 6 }}>Some price feeds failed this build (older closes used): {d.errors.join("; ")}.</p>}
      </section>
    </div>
  );
}
