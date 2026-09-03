import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH, InfoBox } from "../../components/shared.jsx";

// ============================================================================
// OPTIONS → MARKET EXPECTATIONS
// What the options market is predicting about the future value of a stock.
// Every price on the chain is a bet on where the stock finishes, so the chain
// implies a probability distribution for each expiry. We read it out with
// per-strike implied vol (the smile) through the Black-Scholes N(d2) term:
//     P(S_T > K) ≈ N(d2),  d2 = [ln(F/K) − σ_K² T/2] / (σ_K √T)
// — a smile-adjusted approximation of the risk-neutral CDF (it drops the
// dσ/dK term of the full Breeden–Litzenberger density). From the CDF at each
// expiry we get percentile prices → the CONE; differencing it → the
// DISTRIBUTION at one expiry; reading it at fixed levels → the ODDS TABLE.
// Honest caveat, repeated on the page: these are risk-NEUTRAL probabilities.
// They are the market's PRICE for an outcome, which includes the premium
// investors pay for protection — so downside odds read fatter than a pure
// forecast would. They are still the best single read of what the market
// itself expects, and they move the moment the market does.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569";
const fin = v => v != null && isFinite(v);
const pc = (v, dp = 0) => (fin(v) ? `${(v * 100).toFixed(dp)}%` : "—");
const usd = (v, dp = 0) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const R = 0.04; // risk-free rate used for the forward; dividends ignored (small at these horizons)
const HORIZONS = [30, 60, 90, 180, 365];

// Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 7.5e-8)
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function nearestDte(dtes, target) {
  const tol = Math.max(10, target * 0.4);
  const c = dtes.filter(d => Math.abs(d - target) <= tol);
  if (!c.length) return null;
  return c.reduce((b, d) => (Math.abs(d - target) < Math.abs(b - target) ? d : b), c[0]);
}

// Smile-adjusted CDF at one expiry from the chain: OTM-side IV per strike,
// P(S_T > K) = N(d2), forced monotone (real smiles are noisy).
function impliedCdf(options, dte, spot) {
  const T = dte / 365, F = spot * Math.exp(R * T);
  const byStrike = new Map();
  for (const o of options) {
    if (o.dte !== dte || !fin(o.iv) || o.iv <= 0) continue;
    const otm = (o.type === "P" && o.strike <= spot) || (o.type === "C" && o.strike >= spot);
    const cur = byStrike.get(o.strike);
    if (!cur || (otm && !cur.otm)) byStrike.set(o.strike, { iv: o.iv, otm });
  }
  const ks = [...byStrike.keys()].filter(k => k > spot * 0.4 && k < spot * 2.2).sort((a, b) => a - b);
  if (ks.length < 8) return null;
  const pts = ks.map(K => {
    const s = byStrike.get(K).iv;
    const d2 = (Math.log(F / K) - (s * s * T) / 2) / (s * Math.sqrt(T));
    return { K, above: normCdf(d2) };
  });
  // P(S>K) must fall as K rises — running minimum from the low end
  let m = 1;
  for (const p of pts) { m = Math.min(m, p.above); p.above = m; p.cdf = 1 - m; }
  const atmIv = byStrike.get(ks.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), ks[0]))?.iv ?? null;
  return { dte, T, F, pts, atmIv };
}

// price at which the CDF crosses p (linear interpolation)
function quantile(cdf, p) {
  const { pts } = cdf;
  if (p <= pts[0].cdf) return pts[0].K;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].cdf >= p) {
      const a = pts[i - 1], b = pts[i];
      const w = b.cdf > a.cdf ? (p - a.cdf) / (b.cdf - a.cdf) : 0;
      return a.K + w * (b.K - a.K);
    }
  }
  return pts[pts.length - 1].K;
}
// P(S_T > level) from the CDF (interpolated)
function pAbove(cdf, level) {
  const { pts } = cdf;
  if (level <= pts[0].K) return pts[0].above;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].K >= level) {
      const a = pts[i - 1], b = pts[i];
      const w = (level - a.K) / (b.K - a.K);
      return a.above + w * (b.above - a.above);
    }
  }
  return pts[pts.length - 1].above;
}

function Stat({ title, value, sub, color = "var(--text-primary)" }) {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div style={{ ...note, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

export default function ExpectationsView({ symbol, chain, closes, target }) {
  const [sel, setSel] = useState(90);

  const m = useMemo(() => {
    if (!chain?.options?.length || !chain.spot) return null;
    const { options, spot } = chain;
    const dtes = [...new Set(options.map(o => o.dte))].filter(d => d >= 3 && d <= 400).sort((a, b) => a - b);
    // one CDF per expiry that has enough strikes
    const cdfs = dtes.map(d => impliedCdf(options, d, spot)).filter(Boolean);
    if (!cdfs.length) return null;
    const today = new Date();
    const dateOf = dte => { const d = new Date(today); d.setDate(d.getDate() + dte); return d.toISOString().slice(0, 10); };

    // the cone: percentile prices by expiry, growing out of recent history
    const cone = cdfs.map(c => ({ d: dateOf(c.dte), dte: c.dte, q10: quantile(c, 0.10), q25: quantile(c, 0.25), q50: quantile(c, 0.50), q75: quantile(c, 0.75), q90: quantile(c, 0.90), atmIv: c.atmIv }));
    const hist = (closes || []).slice(-60);
    const histRows = hist.map((h, i) => ({ d: h.date, close: h.close, i }));
    const coneRows = [
      ...histRows.map(r => ({ d: r.d, close: r.close })),
      { d: dateOf(0), close: spot, q50: spot, band50: [spot, spot], band80: [spot, spot] },
      ...cone.map(c => ({ d: c.d, q50: c.q50, band50: [c.q25, c.q75], band80: [c.q10, c.q90] })),
    ];

    // the distribution at the selected horizon
    const selDte = nearestDte(cdfs.map(c => c.dte), sel);
    const selCdf = cdfs.find(c => c.dte === selDte) || null;
    let dist = [];
    if (selCdf) {
      const pts = selCdf.pts;
      for (let i = 1; i < pts.length - 1; i++) {
        const dens = (pts[i + 1].cdf - pts[i - 1].cdf) / (pts[i + 1].K - pts[i - 1].K); // probability per $1
        if (fin(dens) && dens >= 0) dist.push({ K: pts[i].K, dens: dens * 100, side: pts[i].K < spot ? "down" : "up" });
      }
    }
    const selQ = selCdf ? { q10: quantile(selCdf, 0.1), q25: quantile(selCdf, 0.25), q50: quantile(selCdf, 0.5), q75: quantile(selCdf, 0.75), q90: quantile(selCdf, 0.9) } : null;

    // the odds table at fixed horizons
    const table = HORIZONS.map(h => {
      const d = nearestDte(cdfs.map(c => c.dte), h);
      const c = cdfs.find(x => x.dte === d);
      if (!c) return { h, d: null };
      return {
        h, d, date: dateOf(d), atmIv: c.atmIv,
        pUp: pAbove(c, spot), up5: pAbove(c, spot * 1.05), dn5: 1 - pAbove(c, spot * 0.95),
        up10: pAbove(c, spot * 1.10), dn10: 1 - pAbove(c, spot * 0.90), up20: pAbove(c, spot * 1.20), dn20: 1 - pAbove(c, spot * 0.80),
        q25: quantile(c, 0.25), q50: quantile(c, 0.5), q75: quantile(c, 0.75),
      };
    }).filter(r => r.d != null);

    // analyst target vs the market's odds at the longest horizon ≤ 1y
    const far = [...cdfs].filter(c => c.dte <= 400).sort((a, b) => b.dte - a.dte)[0];
    const tgt = target?.targetConsensus;
    const tgtOdds = far && fin(tgt) ? { p: pAbove(far, tgt), dte: far.dte, date: dateOf(far.dte) } : null;
    const r90 = table.find(r => r.h === 90) || table[0];
    return { spot, cdfs, cone, coneRows, histCount: histRows.length, selCdf, selDte, dist, selQ, table, tgt, tgtOdds, r90, far };
  }, [chain, closes, sel, target]);

  if (!m) return <InfoBox color="#F97316"><strong style={{ color: "#cbd5e1" }}>No usable chain for {symbol}.</strong> Need at least one expiry with 8+ quoted strikes to read an implied distribution.</InfoBox>;

  const chip = active => ({ padding: "3px 10px", borderRadius: 6, border: `1px solid ${active ? INDIGO : "rgba(255,255,255,0.1)"}`, background: active ? INDIGO : "rgba(255,255,255,0.05)", color: active ? "#0f172a" : SLATE, fontSize: 10, fontWeight: 600, fontFamily: fonts.mono, cursor: "pointer" });
  const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
  const th = (t, align = "right") => <th style={{ padding: "5px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{t}</th>;
  const td = (v, extra = {}) => <td style={{ padding: "6px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "#cbd5e1", whiteSpace: "nowrap", ...extra }}>{v}</td>;
  const r90 = m.r90;
  const skewRead = r90 ? (r90.dn10 > r90.up10 * 1.4 ? { text: "downside priced much fatter than upside — the market is paying up for protection", color: AMBER }
    : r90.up10 > r90.dn10 * 1.2 ? { text: "upside priced fatter than downside — call demand, a rare setup", color: GREEN }
    : { text: "tails roughly symmetric", color: SLATE }) : null;

  return (<>
    {/* headline */}
    <SH>What the Options Market Expects — {symbol} at {usd(m.spot, 2)}</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 10 }}>
      <Stat title={`Median expected · ${r90?.h ?? "—"} days`} value={usd(r90?.q50)} color="var(--text-primary)"
        sub={r90 ? `middle half of outcomes ${usd(r90.q25)}–${usd(r90.q75)} · by ${r90.date}` : "—"} />
      <Stat title={`Odds it's higher · ${r90?.h ?? "—"} days`} value={pc(r90?.pUp)} color={r90?.pUp >= 0.5 ? GREEN : RED}
        sub={r90 ? `+10% or more: ${pc(r90.up10)} · −10% or worse: ${pc(r90.dn10)}` : "—"} />
      <Stat title="Tail asymmetry · 90 days" value={r90 ? `${(r90.dn10 / Math.max(0.001, r90.up10)).toFixed(1)}×` : "—"} color={skewRead?.color || SLATE}
        sub={skewRead ? `odds of −10% vs +10% · ${skewRead.text}` : "—"} />
      <Stat title="Analyst target vs market odds" value={m.tgtOdds ? pc(m.tgtOdds.p) : "—"} color={m.tgtOdds ? (m.tgtOdds.p >= 0.4 ? GREEN : m.tgtOdds.p >= 0.25 ? AMBER : RED) : SLATE}
        sub={m.tgtOdds ? `market odds of ≥ ${usd(m.tgt)} consensus target by ${m.tgtOdds.date} (${m.tgtOdds.dte}d)` : fin(m.tgt) ? `consensus target ${usd(m.tgt)} · no expiry near 1y` : "no consensus target"} />
    </div>

    {/* the cone */}
    <div style={{ ...card, padding: "12px 16px 8px", marginBottom: 12 }}>
      <div style={label}>The cone — where the market puts {symbol} at each expiry</div>
      <div style={{ ...note, marginTop: 3 }}>solid = last {m.histCount} closes · line = median implied price · dark band = middle 50% of outcomes (25th–75th pct) · light band = 80% (10th–90th) · read from each expiry&apos;s full smile, not one volatility number</div>
      <ResponsiveContainer width="100%" height={290}>
        <ComposedChart data={m.coneRows} margin={{ top: 14, right: 18, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="d" tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={d => d.slice(2, 7)} minTickGap={36} axisLine={false} tickLine={false} />
          <YAxis domain={["auto", "auto"]} tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} width={56} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} formatter={(v, n) => Array.isArray(v) ? [`${usd(v[0])} – ${usd(v[1])}`, n === "band50" ? "middle 50%" : "80% range"] : [usd(v, 2), n === "close" ? "close" : "median implied"]} />
          <Area type="monotone" dataKey="band80" stroke="none" fill={INDIGO} fillOpacity={0.12} connectNulls={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="band50" stroke="none" fill={INDIGO} fillOpacity={0.22} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="close" stroke="#cbd5e1" strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="q50" stroke={INDIGO} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
          {fin(m.tgt) && <ReferenceLine y={m.tgt} stroke={AMBER} strokeDasharray="4 3" label={{ value: `analyst target ${usd(m.tgt)}`, position: "insideTopLeft", fill: AMBER, fontSize: 9.5, fontFamily: fonts.mono }} />}
          <ReferenceLine y={m.spot} stroke="#f1f5f9" strokeOpacity={0.35} strokeDasharray="2 3" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>

    {/* the distribution at one horizon + the odds table */}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.1fr) minmax(320px, 1fr)", gap: 12, marginBottom: 12 }}>
      <div style={{ ...card, padding: "12px 16px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={label}>Implied distribution · {m.selDte ?? "—"} days</div>
          <div style={{ display: "flex", gap: 4 }}>{HORIZONS.map(h => <button key={h} onClick={() => setSel(h)} style={chip(sel === h)}>{h >= 365 ? "1y" : `${h}d`}</button>)}</div>
        </div>
        {m.dist.length ? (<>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={m.dist} margin={{ top: 16, right: 12, bottom: 4, left: -6 }}>
              <defs>
                <linearGradient id="dist-fill" x1="0" y1="0" x2="1" y2="0">
                  <stop offset={0} stopColor={RED} stopOpacity={0.35} />
                  <stop offset={Math.max(0, Math.min(1, (m.spot - m.dist[0].K) / (m.dist[m.dist.length - 1].K - m.dist[0].K)))} stopColor={RED} stopOpacity={0.35} />
                  <stop offset={Math.max(0, Math.min(1, (m.spot - m.dist[0].K) / (m.dist[m.dist.length - 1].K - m.dist[0].K)))} stopColor={GREEN} stopOpacity={0.35} />
                  <stop offset={1} stopColor={GREEN} stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <XAxis dataKey="K" type="number" domain={["dataMin", "dataMax"]} tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={tip} labelFormatter={k => `${usd(k)} at expiry`} formatter={v => [`${v.toFixed(2)}% per $1`, "implied probability density"]} />
              <Area type="monotone" dataKey="dens" stroke={INDIGO} strokeWidth={1.5} fill="url(#dist-fill)" isAnimationActive={false} />
              <ReferenceLine x={m.spot} stroke="#f1f5f9" strokeDasharray="4 3" label={{ value: `spot ${usd(m.spot)}`, position: "top", fill: "#f1f5f9", fontSize: 9.5, fontFamily: fonts.mono }} />
              {m.selQ && <ReferenceLine x={m.selQ.q50} stroke={INDIGO} strokeDasharray="2 3" label={{ value: `median ${usd(m.selQ.q50)}`, position: "insideTopRight", fill: INDIGO, fontSize: 9.5, fontFamily: fonts.mono }} />}
            </ComposedChart>
          </ResponsiveContainer>
          {m.selQ && <div style={{ ...note, marginTop: 2 }}>10th–90th pct {usd(m.selQ.q10)}–{usd(m.selQ.q90)} · middle half {usd(m.selQ.q25)}–{usd(m.selQ.q75)} · red mass = finishing below today&apos;s price, green = above</div>}
        </>) : <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, padding: 20 }}>No expiry with enough strikes near {sel} days.</div>}
      </div>

      <div style={{ ...card, padding: "12px 12px 8px", overflowX: "auto" }}>
        <div style={label}>The odds — market-implied probabilities by horizon</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead><tr>{th("Horizon", "left")}{th("Higher")}{th("+5%")}{th("−5%")}{th("+10%")}{th("−10%")}{th("±20%")}{th("Median")}{th("ATM IV")}</tr></thead>
          <tbody>
            {m.table.map(r => (
              <tr key={r.h} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {td(`${r.d}d · ${r.date.slice(5)}`, { textAlign: "left", color: "var(--text-primary)", fontWeight: 700 })}
                {td(pc(r.pUp), { color: r.pUp >= 0.5 ? GREEN : RED, fontWeight: 700 })}
                {td(pc(r.up5))}{td(pc(r.dn5))}
                {td(pc(r.up10), { color: GREEN })}{td(pc(r.dn10), { color: RED })}
                {td(`${pc(r.up20)} / ${pc(r.dn20)}`, { color: SLATE })}
                {td(usd(r.q50))}
                {td(pc(r.atmIv, 1), { color: SLATE })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>
          &ldquo;Higher&rdquo; = finishes above today&apos;s price. ±20% column = odds of +20% / −20%. The median sits below spot at long horizons by construction — a lognormal&apos;s median is below its mean, and the forward barely exceeds spot at today&apos;s rates.
        </div>
      </div>
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read this — and the one caveat that matters.</strong> The chain prices every strike, so it implies a full probability distribution for each expiry; we read it out of the smile strike by strike, which is why the downside band is fatter than the upside band and why a single volatility number would get it wrong. These are <em>risk-neutral</em> probabilities: the market&apos;s price for an outcome, which includes the premium investors pay for protection. That makes the downside odds read somewhat fatter than a pure forecast — treat &ldquo;−10% or worse: 22%&rdquo; as &ldquo;the market charges as if it were 22%.&rdquo; Read levels, ranges and asymmetry; compare them to the analyst target and to your own view. When the market&apos;s median sits well below the Street&apos;s target, one of them is wrong, and the options market has real money on its answer.
    </InfoBox>
  </>);
}
