import React, { useEffect, useMemo, useState } from "react";
import { finite, VizCard, Legend, Spark } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// GPU PREDICTION MARKETS — AI Economy → Compute → GPU prices: what two
// prediction markets expect a GPU-hour to rent for, month by month.
//   Polymarket  (server/polymarketGpu.js) H100, B200, B300: the next four
//               months, then June, September and December, to December 2028.
//               Deep, tight books, so each month has a median and the middle
//               half of the odds around it. For chips with no monthly average
//               (H200, A100, RTX 5090, RTX 6000) its thinner brackets on the
//               index's value on the month's LAST DAY are drawn as diamonds.
//   Kalshi      (server/kalshiGpu.js) H100, H200, B200, A100, RTX 5090: ten
//               consecutive months. Small; past the third month the books are
//               empty and the read is the last trade at each strike.
// Both settle on Ornn's rental index, which the chart carries by day.
//   tiles   one per chip: next month's median, the index now, the far end
//   chart   the index's daily history, then one flat step per contract month
//           at each venue's median. Polymarket's shaded box is the middle half
//           of its odds; Kalshi's is the range its resting orders support, and
//           its dashed steps are last trades. CME futures marks ride along in
//           grey where there are any (a different index, so a neighbour).
//   table   every month, the venues side by side.
// One chip at a time, because they trade at prices 15× apart; ?chip=h200 (with
// ?view=ai&sub=compute&section=prices) opens the panel on that chip.
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDER = ["h100", "h200", "b200", "b300", "a100", "rtx5090", "rtx6000"];
const usd = v => (finite(v) ? `$${v.toFixed(2)}` : "—");
const int = v => (finite(v) ? Math.round(v).toLocaleString("en-US") : "—");
const money = v => (!finite(v) ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
const pct = v => (finite(v) ? `${Math.abs(v * 100).toFixed(0)}% ${v < 0 ? "below" : "above"}` : "—");
const monYear = m => (m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "—");
const monLong = m => (m ? `${LONG[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "—");
const dayShort = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}` : "—");
const mStart = m => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1), mEnd = m => Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1);
const quoted = m => m.read === "firm" || m.read === "quoted";
const left = { textAlign: "left" }, right = { textAlign: "right" };
const K = "var(--oc-2)", P = "var(--oc-3)", KBAND = "color-mix(in srgb, var(--oc-2) 22%, transparent)", PBAND = "color-mix(in srgb, var(--oc-3) 20%, transparent)";

const median = m => (!m ? "—" : finite(m.implied) ? usd(m.implied) : finite(m.floor) ? `above ${usd(m.floor)}` : finite(m.ceiling) ? `below ${usd(m.ceiling)}` : "no read");
const ptText = p => (finite(p.implied) ? `${usd(p.implied)}${p.band ? ` (middle half ${usd(p.band[0])} to ${usd(p.band[1])})` : ""}` : finite(p.floor) ? `at least ${usd(p.floor)} (${Math.round(p.odds * 100)}% of the odds)` : finite(p.ceiling) ? `under ${usd(p.ceiling)} (${Math.round(p.odds * 100)}% of the odds)` : "no read");
const half = m => (m?.band ? `${usd(m.band[0])} – ${usd(m.band[1])}` : "—");
const bounds = m => (!m ? "—" : finite(m.lo) && finite(m.hi) ? `${usd(m.lo)} – ${usd(m.hi)}` : finite(m.lo) ? `${usd(m.lo)} or more` : finite(m.hi) ? `${usd(m.hi)} or less` : "open");
const readFrom = m => (!m ? "—" : m.read === "firm" ? "tight quotes" : m.read === "quoted" ? `wide quotes${m.gaps ? ", gaps" : ""}` : m.read === "trades" ? `last trades${m.tradedOn ? `, ${dayShort(m.tradedOn)}` : ", undated"}${m.gaps ? ", gaps" : ""}` : finite(m.floor) || finite(m.ceiling) ? "every strike on one side of 50%" : "nothing quoted or traded");

function CurveChart({ label, daily, km, pm, pts = [], cme }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 310, mg = { l: 46, r: 10, t: 14, b: 24 };
  const months = [...new Set([...km, ...pm, ...pts].map(m => m.month))].sort(), kOf = Object.fromEntries(km.map(m => [m.month, m])), pOf = Object.fromEntries(pm.map(m => [m.month, m])), ptOf = Object.fromEntries(pts.map(m => [m.month, m]));
  const t0 = daily.length ? Date.parse(daily[0].d) : mStart(months[0]), t1 = mEnd(months.at(-1)), now = daily.length ? Date.parse(daily.at(-1).d) : null;
  const cmeIn = Object.entries(cme || {}).filter(([m, v]) => finite(v) && mStart(m) >= mStart(months[0]) && mEnd(m) <= t1).sort();
  const vals = [...daily.map(p => p.v), ...km.flatMap(m => [m.implied, m.floor, m.ceiling, finite(m.lo) && finite(m.hi) ? m.lo : null, finite(m.lo) && finite(m.hi) ? m.hi : null]), ...[...pm, ...pts].flatMap(m => [m.implied, m.band?.[0], m.band?.[1], m.floor, m.ceiling]), ...cmeIn.map(x => x[1])].filter(finite);
  const vmin = Math.min(...vals), vmax = Math.max(...vals);
  const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5].find(s => (vmax - vmin) / s <= 7) || 5;
  const lo = Math.max(0, Math.floor((vmin - step * 0.25) / step) * step), hi = Math.ceil((vmax + step * 0.25) / step) * step;
  const x = t => mg.l + ((t - t0) / (t1 - t0)) * (W - mg.l - mg.r), y = v => mg.t + (1 - (v - lo) / (hi - lo)) * (H - mg.t - mg.b);
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const xt = []; for (let d = new Date(t0), k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); k < t1; k = Date.UTC(new Date(k).getUTCFullYear(), new Date(k).getUTCMonth() + 1, 1)) xt.push(k);
  const every = xt.length > 20 ? 3 : 2, wide = m => Math.max(1, x(mEnd(m)) - x(mStart(m)) - 2);
  const line = daily.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.d)).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const cmePath = cmeIn.map(([m, v], i) => `${i ? "L" : "M"}${x(mStart(m)).toFixed(1)},${y(v).toFixed(1)}H${x(mEnd(m)).toFixed(1)}`).join("");
  const pLink = pm.filter(m => finite(m.implied)).map((m, i) => `${i ? "L" : "M"}${((x(mStart(m.month)) + x(mEnd(m.month))) / 2).toFixed(1)},${y(m.implied).toFixed(1)}`).join("");
  const move = e => {
    const b = e.currentTarget.getBoundingClientRect(), t = t0 + (((e.clientX - b.left) / b.width) * W - mg.l) / (W - mg.l - mg.r) * (t1 - t0);
    const m = months.find(q => t >= mStart(q) && t < mEnd(q));
    if (m && (now == null || t > now)) return setHover({ m });
    if (!daily.length || (now != null && t > now)) return setHover(null);
    let best = daily[0]; for (const p of daily) if (Math.abs(Date.parse(p.d) - t) < Math.abs(Date.parse(best.d) - t)) best = p;
    setHover({ p: best });
  };
  const num = { fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }, hk = hover?.m && kOf[hover.m], hp = hover?.m && pOf[hover.m], hpt = hover?.m && ptOf[hover.m], dim = m => (hover?.m && hover.m !== m ? 0.45 : 1);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: rental index by day and each market's median for each contract month`} style={{ display: "block" }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {ticks.map(v => <g key={v}><line x1={mg.l} x2={W - mg.r} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" /><text x={mg.l - 6} y={y(v) + 3.5} textAnchor="end" style={num}>${v.toFixed(2)}</text></g>)}
        {xt.map(k => { const d = new Date(k), jan = d.getUTCMonth() === 0; return <g key={k}><line x1={x(k)} x2={x(k)} y1={H - mg.b} y2={H - mg.b + 3} stroke="var(--text-muted)" />{d.getUTCMonth() % every === 0 && <text x={x(k) + 3} y={H - 7} style={num}>{MON[d.getUTCMonth()]}{jan ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}</text>}</g>; })}
        {now != null && <g><line x1={x(now)} x2={x(now)} y1={mg.t} y2={H - mg.b} stroke="var(--text-muted)" strokeDasharray="2 3" /><text x={x(now) + 4} y={mg.t + 8} style={num}>contract months →</text></g>}
        {pm.map(m => m.band && <rect key={`pb${m.month}`} x={x(mStart(m.month)) + 1} width={wide(m.month)} y={y(m.band[1])} height={Math.max(1, y(m.band[0]) - y(m.band[1]))} fill={PBAND} opacity={dim(m.month)} />)}
        {km.map(m => finite(m.lo) && finite(m.hi) && <rect key={`kb${m.month}`} x={x(mStart(m.month)) + 1} width={wide(m.month)} y={y(m.hi)} height={Math.max(1, y(m.lo) - y(m.hi))} fill={KBAND} opacity={dim(m.month)} />)}
        {cmePath && <path d={cmePath} fill="none" stroke="var(--text-muted)" strokeWidth="1.25" />}
        {pLink && <path d={pLink} fill="none" stroke={P} strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />}
        {km.map(m => {
          const x1 = x(mStart(m.month)) + 1, x2 = x(mEnd(m.month)) - 1;
          if (finite(m.implied)) return <line key={`k${m.month}`} x1={x1} x2={x2} y1={y(m.implied)} y2={y(m.implied)} stroke={K} strokeWidth={quoted(m) ? 3 : 2} strokeDasharray={quoted(m) ? "none" : "4 3"} opacity={dim(m.month)} />;
          const edge = finite(m.floor) ? m.floor : m.ceiling, up = finite(m.floor), cx = (x1 + x2) / 2;
          return finite(edge) && <g key={`k${m.month}`} opacity={dim(m.month)}><line x1={x1} x2={x2} y1={y(edge)} y2={y(edge)} stroke={K} strokeWidth="1.5" strokeDasharray="1 3" /><path d={`M${cx - 4},${y(edge) + (up ? -4 : 4)}L${cx},${y(edge) + (up ? -11 : 11)}L${cx + 4},${y(edge) + (up ? -4 : 4)}Z`} fill={K} /></g>;
        })}
        {pm.map(m => finite(m.implied) && <line key={`p${m.month}`} x1={x(mStart(m.month)) + 1} x2={x(mEnd(m.month)) - 1} y1={y(m.implied)} y2={y(m.implied)} stroke={P} strokeWidth="3" opacity={dim(m.month)} />)}
        {line && <path d={line} fill="none" stroke="var(--oc-1)" strokeWidth="2" strokeLinejoin="round" />}
        {pts.map(p => {
          const cx = x(Date.parse(p.date)), v = finite(p.implied) ? p.implied : finite(p.floor) ? p.floor : p.ceiling;
          if (!finite(v)) return null;
          const cy = y(v), up = finite(p.floor);
          return <g key={`pt${p.date}`} opacity={dim(p.month)}>
            {p.band && <line x1={cx} x2={cx} y1={y(p.band[0])} y2={y(p.band[1])} stroke={P} strokeWidth="7" opacity="0.3" strokeLinecap="round" />}
            {finite(p.implied) ? <path d={`M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`} fill={P} stroke="var(--card-bg)" strokeWidth="1.5" />
              : <path d={`M${cx - 6},${cy}L${cx + 6},${cy}L${cx},${cy + (up ? -10 : 10)}Z`} fill={P} stroke="var(--card-bg)" strokeWidth="1.5" />}
          </g>;
        })}
        {hover?.p && <circle cx={x(Date.parse(hover.p.d))} cy={y(hover.p.v)} r="4.5" fill="var(--oc-1)" stroke="var(--card-bg)" strokeWidth="2" />}
        {hover?.m && <rect x={x(mStart(hover.m))} width={x(mEnd(hover.m)) - x(mStart(hover.m))} y={mg.t} height={H - mg.t - mg.b} fill="var(--text-primary)" opacity="0.05" />}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 50, lineHeight: 1.45 }}>
        {hover?.p ? <><b style={{ color: "var(--text-primary)" }}>{dayShort(hover.p.d)}</b> · the index stood at {usd(hover.p.v)} per GPU-hour</>
          : hover?.m ? <><b style={{ color: "var(--text-primary)" }}>{monLong(hover.m)}</b>
            {hp && <> · Polymarket {median(hp)}{hp.band ? `, middle half of the odds ${half(hp)}` : ""} ({money(hp.volume)} traded, {money(hp.liquidity)} resting)</>}
            {hpt && <> · Polymarket, the index on {dayShort(hpt.date)}: {ptText(hpt)} ({money(hpt.volume)} traded, {money(hpt.liquidity)} resting)</>}
            {hk && <> · Kalshi {median(hk)}, read from {readFrom(hk)}; resting orders support {bounds(hk)} ({int(hk.volume)} contracts traded)</>}
            {finite(cme?.[hover.m]) && <> · CME mark {usd(cme[hover.m])}</>}{!hp && !hk && !hpt && <> · no contract for this month</>}</>
            : <>Hover the chart for a day's index or a month's contracts. Dollars per GPU-hour.</>}
      </div>
    </div>
  );
}

export default function GpuPredictionMarkets() {
  const [kal, setKal] = useState(null), [pol, setPol] = useState(null), [errs, setErrs] = useState({}), [fut, setFut] = useState(null), [id, setId] = useState(() => new URLSearchParams(window.location.search).get("chip") || "h100");
  useEffect(() => {
    let live = true, timer;
    const fail = (k, m) => live && setErrs(e => ({ ...e, [k]: m }));
    const loadK = () => fetch("/api/kalshi-gpu").then(r => r.json()).then(j => { if (!live) return; if (j.error && !j.chips) fail("Kalshi", j.error); else { setKal(j); if (j.refreshing) timer = setTimeout(loadK, 30000); } }).catch(e => fail("Kalshi", e.message));
    loadK();
    fetch("/api/polymarket-gpu").then(r => r.json()).then(j => { if (!live) return; if (j.error && !j.chips) fail("Polymarket", j.error); else setPol(j); }).catch(e => fail("Polymarket", e.message));
    fetch("/api/gpu-futures").then(r => r.json()).then(j => live && setFut(j)).catch(() => {});
    return () => { live = false; clearTimeout(timer); };
  }, []);
  const chips = useMemo(() => {
    const ids = [...new Set([...(pol?.chips || []), ...(kal?.chips || [])].map(c => c.id))].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
    return ids.map(cid => { const k = kal?.chips?.find(c => c.id === cid) || null, p = pol?.chips?.find(c => c.id === cid) || null, any = p || k; return { id: cid, label: any.label, k, p, index: any.index, daily: any.daily || [], monthly: any.monthly || [] }; });
  }, [kal, pol]);
  const chip = chips.find(c => c.id === id) || chips[0];
  const cme = useMemo(() => { const rows = fut?.latest?.curves?.[chip?.label]; return rows ? Object.fromEntries(rows.map(r => [r.month, r.settle])) : null; }, [fut, chip]);
  const waiting = (!kal && !errs.Kalshi) || (!pol && !errs.Polymarket);
  if (!chip) return <div className="options-research"><p className="onote">{waiting ? "Reading the GPU price ladders on Polymarket and Kalshi…" : `The GPU price markets could not be read: ${Object.entries(errs).map(([k, v]) => `${k}: ${v}`).join("; ")}`}</p></div>;

  const km = chip.k?.months || [], pm = chip.p?.months || [], kOf = Object.fromEntries(km.map(m => [m.month, m])), pOf = Object.fromEntries(pm.map(m => [m.month, m]));
  const pts = pm.length ? [] : chip.p?.points || [], ptOf = Object.fromEntries(pts.map(p => [p.month, p])), hasP = pm.length > 0 || pts.length > 0;
  const months = [...new Set([...km, ...pm, ...pts].map(m => m.month))].sort(), hasCme = cme && months.some(m => finite(cme[m]));
  const showTraded = pm.length > 0 || (pts.length > 0 && !km.length);
  const monthsOf = c => (c.p?.months?.length ? c.p.months : c.k?.months || []);
  const nextOf = c => { const cur = c.index?.d?.slice(0, 7), pick = ms => ms?.find(m => (!cur || m.month > cur) && finite(m.implied)); const p = pick(c.p?.months), k = pick(c.k?.months), pt = c.p?.points?.find(q => finite(q.implied)); return p ? { m: p, venue: "Polymarket" } : k ? { m: k, venue: "Kalshi" } : pt ? { m: pt, venue: "Polymarket", point: true } : null; };
  const ptsText = pts.length ? `brackets on the index's value on the last day of the month: ${pts.map(p => `${dayShort(p.date)} ${ptText(p)}`).join("; ")}` : "";
  const pf = pm[0], pFar = pm.filter(m => finite(m.implied)).at(-1), pMid = pm.find(m => m.month.endsWith("-12") && m !== pf && m !== pFar);
  const kq = km.filter(quoted), kLastQ = kq.at(-1), kOld = km.filter(m => m.read === "trades"), kDates = kOld.map(m => m.tradedOn).filter(Boolean).sort(), kSame = pf && kOf[pf.month];
  const prog = chip.k?.progress, kFront = km[0];
  const finding = (pf ? `${chip.label}: Polymarket's median for ${monLong(pf.month)}'s average is ${usd(pf.implied)}${pf.band ? `, with the middle half of the odds between ${usd(pf.band[0])} and ${usd(pf.band[1])}` : ""}${chip.index ? `; the index stood at ${usd(chip.index.v)} on ${dayShort(chip.index.d)}` : ""}.`
      + (pFar && pFar !== pf ? ` The curve runs ${pMid ? `through ${usd(pMid.implied)} for ${monLong(pMid.month)} ` : ""}to ${usd(pFar.implied)} for ${monLong(pFar.month)}${chip.index ? `, ${pct(pFar.implied / chip.index.v - 1)} today's index` : ""}${pFar.band ? `, though half the odds there sit outside ${usd(pFar.band[0])} to ${usd(pFar.band[1])}` : ""}.` : "")
      + (kSame ? ` Kalshi, a much smaller market, has ${monLong(kSame.month)} at ${median(kSame)} (${readFrom(kSame)}).` : "")
    : kFront ? `${chip.label}: Kalshi's median for ${monLong(kFront.month)}'s average is ${median(kFront)}${finite(kFront.lo) && finite(kFront.hi) ? `, pinned between ${usd(kFront.lo)} and ${usd(kFront.hi)} by resting orders` : ""}${chip.index ? `; the index stood at ${usd(chip.index.v)} on ${dayShort(chip.index.d)}` : ""}.${kLastQ && kLastQ !== kFront ? ` Quotes run to ${monLong(kLastQ.month)}, at ${usd(kLastQ.implied)}.` : ""}${pts.length ? ` Polymarket lists no monthly average for this chip, only ${ptsText}.` : " Polymarket lists no monthly average for this chip."}` : pts.length ? `${chip.label}: neither venue lists a monthly average. Polymarket has ${ptsText}${chip.index ? `; the index stood at ${usd(chip.index.v)} on ${dayShort(chip.index.d)}` : ""}.` : "")
    + (kOld.length ? ` Kalshi's ${kOld.length === 1 ? "one later month has" : `${kOld.length} later months have`} no usable quotes; the dashed steps are the last trade at each strike${kDates.length ? `, the oldest leg of each dated ${kDates[0] === kDates.at(-1) ? dayShort(kDates[0]) : `between ${dayShort(kDates[0])} and ${dayShort(kDates.at(-1))}`}` : ""}, not today's odds.` : "");
  const pAvg = (pol?.chips || []).filter(c => c.months.length), pTot = k => pAvg.reduce((a, c) => a + (c[k] || 0), 0), kTot = k => (kal?.chips || []).reduce((a, c) => a + (c[k] || 0), 0);
  const cols = [["Month", left], ...(hasP ? [[pm.length ? "Polymarket" : "Polymarket, last day", right, pm.length ? undefined : "The index's value on the last day of the month, not the month's average"], ["Middle half", right, "The prices the market gives a 75% and a 25% chance of being exceeded"], ...(showTraded ? [["$ traded", right, "Dollars traded on the month's markets since listing"]] : [])] : []),
    ...(km.length ? [["Kalshi", right], ...(hasP ? [] : [["Orders support", right, "The highest strike still bid at 50¢ or more and the lowest strike offered at 50¢ or less"]]), ["Kalshi read", left]] : []),
    ...(hasCme ? [["CME mark", right, "CME settlement mark for the Silicon Data index future, a different index; no contract has traded"]] : []), ...(km.length && !hasP ? [["Traded", right, "Contracts traded since listing; each pays $1"]] : [])];
  const cell = { fontFamily: "var(--font-body)" }, soft = { color: "var(--text-secondary)" };

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow="Polymarket and Kalshi monthly contracts · settled on the Ornn rental index · dollars per GPU-hour" title="What prediction markets expect a GPU-hour to rent for" finding={finding} style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, marginBottom: 12 }}>
          {chips.map(c => {
            const on = c.id === chip.id, nx = nextOf(c), far = monthsOf(c).filter(m => finite(m.implied)).at(-1), curve = monthsOf(c).map(m => m.implied);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setId(c.id)} style={{ textAlign: "left", padding: "8px 10px", borderRadius: 8, cursor: "pointer", font: "inherit", color: "inherit", background: on ? "var(--bg-subtle)" : "transparent", border: `1px solid ${on ? "var(--oc-1)" : "var(--border-subtle)"}`, boxShadow: on ? "inset 0 0 0 1px var(--oc-1)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{c.label}</span>
                  {curve.length > 1 && <Spark values={curve} width={54} height={16} color={c.p?.months?.length ? P : K} />}
                </div>
                <div style={{ fontSize: 19, fontWeight: 600, fontFamily: "var(--font-number)", color: "var(--text-primary)", lineHeight: 1.25 }}>{nx ? usd(nx.m.implied) : "—"}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: "var(--font-number)", lineHeight: 1.4 }}>{nx ? `${nx.point ? `${dayShort(nx.m.date)} value` : `${MON[+nx.m.month.slice(5, 7) - 1]} average`} · ${nx.venue}` : "no quoted month"}<br />index {usd(c.index?.v)} now{far && far !== nx?.m ? <><br />{monYear(far.month)} {usd(far.implied)}</> : ""}</div>
              </button>);
          })}
        </div>

        {prog && kFront && <p className="ocard-finding" style={{ margin: "0 0 10px" }}>{monLong(prog.month)} so far: the index has averaged {usd(prog.soFar)} over {prog.n} of {prog.days} days and stands at {usd(prog.latest)}. Held there for the last {prog.left}, the month settles near {usd(prog.tracking)}{prog.bounded ? `, ${prog.inside ? "inside" : "outside"} the ${usd(kFront.lo)} to ${usd(kFront.hi)} Kalshi's order book supports` : ""}.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 460px", minWidth: 0 }}>
            <Legend items={[["Rental index, daily (Ornn)", "var(--oc-1)"], ...(pm.length ? [["Polymarket median", P], ["Polymarket, middle half of the odds", PBAND]] : []), ...(pts.length ? [["Polymarket: the index on the month's last day (bar: middle half)", P]] : []), ...(km.length ? [["Kalshi median (dashed: last trades)", K], ["Kalshi, range resting orders support", KBAND]] : []), ...(hasCme ? [["CME futures mark (Silicon Data index)", "var(--text-muted)"]] : [])]} />
            <CurveChart label={chip.label} daily={chip.daily} km={km} pm={pm} pts={pts} cme={cme} />
          </div>
          <div style={{ flex: "1.3 1 540px", minWidth: 0 }}>
            <div className="otable-wrap">
              <table className="otable">
                <thead><tr>{cols.map(([label, align, title]) => <th key={label} style={align} title={title}>{label}</th>)}</tr></thead>
                <tbody>
                  {chip.monthly.filter(m => m.complete).map(m => <tr key={`r${m.month}`}><td style={{ ...left, ...cell }}>{monYear(m.month)}</td><td style={right}>{usd(m.avg)}</td><td colSpan={cols.length - 2} style={{ ...left, ...cell, ...soft }}>settled: the index's average for the month</td></tr>)}
                  {months.map(mo => { const k = kOf[mo], p = pOf[mo] || ptOf[mo]; return (
                    <tr key={mo}><td style={{ ...left, ...cell }}>{monYear(mo)}</td>
                      {hasP && <><td style={{ ...right, fontWeight: 600 }}>{p ? median(p) : "—"}</td><td style={{ ...right, ...soft }}>{half(p)}</td>{showTraded && <td style={{ ...right, ...soft }}>{p ? money(p.volume) : "—"}</td>}</>}
                      {km.length > 0 && <><td style={{ ...right, fontWeight: k && quoted(k) ? 600 : 400, color: k && quoted(k) ? "var(--text-primary)" : "var(--text-secondary)" }}>{median(k)}</td>{!hasP && <td style={right}>{bounds(k)}</td>}<td style={{ ...left, ...cell, ...soft }}>{readFrom(k)}</td></>}
                      {hasCme && <td style={right}>{usd(cme[mo])}</td>}{km.length > 0 && !hasP && <td style={right}>{k ? int(k.volume) : "—"}</td>}</tr>); })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          <li>Each month is a ladder of yes/no contracts, "will the month's average price be above $X", paying $1. A rung's price is the market's chance of settling above it; the median is where that chance crosses 50%, interpolated between the two rungs around it, and the middle half is where it crosses 75% and 25%. The gap between rungs is the most precision a month can carry.</li>
          {pol && <li>Polymarket: {money(pTot("volume"))} traded across its {pAvg.length} chips with monthly averages ({money(pTot("volume24h"))} in the last 24 hours) with {money(pTot("liquidity"))} of orders resting, and quotes a cent or two wide, so its medians are current odds. It lists the next four months and then quarter-ends, to December 2028; the dotted line only joins those months.</li>}
          {kal && <li>Kalshi: {int(kTot("volume"))} contracts traded across five chips{kTot("volume24h") ? `, ${int(kTot("volume24h"))} in the last 24 hours` : ", none in the last 24 hours"}. A bid at any rung is a floor for every rung below it and an offer a ceiling for every rung above; that is the range drawn. Where it is wider than {Math.round((kal.rules?.usable ?? 0.6) * 100)} points of probability a rung falls back to its last trade, which is why its later months are drawn dashed.</li>}
          <li>Both settle on Ornn's index for the calendar month: Polymarket on the mean of the finalized daily values, Kalshi on the mean of the hourly values.{hasCme ? " The CME marks settle on Silicon Data's index, and no CME contract has traded; they are a neighbour, not a twin." : ""}{pts.length ? ` For this chip Polymarket lists only brackets on the index's value on the month's last day: one day's value, not the month's average, and thinly traded (${money(pts.reduce((a, p) => a + p.liquidity, 0))} resting). Bracket prices are scaled to sum to one and the median is placed inside its bracket in proportion.` : " Polymarket's month-end brackets are drawn only for chips it lists no monthly average for; its \"hit $X\" markets are not shown."}</li>
          <li>Sources: {pol && <><a href={pol.source?.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Polymarket</a>{kal ? " and " : ""}</>}{kal && <a href={chip.k?.url || "https://kalshi.com"} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Kalshi</a>} public market data. Read {new Date((pol || kal).asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{pol?.stale ? "; Polymarket could not be reached, showing its last good read" : ""}{kal?.stale ? "; Kalshi could not be reached, showing its last good read" : kal?.refreshing ? "; Kalshi refreshing" : ""}.{Object.keys(errs).length ? ` Not read: ${Object.entries(errs).map(([k, v]) => `${k} (${v})`).join(", ")}.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}
