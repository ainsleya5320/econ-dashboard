import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "./options/ui.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// CFTC POSITIONING — the Commitments of Traders report, explained.
// Who holds what in 35 futures markets by kind of trader (CFTC Disaggregated
// report for commodities, Traders in Financial Futures for financials), read
// the four ways traders read it: crowding (the COT index), the hedgers on the
// other side, weekly flows, and price with open interest. Every number on the
// page carries the plain-English reading next to it, and a backtest says how
// much the signals have actually been worth.
// Data: /api/cot-report (server/cotReport.js — CFTC Socrata + Yahoo prices).
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dLbl = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}` : "—");
const year = p => String(p).slice(0, 4);
const yearTicks = rows => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y)) return false; seen.add(y); return true; }).map(r => r.p); };
const k = v => { if (!finite(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e6 ? `${s}${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}${(a / 1e3).toFixed(1)}K` : `${s}${Math.round(a)}`; };
const sk = v => (finite(v) ? `${v > 0 ? "+" : ""}${k(v)}` : "—");
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const ASSETS = ["Energy", "Metals", "Agriculture", "Equities", "Rates", "Currencies", "Crypto"];
const READ = {
  crowdedLong: ["Crowded long", "var(--oc-pos)"], crowdedShort: ["Crowded short", "var(--oc-neg)"],
  leanLong: ["Leaning long", "color-mix(in srgb, var(--oc-pos) 55%, var(--oc-mid))"], leanShort: ["Leaning short", "color-mix(in srgb, var(--oc-neg) 55%, var(--oc-mid))"],
  neutral: ["Middle of range", "var(--text-muted)"],
};
const GROUP_C = { spec: C[1], core: C[2], dealer: C[3], small: "var(--text-muted)" };

// what each kind of trader is, in both reports
const WHO = {
  disagg: [
    ["spec", "Managed money", "Hedge funds, CTAs and commodity pools. Mostly trend followers: they buy what is rising and sell what is falling, so their position tends to move with price. This is the group people mean by \"the speculators\", and the one whose extremes signal a crowded trade."],
    ["core", "Producers & users", "Companies that produce, process or consume the physical commodity — oil producers, refiners, grain elevators, food companies, miners — hedging their business. Producers sell forward, so this group is usually net short. They are price-sensitive: they hedge more when prices are high and less when low, which makes them lean against the trend and gives them the \"smart money\" label."],
    ["dealer", "Swap dealers", "Banks that sell commodity swaps and index products to clients (pension funds buying commodity-index exposure, airlines locking in fuel) and offset the risk in futures. Their position is mostly a mirror of client demand, not their own view."],
    ["small", "Small traders", "Positions below the reporting threshold — whatever is left over once the large traders are counted. Often read as retail, but it also includes small professional accounts."],
  ],
  tff: [
    ["spec", "Leveraged funds", "Hedge funds and CTAs (trend followers) — the speculators in financial futures. Caution: in Treasuries and bitcoin much of their short is the cash-futures basis trade (own the bond or the ETF, sell the future to capture a small spread), not a bet that prices fall."],
    ["core", "Asset managers", "Pension funds, insurers, endowments, mutual funds and ETFs — \"real money\". They use futures as a cheap way to hold exposure, so they are structurally long equity-index and Treasury futures. Changes in their position show where long-term money is moving."],
    ["dealer", "Dealers", "The banks' trading desks. They take the other side of client business, so their position is usually the mirror image of what clients want, not a forecast."],
    ["small", "Small traders", "Positions below the reporting threshold, often read as retail."],
  ],
};
const SPECIAL = {
  "042601": "Treasuries: leveraged funds' big short is mostly the basis trade against cash bonds, so read changes and extremes in their position, not the sign.",
  "043602": "Treasuries: leveraged funds' big short is mostly the basis trade against cash bonds, so read changes and extremes in their position, not the sign.",
  "020601": "Treasuries: leveraged funds' short is largely the basis trade; asset managers are the natural longs.",
  "020604": "Treasuries: leveraged funds' short is largely the basis trade; asset managers are the natural longs.",
  "133741": "Bitcoin: much of the leveraged-fund short is the basis trade against spot bitcoin ETFs (long the ETF, short the future), not a bearish call.",
  "1170E1": "VIX: speculators are habitually short volatility futures (selling insurance); a move toward long is unusual and means funds are paying up for protection. Price shown is the spot VIX index, which the futures track loosely.",
  "13874A": "Equity indexes: asset managers hold futures as a cash substitute; leveraged funds' position mixes hedges, relative-value trades and outright bets.",
  "06765T": "This is NYMEX's Brent contract; the main Brent market trades on ICE in London and is not in the CFTC report, so read this as a small sample.",
};

function Scale({ v, w = 120 }) {
  if (!finite(v)) return <span className="onote">—</span>;
  const x = 4 + (v / 100) * (w - 8), col = v >= 90 ? "var(--oc-pos)" : v <= 10 ? "var(--oc-neg)" : "var(--text-secondary)";
  return (
    <svg width={w} height={16} role="img" aria-label={`${Math.round(v)} on a 0 to 100 scale`} style={{ display: "block" }}>
      <rect x={4} y={6} width={w - 8} height={4} rx={2} style={{ fill: "var(--oc-mid)" }} />
      <rect x={4 + 0.1 * (w - 8)} y={6} width={0.8 * (w - 8)} height={4} style={{ fill: "var(--text-muted)", opacity: 0.35 }} />
      <circle cx={x} cy={8} r={5} style={{ fill: col }} stroke="var(--card-bg)" strokeWidth="2" />
    </svg>
  );
}

function narrative(c, groups, all) {
  const s = c.groups.spec, g = c.groups.core, L = c.latest, q = L.quadrant;
  const side = s.net >= 0 ? "long" : "short";
  const scale = finite(s.cotIndex) ? (s.cotIndex >= 90 ? "the top of their three-year range — a crowded long: most funds that want to own it already do" : s.cotIndex <= 10 ? "the bottom of their three-year range — a crowded short: most funds that want to bet against it already have" : s.cotIndex >= 75 ? "the upper part of their range — leaning long but not extreme" : s.cotIndex <= 25 ? "the lower part of their range — leaning short but not extreme" : "the middle of their range — no crowding signal") : "an unknown point (not enough history)";
  const flow = finite(s.chg4w) ? `Over the last four weeks they ${s.chg4w >= 0 ? "added" : "cut"} ${k(Math.abs(s.chg4w))} contracts net (${signed(s.chg4w / Math.max(1, L.oi) * 100, 1, "% of open interest")}), while price moved ${signed(L.priceChg4w, 1, "%")} and open interest ${L.oiChg4w >= 0 ? "rose" : "fell"} ${pct(Math.abs(L.oiChg4w))}.` : "";
  const coreRead = c.report === "disagg"
    ? `${groups.core} sit at ${fx(g.cotIndex, 0)} on their own scale (${g.cotIndex >= 75 ? "unusually long or lightly hedged — the physical side thinks the price is low" : g.cotIndex <= 25 ? "unusually short — the physical side is hedging hard, which usually means it thinks the price is high" : "middle of their range"}).`
    : `${groups.core} sit at ${fx(g.cotIndex, 0)} on their own scale (${g.cotIndex >= 75 ? "real money is near its most long of the last three years" : g.cotIndex <= 25 ? "real money is near its least long of the last three years" : "middle of their range"}).`;
  const bt = c.backtest, ext = s.cotIndex >= 90 ? bt.long : s.cotIndex <= 10 ? bt.short : null;
  const hist = ext && ext.n >= 5 ? ` In this market, past weeks at a similar extreme were followed by an average move of ${signed(ext.fwd4, 1, "%")} over the next four weeks and ${signed(ext.fwd13, 1, "%")} over thirteen (${ext.n} weeks), against ${signed(bt.all.fwd4, 1, "%")} and ${signed(bt.all.fwd13, 1, "%")} for all weeks.` : "";
  return `${groups.spec} are net ${side} ${k(Math.abs(s.net))} contracts, ${pct(Math.abs(s.pctOi))} of open interest. On the three-year scale that is ${fx(s.cotIndex, 0)} — ${scale}. ${flow}${q ? ` That is ${q.label.toLowerCase()}: ${q.why[0].toLowerCase()}${q.why.slice(1)}` : ""} ${coreRead} The four largest traders hold ${pct(L.top4Long, 0)} of the long side and ${pct(L.top4Short, 0)} of the short side.${hist}`;
}

export default function CftcSubTab() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [asset, setAsset] = useState("all"), [sort, setSort] = useState("asset"), [sel, setSel] = useState("067651"), [showGloss, setShowGloss] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/cot-report").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.contracts) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const list = useMemo(() => (d?.contracts || []).filter(c => asset === "all" || c.asset === asset).sort((a, b) =>
    sort === "spec" ? (b.groups.spec.cotIndex ?? -1) - (a.groups.spec.cotIndex ?? -1) : sort === "flow" ? Math.abs(b.groups.spec.chg4w / b.latest.oi) - Math.abs(a.groups.spec.chg4w / a.latest.oi) : ASSETS.indexOf(a.asset) - ASSETS.indexOf(b.asset)), [d, asset, sort]);
  const c = d?.contracts?.find(x => x.code === sel) || d?.contracts?.[0];
  const rows = useMemo(() => {
    if (!c || !d?.weeks) return [];
    const i0 = d.weeks.indexOf(c.series.from), S = c.series;
    return S.spec.map((_, i) => ({ p: d.weeks[i0 + i], spec: S.spec[i], core: S.core[i], dealer: S.dealer[i], small: S.small[i], price: S.price[i], specIdx: S.specIdx[i], coreIdx: S.coreIdx[i] }));
  }, [c, d]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The Commitments of Traders data is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading the CFTC Commitments of Traders report…</p></div></div>;
  const G = c ? d.groups[c.report] : {};
  const crowded = d.contracts.filter(x => x.extreme === "crowdedLong"), shorted = d.contracts.filter(x => x.extreme === "crowdedShort");
  const P = d.backtest?.all;
  const select = code => { setSel(code); requestAnimationFrame(() => document.getElementById("cot-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  return (
    <div className="options-research">
      <header style={{ marginBottom: 10 }}>
        <div className="ocard-eyebrow">CFTC Commitments of Traders · positions as of Tuesday {dLbl(d.asOf)} · published Friday {dLbl(d.released)}</div>
        <h2 style={{ margin: "2px 0 6px", font: "600 24px var(--font-body)", letterSpacing: -0.3 }}>Who is betting on what</h2>
        <p className="ohead-line" style={{ margin: 0 }}>
          Every week the U.S. futures regulator publishes how the big players in each futures market are positioned — hedge funds, producers hedging their business, banks, pension funds. It is the closest thing to a public look at who owns what.
          Right now the speculators are <strong>crowded long</strong> in {crowded.map(x => x.label).join(", ") || "nothing"} and <strong>crowded short</strong> in {shorted.map(x => x.label).join(", ") || "nothing"} (the top or bottom 10% of their own three-year range).
        </p>
      </header>

      <VizCard eyebrow="Start here" title="How to read positioning, in four questions"
        right={<button type="button" className="ochip" aria-pressed={showGloss} onClick={() => setShowGloss(v => !v)}>{showGloss ? "Hide glossary" : "Glossary"}</button>}
        finding="The report doesn't forecast prices. It tells you who is already in a trade, and therefore who is left to push it further — or who would be forced out if it turns. Traders use it four ways:">
        <div className="ogrid ogrid-2" style={{ gap: 10 }}>
          {[
            ["1 · Is the trade crowded?", "Look at the speculators' position on its three-year scale (the COT index: 0 = the most short they've been, 100 = the most long). Above 90, most funds that want to be long already are, so there are few buyers left and many potential sellers if news turns. Below 10 is the mirror image. It's a warning about fragility, not a timing signal — crowded trades can stay crowded for months while a trend runs."],
            ["2 · What are the hedgers doing?", "In commodities, producers and users hedge real business. They sell forward when prices are high and hedge less when prices are low, so they lean against the trend. When the hedgers are unusually long (or unusually lightly short) while speculators are short, the people closest to the physical market think it's cheap. In financial futures the equivalent is asset managers — slow, long-term money."],
            ["3 · Which way is money flowing?", "The week-to-week and four-week change in the speculators' position is a flow. Funds adding steadily confirm a trend; a sharp cut after a long run-up is often the start of a reversal. Size the flow against open interest: 5% of the market moving in a month is a lot."],
            ["4 · Price and open interest together", "Open interest is the number of contracts outstanding. Price up with open interest up = new money buying (a healthy uptrend). Price up with open interest down = shorts covering (can fade once they're done). Price down with open interest up = new selling. Price down with open interest down = longs giving up."],
          ].map(([h, t]) => (
            <div key={h} style={{ padding: "8px 10px", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
              <strong style={{ font: "600 13px var(--font-body)", color: "var(--text-primary)" }}>{h}</strong>
              <p className="onote" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>{t}</p>
            </div>
          ))}
        </div>
        {showGloss && (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {[
              ["Futures contract", "An agreement to buy or sell a set amount of something (1,000 barrels of oil, 100 ounces of gold, $100,000 of Treasury bonds) at a set price on a future date. Each market's contract size is shown in the detail view."],
              ["Long / short", "Long = has agreed to buy (gains if price rises). Short = has agreed to sell (gains if price falls). Every contract has exactly one long and one short."],
              ["Net position", "Long contracts minus short contracts for a group. Positive = net long. Because every long has a short, the groups' net positions add up to roughly zero: someone is always on the other side."],
              ["Open interest", "The number of contracts outstanding. Rising open interest means new positions are being opened; falling means positions are being closed."],
              ["% of open interest", "A group's net position divided by open interest, so markets of different sizes can be compared."],
              ["COT index (three-year scale)", "Where a group's net position sits between its lowest and highest of the last 156 weeks: 0 = most short, 100 = most long. Popularised by trader Larry Williams. 90+ and 10− are the usual \"extreme\" lines."],
              ["Reportable / non-reportable", "Traders above a size threshold set for each market must report and are classified by their business. Everything below is the non-reportable remainder (\"small traders\")."],
              ["Futures + options combined", "This page uses the combined report: options are converted into futures-equivalent positions using their delta, so a trader's whole exposure is counted."],
              ["Spread positions", "Offsetting long and short positions in different months of the same market; they are excluded from the net figures here."],
              ["Report timing", "Positions are taken at Tuesday's close and published Friday at 3:30 pm Eastern (later after holidays), so the data is three days old when it appears."],
            ].map(([t, x]) => <div key={t} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) 1fr", gap: 10 }}><strong style={{ font: "600 12px var(--font-body)" }}>{t}</strong><span className="onote" style={{ margin: 0, fontSize: 12 }}>{x}</span></div>)}
          </div>
        )}
      </VizCard>

      <div style={{ marginTop: 12 }}>
        <VizCard eyebrow={`${d.contracts.length} markets · speculators = managed money (commodities) or leveraged funds (financials)`} title="The scoreboard"
          right={<><Seg label="Asset class" value={asset} onChange={setAsset} options={[["all", "All"], ...ASSETS.map(a => [a, a === "Agriculture" ? "Ags" : a])]} /><Seg label="Sort" value={sort} onChange={setSort} options={[["asset", "By market"], ["spec", "Most crowded"], ["flow", "Biggest flow"]]} /></>}
          finding="Each row answers the four questions for one market. The scale shows where the speculators sit in their own three-year range — the shaded middle is normal, the dot turns red near the top (crowded long) and blue near the bottom (crowded short). Click a market for the full story.">
          <div className="otable-wrap" style={{ maxHeight: 620 }}>
            <table className="otable">
              <thead><tr>
                <th style={{ textAlign: "left" }}>Market</th><th>Price, 4 wk</th><th>Speculators net</th><th style={{ textAlign: "left" }}>Speculators, 3-yr scale</th><th style={{ textAlign: "left" }}>Crowding</th>
                <th>Flow, 4 wk</th><th>Other side, 3-yr scale</th><th style={{ textAlign: "left" }}>Price + open interest</th>
              </tr></thead>
              <tbody>{list.map(x => { const s = x.groups.spec, [rl, rc] = READ[x.extreme] || ["—", "var(--text-muted)"]; return (
                <tr key={x.code} onClick={() => select(x.code)} style={{ cursor: "pointer", background: x.code === c?.code ? "var(--bg-subtle)" : undefined }} title={`${x.label}: click for detail`}>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap" }}><strong>{x.label}</strong><span className="onote" style={{ margin: "0 0 0 6px" }}>{x.asset}</span></td>
                  <td>{signed(x.latest.priceChg4w, 1, "%")}</td>
                  <td title={`${k(s.net)} contracts`}>{signed(s.pctOi, 1, "% OI")}</td>
                  <td style={{ textAlign: "left" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Scale v={s.cotIndex} /><span>{fx(s.cotIndex, 0)}</span></span></td>
                  <td style={{ textAlign: "left" }}><span className="otag" style={{ borderColor: rc, color: "var(--text-primary)" }}>{rl}</span></td>
                  <td title={`${sk(s.chg4w)} contracts`}>{signed(s.chg4w / Math.max(1, x.latest.oi) * 100, 1, "% OI")}</td>
                  <td title={d.groups[x.report].core}>{fx(x.groups.core.cotIndex, 0)}</td>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{x.latest.quadrant?.label || "—"}</td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
          <p className="ocard-note">"Other side" is producers &amp; users for commodities and asset managers for financial futures. Flow is the four-week change in the speculators' net position as a share of open interest. Hover a cell for the number of contracts.</p>
        </VizCard>
      </div>

      {c && (
        <div id="cot-detail" style={{ marginTop: 12, scrollMarginTop: 12 }}>
          <VizCard eyebrow={`${c.asset} · ${c.report === "disagg" ? "Disaggregated report" : "Traders in Financial Futures report"} · one contract = ${c.unit}`} title={c.label}
            right={<select value={c.code} onChange={e => setSel(e.target.value)} aria-label="Market" style={{ font: "12px var(--font-body)", background: "var(--card-bg)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "4px 6px" }}>
              {ASSETS.map(a => <optgroup key={a} label={a}>{d.contracts.filter(x => x.asset === a).map(x => <option key={x.code} value={x.code}>{x.label}</option>)}</optgroup>)}
            </select>}
            finding={narrative(c, G, d)}
            note={SPECIAL[c.code]}>
            <div className="okpis" style={{ marginBottom: 10 }}>
              {["spec", "core", "dealer", "small"].map(g => { const x = c.groups[g]; return <Kpi key={g} label={x.label} value={`${sk(x.net)}`} sub={`${signed(x.pctOi, 1, "% of OI")} · scale ${fx(x.cotIndex, 0)} · 4 wk ${sk(x.chg4w)}`} tone={g === "spec" && finite(x.cotIndex) ? (x.cotIndex >= 90 ? "var(--oc-pos)" : x.cotIndex <= 10 ? "var(--oc-neg)" : undefined) : undefined} />; })}
              <Kpi label="Open interest" value={k(c.latest.oi)} sub={`${signed(c.latest.oiChg4w, 1, "%")} over 4 weeks`} />
            </div>
            <div className="ogrid ogrid-2">
              <div>
                <div className="ocard-eyebrow">Net position by trader group · contracts</div>
                <Legend items={["spec", "core", "dealer", "small"].map(g => [G[g], GROUP_C[g]])} />
                <div className="ochart" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(rows)} interval={0} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={k} />
                    <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dLbl} formatter={(v, n) => [sk(v), G[n] || n]} />
                    <ReferenceLine y={0} stroke="var(--text-muted)" />
                    {["small", "dealer", "core", "spec"].map(g => <Line key={g} dataKey={g} stroke={GROUP_C[g]} strokeWidth={g === "spec" ? 2.25 : 1.5} dot={false} isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer></div>
                <p className="onote">The lines roughly mirror each other because every long has a short: when the speculators buy, someone — usually the hedgers or dealers — sells to them.</p>
              </div>
              <div>
                <div className="ocard-eyebrow">Price · weekly close ({c.symbol})</div>
                <div className="ochart" style={{ height: 105 }}><ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} /><XAxis dataKey="p" hide />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} tickFormatter={v => fx(v, v >= 100 ? 0 : 2)} />
                    <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dLbl} formatter={v => [fx(v, v >= 100 ? 1 : 4), "Price"]} />
                    <Line dataKey="price" stroke="var(--text-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer></div>
                <div className="ocard-eyebrow" style={{ marginTop: 6 }}>Three-year scale (COT index) · 90 and 10 are the crowding lines</div>
                <Legend items={[[G.spec, GROUP_C.spec], [G.core, GROUP_C.core]]} />
                <div className="ochart" style={{ height: 105 }}><ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(rows)} interval={0} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} domain={[0, 100]} ticks={[0, 10, 50, 90, 100]} />
                    <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dLbl} formatter={(v, n) => [fx(v, 0), n === "specIdx" ? G.spec : G.core]} />
                    <ReferenceArea y1={90} y2={100} fill="var(--oc-pos)" fillOpacity={0.12} />
                    <ReferenceArea y1={0} y2={10} fill="var(--oc-neg)" fillOpacity={0.12} />
                    <Line dataKey="coreIdx" stroke={GROUP_C.core} strokeWidth={1.3} dot={false} isAnimationActive={false} connectNulls />
                    <Line dataKey="specIdx" stroke={GROUP_C.spec} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer></div>
              </div>
            </div>
            <div className="ogrid ogrid-2" style={{ marginTop: 10 }}>
              <div>
                <div className="ocard-eyebrow">Who these traders are</div>
                {WHO[c.report].map(([g, t, x]) => <p key={g} className="onote" style={{ margin: "4px 0", fontSize: 12 }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: GROUP_C[g], marginRight: 6 }} /><strong style={{ color: "var(--text-primary)" }}>{t}.</strong> {x}</p>)}
              </div>
              <div>
                <div className="ocard-eyebrow">Has the signal worked in this market? · since {year(c.firstReport)}</div>
                <MiniTable columns={[{ key: "when", label: "When speculators were…" }, { key: "n", label: "Weeks" }, { key: "fwd4", label: "Avg move, next 4 wk", fmt: v => signed(v, 1, "%") }, { key: "up4", label: "Up after 4 wk", fmt: v => pct(v, 0) }, { key: "fwd13", label: "Avg move, next 13 wk", fmt: v => signed(v, 1, "%") }]}
                  rows={[{ when: "Crowded long (≥ 90)", ...c.backtest.long }, { when: "Crowded short (≤ 10)", ...c.backtest.short }, { when: "Any week", ...c.backtest.all }]} />
                <p className="onote">If crowding were a reliable contrarian signal, crowded longs would be followed by falls and crowded shorts by rises. Small counts (under ~20 weeks) are anecdotes, not evidence.</p>
              </div>
            </div>
          </VizCard>
        </div>
      )}

      {P && (
        <div style={{ marginTop: 12 }}>
          <VizCard eyebrow="Backtest · all 35 markets, weekly, since 2016 (first three years used to build the scale)" title="Does crowding predict reversals?"
            finding={`Not reliably, on its own. Across every market, weeks when speculators were crowded long were followed by ${signed(P.long.fwd4, 1, "%")} on average over four weeks (up ${pct(P.long.up4, 0)} of the time) and ${signed(P.long.fwd13, 1, "%")} over thirteen — against ${signed(P.all.fwd4, 1, "%")} and ${signed(P.all.fwd13, 1, "%")} for all weeks. Crowded shorts were followed by ${signed(P.short.fwd4, 1, "%")} and ${signed(P.short.fwd13, 1, "%")}. In other words, extremes have more often marked trends that kept going than tops and bottoms. Traders who use the report treat an extreme as a reason to watch for a catalyst — a reversal in price, the speculators starting to cut, open interest falling — rather than as a signal in itself.`}
            note={d.backtest.note}
            table={null}>
            <MiniTable columns={[{ key: "a", label: "Asset class" }, { key: "lf4", label: "Crowded long: next 4 wk", fmt: v => signed(v, 1, "%") }, { key: "ln", label: "weeks" }, { key: "sf4", label: "Crowded short: next 4 wk", fmt: v => signed(v, 1, "%") }, { key: "sn", label: "weeks" }, { key: "af4", label: "All weeks: next 4 wk", fmt: v => signed(v, 1, "%") }, { key: "lf13", label: "Crowded long: next 13 wk", fmt: v => signed(v, 1, "%") }, { key: "sf13", label: "Crowded short: next 13 wk", fmt: v => signed(v, 1, "%") }, { key: "af13", label: "All: next 13 wk", fmt: v => signed(v, 1, "%") }]}
              rows={[["All markets", P], ...Object.entries(d.backtest.byAsset)].map(([a, b]) => ({ a, lf4: b.long.fwd4, ln: b.long.n, sf4: b.short.fwd4, sn: b.short.n, af4: b.all.fwd4, lf13: b.long.fwd13, sf13: b.short.fwd13, af13: b.all.fwd13 }))} />
          </VizCard>
        </div>
      )}

      <VizCard style={{ marginTop: 12 }} eyebrow="Before you trade on it" title="What the report can't tell you"
        finding="Positioning is context, not a forecast. Keep these in mind:">
        <ul className="onote" style={{ margin: "0 0 0 18px", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          <li><strong>It is three days old.</strong> Positions are Tuesday's; by Friday's release the market may already have moved.</li>
          <li><strong>Classification is by firm, not by purpose.</strong> A hedge fund's long may be one leg of a spread or a hedge; a producer can speculate.</li>
          <li><strong>Some big positions aren't bets.</strong> The basis trade in Treasuries and bitcoin, dealers offsetting client swaps, and asset managers using futures as a cash substitute all create large positions with no view on price.</li>
          <li><strong>Extremes can persist.</strong> A crowded long in a strong trend can stay crowded for a long time — the backtest above shows it.</li>
          <li><strong>Not every market is here.</strong> Brent and gasoil trade mainly on ICE in London, and many contracts trade overseas, outside the CFTC's report.</li>
        </ul>
      </VizCard>

      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      <p className="onote">Sources: {(d.sources || []).map(s => `${s.label} (${s.from === "live" ? "fetched" : `${s.from} copy`} ${String(s.fetched || "").slice(0, 10)})`).join("; ")}. Commodities → Pulse shows the speculators' readings for its markets in summary.</p>
    </div>
  );
}
