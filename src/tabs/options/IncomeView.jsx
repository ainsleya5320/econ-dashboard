import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH, InfoBox } from "../../components/shared.jsx";
import { fetchOptionsChain, fetchFMP } from "../../lib/api.js";

// ============================================================================
// OPTIONS → INCOME VIEW
// The question an income seller actually asks: "what am I paid to take what
// risk, and is now a good time to be paid?" Three pieces, one symbol:
//   1. Premium regime — implied vs realized vol (are sellers overpaid?), the
//      expected move, term structure (calm vs event), and put skew (fear).
//   2. The income ladder — every strike at the chosen expiry as a bar of
//      ANNUALIZED yield, colored by the probability of assignment (|delta|),
//      with the spot line and the ±1σ expected-move zone. Puts left, calls
//      right. Bright green bars are the 15–30Δ sweet spot.
//   3. Candidate tables — puts to sell (cash-secured) and calls to sell
//      (covered) with premium, yield, probability, breakeven / if-called.
// Data: CBOE chain (bid/ask/iv/delta/OI) + FMP daily closes for realized vol.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569";
const fin = v => v != null && isFinite(v);
const pc = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const pcS = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "—");
const usd = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const DTE_TARGETS = [30, 45, 60, 90];

// Probability-of-assignment bands (|delta| ≈ chance the option finishes ITM)
function band(prob) {
  if (!fin(prob)) return { key: "na", color: "#334155", name: "no delta" };
  if (prob < 0.15) return { key: "far", color: "#64748b", name: "<15Δ · far OTM" };
  if (prob <= 0.30) return { key: "sweet", color: GREEN, name: "15–30Δ · sweet spot" };
  if (prob <= 0.50) return { key: "near", color: AMBER, name: "30–50Δ · likely assigned" };
  return { key: "itm", color: RED, name: ">50Δ · in the money" };
}

// nearest available expiry to a target DTE (within ±40%, min ±10 days)
function nearestDte(dtes, target) {
  const tol = Math.max(10, target * 0.4);
  const c = dtes.filter(d => Math.abs(d - target) <= tol);
  if (!c.length) return null;
  return c.reduce((b, d) => (Math.abs(d - target) < Math.abs(b - target) ? d : b), c[0]);
}

// ATM implied vol at an expiry: average of the call and put closest to spot
function atmIv(options, dte, spot) {
  const at = options.filter(o => o.dte === dte && fin(o.iv) && o.iv > 0);
  if (!at.length) return null;
  const pick = type => at.filter(o => o.type === type).reduce((b, o) => (!b || Math.abs(o.strike - spot) < Math.abs(b.strike - spot) ? o : b), null);
  const c = pick("C"), p = pick("P");
  const ivs = [c?.iv, p?.iv].filter(fin);
  return ivs.length ? (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 : null;
}

// Realized vol from daily closes: annualized stdev of log returns over N days
function realizedVol(closes, n) {
  const c = closes.slice(-(n + 1));
  if (c.length < n + 1) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) rets.push(Math.log(c[i] / c[i - 1]));
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252) * 100;
}

function Stat({ title, value, sub, color = "var(--text-primary)", chip }) {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1 }}>{value}</span>
        {chip && <span style={{ fontSize: 9.5, fontWeight: 700, color: chip.color, background: `${chip.color}1e`, padding: "2px 8px", borderRadius: 6, fontFamily: fonts.mono }}>{chip.text}</span>}
      </div>
      <div style={{ ...note, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

export default function IncomeView({ symbol, fmpKey, chain: sharedChain, closes: sharedCloses }) {
  const [ownChain, setChain] = useState(null);
  const [ownCloses, setCloses] = useState(null);
  const [loading, setLoading] = useState(!sharedChain);
  const chain = sharedChain || ownChain;
  // closes arrive as [{date, close}] when shared; as a bare close array when self-fetched
  const closes = sharedCloses ? sharedCloses.map(r => r.close) : ownCloses;
  const [err, setErr] = useState(null);
  const [target, setTarget] = useState(45);

  useEffect(() => {
    if (sharedChain) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setErr(null); setChain(null);
    fetchOptionsChain(symbol)
      .then(d => { if (alive) setChain(d); })
      .catch(e => { if (alive) setErr(e?.message || "chain unavailable"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol, sharedChain]);

  useEffect(() => {
    if (!fmpKey || sharedCloses) return;
    let alive = true;
    setCloses(null);
    fetchFMP(`/historical-price-eod/full?symbol=${symbol}`, fmpKey)
      .then(d => {
        const rows = Array.isArray(d) ? d : (d?.historical || []);
        const chron = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        if (alive) setCloses(chron.map(r => r.close).filter(fin).slice(-130));
      })
      .catch(() => { if (alive) setCloses([]); });
    return () => { alive = false; };
  }, [symbol, fmpKey]);

  const m = useMemo(() => {
    if (!chain?.options?.length || !chain.spot) return null;
    const { options, spot } = chain;
    const dtes = [...new Set(options.map(o => o.dte))].sort((a, b) => a - b);
    const dte = nearestDte(dtes, target);
    const d30 = nearestDte(dtes, 30), d90 = nearestDte(dtes, 90);
    const iv30 = d30 != null ? atmIv(options, d30, spot) : null;
    const iv90 = d90 != null ? atmIv(options, d90, spot) : null;
    const ivSel = dte != null ? atmIv(options, dte, spot) : null;
    const rv30 = closes?.length ? realizedVol(closes, 21) : null;
    const rv90 = closes?.length ? realizedVol(closes, 63) : null;
    const spread = fin(iv30) && fin(rv30) ? iv30 - rv30 : null;
    const ratio = fin(iv30) && fin(rv30) && rv30 > 0 ? iv30 / rv30 : null; // vol risk premium, as a multiple
    const sigma = fin(ivSel) && dte ? spot * (ivSel / 100) * Math.sqrt(dte / 365) : null;

    // 25-delta skew at the selected expiry
    const at = options.filter(o => o.dte === dte && fin(o.iv) && o.iv > 0 && fin(o.delta));
    const p25 = at.filter(o => o.type === "P").reduce((b, o) => (!b || Math.abs(Math.abs(o.delta) - 0.25) < Math.abs(Math.abs(b.delta) - 0.25) ? o : b), null);
    const c25 = at.filter(o => o.type === "C").reduce((b, o) => (!b || Math.abs(o.delta - 0.25) < Math.abs(b.delta - 0.25) ? o : b), null);
    const skew = p25 && c25 ? (p25.iv - c25.iv) * 100 : null;

    // the ladder: puts below spot (cash-secured), calls above (covered)
    const lo = spot * 0.78, hi = spot * 1.22;
    const rows = [];
    for (const o of options) {
      if (o.dte !== dte || !(o.bid > 0) || o.strike < lo || o.strike > hi) continue;
      if (o.type === "P" && o.strike <= spot) {
        const prob = fin(o.delta) ? Math.abs(o.delta) : null;
        const yp = o.bid / o.strike;
        rows.push({ side: "put", strike: o.strike, bid: o.bid, ask: o.ask, oi: o.oi, prob, yp: yp * 100, ann: yp * (365 / dte) * 100, be: o.strike - o.bid, dist: (o.strike / spot - 1) * 100, band: band(prob) });
      } else if (o.type === "C" && o.strike >= spot) {
        const prob = fin(o.delta) ? Math.abs(o.delta) : null;
        const yp = o.bid / spot;
        rows.push({ side: "call", strike: o.strike, bid: o.bid, ask: o.ask, oi: o.oi, prob, yp: yp * 100, ann: yp * (365 / dte) * 100, ifCalled: ((o.strike - spot + o.bid) / spot) * 100, dist: (o.strike / spot - 1) * 100, band: band(prob) });
      }
    }
    rows.sort((a, b) => a.strike - b.strike);
    const puts = rows.filter(r => r.side === "put" && r.prob != null && r.prob >= 0.05 && r.prob <= 0.55).sort((a, b) => b.strike - a.strike).slice(0, 8);
    const calls = rows.filter(r => r.side === "call" && r.prob != null && r.prob >= 0.05 && r.prob <= 0.55).sort((a, b) => a.strike - b.strike).slice(0, 8);
    const sweetPuts = rows.filter(r => r.side === "put" && r.band.key === "sweet");
    const sweetCalls = rows.filter(r => r.side === "call" && r.band.key === "sweet");
    const rng = arr => (arr.length ? { lo: Math.min(...arr.map(r => r.strike)), hi: Math.max(...arr.map(r => r.strike)), annLo: Math.min(...arr.map(r => r.ann)), annHi: Math.max(...arr.map(r => r.ann)) } : null);

    // regime reads
    // vol risk premium: implied ≥ 1.25× realized = sellers overpaid; below 1× = buyers' market
    const premium = !fin(ratio) ? { text: "Premium vs realized", color: SLATE, chip: null }
      : ratio >= 1.25 ? { text: "Premium rich — sellers overpaid", color: GREEN, chip: { text: `Rich · ${ratio.toFixed(2)}×`, color: GREEN } }
      : ratio >= 1.0 ? { text: "Premium fair", color: AMBER, chip: { text: `Fair · ${ratio.toFixed(2)}×`, color: AMBER } }
      : { text: "Premium cheap — hedges are cheap", color: RED, chip: { text: `Cheap · ${ratio.toFixed(2)}×`, color: RED } };
    const term = !fin(iv30) || !fin(iv90) ? null
      : iv30 > iv90 + 1 ? { text: "Backwardation — near-term event risk", color: AMBER }
      : iv30 < iv90 - 1 ? { text: "Contango — calm near term", color: GREEN }
      : { text: "Flat", color: SLATE };
    const skewRead = !fin(skew) ? null : skew >= 8 ? { text: "Fear premium high — puts rich vs calls", color: AMBER } : skew >= 3 ? { text: "Normal put skew", color: SLATE } : { text: "Skew flat — little fear priced", color: GREEN };

    return { spot, dte, dtes, iv30, iv90, ivSel, rv30, rv90, spread, ratio, sigma, skew, rows, puts, calls, sweetPut: rng(sweetPuts), sweetCall: rng(sweetCalls), premium, term, skewRead, p25, c25 };
  }, [chain, closes, target]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading {symbol} options chain (CBOE)…</div>;
  if (err || !m) return <InfoBox color="#F97316"><strong style={{ color: "#cbd5e1" }}>No chain for {symbol}.</strong> {err || "CBOE returned no options or no spot price"} — try another symbol.</InfoBox>;

  const chipStyle = active => ({ padding: "3px 10px", borderRadius: 6, border: `1px solid ${active ? INDIGO : "rgba(255,255,255,0.1)"}`, background: active ? INDIGO : "rgba(255,255,255,0.05)", color: active ? "#0f172a" : SLATE, fontSize: 10, fontWeight: 600, fontFamily: fonts.mono, cursor: "pointer" });
  const cell = (v, extra = {}) => <td style={{ padding: "5px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "#cbd5e1", whiteSpace: "nowrap", ...extra }}>{v}</td>;
  const th = t => <th style={{ padding: "4px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{t}</th>;

  const summary = (() => {
    const parts = [];
    if (fin(m.ratio)) parts.push(`Implied ${pc(m.iv30)} vs realized ${pc(m.rv30)} over the last month (${m.ratio.toFixed(2)}×) — ${m.ratio >= 1.25 ? "sellers are being paid well over what the stock has actually moved" : m.ratio >= 1.0 ? "premium roughly covers what the stock has been doing" : "premium is thin; the market isn't paying you much to take risk"}.`);
    if (m.term) parts.push(m.term.text + ".");
    if (m.sweetPut) parts.push(`At ${m.dte} days the cash-secured sweet spot is the $${m.sweetPut.lo.toFixed(0)}–$${m.sweetPut.hi.toFixed(0)} puts: 15–30% chance of assignment for ${pc(m.sweetPut.annLo)}–${pc(m.sweetPut.annHi)} annualized.`);
    if (m.sweetCall) parts.push(`Covered-call sweet spot: the $${m.sweetCall.lo.toFixed(0)}–$${m.sweetCall.hi.toFixed(0)} calls for ${pc(m.sweetCall.annLo)}–${pc(m.sweetCall.annHi)} annualized.`);
    return parts.join(" ");
  })();

  return (<>
    {/* 1 · premium regime */}
    <SH>Premium Regime — {symbol} at {usd(m.spot)}</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 10 }}>
      <Stat title="Implied vs realized (30d)" value={fin(m.iv30) ? pc(m.iv30) : "—"} color={m.premium.color} chip={m.premium.chip}
        sub={fin(m.rv30) ? `realized ${pc(m.rv30)} · spread ${pcS(m.spread)} pts` : fmpKey ? "realized vol loading…" : "add an FMP key for realized vol"} />
      <Stat title={`Expected move · ${m.dte ?? "—"} days`} value={fin(m.sigma) ? `±${usd(m.sigma)}` : "—"} color="var(--text-primary)"
        sub={fin(m.sigma) ? `±${pc((m.sigma / m.spot) * 100)} · ${usd(m.spot - m.sigma, 0)}–${usd(m.spot + m.sigma, 0)} (1σ, ${pc(m.ivSel)} IV)` : "no ATM IV at this expiry"} />
      <Stat title="Term structure" value={fin(m.iv30) && fin(m.iv90) ? `${pc(m.iv30)} → ${pc(m.iv90)}` : "—"} color={m.term?.color || SLATE}
        sub={m.term ? `${m.term.text} · 30d vs 90d ATM IV` : "need both 30d and 90d expiries"} />
      <Stat title="Put skew (25Δ)" value={fin(m.skew) ? `${pcS(m.skew)} pts` : "—"} color={m.skewRead?.color || SLATE}
        sub={m.skewRead ? `${m.skewRead.text} · put ${pc(m.p25?.iv * 100)} vs call ${pc(m.c25?.iv * 100)}` : "no 25Δ pair at this expiry"} />
    </div>
    <div style={{ ...card, marginBottom: 14, borderLeft: `4px solid ${m.premium.color}`, fontSize: 11.5, color: "#cbd5e1", fontFamily: fonts.heading, lineHeight: 1.55 }}>{summary || "Not enough chain data at this expiry to summarize."}</div>

    {/* 2 · the income ladder */}
    <SH>The Income Ladder — what you are paid to take what risk</SH>
    <div style={{ ...card, padding: "12px 16px 8px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={label}>Annualized yield by strike · puts left of spot (cash-secured), calls right (covered) · {m.dte ?? "—"} days to expiry</div>
          <div style={{ ...note, marginTop: 3 }}>bar color = chance of assignment (|delta|) · shaded band = ±1σ expected move · bid prices, so what you&apos;d actually collect</div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ ...note, marginRight: 4 }}>expiry</span>
          {DTE_TARGETS.map(t => <button key={t} onClick={() => setTarget(t)} style={chipStyle(target === t)}>~{t}d</button>)}
        </div>
      </div>
      {m.rows.length ? (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={m.rows} margin={{ top: 18, right: 16, bottom: 4, left: 0 }} barCategoryGap="12%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="strike" type="number" domain={[m.spot * 0.78, m.spot * 1.22]} tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} width={44} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelFormatter={s => `$${Number(s).toFixed(0)} strike`}
              formatter={(v, _n, p) => [`${v.toFixed(1)}% annualized · ${pc(p.payload.yp, 2)} for ${m.dte}d · ${p.payload.prob != null ? Math.round(p.payload.prob * 100) + "% chance assigned" : "no delta"} · bid ${usd(p.payload.bid)}`, p.payload.side === "put" ? "Sell put (cash-secured)" : "Sell call (covered)"]} />
            {fin(m.sigma) && <ReferenceArea x1={m.spot - m.sigma} x2={m.spot + m.sigma} fill={INDIGO} fillOpacity={0.08} />}
            <ReferenceLine x={m.spot} stroke="#f1f5f9" strokeDasharray="4 3" label={{ value: `spot $${m.spot.toFixed(0)}`, position: "top", fill: "#f1f5f9", fontSize: 10, fontFamily: fonts.mono }} />
            <Bar dataKey="ann" isAnimationActive={false} maxBarSize={14} radius={[3, 3, 0, 0]}>
              {m.rows.map((r, i) => <Cell key={i} fill={r.band.color} fillOpacity={r.band.key === "far" ? 0.55 : 0.9} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, padding: 20 }}>No quoted strikes near spot at this expiry.</div>}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
        {[band(0.05), band(0.2), band(0.4), band(0.7)].map(b => (
          <span key={b.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: SLATE, fontFamily: fonts.mono }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color, opacity: b.key === "far" ? 0.55 : 0.9 }} /> {b.name}
          </span>
        ))}
      </div>
    </div>

    {/* 3 · candidates */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, marginBottom: 12 }}>
      {[["Puts to sell — cash-secured", m.puts, "put"], ["Calls to sell — covered", m.calls, "call"]].map(([title, list, side]) => (
        <div key={side} style={{ ...card, padding: "10px 12px", overflowX: "auto" }}>
          <div style={label}>{title} · {m.dte ?? "—"}d · 5–55Δ</div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <thead><tr>{th("Strike")}{th("vs spot")}{th("Assign %")}{th("Bid")}{th("Yield")}{th("Annual")}{th(side === "put" ? "Breakeven" : "If called")}{th("OI")}</tr></thead>
            <tbody>
              {list.length ? list.map(r => (
                <tr key={r.strike} style={{ background: r.band.key === "sweet" ? "rgba(74,222,128,0.07)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {cell(`$${r.strike.toFixed(r.strike % 1 ? 1 : 0)}`, { color: "var(--text-primary)", fontWeight: 700 })}
                  {cell(pcS(r.dist), { color: "#94a3b8" })}
                  {cell(r.prob != null ? `${Math.round(r.prob * 100)}%` : "—", { color: r.band.color, fontWeight: 700 })}
                  {cell(usd(r.bid))}
                  {cell(pc(r.yp, 2))}
                  {cell(pc(r.ann), { color: r.band.color, fontWeight: 700 })}
                  {cell(side === "put" ? usd(r.be) : pcS(r.ifCalled))}
                  {cell(r.oi != null ? r.oi.toLocaleString() : "—", { color: DIM })}
                </tr>
              )) : <tr><td colSpan={8} style={{ padding: 10, fontSize: 10.5, color: "#64748b", fontFamily: fonts.mono }}>No candidates with 5–55% assignment probability at this expiry.</td></tr>}
            </tbody>
          </table>
          <div style={{ ...note, marginTop: 6 }}>
            {side === "put" ? "Yield = bid ÷ strike (the cash you set aside). Breakeven = strike − premium: your effective purchase price if assigned." : "Yield = bid ÷ spot (the shares you already hold). If called = premium + gain to strike, your total return if the shares are called away."} Green rows are the 15–30Δ band.
          </div>
        </div>
      ))}
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to use this page.</strong> Start with the regime: when implied vol sits well above realized, option sellers are being overpaid — that&apos;s when income strategies earn their keep; when the spread is thin, you&apos;re taking risk for little. Then read the ladder left to right: each bar is a strike, its height is the annualized yield for selling it, its color is roughly the chance you end up owning the stock (puts) or having it called away (calls). The 15–30Δ band is the classic income trade — meaningful premium, assignment still the exception. Backwardation or a steep put skew means the market is bracing for something; check the news before selling into it. Everything here uses bid prices and ignores commissions and early assignment.
    </InfoBox>
  </>);
}
