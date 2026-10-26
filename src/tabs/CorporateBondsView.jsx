// Bonds → Corporate bonds: the corporate tape from finra.org's Fixed Income Data (server/corporateBonds.js,
// /api/corporate-bonds). Personal use only: finra.org's user agreement forbids automated copying, which the
// user accepted for this dashboard. Most active, the biggest moves, distressed bonds, a fallen-angel watch,
// and an issuer watchlist with each bond's spread over the Treasury curve.
import React, { useEffect, useMemo, useState } from "react";
import { ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import "./options/OptionsResearch.css";
import { VizCard, MiniTable, Kpi, Seg, Legend, finite, fx, signed, axisTick, gridProps, tipStyle, C, dayLabel } from "./options/ui.jsx";

const pctY = (v, dp = 2) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const pts = v => (finite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}` : "—");
const rating = (sp, md) => [sp, md].filter(Boolean).join(" / ") || "—";
const short = (s, n = 42) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || "—");
const SERIES = [C[1], C[2], C[3], C[4], C[5]];

function IssuerTip({ active, payload }) {
  const b = active && payload?.find(p => p.payload?.cusip)?.payload;
  if (!b) return null;
  return (
    <div style={{ ...tipStyle, padding: "8px 10px" }}>
      <div style={{ fontWeight: 600 }}>{b.issuerName} {fx(b.coupon, 3)}% {b.maturity}</div>
      <div>price {fx(b.price, 2)} · yield {pctY(b.yield)} · spread {finite(b.spread) ? `${fx(b.spread, 2)} pts` : "—"}</div>
      <div>last trade {b.last} · CUSIP {b.cusip}{b.cl ? " · callable" : ""}</div>
    </div>
  );
}

function Watchlist({ d, onSaved }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(() => fetch(`/api/corporate-bonds?find=${encodeURIComponent(q.trim())}`).then(r => r.json()).then(j => setHits(j.names || [])).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q]);
  const save = async list => {
    setBusy(true); setMsg(null);
    try {
      const j = await fetch("/api/corporate-bonds/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issuers: list }) }).then(r => r.json());
      if (j.error) setMsg(j.error); else { setQ(""); setHits([]); onSaved(); }
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const names = d.watchNames || [];
  const shown = d.watchlist.filter(w => w.bonds?.length).slice(0, 5);
  const curveRows = useMemo(() => (d.treasuryLine || []), [d]);
  return (
    <VizCard eyebrow="Issuers" title="Issuer curves and spreads over Treasuries"
      finding="Each issuer's bonds that traded in the past 30 days, yield against years to maturity; the gray line is the Treasury curve fitted on the Treasuries view. Spread is a bond's yield minus that curve at its maturity: the market's price for the issuer's credit risk. Callable bonds can sit off the curve; bonds past 30 years are in the table only."
      table={<MiniTable columns={[{ key: "issuer", label: "Issuer", fmt: v => short(v, 48) }, { key: "sp", label: "Ratings", fmt: (_, w) => rating(w.sp, w.moodys) }, { key: "bonds", label: "Bonds traded, 30 days", fmt: (v, w) => (w.error ? w.error : `${v?.length || 0} of ${w.total || 0}`) }, { key: "medianSpread", label: "Median spread", fmt: v => (finite(v) ? `${fx(v, 2)} pts` : "—") }, { key: "spreadChange1w", label: "Change, 1 week", fmt: v => signed(v, 0, " bp") }]} rows={d.watchlist} />}>
      <Legend items={[...shown.map((w, i) => [short(w.issuer, 30), SERIES[i]]), ["Treasury curve", C.muted]]} />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis type="number" dataKey="years" domain={[0, 30]} ticks={[0, 2, 5, 10, 20, 30]} tick={axisTick} tickFormatter={v => `${v}y`} allowDuplicatedCategory={false} />
          <YAxis type="number" dataKey="yield" domain={["auto", "auto"]} tick={axisTick} tickFormatter={v => `${v.toFixed(1)}%`} width={48} />
          <Tooltip content={<IssuerTip />} />
          {curveRows.length > 0 && <Line data={curveRows} dataKey="yield" stroke={C.muted} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={false} />}
          {shown.map((w, i) => <Scatter key={w.issuer} data={w.bonds.filter(b => b.years <= 31).map(b => ({ ...b, issuerName: w.issuer }))} fill={SERIES[i]} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={3.5} fill={SERIES[i]} />} />)}
        </ComposedChart>
      </ResponsiveContainer>
      {d.watchlist.length > 5 && <p className="ocard-note">The chart shows the first five issuers; the table has them all.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 6px" }}>
        {names.map(n => <button key={n} type="button" className="ochip" disabled={busy} title="Remove from the watchlist" onClick={() => save(names.filter(x => x !== n))}>{short(n, 34)} ×</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="oinput" placeholder="Add an issuer (type 3+ letters)" value={q} onChange={e => setQ(e.target.value)} style={{ width: 260 }} />
        {busy && <span className="ocard-note">Fetching the issuer's bonds…</span>}
        {msg && <span className="ocard-note">{msg}</span>}
      </div>
      {hits.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{hits.filter(h => !names.includes(h)).slice(0, 12).map(h => <button key={h} type="button" className="ochip" disabled={busy || names.length >= 20} onClick={() => save([...names, h])}>+ {short(h, 40)}</button>)}</div>}
    </VizCard>
  );
}

export default function CorporateBondsView() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [tick, setTick] = useState(0);
  const [act, setAct] = useState("hy"), [span, setSpan] = useState("day");
  useEffect(() => {
    let live = true;
    Promise.all([fetch("/api/corporate-bonds").then(r => r.json()), fetch("/api/treasury-bonds").then(r => r.json()).catch(() => null)])
      .then(([j, t]) => { if (!live) return; if (j.error && !j.asOf) setErr(j.error); else { setD({ ...j, treasuryLine: t?.line || [] }); setErr(null); } })
      .catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [tick]);

  if (err && !d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">FINRA bond data is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading the corporate bond tape from finra.org (the first load reads about 25,000 bonds and takes a minute)…</p></div></div>;

  const mv = d.moves?.[span];
  const fa = d.fallenAngels || {};
  return (
    <div className="options-research">
      <header style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 28 }}>Corporate bonds</h2>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14 }}>
          {d.bondsTraded.toLocaleString()} corporate bonds that traded in the week to {dayLabel(d.asOf)} (FINRA TRACE last sales, with S&P and Moody's ratings). {d.snapshots} daily snapshot{d.snapshots === 1 ? "" : "s"} on file.{d.refreshing ? " Refreshing…" : ""}
        </p>
        <p className="ocard-note">Personal use only: this data comes from finra.org's Fixed Income Data pages, whose user agreement forbids automated copying and any commercial use. It is read lightly once a day, kept on this computer and never published.{d.error ? ` Last refresh failed: ${d.error}.` : ""}</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        <Kpi label="Distressed (20 to 70)" value={d.distressed.count.toLocaleString()} sub={`bonds of ${d.distressed.issuers} rated issuers${d.distressed.newIssuers ? ` · ${d.distressed.newIssuers} new this week` : ""}`} />
        <Kpi label="Split-rated at the line" value={(fa.split || []).length} sub="one agency investment grade, the other junk" />
        <Kpi label="Recent BB+ / Ba1 actions" value={(fa.recentCuts || []).length} sub="issuers, past 120 days" />
        <Kpi label="IG priced like junk" value={(fa.junkPriced || []).length} sub="median spread over 3.5 pts" />
      </div>

      <VizCard eyebrow="The tape" title={`Most active bonds, ${dayLabel(d.active?.day)}`} right={<Seg label="Type" value={act} options={[["inv", "Investment grade"], ["hy", "High yield"], ["conv", "Convertibles"]]} onChange={setAct} />}>
        {d.active?.[act]?.length ? <MiniTable columns={[
          { key: "issuer", label: "Issuer", fmt: v => short(v, 40) }, { key: "coupon", label: "Coupon", fmt: v => pctY(v, 3) }, { key: "maturity", label: "Maturity" },
          { key: "sp", label: "Ratings", fmt: (_, r) => rating(r.sp, r.moodys) }, { key: "last", label: "Last", fmt: v => fx(v, 2) }, { key: "change", label: "Change", fmt: pts },
          { key: "low", label: "Day's range", fmt: (v, r) => `${fx(v, 2)}–${fx(r.high, 2)}` }, { key: "yield", label: "Yield", fmt: v => pctY(v) },
        ]} rows={d.active[act]} /> : <p className="ocard-finding">No most-active list on file yet.</p>}
      </VizCard>

      <VizCard eyebrow="Moves" title="Biggest price moves" right={<Seg label="Period" value={span} options={[["day", "1 day"], ["week", "1 week"], ["month", "1 month"]]} onChange={setSpan} />}
        finding="Coupon bonds over $5 that traded on the latest day, against their last price in the earlier snapshot; at least 1 point. A single small trade can move a thin bond, so check the volume before reading much into one print.">
        {!mv ? <p className="ocard-finding">Moves need an earlier daily snapshot; the first arrives with tomorrow's pull, the week view after a week.</p> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 14 }}>
            {[["down", "Fell most"], ["up", "Rose most"]].map(([k, label]) => (
              <div key={k}><div className="ocard-eyebrow" style={{ marginBottom: 4 }}>{label} since {dayLabel(mv.since)}</div>
                <MiniTable maxHeight={300} columns={[{ key: "issuer", label: "Issuer", fmt: v => short(v, 30) }, { key: "coupon", label: "Bond", fmt: (v, r) => `${fx(v, 3)}% ${r.maturity?.slice(0, 4)}` }, { key: "price", label: "Price", fmt: v => fx(v, 2) }, { key: "change", label: "Change", fmt: pts }, { key: "sp", label: "Ratings", fmt: (_, r) => rating(r.sp, r.moodys) }]} rows={mv[k]} />
              </div>
            ))}
          </div>
        )}
      </VizCard>

      <VizCard eyebrow="Distress" title="Bonds trading below 70"
        finding={`Rated coupon bonds between 20 and 70, by issuer, lowest first (new this week first). Under 20 is usually paper already in default: ${d.distressed.defaultedIssuers} issuers there are left out. Prices this low mean the market doubts full repayment; recovery and the capital structure decide whether that's a buy. New entrants also show on the Ideas page's special situations.`}>
        <MiniTable maxHeight={420} columns={[
          { key: "issuer", label: "Issuer", fmt: (v, g) => `${short(v, 40)}${g.newly ? " · new" : ""}` }, { key: "industry", label: "Industry", fmt: v => v || "—" },
          { key: "sp", label: "Ratings", fmt: (_, g) => rating(g.sp, g.moodys) }, { key: "low", label: "Lowest price", fmt: v => fx(v, 2) }, { key: "count", label: "Bonds < 70" },
          { key: "bonds", label: "Lowest bond", fmt: v => (v?.[0] ? `${fx(v[0].coupon, 3)}% ${v[0].maturity} · yield ${pctY(v[0].yield, 1)}` : "—") },
        ]} rows={d.distressed.list} />
      </VizCard>

      <VizCard eyebrow="Fallen angels" title="Investment grade at risk of falling to junk"
        finding="Bonds cut from investment grade to junk are dumped by funds that can only hold investment grade; the forced selling has historically left fallen angels cheap for a few months. Three early signs: one agency already rates the issuer junk while the other doesn't; a recent rating action left it at BB+ / Ba1, the top of junk (check whether it was a cut); or its bonds already trade at junk-like spreads.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
          <div><div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Split-rated at the line</div>
            <MiniTable maxHeight={300} columns={[{ key: "issuer", label: "Issuer", fmt: v => short(v, 34) }, { key: "sp", label: "S&P / Moody's", fmt: (_, r) => rating(r.sp, r.moodys) }, { key: "spread", label: "Spread", fmt: v => (finite(v) ? `${fx(v, 2)} pts` : "—") }]} rows={fa.split || []} /></div>
          <div><div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Rated BB+ / Ba1 in the past 120 days</div>
            <MiniTable maxHeight={300} columns={[{ key: "issuer", label: "Issuer", fmt: v => short(v, 34) }, { key: "sp", label: "S&P / Moody's", fmt: (_, r) => rating(r.sp, r.moodys) }, { key: "since", label: "Action", fmt: v => v || "—" }]} rows={fa.recentCuts || []} /></div>
          <div><div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Investment grade, priced like junk</div>
            <MiniTable maxHeight={300} columns={[{ key: "issuer", label: "Issuer", fmt: v => short(v, 34) }, { key: "sp", label: "S&P / Moody's", fmt: (_, r) => rating(r.sp, r.moodys) }, { key: "spread", label: "Median spread", fmt: v => `${fx(v, 2)} pts` }]} rows={fa.junkPriced || []} /></div>
        </div>
        {fa.confirmed?.length > 0 && <p className="ocard-note">Seen falling from investment grade to junk since the snapshots began: {fa.confirmed.map(x => `${short(x.issuer, 30)} (${rating(x.sp, x.moodys)})`).join(", ")}.</p>}
      </VizCard>

      <Watchlist d={d} onSaved={() => setTick(t => t + 1)} />
    </div>
  );
}
