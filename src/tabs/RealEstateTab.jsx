import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import { CHOROPLETH_METRICS, BUILD_COST_PER_SQFT } from "../lib/constants.js";
import StateChoropleth from "../components/StateChoropleth.jsx";
import HousingSubTab from "./HousingSubTab.jsx";

// ============================================================================
// REAL ESTATE — fundamentals and fair value
// Organizing principle: every real-estate price is judged against four
// anchors — income (affordability / rent), replacement cost (Tobin's q),
// yield vs bonds (cap-rate spread), and supply/credit (vacancy, delinquency,
// construction). The section is split residential / commercial with those
// anchors applied to each, plus a state map for the residential data that
// exists at state level. Sub-tabs:
//   Fair Value    verdict band + the anchors, both sectors, one screen
//   Residential   the former U.S. Economy → Housing tab (Zillow + FRED +
//                 health synthesis + replacement cost), moved here whole
//   Commercial    price cycle, credit, construction, vacancy, replacement
//                 ratio, REIT-implied cap rates by property type
//   State Map     listing price, $/sq ft, $/sq ft vs build cost, price
//                 growth, listings, days on market, vacancy — by state
// What's NOT here, honestly: private-market cap rates and occupancy by
// property type (broker surveys, paywalled) and state-level foreclosures
// (ATTOM, paywalled) — the CURATED_COMMERCIAL scaffold below is where hand-
// entered survey numbers go, in the same verify-and-extend pattern as the
// rest of the dashboard.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee";
const fin = v => v != null && isFinite(v);
const pc = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "—");
const pc0 = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const RE_MAP_METRICS = [...CHOROPLETH_METRICS.filter(m => m.group === "realestate"), ...CHOROPLETH_METRICS.filter(m => m.source === "zillow")];

// Hand-curated commercial survey numbers (private-market cap rates and
// occupancy by property type). Empty until you log a broker release —
// CBRE/Cushman/JLL cap-rate surveys and STR (hotels), each with a date.
// Format: { asOf: "2026-Q2", type: "Office", capRate: 8.2, occupancy: 81,
//           source: "CBRE H1 2026 Cap Rate Survey" }
const CURATED_COMMERCIAL = [];

const useJson = url => {
  const [d, setD] = useState(null);
  useEffect(() => { fetch(url).then(r => r.json()).then(x => { if (x && !x.error) setD(x); }).catch(() => {}); }, [url]);
  return d;
};

function Verdict({ title, verdict, color, why, onOpen, dest }) {
  return (
    <div onClick={onOpen} style={{ ...card, position: "relative", overflow: "hidden", cursor: onOpen ? "pointer" : "default" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: color }} />
      <div style={label}>{title}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.4, marginTop: 4, lineHeight: 1.15 }}>{verdict}</div>
      <div style={{ fontSize: 9.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.45, minHeight: 28 }}>{why}</div>
      {dest && <div style={{ fontSize: 10, color: INDIGO, fontFamily: fonts.mono, marginTop: 6 }}>{dest} →</div>}
    </div>
  );
}

function Stat({ title, value, sub, color = "var(--text-primary)" }) {
  return (
    <div style={{ ...card, padding: "10px 14px" }}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.4, lineHeight: 1.15, marginTop: 3 }}>{value}</div>
      <div style={{ ...note, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Series({ title, data, lines, height = 220, yFmt = v => v, refY, foot }) {
  return (
    <div style={{ ...card, padding: "12px 14px 6px", marginBottom: 12 }}>
      <div style={label}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={d => d.slice(0, 4)} minTickGap={40} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={yFmt} axisLine={false} tickLine={false} width={52} domain={["auto", "auto"]} />
          <Tooltip contentStyle={tip} labelFormatter={d => d.slice(0, 7)} formatter={(v, n) => [yFmt(v), n]} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="plainline" />}
          {refY != null && <ReferenceLine y={refY} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />}
          {lines.map(l => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={l.width || 1.8} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
      {foot && <div style={{ ...note, padding: "4px 0 4px 6px" }}>{foot}</div>}
    </div>
  );
}

// merge several [{d,v}] series into rows keyed by date (for multi-line charts)
function merge(named) {
  const rows = {};
  for (const [key, arr] of Object.entries(named)) for (const p of arr || []) { (rows[p.d] = rows[p.d] || { d: p.d })[key] = p.v; }
  return Object.values(rows).sort((a, b) => a.d.localeCompare(b.d));
}
// index each series to 100 at its first shared date
function indexed(named) {
  const out = {};
  for (const [key, arr] of Object.entries(named)) { const base = arr?.find(p => p.v)?.v; out[key] = base ? arr.map(p => ({ d: p.d, v: +((p.v / base) * 100).toFixed(1) })) : []; }
  return merge(out);
}

// ── Fair Value ──────────────────────────────────────────────────────────────
function FairValueView({ housing, repl, cre, reit, zillow, go }) {
  const zn = zillow?.national || {};
  const zhvi = zn.zhvi?.current ?? zn.zhvi?.history?.slice(-1)[0]?.v ?? null;
  const zori = zn.zori?.current ?? zn.zori?.history?.slice(-1)[0]?.v ?? null;
  const priceToRent = fin(zhvi) && fin(zori) && zori > 0 ? zhvi / (zori * 12) : null;
  const grossYield = fin(priceToRent) ? 100 / priceToRent : null;
  const hv = housing?.verdict, rv = repl?.verdict, cv = cre?.cycle, kv = reit?.verdict;
  const light = l => (l?.label === "green" ? GREEN : l?.label === "amber" ? AMBER : l?.label === "red" ? RED : SLATE);
  return (<>
    <SH>Fair Value — Four Anchors, Both Sectors</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 12 }}>
      <Verdict title="Residential · health" verdict={hv?.label ?? "…"} color={hv?.color ?? SLATE}
        why={housing ? `affordability ${light(housing.afford?.light) === RED ? "red" : light(housing.afford?.light) === AMBER ? "amber" : "green"} (${pc0(housing.afford?.current)} of income, p${housing.afford?.pct}) · supply p${housing.supply?.pct} · valuation p${housing.valuation?.pct}` : "loading"} dest="Residential" onOpen={() => go("residential")} />
      <Verdict title="Residential · vs rebuild cost" verdict={rv?.label ?? "…"} color={rv?.color ?? SLATE}
        why={rv ? `price ÷ build-cost ratio ${rv.ratio} (100 = parity) · p${rv.pct} since ${repl.ratioSince}${rv.chg1y != null ? ` · ${rv.chg1y >= 0 ? "+" : ""}${rv.chg1y} over 12mo` : ""}` : "loading"} dest="Residential" onOpen={() => go("residential")} />
      <Verdict title="Commercial · price cycle" verdict={cv?.label ?? "…"} color={cv?.color ?? SLATE}
        why={cre ? `CRE prices ${pc(cre.price.yoy)} YoY (BIS, ${cre.price.asOf?.slice(0, 7)}) · CRE loan delinquency ${pc0(cre.delinquency.cre.current, 2)} (p${cre.delinquency.cre.pct}, ${pc(cre.delinquency.cre.chg1y, 2)} 1y)` : "loading"} dest="Commercial" onOpen={() => go("commercial")} />
      <Verdict title="Commercial · yield vs bonds" verdict={kv?.label ?? "…"} color={kv?.color ?? SLATE}
        why={reit?.available ? `REIT-implied cap rate ${pc0(reit.avgCap)} vs 10Y ${pc0(reit.tenYear, 2)} → spread ${reit.spread >= 0 ? "+" : ""}${reit.spread?.toFixed(1)} pts · ${reit.coverage} REITs` : reit ? "cap-rate data unavailable" : "loading"} dest="Commercial" onOpen={() => go("commercial")} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 12 }}>
      {/* residential anchors */}
      <div style={card}>
        <div style={label}>Residential — the anchors</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
          <Stat title="Price vs income" value={pc0(housing?.afford?.current)} color={light(housing?.afford?.light)} sub={housing ? `median payment as % of income · p${housing.afford?.pct} since ${housing.afford?.since} · needs $${Math.round((housing.afford?.incomeNeeded || 0) / 1000)}K income` : "—"} />
          <Stat title="Price vs rent" value={fin(priceToRent) ? `${priceToRent.toFixed(1)}×` : "—"} color={fin(priceToRent) ? (priceToRent > 20 ? RED : priceToRent > 16 ? AMBER : GREEN) : SLATE} sub={fin(grossYield) ? `Zillow home value ÷ annual rent · gross yield ${pc0(grossYield)} · >20× is expensive vs history` : "Zillow ZHVI/ZORI"} />
          <Stat title="Price vs rebuild" value={rv ? `${rv.ratio}` : "—"} color={rv?.color || SLATE} sub={rv ? `Case-Shiller ÷ construction PPI, 100 = long-run parity · p${rv.pct}` : "—"} />
          <Stat title="Supply & credit" value={housing ? `${housing.supply?.current?.toFixed(1)} mo` : "—"} color={light(housing?.supply?.light)} sub={housing ? `months of supply (p${housing.supply?.pct}) · mortgage delinquency ${pc0(cre?.delinquency?.mortgage?.current, 2)}` : "—"} />
        </div>
      </div>
      {/* commercial anchors */}
      <div style={card}>
        <div style={label}>Commercial — the anchors</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
          <Stat title="Yield vs bonds" value={reit?.available ? `${reit.spread >= 0 ? "+" : ""}${reit.spread?.toFixed(1)} pts` : "—"} color={kv?.color || SLATE} sub={reit?.available ? `implied cap ${pc0(reit.avgCap)} − 10Y ${pc0(reit.tenYear, 2)} · norm ≈ 3 pts` : "REIT proxy"} />
          <Stat title="Price vs rebuild" value={cre?.replacement?.current != null ? `${cre.replacement.current}` : "—"} color={cre?.replacement?.pct != null ? (cre.replacement.pct >= 70 ? RED : cre.replacement.pct >= 30 ? AMBER : GREEN) : SLATE} sub={cre ? `CRE price index ÷ construction-input PPI, mean = 100 · p${cre.replacement.pct} since ${cre.replacement.since}` : "—"} />
          <Stat title="Price momentum" value={pc(cre?.price?.yoy)} color={cre ? (cre.price.yoy < 0 ? RED : cre.price.yoy > 3 ? GREEN : AMBER) : SLATE} sub={cre ? `BIS commercial property prices, YoY · rents (CPI) ${pc(cre.rent.cpiYoy)} · build inputs ${pc(cre.cost.ppiYoy)}` : "—"} />
          <Stat title="Credit & vacancy" value={pc0(cre?.delinquency?.cre?.current, 2)} color={cre ? (cre.delinquency.cre.chg1y > 0.3 ? RED : cre.delinquency.cre.chg1y > 0 ? AMBER : GREEN) : SLATE} sub={cre ? `CRE loan delinquency (p${cre.delinquency.cre.pct}) · rental vacancy ${pc0(cre.vacancy.rental.current)} (p${cre.vacancy.rental.pct})` : "—"} />
        </div>
      </div>
    </div>

    {/* cap rates by property type */}
    {reit?.available && (
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={label}>REIT-implied cap rate by property type · spread over the 10-year ({pc0(reit.tenYear, 2)})</div>
          <span style={note}>EBITDA ÷ enterprise value · {reit.coverage} bellwethers · {reit.asOf}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "4px 20px", marginTop: 8 }}>
          {reit.bySector.map(s => {
            const c = s.spread == null ? SLATE : s.spread < 1 ? RED : s.spread < 2.5 ? AMBER : GREEN;
            return (
              <div key={s.sector} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                <span style={{ width: 128, fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.mono, flexShrink: 0 }}>{s.sector}</span>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, position: "relative" }}>
                  <div style={{ width: `${Math.min(100, (s.cap / 12) * 100)}%`, height: "100%", background: c, borderRadius: 4, opacity: 0.85 }} />
                  {fin(reit.tenYear) && <div style={{ position: "absolute", left: `${Math.min(100, (reit.tenYear / 12) * 100)}%`, top: -3, width: 2, height: 14, background: "#f1f5f9" }} title="10-year Treasury" />}
                </div>
                <span style={{ width: 44, textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.mono }}>{pc0(s.cap)}</span>
                <span style={{ width: 54, textAlign: "right", fontSize: 10, color: c, fontFamily: fonts.mono }}>{s.spread != null ? `${s.spread >= 0 ? "+" : ""}${s.spread.toFixed(1)}` : "—"}</span>
              </div>
            );
          })}
        </div>
        <div style={{ ...note, marginTop: 8 }}>White tick = the 10-year. Public REITs own better-than-average assets, so private-market cap rates run higher than these; read the ranking and the spread, not the level. Office is the tell for distress, data centers for the AI bid.</div>
      </div>
    )}

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>The framework.</strong> Real estate is fairly valued when four things line up: the price can be carried out of income (affordability, or rent for a landlord), it doesn&apos;t sit far above what building the asset would cost (replacement cost — the market&apos;s gravity, because a big gap invites new supply), its yield clears a bond by a normal margin (cap rate minus the 10-year), and supply and credit aren&apos;t deteriorating underneath it (vacancy, delinquency, construction). Residential today is expensive on income, rich on replacement, and thin on supply; commercial is mid-correction with credit still catching up. Each anchor drills into its sector tab.
    </InfoBox>
  </>);
}

// ── Commercial ──────────────────────────────────────────────────────────────
function CommercialView({ cre, reit }) {
  if (!cre) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading commercial fundamentals (FRED)…</div>;
  const cv = cre.cycle;
  const priceRows = merge({ yoy: cre.price.series });
  const dqRows = merge({ cre: cre.delinquency.cre.series, mortgage: cre.delinquency.mortgage.series });
  const consRows = indexed({ commercial: cre.construction.commercial, office: cre.construction.office, residential: cre.construction.residential, manufacturing: cre.construction.manufacturing });
  const vacRows = merge({ rental: cre.vacancy.rental.series, owner: cre.vacancy.owner.series });
  const replRows = merge({ ratio: cre.replacement.ratio });
  const th = t => <th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{t}</th>;
  const td = (v, extra = {}) => <td style={{ padding: "6px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "#cbd5e1", whiteSpace: "nowrap", ...extra }}>{v}</td>;
  return (<>
    <SH>Commercial — Price Cycle, Credit, Supply</SH>
    <div style={{ ...card, marginBottom: 12, position: "relative", overflow: "hidden", padding: "16px 20px" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: cv.color }} />
      <div style={label}>Where commercial property is in its cycle</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: cv.color, fontFamily: fonts.heading, letterSpacing: -0.5, marginTop: 4 }}>{cv.label}</div>
      <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5, maxWidth: 860 }}>{cv.note} Prices {pc(cre.price.yoy)} YoY as of {cre.price.asOf?.slice(0, 7)}; CRE loan delinquency {pc0(cre.delinquency.cre.current, 2)} ({pc(cre.delinquency.cre.chg1y, 2)} over a year, p{cre.delinquency.cre.pct} of history); bank CRE loans {pc(cre.loans.yoy)} YoY.</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
      <Stat title="CRE prices YoY" value={pc(cre.price.yoy)} color={cre.price.yoy < 0 ? RED : GREEN} sub={`BIS commercial property index · ${cre.price.asOf?.slice(0, 7)}`} />
      <Stat title="CRE loan delinquency" value={pc0(cre.delinquency.cre.current, 2)} color={cre.delinquency.cre.chg1y > 0 ? AMBER : GREEN} sub={`p${cre.delinquency.cre.pct} since 1991 · ${pc(cre.delinquency.cre.chg1y, 2)} 1y`} />
      <Stat title="Bank CRE loans YoY" value={pc(cre.loans.yoy)} color={cre.loans.yoy < 0 ? RED : cre.loans.yoy < 2 ? AMBER : GREEN} sub={`$${(cre.loans.current / 1000).toFixed(2)}T outstanding (H.8)`} />
      <Stat title="Rental vacancy" value={pc0(cre.vacancy.rental.current)} color={cre.vacancy.rental.pct >= 70 ? RED : cre.vacancy.rental.pct >= 35 ? AMBER : GREEN} sub={`p${cre.vacancy.rental.pct} · homeowner vacancy ${pc0(cre.vacancy.owner.current)}`} />
      <Stat title="Rents (CPI) YoY" value={pc(cre.rent.cpiYoy)} color={SLATE} sub={`shelter rent · build inputs ${pc(cre.cost.ppiYoy)} YoY`} />
      <Stat title="Price vs rebuild" value={cre.replacement.current ?? "—"} color={cre.replacement.pct >= 70 ? RED : cre.replacement.pct >= 30 ? AMBER : GREEN} sub={`index ÷ construction PPI · p${cre.replacement.pct} since ${cre.replacement.since}`} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
      <Series title="Commercial property prices — YoY % (BIS, quarterly)" data={priceRows} lines={[{ key: "yoy", name: "CRE price YoY", color: INDIGO, width: 2 }]} yFmt={v => `${Number(v).toFixed(0)}%`} refY={0} foot="Negative = values falling year over year. The 2009–10 and 2023–24 legs are the two corrections in this series." />
      <Series title="Loan delinquency — CRE vs residential mortgages (%)" data={dqRows} lines={[{ key: "cre", name: "CRE loans", color: RED, width: 2 }, { key: "mortgage", name: "Mortgages", color: SLATE }]} yFmt={v => `${Number(v).toFixed(1)}%`} foot="Fed H.8, all commercial banks. Commercial credit turns after prices; the peak in delinquencies has marked the price bottom." />
      <Series title="Construction spending — indexed to 100 (monthly, SAAR)" data={consRows} lines={[{ key: "commercial", name: "Commercial", color: INDIGO, width: 2 }, { key: "office", name: "Office", color: RED }, { key: "residential", name: "Residential", color: GREEN }, { key: "manufacturing", name: "Manufacturing", color: AMBER }]} yFmt={v => Number(v).toFixed(0)} foot="Supply response by segment. A price-above-replacement gap that persists shows up here as a building boom — the manufacturing line is the CHIPS/AI build." />
      <Series title="Vacancy — rental vs homeowner (%)" data={vacRows} lines={[{ key: "rental", name: "Rental vacancy", color: AMBER, width: 2 }, { key: "owner", name: "Homeowner vacancy", color: CYAN }]} yFmt={v => `${Number(v).toFixed(1)}%`} foot="Census HVS. Rental vacancy is the multifamily occupancy read (occupancy = 100 − vacancy); office and industrial occupancy come from broker surveys — see the curated table." />
      <Series title="Commercial price vs cost to build — ratio, mean = 100" data={replRows} lines={[{ key: "ratio", name: "CRE price ÷ construction-input PPI", color: CYAN, width: 2 }]} yFmt={v => Number(v).toFixed(0)} refY={100} foot="The commercial Tobin's q: the BIS index chained to a level, divided by the PPI for construction inputs. Above 100 invites supply; well below it, nothing new pencils." />
    </div>

    <SH>REIT-Implied Cap Rates — What the Public Market Pays for NOI</SH>
    {reit?.available ? (
      <div style={{ ...card, padding: "10px 12px", marginBottom: 12, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Average implied cap <strong style={{ color: "var(--text-primary)" }}>{pc0(reit.avgCap)}</strong> vs 10Y {pc0(reit.tenYear, 2)} → spread <strong style={{ color: reit.verdict.color }}>{reit.spread >= 0 ? "+" : ""}{reit.spread?.toFixed(1)} pts</strong> · {reit.verdict.label}</span>
          <span style={note}>{reit.coverage} names · fiscal-year EBITDA ÷ current EV · {reit.asOf}</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Property type · REIT</th>{th("Implied cap")}{th("Spread vs 10Y")}{th("Div. yield")}{th("Debt / EV")}{th("Off 52w high")}{th("EV")}</tr></thead>
          <tbody>
            {reit.rows.filter(r => !r.error).sort((a, b) => a.sector.localeCompare(b.sector) || b.cap - a.cap).map(r => {
              const sp = fin(reit.tenYear) ? r.cap - reit.tenYear : null;
              const c = sp == null ? SLATE : sp < 1 ? RED : sp < 2.5 ? AMBER : GREEN;
              return (
                <tr key={r.t} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 8px", fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1" }}><span style={{ color: DIM }}>{r.sector}</span> · <strong style={{ color: "var(--text-primary)" }}>{r.t}</strong></td>
                  {td(pc0(r.cap), { color: "var(--text-primary)", fontWeight: 700 })}
                  {td(sp != null ? `${sp >= 0 ? "+" : ""}${sp.toFixed(1)}` : "—", { color: c, fontWeight: 700 })}
                  {td(pc0(r.divYield))}
                  {td(pc0(r.debtToEv, 0))}
                  {td(pc(r.offHigh, 0), { color: r.offHigh < -20 ? RED : SLATE })}
                  {td(`$${(r.ev / 1e9).toFixed(0)}B`, { color: DIM })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>Cap rate here = EBITDA ÷ (market cap + debt − cash), a public-market proxy for NOI yield. It understates private cap rates for the same property type (REITs own trophy assets and trade with liquidity) but ranks the sectors faithfully and moves daily.</div>
      </div>
    ) : <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>{reit ? `REIT cap rates unavailable (${reit.reason || "no data"}).` : "Loading REIT cap rates (FMP)…"}</div>}

    {/* curated survey scaffold */}
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={label}>Private-market cap rates &amp; occupancy by property type — curated{CURATED_COMMERCIAL.length ? "" : " (awaiting first entry)"}</div>
      {CURATED_COMMERCIAL.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead><tr><th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textAlign: "left" }}>Type</th>{th("Cap rate")}{th("Occupancy")}<th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textAlign: "left" }}>Source</th></tr></thead>
          <tbody>{CURATED_COMMERCIAL.map((r, i) => <tr key={i}><td style={{ padding: "6px 8px", fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1" }}>{r.type}</td>{td(pc0(r.capRate))}{td(pc0(r.occupancy, 0))}<td style={{ padding: "6px 8px", fontSize: 10, fontFamily: fonts.mono, color: DIM }}>{r.source} · {r.asOf}</td></tr>)}</tbody>
        </table>
      ) : (
        <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.6 }}>
          Private-market cap rates and occupancy by property type only exist in broker surveys (CBRE, Cushman &amp; Wakefield, JLL; STR for hotels), published quarterly and not machine-readable. When one prints, add a row to CURATED_COMMERCIAL in RealEstateTab.jsx — type, cap rate, occupancy, source, date — and it renders here beside the live REIT-implied numbers.
        </div>
      )}
    </div>

    <InfoBox color={CYAN}>
      <strong style={{ color: "#cbd5e1" }}>Reading commercial.</strong> Three things move commercial values: rates (through the cap rate), NOI (rents × occupancy), and credit availability. The BIS price index tells you where values are; delinquency tells you whether the pain has reached the lenders (it always lags); the cap-rate spread tells you whether the asset class is being paid for its risk; construction tells you whether supply is coming. Office is the sector where all four are worst — and the sector the REIT table prices accordingly.
    </InfoBox>
  </>);
}

// ── Tab ─────────────────────────────────────────────────────────────────────
export default function RealEstateTab({ hd, md, zillowData, choroplethCache, choroplethMetric, setChoroplethMetric, fetchChoroplethData, choroplethLoading, choroplethProgress }) {
  const [view, setView] = useState("fair");
  const housing = useJson("/api/housing-health");
  const repl = useJson("/api/replacement-cost");
  const cre = useJson("/api/cre-fundamentals");
  const reit = useJson("/api/reit-caprates");

  // the map: make sure the shared metric is a real-estate one while this tab owns it
  useEffect(() => {
    if (view !== "map") return;
    const key = RE_MAP_METRICS.some(m => m.key === choroplethMetric) ? choroplethMetric : RE_MAP_METRICS[0]?.key;
    if (key && key !== choroplethMetric) setChoroplethMetric(key);
    if (key) fetchChoroplethData(key);
  }, [view, choroplethMetric, setChoroplethMetric, fetchChoroplethData]);

  const VIEWS = [["fair", "Fair Value"], ["residential", "Residential"], ["commercial", "Commercial"], ["map", "State Map"]];
  return (<>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
      {VIEWS.map(([id, text]) => (
        <button key={id} onClick={() => setView(id)} style={{
          flex: "1 1 auto", padding: "8px 10px", border: "none", borderRadius: 8,
          background: view === id ? "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(99,102,241,0.1))" : "transparent",
          color: view === id ? "var(--tab-active-color)" : "var(--tab-inactive-color)", fontSize: 12, fontWeight: view === id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.15s", borderBottom: view === id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{text}</button>
      ))}
    </div>

    {view === "fair" && <FairValueView housing={housing} repl={repl} cre={cre} reit={reit} zillow={zillowData} go={setView} />}
    {view === "residential" && <HousingSubTab hd={hd} md={md} zillow={zillowData} />}
    {view === "commercial" && <CommercialView cre={cre} reit={reit} />}
    {view === "map" && (<>
      <StateChoropleth title="State-Level Real Estate" metrics={RE_MAP_METRICS} metric={choroplethMetric} setMetric={setChoroplethMetric} cache={choroplethCache} loading={choroplethLoading} progress={choroplethProgress}
        note={`Realtor.com listing data (price, $/sq ft, active listings, days on market — monthly), FHFA house price index (quarterly), Census vacancy (annual), Zillow home value and inventory. "$ / sq ft vs build cost" divides each state's median listing $/sq ft by the national hard construction cost of $${BUILD_COST_PER_SQFT.value}/sq ft (${BUILD_COST_PER_SQFT.source}) — the residual above 1.0× is mostly land, which is exactly what a replacement-cost lens should isolate. State-level foreclosures and cap rates have no free feed (ATTOM and broker surveys are paywalled); the national delinquency series on the Commercial tab is the honest substitute.`} />
    </>)}
  </>);
}
