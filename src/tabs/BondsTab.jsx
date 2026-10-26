// Income → Bonds: the fixed-income home, three views.
//   Treasuries         every marketable Treasury, bond by bond (server/treasuryBonds.js, /api/treasury-bonds):
//                      the fitted curve with each issue on it, rich and cheap against neighbouring issues, TIPS
//                      breakevens by maturity, auctions graded against their own history, the full list
//   Rates & mortgages  the constant-maturity curve's history, spreads and term premium, real yields, policy and
//                      money-market rates, mortgages, bond ETFs (RatesTab.jsx, moved from U.S. Economy, Oct 2026)
//   Corporate credit   spreads, the refi squeeze, corporate balance sheets (DebtMarketTab.jsx, moved from U.S. Economy)
// The Fed balance sheet and the tightening monitor stay on U.S. Economy → Fed.
import React, { useEffect, useMemo, useState } from "react";
import SubViews from "../components/SubViews.jsx";
import RatesTab from "./RatesTab.jsx";
import DebtMarketTab from "./DebtMarketTab.jsx";
import { ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import "./options/OptionsResearch.css";
import { VizCard, MiniTable, Kpi, Seg, Legend, finite, fx, signed, axisTick, gridProps, tipStyle, C, dayLabel } from "./options/ui.jsx";

const KINDS = [["all", "All"], ["Bill", "Bills"], ["Note", "Notes"], ["Bond", "Bonds"], ["TIPS", "TIPS"], ["FRN", "FRNs"]];
const bp = v => signed(v, 1, " bp");
const pctY = (v, dp = 2) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const share = v => (finite(v) ? `${Math.round(v * 100)}%` : "—");
const desc = b => `${b.kind === "Bill" ? "Bill" : `${fx(b.coupon, 3)}%`} ${b.maturity}`;

function BondTip({ active, payload }) {
  const b = active && payload?.find(p => p.payload?.cusip)?.payload;
  if (!b) return null;
  return (
    <div style={{ ...tipStyle, padding: "8px 10px" }}>
      <div style={{ fontWeight: 600 }}>{b.kind} {desc(b)}{b.otr ? ` · on-the-run ${b.otr}` : ""}</div>
      <div>CUSIP {b.cusip} · price {fx(b.price, 3)}</div>
      <div>{b.kind === "TIPS" ? "Real yield" : "Yield"} {pctY(b.yield, 3)}{finite(b.rc) ? ` · ${bp(b.rc)} vs neighbours` : ""}{finite(b.breakeven) ? ` · breakeven ${pctY(b.breakeven)}` : ""}</div>
      {finite(b.d1) && <div>1 day {bp(b.d1)}{finite(b.d1m) ? ` · 1 month ${bp(b.d1m)}` : ""}</div>}
    </div>
  );
}

const yearTicks = [0, 2, 5, 7, 10, 20, 30];

export const BOND_VIEWS = ["treasuries", "rates", "credit"];

export default function BondsTab({ md, td, fmpKey, fredKey, view, onView }) {
  return (
    <SubViews view={view} onChange={onView} views={[
      { id: "treasuries", label: "Treasuries", hint: "every issue, bond by bond", render: () => <TreasuryTerminal /> },
      { id: "rates", label: "Rates & mortgages", hint: "the curve over time, spreads, real yields, policy rates, mortgages", render: () => <RatesTab md={md} td={td} fmpKey={fmpKey} fredKey={fredKey} /> },
      { id: "credit", label: "Corporate credit", hint: "spreads, the refi squeeze, balance sheets", render: () => <DebtMarketTab /> },
    ]} />
  );
}

function TreasuryTerminal() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [aucKind, setAucKind] = useState("coupons"), [kind, setKind] = useState("all"), [q, setQ] = useState(""), [sort, setSort] = useState(["years", 1]);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/treasury-bonds").then(r => r.json()).then(j => { if (!live) return; if (j.error) setErr(j.error); else { setD(j); setErr(null); } }).catch(e => live && setErr(e.message));
    load();
    const t = setInterval(load, 10 * 60e3);
    return () => { live = false; clearInterval(t); };
  }, []);

  const view = useMemo(() => {
    if (!d) return null;
    const coupons = d.bonds.filter(b => ["Note", "Bond"].includes(b.kind) && finite(b.yield));
    const bills = d.bonds.filter(b => b.kind === "Bill" && finite(b.yield));
    const tips = d.bonds.filter(b => b.kind === "TIPS" && finite(b.breakeven));
    const ranked = coupons.filter(b => finite(b.rc)).sort((a, b) => b.rc - a.rc);
    const tips10 = [...tips].sort((a, b) => Math.abs(a.years - 10) - Math.abs(b.years - 10))[0];
    return { coupons: coupons.filter(b => !b.otr), otr: coupons.filter(b => b.otr), bills, tips, cheap: ranked.slice(0, 8), rich: ranked.slice(-8).reverse(), tips10 };
  }, [d]);

  const list = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toUpperCase();
    const rows = d.bonds.filter(b => (kind === "all" || b.kind === kind) && (!s || b.cusip.includes(s) || b.maturity.includes(s)));
    const [k, dir] = sort;
    return [...rows].sort((a, b) => ((finite(a[k]) ? a[k] : -1e9) - (finite(b[k]) ? b[k] : -1e9)) * dir || String(a[k]).localeCompare(String(b[k])) * dir);
  }, [d, kind, q, sort]);

  if (err && !d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Treasury prices are unavailable: {err}</p></div></div>;
  if (!d || !view) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading every Treasury from TreasuryDirect (the first load back-fills a month of prices, about a minute)…</p></div></div>;

  const c = t => d.curve.find(x => x.t === t) || {};
  const sortBtn = (key, label) => <button type="button" className="ochip" aria-pressed={sort[0] === key} onClick={() => setSort(s => [key, s[0] === key ? -s[1] : key === "years" ? 1 : -1])}>{label}{sort[0] === key ? (sort[1] > 0 ? " ↑" : " ↓") : ""}</button>;
  const xAxis = <XAxis type="number" dataKey="years" domain={[0, 30]} ticks={yearTicks} tick={axisTick} tickFormatter={v => `${v}y`} allowDuplicatedCategory={false} />;

  return (
    <div className="options-research">
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 28 }}>Treasuries, bond by bond</h2>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14 }}>
          All {d.bonds.length} marketable Treasuries priced at the close of {dayLabel(d.asOf)}, {d.asOf.slice(0, 4)} (TreasuryDirect FedInvest), with a curve fitted through the notes and bonds. Changes are against {dayLabel(d.prevDate)} and {dayLabel(d.monthDate)}.
          {d.refreshing ? " Refreshing…" : ""}
        </p>
        {d.errors?.length > 0 && <p className="ocard-note">{d.errors.join(" · ")}</p>}
      </header>

      <div className="okpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[2, 10, 30].map(t => <Kpi key={t} label={`${t}-year (fitted)`} value={pctY(c(t).y, 3)} sub={`${bp(c(t).d1)} on the day · ${bp(c(t).d1m)} on the month`} />)}
        <Kpi label="2s10s" value={bp(d.spreads.s2s10)} sub="10-year minus 2-year" />
        <Kpi label="5s30s" value={bp(d.spreads.s5s30)} sub="30-year minus 5-year" />
        <Kpi label="10-year breakeven" value={pctY(view.tips10?.breakeven)} sub={view.tips10 ? `TIPS ${view.tips10.maturity}, real ${pctY(view.tips10.yield)}` : ""} />
      </div>

      <VizCard eyebrow="The curve" title="Every note and bond on the fitted curve"
        finding={`Each dot is one Treasury. The line is a smooth curve fitted through the notes and bonds; it misses them by ${fx(d.fitRmseBp, 1)} bp on average. On-the-run issues, the latest auctioned of each maturity, are marked.`}
        table={<MiniTable columns={[{ key: "t", label: "Maturity", fmt: v => `${v}-year` }, { key: "y", label: "Fitted yield", fmt: v => pctY(v, 3) }, { key: "d1", label: "1 day", fmt: bp }, { key: "d1m", label: "1 month", fmt: bp }]} rows={d.curve} />}>
        <Legend items={[["Bills", C[3]], ["Notes and bonds", C[1]], ["On-the-run", C[2]], ["Fitted curve", C.muted]]} />
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis type="number" dataKey="yield" domain={["auto", "auto"]} tick={axisTick} tickFormatter={v => `${v.toFixed(1)}%`} width={48} />
            <Tooltip content={<BondTip />} />
            <Line data={d.line} dataKey="yield" type="monotone" stroke={C.muted} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={false} />
            <Scatter data={view.bills} fill={C[3]} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={3} fill={C[3]} />} />
            <Scatter data={view.coupons} fill={C[1]} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={3} fill={C[1]} />} />
            <Scatter data={view.otr} fill={C[2]} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={5.5} fill={C[2]} stroke="var(--card-bg)" strokeWidth={2} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </VizCard>

      <VizCard eyebrow="Rich and cheap" title="Yield against nearby issues"
        finding={`Each issue's yield against a line drawn through the notes and bonds maturing around it, the issue itself left out: above zero it yields more than its neighbours (cheap), below less (rich). Cheapest today: ${view.cheap[0] ? `${view.cheap[0].kind} ${desc(view.cheap[0])}, ${bp(view.cheap[0].rc)}` : "—"}; richest: ${view.rich[0] ? `${view.rich[0].kind} ${desc(view.rich[0])}, ${bp(view.rich[0].rc)}` : "—"}. Old high-coupon bonds and the 20-year sector have tended to sit cheap, on-the-runs rich: liquidity is part of the gap.`}
        table={<MiniTable columns={[{ key: "cusip", label: "CUSIP" }, { key: "kind", label: "Type" }, { key: "maturity", label: "Issue", fmt: (_, b) => desc(b) }, { key: "rc", label: "vs neighbours", fmt: bp }, { key: "rc1m", label: "Change, 1 month", fmt: bp }]} rows={[...view.cheap, ...view.rich]} />}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis type="number" dataKey="rc" tick={axisTick} tickFormatter={v => `${v}`} width={48} label={{ value: "bp", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 10 }} />
            <ReferenceLine y={0} stroke="var(--text-muted)" />
            <Tooltip content={<BondTip />} />
            <Scatter data={[...view.coupons, ...view.otr].filter(b => finite(b.rc))} fill={C[1]} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={p.payload.otr ? 5 : 3} fill={p.payload.otr ? C[2] : C[1]} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </VizCard>

      <VizCard eyebrow="Inflation" title="TIPS breakevens by maturity"
        finding={`The inflation rate each TIPS needs to match an ordinary Treasury of the same maturity: the fitted nominal yield minus the TIPS real yield. Near ten years it is ${pctY(view.tips10?.breakeven)}.`}
        table={<MiniTable columns={[{ key: "cusip", label: "CUSIP" }, { key: "maturity", label: "Maturity" }, { key: "coupon", label: "Coupon", fmt: v => pctY(v, 3) }, { key: "yield", label: "Real yield", fmt: v => pctY(v, 3) }, { key: "breakeven", label: "Breakeven", fmt: v => pctY(v, 2) }, { key: "d1m", label: "Real yield, 1 month", fmt: bp }]} rows={view.tips} />}>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis type="number" dataKey="breakeven" domain={["auto", "auto"]} tick={axisTick} tickFormatter={v => `${v.toFixed(1)}%`} width={48} />
            <Tooltip content={<BondTip />} />
            <Scatter data={view.tips} fill={C[4]} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={4} fill={C[4]} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </VizCard>

      <VizCard eyebrow="Supply" title="Auctions, graded against the last six of the same maturity" right={<Seg label="Auctions" value={aucKind} options={[["coupons", "Notes, bonds, TIPS"], ["bills", "Bills"]]} onChange={setAucKind} />}
        finding="Strong: more bids per dollar sold than usual and dealers took less; weak: the reverse, so the market had to be paid to absorb the supply. Dealer share is the part of the competitive award left with the primary dealers; indirect bidders are mostly foreign central banks and funds bidding through dealers.">
        <MiniTable maxHeight={360} columns={[
          { key: "auction", label: "Auction" }, { key: "type", label: "Security", fmt: (_, a) => `${a.type} ${a.original}${a.reopening ? " (reopening)" : ""}` },
          { key: "highYield", label: "High yield", fmt: (v, a) => (finite(v) ? pctY(v, 3) : finite(a.highDiscount) ? `${pctY(a.highDiscount, 3)} discount` : "—") },
          { key: "btc", label: "Bid-to-cover", fmt: (v, a) => `${fx(v, 2)}${finite(a.dBtc) ? ` (${signed(a.dBtc, 2)})` : ""}` },
          { key: "dealerShare", label: "Dealers took", fmt: (v, a) => `${share(v)}${finite(a.dDealer) ? ` (${signed(a.dDealer * 100, 0, " pt")})` : ""}` },
          { key: "indirectShare", label: "Indirect", fmt: share }, { key: "grade", label: "Read", fmt: v => v || "—" },
        ]} rows={d.auctions.filter(a => (aucKind === "bills") === (a.type === "Bill")).slice(0, 40)} />
        {d.upcoming?.length > 0 && <p className="ocard-note">Coming up: {d.upcoming.slice(0, 8).map(a => `${dayLabel(a.auction)} ${a.type} ${a.term}${finite(a.offering) ? ` ($${Math.round(a.offering / 1e9)}B)` : ""}`).join(" · ")}.</p>}
      </VizCard>

      <VizCard eyebrow="The list" title={`Every Treasury (${list.length})`}
        right={<Seg label="Type" value={kind} options={KINDS} onChange={setKind} />}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "4px 0 10px" }}>
          <input className="oinput" placeholder="CUSIP or maturity (2031-05)" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Sort:</span>
          {sortBtn("years", "Maturity")}{sortBtn("yield", "Yield")}{sortBtn("rc", "Rich / cheap")}{sortBtn("d1m", "1-month change")}{sortBtn("md", "Duration")}
        </div>
        <MiniTable maxHeight={520} columns={[
          { key: "cusip", label: "CUSIP" }, { key: "kind", label: "Type", fmt: (v, b) => `${v}${b.otr ? " · OTR" : ""}` },
          { key: "coupon", label: "Coupon", fmt: (v, b) => (b.kind === "Bill" ? "—" : pctY(v, 3)) }, { key: "maturity", label: "Maturity" },
          { key: "price", label: "Price", fmt: v => fx(v, 3) }, { key: "yield", label: "Yield", fmt: (v, b) => (b.kind === "TIPS" ? `${pctY(v, 3)} real` : pctY(v, 3)) },
          { key: "d1", label: "1 day", fmt: bp }, { key: "d1m", label: "1 month", fmt: bp }, { key: "md", label: "Duration", fmt: v => fx(v, 2) },
          { key: "dv01", label: "DV01 / $1M", fmt: v => (finite(v) ? `$${Math.round(v * 100)}` : "—") }, { key: "rc", label: "Rich / cheap", fmt: bp },
        ]} rows={list} />
        <p className="ocard-note">Yields: bills bond-equivalent; notes and bonds street yield from the clean price, settling the next business day; TIPS real. DV01 is the dollar change per $1M face for a 1 bp move. FRNs carry prices only. Source: TreasuryDirect FedInvest and auction results.</p>
      </VizCard>
    </div>
  );
}
