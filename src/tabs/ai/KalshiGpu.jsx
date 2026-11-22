import React, { useEffect, useMemo, useState } from "react";
import { finite, C, VizCard, Legend, Spark } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// KALSHI GPU — AI Economy → Compute → GPU prices: what a prediction market
// expects a GPU-hour to rent for (server/kalshiGpu.js). Kalshi lists a ladder
// of "will the month's average be above $X" contracts for five chips, about
// ten months out, settled on the Ornn rental index. The price where the odds
// cross 50% is the market's median for that month.
//   tiles   one per chip: the month in progress, the index today, the curve
//   chart   the index's daily history, then one flat step per contract month
//           at the market's median. A solid step is read from resting quotes;
//           a dashed one from the last trade at each strike, which may be
//           months old. The shaded box is the range resting orders support.
//           On the H100 and B200 the CME futures marks ride along in grey —
//           a different index (Silicon Data), so a neighbour, not a twin.
//   table   every month: median, order-book range, how it was read, CME where
//           there is one, contracts traded and open.
// One chip at a time, because the five trade at prices 15× apart.
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const usd = v => (finite(v) ? `$${v.toFixed(2)}` : "—");
const int = v => (finite(v) ? Math.round(v).toLocaleString("en-US") : "—");
const monYear = m => (m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "—");
const monLong = m => (m ? `${LONG[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "—");
const dayShort = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}` : "—");
const mStart = m => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1), mEnd = m => Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1);
const quoted = m => m.read === "firm" || m.read === "quoted";
const left = { textAlign: "left" }, right = { textAlign: "right" };
const BAND = "color-mix(in srgb, var(--oc-2) 22%, transparent)";

const median = m => (finite(m.implied) ? usd(m.implied) : finite(m.floor) ? `above ${usd(m.floor)}` : finite(m.ceiling) ? `below ${usd(m.ceiling)}` : "no read");
const bounds = m => (finite(m.lo) && finite(m.hi) ? `${usd(m.lo)} – ${usd(m.hi)}` : finite(m.lo) ? `${usd(m.lo)} or more` : finite(m.hi) ? `${usd(m.hi)} or less` : "open");
const readFrom = m => (m.read === "firm" ? "tight quotes" : m.read === "quoted" ? `wide quotes${m.gaps ? ", gaps" : ""}` : m.read === "trades" ? `last trades${m.tradedOn ? `, ${dayShort(m.tradedOn)}` : ", undated"}${m.gaps ? ", gaps" : ""}` : finite(m.floor) || finite(m.ceiling) ? "every strike on one side of 50%" : "nothing quoted or traded");

function CurveChart({ chip, cme }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 300, mg = { l: 46, r: 10, t: 14, b: 24 };
  const months = chip.months, daily = chip.daily || [];
  const t0 = daily.length ? Date.parse(daily[0].d) : mStart(months[0].month), t1 = mEnd(months.at(-1).month), now = daily.length ? Date.parse(daily.at(-1).d) : null;
  const cmeIn = months.map(m => ({ month: m.month, v: cme?.[m.month] })).filter(x => finite(x.v));
  const vals = [...daily.map(p => p.v), ...months.flatMap(m => [m.implied, m.floor, m.ceiling, finite(m.lo) && finite(m.hi) ? m.lo : null, finite(m.lo) && finite(m.hi) ? m.hi : null]), ...cmeIn.map(x => x.v)].filter(finite);
  const vmin = Math.min(...vals), vmax = Math.max(...vals);
  const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5].find(s => (vmax - vmin) / s <= 6) || 5;
  const lo = Math.max(0, Math.floor((vmin - step * 0.25) / step) * step), hi = Math.ceil((vmax + step * 0.25) / step) * step;
  const x = t => mg.l + ((t - t0) / (t1 - t0)) * (W - mg.l - mg.r), y = v => mg.t + (1 - (v - lo) / (hi - lo)) * (H - mg.t - mg.b);
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const xt = []; for (let d = new Date(t0), k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); k < t1; k = Date.UTC(new Date(k).getUTCFullYear(), new Date(k).getUTCMonth() + 1, 1)) xt.push(k);
  const line = daily.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.d)).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const cmePath = cmeIn.map((p, i) => `${i ? "L" : "M"}${x(mStart(p.month)).toFixed(1)},${y(p.v).toFixed(1)}H${x(mEnd(p.month)).toFixed(1)}`).join("");
  const move = e => {
    const b = e.currentTarget.getBoundingClientRect(), t = t0 + (((e.clientX - b.left) / b.width) * W - mg.l) / (W - mg.l - mg.r) * (t1 - t0);
    const m = months.find(q => t >= mStart(q.month) && t < mEnd(q.month));
    if (m && (now == null || t > now)) return setHover({ m });
    if (!daily.length) return setHover(m ? { m } : null);
    let best = daily[0]; for (const p of daily) if (Math.abs(Date.parse(p.d) - t) < Math.abs(Date.parse(best.d) - t)) best = p;
    setHover({ p: best });
  };
  const num = { fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" };
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chip.label}: rental index by day and the market's median for each contract month`} style={{ display: "block" }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {ticks.map(v => <g key={v}><line x1={mg.l} x2={W - mg.r} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" /><text x={mg.l - 6} y={y(v) + 3.5} textAnchor="end" style={num}>${v.toFixed(2)}</text></g>)}
        {xt.map((k, i) => { const d = new Date(k), jan = d.getUTCMonth() === 0; return <g key={k}><line x1={x(k)} x2={x(k)} y1={H - mg.b} y2={H - mg.b + 3} stroke="var(--text-muted)" />{(i % 2 === 0 || jan) && <text x={x(k) + 3} y={H - 7} style={num}>{MON[d.getUTCMonth()]}{jan ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}</text>}</g>; })}
        {now != null && <g><line x1={x(now)} x2={x(now)} y1={mg.t} y2={H - mg.b} stroke="var(--text-muted)" strokeDasharray="2 3" /><text x={x(now) - 4} y={mg.t + 8} textAnchor="end" style={num}>index to {dayShort(daily.at(-1).d)}</text><text x={x(now) + 4} y={mg.t + 8} style={num}>contract months</text></g>}
        {months.map(m => finite(m.lo) && finite(m.hi) && <rect key={`b${m.month}`} x={x(mStart(m.month)) + 1} width={Math.max(1, x(mEnd(m.month)) - x(mStart(m.month)) - 2)} y={y(m.hi)} height={Math.max(1, y(m.lo) - y(m.hi))} fill={BAND} />)}
        {cmePath && <path d={cmePath} fill="none" stroke="var(--text-muted)" strokeWidth="1.25" />}
        {months.map(m => {
          const x1 = x(mStart(m.month)) + 1, x2 = x(mEnd(m.month)) - 1, dim = hover?.m && hover.m !== m ? 0.45 : 1;
          if (finite(m.implied)) return <line key={m.month} x1={x1} x2={x2} y1={y(m.implied)} y2={y(m.implied)} stroke="var(--oc-2)" strokeWidth={quoted(m) ? 3 : 2} strokeDasharray={quoted(m) ? "none" : "4 3"} strokeLinecap="butt" opacity={dim} />;
          const edge = finite(m.floor) ? m.floor : m.ceiling, up = finite(m.floor), cx = (x1 + x2) / 2;
          return finite(edge) && <g key={m.month} opacity={dim}><line x1={x1} x2={x2} y1={y(edge)} y2={y(edge)} stroke="var(--oc-2)" strokeWidth="1.5" strokeDasharray="1 3" /><path d={`M${cx - 4},${y(edge) + (up ? -4 : 4)}L${cx},${y(edge) + (up ? -11 : 11)}L${cx + 4},${y(edge) + (up ? -4 : 4)}Z`} fill="var(--oc-2)" /></g>;
        })}
        {line && <path d={line} fill="none" stroke="var(--oc-1)" strokeWidth="2" strokeLinejoin="round" />}
        {hover?.p && <circle cx={x(Date.parse(hover.p.d))} cy={y(hover.p.v)} r="4.5" fill="var(--oc-1)" stroke="var(--card-bg)" strokeWidth="2" />}
        {hover?.m && <rect x={x(mStart(hover.m.month))} width={x(mEnd(hover.m.month)) - x(mStart(hover.m.month))} y={mg.t} height={H - mg.t - mg.b} fill="var(--text-primary)" opacity="0.05" />}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 34, lineHeight: 1.45 }}>
        {hover?.p ? <><b style={{ color: "var(--text-primary)" }}>{dayShort(hover.p.d)}</b> · the index stood at {usd(hover.p.v)} per GPU-hour</>
          : hover?.m ? <><b style={{ color: "var(--text-primary)" }}>{monLong(hover.m.month)}</b> · market median {median(hover.m)}{hover.m.between ? `, interpolated between the ${usd(hover.m.between[0])} and ${usd(hover.m.between[1])} strikes` : ""} · read from {readFrom(hover.m)} · resting orders: {bounds(hover.m)}{finite(cme?.[hover.m.month]) ? ` · CME mark ${usd(cme[hover.m.month])}` : ""} · {int(hover.m.volume)} contracts traded, {int(hover.m.openInterest)} open</>
            : <>Hover the chart for a day's index or a month's contract. Dollars per GPU-hour.</>}
      </div>
    </div>
  );
}

export default function KalshiGpu() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [fut, setFut] = useState(null), [id, setId] = useState("h100");
  useEffect(() => {
    let live = true, timer;
    const load = () => fetch("/api/kalshi-gpu").then(r => r.json()).then(j => { if (!live) return; if (j.error) setErr(j.error); else { setD(j); if (j.refreshing) timer = setTimeout(load, 30000); } }).catch(e => live && setErr(e.message));
    load();
    fetch("/api/gpu-futures").then(r => r.json()).then(j => live && setFut(j)).catch(() => {});
    return () => { live = false; clearTimeout(timer); };
  }, []);
  const chip = d?.chips?.find(c => c.id === id) || d?.chips?.[0];
  const cme = useMemo(() => { const rows = fut?.latest?.curves?.[chip?.label]; return rows ? Object.fromEntries(rows.map(r => [r.month, r.settle])) : null; }, [fut, chip]);
  if (err) return <div className="options-research"><p className="onote">Kalshi's GPU price contracts could not be read: {err}</p></div>;
  if (!d || !chip) return <div className="options-research"><p className="onote">Reading Kalshi's GPU price ladders, five chips by ten months…</p></div>;

  const front = chip.months[0], q = chip.months.filter(quoted), lastQ = q.at(-1), old = chip.months.filter(m => m.read === "trades"), dates = old.map(m => m.tradedOn).filter(Boolean).sort();
  const p = chip.progress, hasCme = cme && chip.months.some(m => finite(cme[m.month]));
  const finding = `${chip.label}: the market's median for ${monLong(front.month)}'s average is ${median(front)}${finite(front.lo) && finite(front.hi) ? `, pinned between ${usd(front.lo)} and ${usd(front.hi)} by resting orders` : ""}${chip.index ? `; the index stood at ${usd(chip.index.v)} on ${dayShort(chip.index.d)}` : ""}.`
    + (lastQ && lastQ !== front ? ` Quotes run to ${monLong(lastQ.month)}, at ${usd(lastQ.implied)}.` : "")
    + (old.length ? ` ${old.length === 1 ? "One later month has" : `${old.length} later months have`} no usable quotes: what is drawn for them is the last trade at each strike${dates.length ? `, the oldest leg of each dated ${dates[0] === dates.at(-1) ? dayShort(dates[0]) : `between ${dayShort(dates[0])} and ${dayShort(dates.at(-1))}`}` : ""}. Read the dashed steps as where these months last changed hands, not as today's odds.` : "");
  const total = d.chips.reduce((a, c) => a + c.volume, 0), day24 = d.chips.reduce((a, c) => a + c.volume24h, 0);

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow="Kalshi monthly contracts · settled on the Ornn rental index · dollars per GPU-hour" title="What the prediction market expects a GPU-hour to rent for" finding={finding} style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, marginBottom: 12 }}>
          {d.chips.map(c => {
            const f = c.months[0], on = c.id === chip.id, n = c.months.filter(quoted).length;
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setId(c.id)} style={{ textAlign: "left", padding: "8px 10px", borderRadius: 8, cursor: "pointer", font: "inherit", color: "inherit", background: on ? "var(--bg-subtle)" : "transparent", border: `1px solid ${on ? "var(--oc-1)" : "var(--border-subtle)"}`, boxShadow: on ? "inset 0 0 0 1px var(--oc-1)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{c.label}</span>
                  <Spark values={c.months.map(m => m.implied)} width={54} height={16} color="var(--oc-2)" />
                </div>
                <div style={{ fontSize: 19, fontWeight: 600, fontFamily: "var(--font-number)", color: "var(--text-primary)", lineHeight: 1.25 }}>{median(f)}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: "var(--font-number)", lineHeight: 1.4 }}>{LONG[+f.month.slice(5, 7) - 1]} average<br />index {usd(c.index?.v)} now · {n} of {c.months.length} quoted</div>
              </button>);
          })}
        </div>

        {p && <p className="ocard-finding" style={{ margin: "0 0 10px" }}>{monLong(p.month)} so far: the index has averaged {usd(p.soFar)} over {p.n} of {p.days} days and stands at {usd(p.latest)}. Held there for the last {p.left}, the month settles near {usd(p.tracking)}{p.bounded ? `, ${p.inside ? "inside" : "outside"} the ${usd(front.lo)} to ${usd(front.hi)} the order book supports` : ""}.{front.between && front.read === "firm" ? ` The ${usd(front.implied)} median is an interpolation inside that one gap between strikes; the market has priced the gap, not a point in it.` : ""}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 460px", minWidth: 0 }}>
        <Legend items={[["Rental index, daily (Ornn)", "var(--oc-1)"], ["Market median, from quotes", "var(--oc-2)"], ["Market median, from last trades", "var(--oc-2)", true], ["Range resting orders support", BAND], ...(hasCme ? [["CME futures mark (Silicon Data index)", "var(--text-muted)"]] : [])]} />
        <CurveChart chip={chip} cme={cme} />
          </div>
          <div style={{ flex: "1.3 1 540px", minWidth: 0 }}>


        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={left}>Month</th><th style={right}>Market median</th><th style={right} title="The highest strike still bid at 50¢ or more and the lowest strike offered at 50¢ or less">Orders support</th><th style={left}>Read from</th>{hasCme && <th style={right} title="CME settlement mark for the Silicon Data index future, a different index; no contract has traded">CME mark</th>}<th style={right} title="Contracts traded since listing; each pays $1. Hover a month on the chart for contracts still open.">Traded</th></tr></thead>
            <tbody>
              {chip.monthly.filter(m => m.complete).map(m => <tr key={`r${m.month}`}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{monYear(m.month)}</td><td style={right}>{usd(m.avg)}</td><td style={{ ...right, color: "var(--text-muted)" }}>—</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>settled</td>{hasCme && <td style={right}>—</td>}<td style={right}>—</td></tr>)}
              {chip.months.map(m => <tr key={m.month}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{monYear(m.month)}</td><td style={{ ...right, fontWeight: quoted(m) ? 600 : 400, color: quoted(m) ? "var(--text-primary)" : "var(--text-secondary)" }}>{median(m)}</td><td style={right}>{bounds(m)}</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{readFrom(m)}</td>{hasCme && <td style={right}>{usd(cme[m.month])}</td>}<td style={right}>{int(m.volume)}</td></tr>)}
            </tbody>
          </table>
        </div>
          </div>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          <li>Each month is a ladder of yes/no contracts, "will the average hourly price be above $X", paying $1. The price of a rung is the market's chance of settling above it; the median is where that chance crosses 50%, interpolated between the two rungs around it. Rungs are {usd(chip.months[0].strikes?.[1]?.strike - chip.months[0].strikes?.[0]?.strike)} apart on the {chip.label}, which is the most precision a month can carry.</li>
          <li>A bid at any rung is a floor for every rung below it and an offer is a ceiling for every rung above, so the order book supports a range even where single rungs are unquoted. Where that range is wider than {Math.round(d.rules.usable * 100)} points of probability the rung falls back to its last trade.</li>
          <li>{int(total)} contracts have traded across the five chips{day24 ? `, ${int(day24)} in the last 24 hours` : ", none in the last 24 hours"}: each is a $1 payout, so this is a small market and one order can move a month.{hasCme ? " The CME marks settle on Silicon Data's index, not Ornn's, and no CME contract has traded; they are shown as a neighbour." : ""}</li>
          <li>Source: <a href={chip.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Kalshi</a> public market data, settled on the <a href={d.source.index} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Ornn</a> index (arithmetic mean of hourly values over the month). As of {new Date(d.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{d.stale ? "; Kalshi could not be reached, showing the last good read" : d.refreshing ? "; refreshing" : ""}.{d.missing?.length ? ` Not read this build: ${d.missing.join(", ")}.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}
