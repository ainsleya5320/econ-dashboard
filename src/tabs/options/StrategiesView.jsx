import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ScatterChart, Scatter } from "recharts";
import { STRATEGIES, STRATEGY_BY_ID, CAVEATS, schematic, buildCandidates, payoff } from "../../lib/optionStrategies.js";
import { smileDistribution, distributionQuantile, quoteQuality } from "../../lib/optionsAnalysis.js";
import { modelInputs } from "./DecisionWorkbench.jsx";
import { finite, fx, signed, usd, usdK, dayLabel, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "./ui.jsx";

// ============================================================================
// STRATEGIES: the twelve classic listed-option trades. A rail of payoff
// shapes picks one; its card explains how it works; the builder prices it on
// the current symbol (conservative fills: sells at the bid, buys at the ask,
// $0.65 a contract) with the payoff at expiry drawn above the market's
// pricing distribution on the same price axis, so the profit zone and the
// odds of landing in it read together; the screener shows the same trade
// across every name in the market scan. Engine: src/lib/optionStrategies.js.
// Odds are market-implied (risk-neutral), not forecasts.
// ============================================================================

const FAMILY = { income: "Income", spread: "Spreads", volatility: "Volatility", hedge: "Hedges" };
const DELTAS = [0.1, 0.16, 0.2, 0.25, 0.3, 0.4];
const WIDTHS = [[0.025, "2.5%"], [0.05, "5%"], [0.1, "10%"]];
const KEY = "opt-strategy";

const strikeTxt = k => (finite(k) ? (k % 1 ? k.toFixed(k < 10 ? 2 : 1) : String(k)) : "—");
export const legsText = c => [c.shares ? `+${c.shares} sh` : null, ...(c.legs || []).map(l => `${l.side === "sell" ? "−" : "+"}${l.type}${strikeTxt(l.strike)}`)].filter(Boolean).join(" ");
const pct0 = v => (finite(v) ? `${Math.round(v * 100)}%` : "—");
const pct1 = v => (finite(v) ? `${(v * 100).toFixed(1)}%` : "—");
const money0 = v => (finite(v) ? usd(v, Math.abs(v) >= 1000 ? 0 : 2) : "—");
const maxP = c => (c.unlimitedProfit ? "unlimited" : money0(c.maxProfit));
const maxL = c => (c.unlimitedLoss ? "unlimited" : money0(c.maxLoss));
const r0 = v => (finite(v) ? Math.round(v) + 0 : null); // no "-0"
// annualizing only makes sense where the premium is a yield on cash or shares; for spreads and
// long-volatility trades a simple ×365/days figure on a low-odds payoff is misleading
const YIELD = new Set(["csp", "coveredCall"]);
const CREDIT = new Set(["bullPut", "bearCall", "shortStrangle", "ironCondor", "ironButterfly"]);
const odds = c => (finite(c.pMax) ? `${pct0(c.pMax)} keep the maximum` : c.unlimitedProfit ? "no cap on the gain" : finite(c.pop) ? "the maximum needs a finish at the short strike" : "no reliable distribution");
const netTxt = c => (finite(c.netPerShare) ? `${c.netPerShare >= 0 ? "credit" : "debit"} ${usd(Math.abs(c.netPerShare))}` : "—");

// the generic payoff shape: gain above the line in blue, loss below in red, today's price dashed
function Schematic({ id, width = 120, height = 46 }) {
  const uid = useId().replace(/:/g, "");
  const pts = schematic(id) || [];
  if (pts.length < 2) return null;
  const x = v => 2 + ((v + 1) / 2) * (width - 4), y = v => height / 2 - v * (height / 2 - 4);
  const path = pts.map(p => `${x(p.x)},${y(p.y)}`).join(" L");
  const area = `M${x(pts[0].x)},${y(0)} L${path} L${x(pts.at(-1).x)},${y(0)} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <clipPath id={`${uid}u`}><rect x="0" y="0" width={width} height={height / 2} /></clipPath>
        <clipPath id={`${uid}d`}><rect x="0" y={height / 2} width={width} height={height / 2} /></clipPath>
      </defs>
      <path d={area} fill="var(--oc-1)" opacity=".28" clipPath={`url(#${uid}u)`} />
      <path d={area} fill="var(--oc-pos)" opacity=".28" clipPath={`url(#${uid}d)`} />
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--border-subtle)" />
      <line x1={x(0)} x2={x(0)} y1="2" y2={height - 2} stroke="var(--text-muted)" strokeDasharray="2 2" />
      <path d={`M${path}`} fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Rail({ value, onPick }) {
  const fams = [...new Set(STRATEGIES.map(s => s.family))];
  return (
    <nav className="ostrat-rail" aria-label="Strategies">
      {fams.map(f => (
        <div key={f} className="ostrat-fam">
          <div className="ocard-eyebrow">{FAMILY[f] || f}</div>
          {STRATEGIES.filter(s => s.family === f).map(s => (
            <button key={s.id} type="button" className="ostrat-item" aria-pressed={value === s.id} onClick={() => onPick(s.id)} title={s.summary}>
              <Schematic id={s.id} width={64} height={28} />
              <span><strong>{s.name}</strong><small>{s.outlook} · {s.volView}</small></span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Explainer({ s }) {
  const lists = [["Best when", s.bestWhen], ["Risks", s.risks], ["Management (common conventions, not rules)", s.management]];
  return (
    <section className="ocard">
      <div className="ostrat-explain-head">
        <Schematic id={s.id} width={200} height={76} />
        <div style={{ minWidth: 0 }}>
          <div className="ocard-eyebrow">{FAMILY[s.family]} · {s.outlook} · {s.volView}</div>
          <h3 className="ocard-title" style={{ fontSize: 17 }}>{s.name}</h3>
          <p className="ocard-finding" style={{ margin: "3px 0" }}>{s.summary}</p>
          <p className="onote" style={{ margin: 0 }}><strong style={{ color: "var(--text-secondary)" }}>Legs:</strong> {s.legs}</p>
        </div>
      </div>
      <dl className="ostrat-facts">
        {[["Max profit", s.maxProfit], ["Max loss", s.maxLoss], ["Break-even", s.breakeven], ["Capital", s.capital]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="ostrat-lists">
        {lists.map(([k, xs]) => <div key={k}><div className="ocard-eyebrow">{k}</div><ul>{(xs || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// builder: one symbol, one expiry, candidate table, payoff over the pricing distribution
// ---------------------------------------------------------------------------
function expiries(chain) {
  const m = new Map();
  for (const o of chain?.options || []) if (o.dte >= 5 && o.dte <= 400 && quoteQuality(o).usable) m.set(o.expiryDate, o.dte);
  return [...m].map(([expiryDate, dte]) => ({ expiryDate, dte })).sort((a, b) => a.dte - b.dte);
}

function PayoffPanels({ c, dist }) {
  const strikes = [...new Set((c.legs || []).map(l => l.strike))];
  const bes = (c.breakevens || []).filter(finite);
  const [lo, hi] = useMemo(() => {
    const qs = dist ? [distributionQuantile(dist, 0.02), distributionQuantile(dist, 0.98)].filter(finite) : [];
    const xs = [c.spot, ...strikes, ...bes, ...qs].filter(finite);
    const a = Math.min(...xs, c.spot * 0.85), b = Math.max(...xs, c.spot * 1.15), pad = (b - a) * 0.08;
    return [Math.max(0, a - pad), b + pad];
  }, [c, dist]);
  const grid = useMemo(() => {
    const n = 220, xs = new Set([...strikes, ...bes]);
    for (let i = 0; i <= n; i++) xs.add(lo + ((hi - lo) * i) / n);
    return [...xs].filter(x => x >= lo && x <= hi).sort((a, b) => a - b);
  }, [lo, hi, c]);
  const pay = useMemo(() => grid.map(S => { const p = payoff(c, S); return { S, pnl: p, gain: p > 0 ? p : 0, loss: p < 0 ? p : 0 }; }), [grid, c]);
  // density per $1 between quoted strikes, interpolated onto the same grid and split by the trade's profit zone
  const dens = useMemo(() => {
    if (!dist?.pts?.length) return [];
    const raw = dist.pts.slice(1).map((p, i) => ({ S: (p.K + dist.pts[i].K) / 2, d: (100 * (p.cdf - dist.pts[i].cdf)) / (p.K - dist.pts[i].K) }));
    if (raw.length < 2) return [];
    const at = S => { if (S < raw[0].S || S > raw.at(-1).S) return null; for (let i = 1; i < raw.length; i++) if (raw[i].S >= S) { const a = raw[i - 1], b = raw[i]; return a.d + ((S - a.S) / (b.S - a.S || 1)) * (b.d - a.d); } return null; };
    return grid.map(S => { const d = at(S); if (d == null) return { S }; const win = payoff(c, S) > 0; return { S, win: win ? d : 0, lose: win ? 0 : d }; });
  }, [dist, grid, c]);
  const refs = (
    <>
      <ReferenceLine x={c.spot} stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "today", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />
      {strikes.map(k => <ReferenceLine key={`k${k}`} x={k} stroke="var(--border-subtle)" />)}
      {bes.map(b => <ReferenceLine key={`b${b}`} x={b} stroke="var(--text-secondary)" strokeDasharray="1 3" />)}
    </>
  );
  const xAxis = hide => <XAxis dataKey="S" type="number" domain={[lo, hi]} allowDataOverflow tick={hide ? false : axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => `$${v >= 100 ? Math.round(v) : v.toFixed(1)}`} height={hide ? 4 : 22} />;
  const M = { top: 6, right: 14, left: 0, bottom: 0 };
  return (
    <div>
      <Legend items={[["Profit at expiry", C[1]], ["Loss at expiry", "var(--oc-pos)"]]} />
      <div className="ochart" style={{ height: 200 }}><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={pay} margin={M} syncId="strat" syncMethod="value">
          <CartesianGrid {...gridProps} />
          {xAxis(true)}
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={62} tickFormatter={v => usdK(v)} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={v => `Price at expiry ${usd(v)}`} formatter={(v, n) => (n === "P&L" ? [usd(v, 0), "P&L per lot"] : [null, null])} />
          <ReferenceLine y={0} stroke="var(--text-muted)" />
          {refs}
          <Area dataKey="gain" name="gain" stroke="none" fill={C[1]} fillOpacity={0.25} isAnimationActive={false} tooltipType="none" />
          <Area dataKey="loss" name="loss" stroke="none" fill="var(--oc-pos)" fillOpacity={0.25} isAnimationActive={false} tooltipType="none" />
          <Line dataKey="pnl" name="P&L" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer></div>
      <div className="onote" style={{ margin: "2px 0 0" }}>Below, same price axis: the market&apos;s pricing distribution for {c.expiryDate}, shaded blue where this trade finishes with a profit{dens.length ? "" : " (no reliable distribution at this expiry)"}</div>
      <div className="ochart-sm" style={{ height: 130 }}><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dens.length ? dens : pay.map(p => ({ S: p.S }))} margin={M} syncId="strat" syncMethod="value">
          <CartesianGrid {...gridProps} />
          {xAxis(false)}
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={62} tickFormatter={v => `${v.toFixed(1)}%`} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={v => `Price at expiry ${usd(v)}`} formatter={(v, n) => (v ? [`${v.toFixed(2)}% per $1`, n === "win" ? "Density (profit zone)" : "Density (loss zone)"] : [null, null])} />
          {refs}
          <Area dataKey="win" stroke="none" fill={C[1]} fillOpacity={0.55} isAnimationActive={false} connectNulls={false} />
          <Area dataKey="lose" stroke="none" fill="var(--oc-pos)" fillOpacity={0.45} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer></div>
      <p className="ocard-note">Thin solid lines mark strikes, dotted lines break-evens. Payoff per lot (100 shares a contract) after opening fees; closing fees excluded. The distribution covers quoted strikes only, so its visible area need not total 100%.</p>
    </div>
  );
}

function Builder({ s, symbol, chain, context, chainState, focusRef }) {
  const list = useMemo(() => expiries(chain), [chain]);
  const [expiry, setExpiry] = useState(null);
  const [delta, setDelta] = useState(null), [width, setWidth] = useState(null);
  const [pick, setPick] = useState(0);
  useEffect(() => { setDelta(null); setWidth(null); setPick(0); }, [s.id]);
  useEffect(() => { setPick(0); }, [symbol, expiry, delta, width]);
  // default expiry: closest to 45 days, preferring 21-60
  const exp = useMemo(() => {
    if (expiry && list.some(e => e.expiryDate === expiry)) return list.find(e => e.expiryDate === expiry);
    const pref = list.filter(e => e.dte >= 21 && e.dte <= 60);
    return (pref.length ? pref : list).reduce((a, b) => (!a || Math.abs(b.dte - 45) < Math.abs(a.dte - 45) ? b : a), null);
  }, [list, expiry]);
  useEffect(() => { setExpiry(null); }, [symbol]);
  const dist = useMemo(() => {
    if (!chain || !exp) return null;
    const m = modelInputs(context, chain.spot, exp.dte);
    return smileDistribution(chain.options, exp.dte, chain.spot, finite(m.rate) ? m.rate : 0.04, finite(m.dividend) ? m.dividend : 0);
  }, [chain, exp, context]);
  const settings = useMemo(() => ({ ...(delta != null ? { delta } : {}), ...(width != null ? { width } : {}) }), [delta, width]);
  const cands = useMemo(() => {
    if (!chain || !exp) return [];
    try { return buildCandidates(chain, { strategy: s.id, expiryDate: exp.expiryDate, dist, settings }) || []; } catch (e) { console.error(e); return []; }
  }, [chain, exp, dist, s.id, settings]);
  const c = cands[Math.min(pick, cands.length - 1)];
  const usesDelta = finite(s.defaults?.delta) && s.defaults.delta < 0.5;
  const usesWidth = finite(s.defaults?.width);
  const curDelta = delta ?? s.defaults?.delta, curWidth = width ?? s.defaults?.width;
  const events = (context?.events || []).filter(e => exp && e.date <= exp.expiryDate && e.date >= (chain?.valuationDate || ""));
  return (
    <section className="ocard" ref={focusRef}>
      <header className="ocard-head">
        <div><div className="ocard-eyebrow">Priced on the delayed Cboe chain · sells at the bid, buys at the ask · $0.65 a contract</div><h3 className="ocard-title">{s.name} on {symbol}{chain?.spot ? ` at ${usd(chain.spot)}` : ""}</h3></div>
        {!chainState && <div className="ocard-tools">
          <select className="ochip" value={exp?.expiryDate || ""} onChange={e => setExpiry(e.target.value)} aria-label="Expiry">{list.map(e => <option key={e.expiryDate} value={e.expiryDate}>{dayLabel(e.expiryDate)} {e.expiryDate.slice(0, 4)} · {e.dte}d</option>)}</select>
          {usesDelta && <Seg label="Short-leg delta" value={curDelta} onChange={setDelta} options={[...new Set([...DELTAS, s.defaults.delta])].sort((a, b) => a - b).map(v => [v, `${Math.round(v * 100)}Δ`])} />}
          {usesWidth && <Seg label="Width" value={curWidth} onChange={setWidth} options={WIDTHS} />}
        </div>}
      </header>
      {chainState || (<>
        {events.length > 0 && <p className="ocard-finding"><span className="otag" style={{ borderColor: "var(--oc-2)", marginRight: 6 }}>before expiry</span>{events.map(e => `${e.type} ${dayLabel(e.date)}`).join(" · ")}: a gap or an early assignment is possible.</p>}
        {!cands.length ? <p className="ocard-finding">No {s.name.toLowerCase()} can be built at {exp ? `${dayLabel(exp.expiryDate)} (${exp.dte} days)` : "any expiry"} from contracts with a spread under 35% of the midpoint and at least 50 open: try another expiry, a wider width, or a more liquid name.</p> : (<>
          <div className="okpis" style={{ marginTop: 8 }}>
            <Kpi label="Net at fills" value={netTxt(c)} sub={`at mids ${finite(c.netMidPerShare) ? usd(Math.abs(c.netMidPerShare)) : "—"} a share`} />
            <Kpi label="Max profit" value={maxP(c)} sub="per lot" />
            <Kpi label="Max loss" value={maxL(c)} sub="per lot" />
            <Kpi label="Break-even" value={(c.breakevens || []).map(usd).join(" / ") || "—"} sub={(c.breakevens || []).map(b => signed((b / c.spot - 1) * 100, 1, "%")).join(" / ")} />
            <Kpi label="Capital" value={money0(c.capital)} sub={finite(c.returnOnRisk) ? (YIELD.has(s.id) ? `yield ${pct1(c.returnOnRisk)} · ${pct0(c.annualized)} a year, simple` : `return on risk ${pct0(c.returnOnRisk)}`) : finite(c.returnOnCapital) ? `return on margin ${pct1(c.returnOnCapital)} (approximate)` : ""} />
            <Kpi label="Market-implied odds" value={finite(c.pop) ? `${pct0(c.pop)} profit` : "—"} sub={odds(c)} />
            <Kpi label="Greeks per lot" value={`Δ ${fx(r0(c.greeks?.delta), 0)}`} sub={`θ ${usd(r0(c.greeks?.theta), 0)}/day · vega ${usd(r0(c.greeks?.vega), 0)}/pt`} title="Delta in share-equivalents; theta in dollars a day; vega in dollars per volatility point" />
          </div>
          <div className="ogrid ogrid-2" style={{ alignItems: "start" }}>
            <PayoffPanels c={c} dist={dist} />
            <div>
              <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Candidates at {dayLabel(exp.expiryDate)} · click to draw · − sold, + bought, P put, C call</div>
              <div className="otable-wrap"><table className="otable">
                <thead><tr><th style={{ textAlign: "left" }}>Legs</th><th style={{ textAlign: "right" }}>Net / sh</th><th style={{ textAlign: "right" }}>Max profit</th><th style={{ textAlign: "right" }}>Max loss</th><th style={{ textAlign: "right" }}>RoR</th><th style={{ textAlign: "right" }} title="Market-implied probability of finishing with a profit">Odds</th><th style={{ textAlign: "right" }} title="Widest leg spread as a share of its midpoint">Spread</th></tr></thead>
                <tbody>{cands.map((x, i) => (
                  <tr key={x.key || i} className="oclick" onClick={() => setPick(i)} style={i === Math.min(pick, cands.length - 1) ? { outline: "2px solid var(--oc-1)", outlineOffset: -2 } : undefined}>
                    <td style={{ textAlign: "left" }}>{legsText(x)}</td>
                    <td style={{ textAlign: "right" }}>{signed(x.netPerShare, 2)}</td>
                    <td style={{ textAlign: "right" }}>{maxP(x)}</td>
                    <td style={{ textAlign: "right" }}>{maxL(x)}</td>
                    <td style={{ textAlign: "right" }}>{pct0(x.returnOnRisk)}</td>
                    <td style={{ textAlign: "right" }}>{pct0(x.pop)}</td>
                    <td style={{ textAlign: "right" }}>{pct0(x.liquidity?.worstSpread)}</td>
                  </tr>))}
                </tbody>
              </table></div>
              <div className="ocard-eyebrow" style={{ margin: "10px 0 4px" }}>Legs of the drawn trade</div>
              <MiniTable rows={c.legs || []} maxHeight={200} columns={[
                { key: "side", label: "Leg", fmt: (v, l) => `${v === "sell" ? "Sell" : "Buy"} ${l.type === "C" ? "call" : "put"} ${strikeTxt(l.strike)}` },
                { key: "bid", label: "Bid", fmt: v => fx(v, 2) }, { key: "ask", label: "Ask", fmt: v => fx(v, 2) }, { key: "fill", label: "Fill", fmt: v => fx(v, 2) },
                { key: "delta", label: "Delta", fmt: v => fx(v, 2) }, { key: "iv", label: "IV", fmt: v => (finite(v) ? `${fx(v * (v < 5 ? 100 : 1), 0)}%` : "—") },
                { key: "oi", label: "Open int.", fmt: v => (finite(v) ? v.toLocaleString("en-US") : "—") }, { key: "vol", label: "Volume", fmt: v => (finite(v) ? v.toLocaleString("en-US") : "—") },
              ]} />
              {(c.notes || []).length > 0 && <ul className="ostrat-notes">{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
          </div>
        </>)}
      </>)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// screener: the same trade across the market scan (server-side screenChain at ~45 days)
// ---------------------------------------------------------------------------
const SCOLS = [
  { key: "symbol", label: "Name", v: x => x.r.symbol },
  { key: "iv30", label: "IV 30d", v: x => x.r.iv30 },
  { key: "exp", label: "Expiry", v: x => x.c.dte },
  { key: "legs", label: "Legs", v: null },
  { key: "net", label: "Net / sh", long: "net premium a share", v: x => x.c.netPerShare },
  { key: "maxProfit", label: "Max profit", v: x => (x.c.unlimitedProfit ? Infinity : x.c.maxProfit) },
  { key: "maxLoss", label: "Max loss", v: x => (x.c.unlimitedLoss ? Infinity : x.c.maxLoss) },
  { key: "capital", label: "Capital", v: x => x.c.capital },
  { key: "ror", label: "RoR", long: "return on risk", v: x => x.c.returnOnRisk, title: "Return on risk: max profit ÷ max loss (÷ capital for cash-secured puts and covered calls)" },
  { key: "ann", label: "Annualized", long: "annualized yield", v: x => x.c.annualized, title: "Return on risk × 365 ÷ days, simple" },
  { key: "pop", label: "Odds of profit", long: "market-implied odds of profit", v: x => x.c.pop, title: "Market-implied (risk-neutral) probability of finishing with any profit" },
  { key: "pMax", label: "Odds of max", long: "odds of the maximum profit", v: x => x.c.pMax },
  { key: "spread", label: "Spread", long: "widest bid/ask spread", v: x => x.c.liquidity?.worstSpread, title: "Widest leg bid/ask spread as a share of its midpoint" },
  { key: "earn", label: "Before expiry", v: x => (x.earnBefore ? 1 : 0) },
];

function Screener({ s, market, onOpen }) {
  const [only, setOnly] = useState("all");
  const defSort = id => ({ key: YIELD.has(id) ? "ann" : CREDIT.has(id) ? "ror" : "pop", dir: -1 });
  const [sort, setSort] = useState(() => defSort(s.id));
  useEffect(() => { setSort(defSort(s.id)); }, [s.id]);
  const cols = SCOLS.filter(c => c.key !== "ann" || YIELD.has(s.id));
  const rows = (market?.scan?.rows || []).filter(r => r.picks && (only === "all" || r.watch)).map(r => ({ r, c: r.picks[s.id] })).filter(x => x.c)
    .map(x => ({ ...x, earnBefore: !!(x.r.earnings && x.r.earnings <= x.c.expiryDate) }));
  const scanned = (market?.scan?.rows || []).filter(r => r.picks).length;
  const col = cols.find(c => c.key === sort.key) || cols[0];
  const sorted = [...rows].sort((a, b) => { const x = col.v(a), y = col.v(b); return (!finite(x) && typeof x !== "string") - (!finite(y) && typeof y !== "string") || (typeof x === "string" ? x.localeCompare(y) : (x - y)) * sort.dir; });
  // y: return on risk when it is defined for this trade, otherwise the cost as a share of the price
  const useRor = rows.filter(x => finite(x.c.returnOnRisk)).length >= rows.length / 2;
  const pts = rows.filter(x => finite(x.c.pop) && (useRor ? finite(x.c.returnOnRisk) : finite(x.c.capital))).map(x => ({ sym: x.r.symbol, watch: x.r.watch, x: 100 * x.c.pop, y: useRor ? 100 * x.c.returnOnRisk : (100 * x.c.capital) / (x.c.spot * 100) }));
  const labelled = new Set([...pts].sort((a, b) => b.y - a.y).slice(0, 4).map(p => p.sym).concat(pts.filter(p => p.watch).map(p => p.sym)));
  // labels for the top four and the watchlist, skipping any that would collide with one already placed
  // (decisions are remembered per name: recharts redraws the shapes on hover without re-rendering this view)
  const placed = [], decided = new Map();
  const fits = (sym, x, y, w) => { if (decided.has(sym)) return decided.get(sym); const ok = !placed.some(b => x < b.x + b.w && x + w > b.x && Math.abs(y - b.y) < 11); if (ok) placed.push({ x, y, w }); decided.set(sym, ok); return ok; };
  const shape = color => props => { const { cx, cy, payload } = props; const w = payload.sym.length * 6.2; const show = labelled.has(payload.sym) && fits(payload.sym, cx + 7, cy, w); return (<g style={{ cursor: "pointer" }}><circle cx={cx} cy={cy} r={5} fill={color} stroke="var(--card-bg)" strokeWidth={2} />{show && <text x={cx + 7} y={cy + 3} fontSize={10} fill="var(--text-secondary)" fontFamily="var(--font-number)">{payload.sym}</text>}</g>); };
  const best = sorted[0];
  if (!scanned) return (
    <section className="ocard"><div className="ocard-eyebrow">Screener</div><h3 className="ocard-title">{s.name} across the market scan</h3>
      <p className="ocard-finding">{market?.scan ? "Screener picks appear once the next market scan finishes (it builds every 30 minutes)." : "Waiting for the market scan."}</p></section>
  );
  return (
    <VizCard eyebrow={`${rows.length} of ${scanned} scanned names · nearest expiry to 45 days · default strikes`} title={`${s.name} across the market scan`}
      right={<Seg label="Names" value={only} onChange={setOnly} options={[["all", "All scanned"], ["watch", "Watchlist"]]} />}
      finding={best ? `Sorted by ${col.long || col.label.toLowerCase()}, ${sort.dir < 0 ? "highest" : "lowest"} first: ${best.r.symbol} (${legsText(best.c)}, ${dayLabel(best.c.expiryDate)}) at ${pct0(best.c.returnOnRisk)} return on risk with ${pct0(best.c.pop)} market-implied odds of profit. Names where earnings fall before expiry are flagged; their premium partly pays for the announcement gap.` : `No scanned name has a liquid ${s.name.toLowerCase()} at the default strikes.`}
      note="One candidate per name at the default delta and width; click a row to open it in the builder above and change strikes. Odds come from each name's options-implied distribution, not forecasts; richer premium usually means more risk is being priced.">
      {pts.length > 2 && (<>
        <Legend items={[["Scanned name", C[1]], ["Watchlist", C[2]]]} />
        <div className="onote" style={{ margin: 0 }}>↑ {useRor ? "return on risk (max profit ÷ max loss)" : "cost as a share of the price"}</div>
        <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 24, left: -4, bottom: 4 }}>
            <CartesianGrid stroke="var(--border-subtle)" />
            <XAxis type="number" dataKey="x" name="Odds of profit" domain={["auto", "auto"]} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => `${Math.round(v)}%`} label={{ value: "market-implied odds of profit →", position: "insideBottomRight", offset: -2, fill: "var(--text-muted)", fontSize: 10 }} />
            <YAxis type="number" dataKey="y" name={useRor ? "Return on risk" : "Cost, % of price"} domain={["auto", "auto"]} tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${Math.round(v)}%`} />
            <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} cursor={{ strokeDasharray: "3 3" }} formatter={(v, n) => [`${v.toFixed(1)}%`, n]} labelFormatter={() => ""} content={({ payload }) => payload?.length ? <div style={{ ...tipStyle, padding: "6px 8px" }}><strong>{payload[0].payload.sym}</strong><div>Odds of profit {payload[0].payload.x.toFixed(0)}%</div><div>{useRor ? "Return on risk" : "Cost"} {payload[0].payload.y.toFixed(1)}%</div></div> : null} />
            <Scatter data={pts.filter(p => !p.watch)} shape={shape(C[1])} isAnimationActive={false} onClick={p => onOpen(p.sym)} />
            <Scatter data={pts.filter(p => p.watch)} shape={shape(C[2])} isAnimationActive={false} onClick={p => onOpen(p.sym)} />
          </ScatterChart>
        </ResponsiveContainer></div>
        <p className="ocard-note" style={{ marginTop: 0 }}>{useRor ? "Up and to the right is better on both counts; the two usually trade off, so names far above the cloud at the same odds are pricing unusual risk (often an event)." : "For bought volatility the cost is the hurdle: the stock must move more than this, in either direction, by expiry."}</p>
      </>)}
      <div className="otable-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
        <table className="otable">
          <thead><tr>{cols.map(c => <th key={c.key} title={c.title} style={{ textAlign: c.key === "symbol" || c.key === "legs" ? "left" : "right" }}>{c.v ? <button type="button" onClick={() => setSort(o => ({ key: c.key, dir: o.key === c.key ? -o.dir : -1 }))}>{c.label}{sort.key === c.key ? (sort.dir < 0 ? " ▾" : " ▴") : ""}</button> : c.label}</th>)}</tr></thead>
          <tbody>{sorted.map(({ r, c, earnBefore }) => (
            <tr key={r.symbol} className="oclick" onClick={() => onOpen(r.symbol)} title={`Open ${r.symbol} in the builder`}>
              <td style={{ textAlign: "left" }}><strong>{r.symbol}</strong>{r.watch && <span className="otag" style={{ marginLeft: 4 }}>watch</span>}</td>
              <td style={{ textAlign: "right" }}>{fx(r.iv30, 0)}</td>
              <td style={{ textAlign: "right" }}>{dayLabel(c.expiryDate)} <span className="onote">{c.dte}d</span></td>
              <td style={{ textAlign: "left" }}>{legsText(c)}</td>
              <td style={{ textAlign: "right" }}>{signed(c.netPerShare, 2)}</td>
              <td style={{ textAlign: "right" }}>{maxP(c)}</td>
              <td style={{ textAlign: "right" }}>{maxL(c)}</td>
              <td style={{ textAlign: "right" }}>{money0(c.capital)}</td>
              <td style={{ textAlign: "right" }}>{YIELD.has(s.id) ? pct1(c.returnOnRisk) : pct0(c.returnOnRisk)}</td>
              {YIELD.has(s.id) && <td style={{ textAlign: "right" }}>{pct0(c.annualized)}</td>}
              <td style={{ textAlign: "right" }}>{pct0(c.pop)}</td>
              <td style={{ textAlign: "right" }}>{pct0(c.pMax)}</td>
              <td style={{ textAlign: "right" }}>{pct0(c.liquidity?.worstSpread)}</td>
              <td style={{ textAlign: "right" }}>{earnBefore ? <span className="otag" style={{ borderColor: "var(--oc-2)" }}>earnings {dayLabel(r.earnings)}</span> : ""}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </VizCard>
  );
}

function CheatSheet({ value, onPick }) {
  return (
    <section className="ocard">
      <div className="ocard-eyebrow">Reference</div>
      <h3 className="ocard-title">All twelve side by side</h3>
      <div className="otable-wrap" style={{ marginTop: 6 }}><table className="otable ostrat-sheet">
        <thead><tr><th style={{ textAlign: "left" }}>Strategy</th><th style={{ textAlign: "left" }}>Shape</th><th style={{ textAlign: "left" }}>View</th><th style={{ textAlign: "left" }}>Legs</th><th style={{ textAlign: "left" }}>Max profit</th><th style={{ textAlign: "left" }}>Max loss</th><th style={{ textAlign: "left" }}>Capital</th></tr></thead>
        <tbody>{STRATEGIES.map(s => (
          <tr key={s.id} className="oclick" onClick={() => onPick(s.id)} style={value === s.id ? { outline: "2px solid var(--oc-1)", outlineOffset: -2 } : undefined}>
            <td style={{ textAlign: "left" }}><strong>{s.name}</strong></td>
            <td style={{ textAlign: "left" }}><Schematic id={s.id} width={70} height={26} /></td>
            <td style={{ textAlign: "left" }}>{s.outlook}<br /><span className="onote">{s.volView}</span></td>
            <td style={{ textAlign: "left" }}>{s.legs}</td>
            <td style={{ textAlign: "left" }}>{s.maxProfit}</td>
            <td style={{ textAlign: "left" }}>{s.maxLoss}</td>
            <td style={{ textAlign: "left" }}>{s.capital}</td>
          </tr>))}
        </tbody>
      </table></div>
    </section>
  );
}

export default function StrategiesView({ symbol, chain, context, chainState, market, onSymbol }) {
  const [id, setId] = useState(() => { try { const v = localStorage.getItem(KEY); return STRATEGY_BY_ID[v] ? v : "csp"; } catch { return "csp"; } });
  useEffect(() => { try { localStorage.setItem(KEY, id); } catch {} }, [id]);
  const s = STRATEGY_BY_ID[id] || STRATEGIES[0];
  const builderRef = useRef(null);
  const open = sym => { onSymbol(sym); builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return (
    <div className="ostrat-layout">
      <Rail value={s.id} onPick={setId} />
      <div style={{ minWidth: 0, display: "grid", gap: 12 }}>
        <Explainer s={s} />
        <Builder s={s} symbol={symbol} chain={chain} context={context} chainState={chainState} focusRef={builderRef} />
        <Screener s={s} market={market} onOpen={open} />
        <CheatSheet value={s.id} onPick={setId} />
        <p className="onote">{CAVEATS.notAdvice} {CAVEATS.odds} {CAVEATS.fills} {CAVEATS.fees} {CAVEATS.expiry} Listed U.S. equity options are American-style: short calls can be assigned early ahead of an ex-dividend date, and deep in-the-money puts at any time. {CAVEATS.margin}</p>
      </div>
    </div>
  );
}
