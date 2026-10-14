import React, { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, BarChart, Area, Line, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, ord, usdK, usd, dayLabel, monLabel, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Spark, divBg, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// CLOSED-END FUNDS: the discount trade. A closed-end fund's shares trade apart
// from its net asset value, and a discount that is unusually wide against the
// fund's own history tends to narrow (Pontiff 1995; activists and tender
// offers are the usual catalysts). Discounts also widen into December's
// tax-loss selling and recover in January. The view shows the whole market's
// discount cycle, the calendar-month pattern, a screener of every listed fund,
// one fund's discount and distribution history, and a monthly backtest of
// "buy the cheapest against their own history" that runs here on the
// server's month-end panel, so its settings can be changed. Data:
// /api/cef (server/cefDiscounts.js, from CEFConnect; kept on this machine).
// ============================================================================

const FAMS = [["all", "All"], ["Equity", "Equity"], ["Taxable bond", "Taxable bond"], ["Municipal", "Municipal"], ["Other", "Other"]];
const NEG = "var(--oc-pos)"; // widening / expensive side of the diverging pair (red)
const pct1 = v => (finite(v) ? `${v.toFixed(1)}%` : "—");
const sd = xs => { const v = xs.filter(finite); if (v.length < 2) return null; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); };
const mean = xs => { const v = xs.filter(finite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const median = xs => { const v = xs.filter(finite).sort((a, b) => a - b); if (!v.length) return null; const i = (v.length - 1) / 2; return (v[Math.floor(i)] + v[Math.ceil(i)]) / 2; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// backtest: month-end signal, next month's total return, equal weight
// ---------------------------------------------------------------------------
function runBacktest(panel, { signal, n, cost, minPx, fam, lag = 0 }) {
  if (!panel?.months?.length) return null;
  const M = panel.months.length, funds = panel.funds.filter(f => fam === "all" || f.fam === fam);
  const sig = f => (signal === "z" ? f.z : signal === "rel" ? f.rel : f.disc);
  const rows = [], quint = [[], [], [], [], []];
  let prevCheap = new Set(), prevRich = new Set(), gC = 1, gU = 1, gR = 1;
  const holdingsNow = { cheap: [], rich: [] };
  // lag 1 waits a month after the signal before holding: what is left once the fast reversal
  // (including bounce in the closing prices the signal is read from) has gone
  const lastFull = panel.lastPartial ? M - 2 : M - 1; // the month in progress is not a holding month
  for (let i = 0; i + 1 + lag <= lastFull; i++) {
    const h = i + 1 + lag;
    const elig = funds.filter(f => finite(sig(f)[i]) && finite(f.tr[h]) && finite(f.px[i]) && f.px[i] >= minPx);
    if (elig.length < n * 3) continue;
    const ranked = [...elig].sort((a, b) => sig(a)[i] - sig(b)[i]);
    const cheap = ranked.slice(0, n), rich = ranked.slice(-n);
    const turn = (set, prev) => (prev.size ? set.filter(f => !prev.has(f.t)).length / set.length : 1);
    const tC = turn(cheap, prevCheap), tR = turn(rich, prevRich);
    const uni = mean(elig.map(f => f.tr[h]));
    const rC = mean(cheap.map(f => f.tr[h])) - 2 * cost * tC, rR = mean(rich.map(f => f.tr[h])) - 2 * cost * tR;
    gC *= 1 + rC; gU *= 1 + uni; gR *= 1 + rR;
    rows.push({ m: panel.months[h], cheap: gC, uni: gU, rich: gR, rC, rU: uni, rR, tC });
    prevCheap = new Set(cheap.map(f => f.t)); prevRich = new Set(rich.map(f => f.t));
    // quintiles of the signal: next month's return against the month's universe mean
    const q = Math.floor(ranked.length / 5);
    for (let k = 0; k < 5; k++) quint[k].push(mean(ranked.slice(k * q, k === 4 ? ranked.length : (k + 1) * q).map(f => f.tr[h])) - uni);
  }
  // what the rule would hold today, from the latest month-end
  const L = M - 1, nowElig = funds.filter(f => finite(sig(f)[L]) && finite(f.px[L]) && f.px[L] >= minPx).sort((a, b) => sig(a)[L] - sig(b)[L]);
  holdingsNow.cheap = nowElig.slice(0, n).map(f => ({ t: f.t, s: sig(f)[L], disc: f.disc[L] }));
  holdingsNow.rich = nowElig.slice(-n).reverse().map(f => ({ t: f.t, s: sig(f)[L], disc: f.disc[L] }));
  const stats = key => {
    const r = rows.map(x => x[key]);
    if (!r.length) return null;
    const g = r.reduce((a, b) => a * (1 + b), 1), yrs = r.length / 12;
    let peak = 1, dd = 0, v = 1; for (const x of r) { v *= 1 + x; peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
    return { ann: (g ** (1 / yrs) - 1) * 100, vol: sd(r) * Math.sqrt(12) * 100, dd: dd * 100, months: r.length };
  };
  const hit = rows.length ? (rows.filter(x => x.rC > x.rU).length / rows.length) * 100 : null;
  return { rows, cheap: stats("rC"), uni: stats("rU"), rich: stats("rR"), hit, turnover: mean(rows.map(x => x.tC)) * 100, quint: quint.map((q, k) => ({ q: `Q${k + 1}`, ex: mean(q) * 100, n: q.length })), now: holdingsNow, asOf: panel.months[L] };
}

// ---------------------------------------------------------------------------
// one fund: discount against its own rolling range, price vs NAV, distributions
// ---------------------------------------------------------------------------
function FundDetail({ t, row }) {
  const [h, setH] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true; setH(null); setErr(null);
    fetch(`/api/cef?fund=${encodeURIComponent(t)}`).then(r => r.json()).then(j => { if (!alive) return; if (j.error) setErr(j.error); else setH(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, [t]);
  const weekly = useMemo(() => {
    const w = (h?.weekly || []).filter(p => finite(p.disc));
    return w.map((p, i) => {
      const win = w.slice(Math.max(0, i - 51), i + 1).map(x => x.disc);
      const m = win.length >= 26 ? mean(win) : null, s = win.length >= 26 ? sd(win) : null;
      return { d: p.d, disc: p.disc, price: p.price, nav: p.nav, mean: m, b1: finite(m) && finite(s) ? [m - s, m + s] : null, b2: finite(m) && finite(s) ? [m - 2 * s, m + 2 * s] : null };
    });
  }, [h]);
  const dists = useMemo(() => (h?.dists || []).filter(x => finite(x.total)).map(x => ({ ex: x.ex, income: finite(x.income) ? x.income : Math.max(0, x.total - (x.roc || 0)), roc: finite(x.roc) ? x.roc : 0, special: x.special || 0 })).sort((a, b) => a.ex.localeCompare(b.ex)), [h]);
  const last = weekly.at(-1);
  if (err) return <div className="ocard"><p className="ocard-finding">No history for {t}: {err}</p></div>;
  if (!h) return <div className="ocard"><p className="ocard-finding">Loading {t}…</p></div>;
  const z = finite(last?.mean) && finite(last?.b1?.[1]) ? (last.disc - last.mean) / (last.b1[1] - last.mean) : null;
  const rocShare = dists.length ? dists.slice(-12).reduce((a, b) => a + b.roc, 0) / Math.max(1e-9, dists.slice(-12).reduce((a, b) => a + b.income + b.roc + b.special, 0)) : null;
  return (
    <div className="ogrid" style={{ marginBottom: 12 }}>
      <div className="okpis" style={{ marginBottom: 0 }}>
        <Kpi label={`${t} discount`} value={pct1(row?.disc ?? last?.disc)} sub={`52-wk avg ${pct1(row?.disc52)} · z ${fx(row?.z1y, 2)}`} />
        <Kpi label="Price · NAV" value={`${usd(row?.price)} · ${usd(row?.nav)}`} sub={row?.navDate ? `NAV ${dayLabel(row.navDate.slice(0, 10))}` : ""} />
        <Kpi label="Distribution rate" value={pct1(row?.distPrice)} sub={`on NAV ${pct1(row?.distNav)} · ${row?.distFreq || ""}${row?.managed ? " · managed" : ""}`} />
        <Kpi label="Return of capital, 12m" value={finite(row?.roc12) ? `${Math.round(row.roc12 * 100)}%` : finite(rocShare) ? `${Math.round(rocShare * 100)}%` : "—"} sub={finite(row?.coverage) ? `earnings cover ${Math.round(row.coverage * 100)}% of the payout` : "share of payouts that were capital"} />
        <Kpi label="Leverage · expense" value={`${pct1(row?.lev)} · ${pct1(row?.expense)}`} sub={`${row?.sponsor || ""}`} />
        <Kpi label="NAV return" value={pct1(row?.ret1yNav)} sub={`1y · 3y ${pct1(row?.ret3yNav)} a yr · 5y ${pct1(row?.ret5yNav)} a yr`} />
      </div>
      <div className="ogrid ogrid-2" style={{ marginBottom: 0 }}>
        <VizCard eyebrow={`${row?.name || t} · weekly, 5 years`} title="Discount against its own range"
          finding={finite(z) ? `At ${pct1(last.disc)}, the discount is ${Math.abs(z).toFixed(1)} standard deviations ${z < 0 ? "wider" : "narrower"} than its trailing 52-week average of ${pct1(last.mean)}${z <= -2 ? ": unusually cheap against its own history" : z >= 2 ? ": unusually rich against its own history" : ""}.` : "Not enough history for a range."}
          table={<MiniTable columns={[{ key: "d", label: "Week" }, { key: "disc", label: "Discount", fmt: v => pct1(v) }, { key: "mean", label: "52w avg", fmt: v => pct1(v) }, { key: "price", label: "Price", fmt: v => usd(v) }, { key: "nav", label: "NAV", fmt: v => usd(v) }]} rows={[...weekly].reverse()} />}>
          <Legend items={[["Discount", C[1]], ["52-week average", "var(--text-muted)", true], ["±1 and ±2 standard deviations", "var(--text-muted)"]]} />
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={weekly} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${Math.round(v)}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={(v, n) => (Array.isArray(v) ? [`${v[0].toFixed(1)}% to ${v[1].toFixed(1)}%`, n] : [pct1(v), n])} />
              <ReferenceLine y={0} stroke="var(--border-subtle)" />
              <Area dataKey="b2" name="±2 sd" stroke="none" fill="var(--text-muted)" fillOpacity={0.12} isAnimationActive={false} connectNulls />
              <Area dataKey="b1" name="±1 sd" stroke="none" fill="var(--text-muted)" fillOpacity={0.2} isAnimationActive={false} connectNulls />
              <Line dataKey="mean" name="52-week average" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="disc" name="Discount" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="Same weeks, dollars per share" title="Price and NAV"
          finding={finite(last?.price) && finite(last?.nav) ? `The gap between the lines is the discount: $${(last.nav - last.price).toFixed(2)} a share on ${dayLabel(last.d)}. A fund whose NAV falls while the gap stays wide is a value trap, not a bargain.` : ""}>
          <Legend items={[["NAV", C[3]], ["Price", C[1]]]} />
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={weekly} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v >= 100 ? Math.round(v) : v.toFixed(1)}`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={(v, n) => [usd(v), n]} />
              <Line dataKey="nav" name="NAV" stroke={C[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="price" name="Price" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>
      {dists.length > 0 && (
        <VizCard eyebrow="Per share, by ex-date" title="Distributions: income versus return of capital"
          finding={`${dists.length} distributions over five years${finite(rocShare) ? `; in the last twelve, ${Math.round(rocShare * 100)}% was classified as return of capital` : ""}. Return of capital paid out of gains is harmless; paid out of a shrinking NAV it is the fund handing your money back.`}
          table={<MiniTable columns={[{ key: "ex", label: "Ex-date" }, { key: "income", label: "Income", fmt: v => fx(v, 4) }, { key: "roc", label: "Return of capital", fmt: v => fx(v, 4) }, { key: "special", label: "Special", fmt: v => (v ? fx(v, 4) : "—") }]} rows={[...dists].reverse()} />}>
          <Legend items={[["Income and gains", C[1]], ["Return of capital", C[2]]]} />
          <div className="ochart-sm"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={dists} margin={{ top: 6, right: 20, left: 0, bottom: 0 }} barCategoryGap={1}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="ex" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v.toFixed(2)}`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={(v, n) => [`$${Number(v).toFixed(4)}`, n]} cursor={{ fill: "var(--bg-subtle)" }} />
              <Bar dataKey="income" name="Income and gains" stackId="d" fill={C[1]} isAnimationActive={false} />
              <Bar dataKey="roc" name="Return of capital" stackId="d" fill={C[2]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer></div>
        </VizCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the screener
// ---------------------------------------------------------------------------
const COLS = [
  { key: "t", label: "Fund", sort: f => f.t },
  { key: "cat", label: "Category", sort: f => f.cat || "" },
  { key: "price", label: "Price", sort: f => f.price },
  { key: "disc", label: "Discount", title: "Price ÷ NAV − 1; negative is a discount", sort: f => f.disc },
  { key: "disc52", label: "52w avg", sort: f => f.disc52 },
  { key: "z1y", label: "Z 1y", title: "Today's discount against the past year's, in standard deviations: −2 is unusually cheap for this fund", sort: f => f.z1y },
  { key: "pct5y", label: "5y pct", title: "Where today's discount sits in the fund's own five years (0 = widest)", sort: f => f.pct5y },
  { key: "spark", label: "Discount, 1y", sort: null },
  { key: "distPrice", label: "Dist. rate", title: "Annualized distribution ÷ price", sort: f => f.distPrice },
  { key: "roc12", label: "ROC 12m", title: "Share of the last year's distributions classified as return of capital", sort: f => f.roc12 },
  { key: "coverage", label: "Coverage", title: "Net investment income per share ÷ the distribution", sort: f => f.coverage },
  { key: "lev", label: "Leverage", sort: f => f.lev },
  { key: "expense", label: "Expense", sort: f => f.expense },
  { key: "advUsd", label: "Daily $ vol", title: "Average daily dollar volume", sort: f => f.advUsd },
  { key: "ret1yNav", label: "NAV 1y", sort: f => f.ret1yNav },
  { key: "events", label: "Events", sort: f => (f.events?.length ? 1 : 0) },
];

export default function ClosedEndFunds() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [fam, setFam] = useState("all"), [minAdv, setMinAdv] = useState(250e3), [hideRoc, setHideRoc] = useState(false), [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "z1y", dir: 1 });
  const [sel, setSel] = useState(null);
  const [bt, setBt] = useState({ signal: "z", n: 20, cost: 0.0025, minPx: 5, fam: "all", lag: 0 });
  const detailRef = useRef(null);
  useEffect(() => {
    let alive = true, timer;
    const load = () => fetch("/api/cef").then(r => r.json()).then(j => {
      if (!alive) return;
      if (j.error) setErr(j.error); else { setD(j); setErr(null); }
      if (j.backfill?.running || !j.funds?.length) timer = setTimeout(load, 20000);
    }).catch(e => { if (alive) { setErr(e.message); timer = setTimeout(load, 30000); } });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  const funds = d?.funds || [];
  const shown = useMemo(() => {
    const s = q.trim().toUpperCase();
    const rows = funds.filter(f => (fam === "all" || f.family === fam) && (!minAdv || !finite(f.advUsd) || f.advUsd >= minAdv) && (!hideRoc || !(f.roc12 > 0.5)) && (!s || f.t.includes(s) || (f.name || "").toUpperCase().includes(s)));
    const col = COLS.find(c => c.key === sort.key) || COLS[0];
    return [...rows].sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x == null) - (y == null) || (typeof x === "string" ? x.localeCompare(y) : (x - y)) * sort.dir; });
  }, [funds, fam, minAdv, hideRoc, q, sort]);
  useEffect(() => { if (!sel && shown.length) setSel(shown[0].t); }, [shown, sel]);
  const result = useMemo(() => runBacktest(d?.panel, bt), [d, bt]);
  const delayed = useMemo(() => (bt.lag ? null : runBacktest(d?.panel, { ...bt, lag: 1 })), [d, bt]);

  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">{err ? `The closed-end fund feed is unavailable: ${err}` : "Loading closed-end funds (CEFConnect)…"}</p></div></div>;

  const discs = funds.map(f => f.disc).filter(finite);
  // holiday weeks (Good Friday, July 4, Juneteenth) report only a fund or two; their "median" is noise
  const nTyp = median((d.universe || []).map(u => u.n));
  const medNow = median(discs), uni = (d.universe || []).filter(u => u.n >= 0.5 * (nTyp || 0));
  const uniPct = uni.length && finite(medNow) ? Math.round((uni.filter(u => u.median < medNow).length / uni.length) * 100) : null;
  const cheap = funds.filter(f => finite(f.z1y) && f.z1y <= -2), rich = funds.filter(f => finite(f.z1y) && f.z1y >= 2);
  const m = new Date().getMonth() + 1;
  const season = m === 11 || m === 12 ? "Tax-loss season: discounts have tended to widen into December" : m === 1 ? "January: the month discounts have tended to recover" : null;
  const seas = (d.seasonality || []).map(s => ({ ...s, name: MON[s.m - 1] }));
  const row = funds.find(f => f.t === sel);
  const open = t => { setSel(t); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };

  return (
    <div className="options-research">
      <p className="ohead-line">
        {funds.length} listed closed-end funds. The median trades at a {pct1(Math.abs(medNow ?? 0))} discount{finite(uniPct) ? `, wider than ${100 - uniPct}% of the past five years' weeks` : ""}; {Math.round((discs.filter(x => x < 0).length / Math.max(1, discs.length)) * 100)}% trade below NAV. {cheap.length} funds sit two standard deviations cheaper than their own past year and {rich.length} two richer.{season ? ` ${season}.` : ""}
      </p>
      {d.backfill?.running && <p className="onote" style={{ marginTop: -6 }}>Building five-year histories: {d.backfill.done} of {d.backfill.total} funds so far. The backtest and charts fill in as it runs.</p>}
      <div className="okpis">
        <Kpi label="Median discount" value={pct1(medNow)} sub={finite(uniPct) ? `${ord(uniPct)} percentile of 5 years` : ""} />
        <Kpi label="Funds at a discount" value={`${Math.round((discs.filter(x => x < 0).length / Math.max(1, discs.length)) * 100)}%`} sub={`${discs.filter(x => x <= -10).length} wider than 10%`} />
        <Kpi label="Cheap vs own year" value={String(cheap.length)} sub="z ≤ −2" />
        <Kpi label="Rich vs own year" value={String(rich.length)} sub="z ≥ +2" />
        <Kpi label="Muni median" value={pct1(median(funds.filter(f => f.family === "Municipal").map(f => f.disc)))} sub={`taxable bond ${pct1(median(funds.filter(f => f.family === "Taxable bond").map(f => f.disc)))} · equity ${pct1(median(funds.filter(f => f.family === "Equity").map(f => f.disc)))}`} />
        <Kpi label="Season" value={MON[m - 1]} sub={finite(seas[m - 1]?.mean) ? `avg change ${signed(seas[m - 1].mean, 2)} pts this month` : ""} />
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow="Weekly, every listed fund · CEFConnect" title="The market's discount cycle"
          finding={uni.length ? `The median fund's discount ranged from ${pct1(Math.min(...uni.map(u => u.median)))} to ${pct1(Math.max(...uni.map(u => u.median)))} over five years; it is ${pct1(medNow)} today. Wide-discount markets have been the better entry points for the whole group.` : "History is still being built."}
          table={<MiniTable columns={[{ key: "d", label: "Week" }, { key: "p25", label: "25th pct", fmt: v => pct1(v) }, { key: "median", label: "Median", fmt: v => pct1(v) }, { key: "p75", label: "75th pct", fmt: v => pct1(v) }, { key: "n", label: "Funds" }]} rows={[...uni].reverse()} />}>
          <Legend items={[["Median discount", C[1]], ["Middle half of funds", "var(--text-muted)"]]} />
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={uni.map(u => ({ ...u, band: finite(u.p25) && finite(u.p75) ? [u.p25, u.p75] : null }))} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLabel} minTickGap={40} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${Math.round(v)}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayLabel} formatter={(v, n) => (Array.isArray(v) ? [`${v[0].toFixed(1)}% to ${v[1].toFixed(1)}%`, n] : [pct1(v), n])} />
              <ReferenceLine y={0} stroke="var(--border-subtle)" />
              <Area dataKey="band" name="Middle half" stroke="none" fill="var(--text-muted)" fillOpacity={0.2} isAnimationActive={false} />
              <Line dataKey="median" name="Median" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer></div>
        </VizCard>
        <VizCard eyebrow="Average change in discount over each calendar month, all funds and years" title="The calendar"
          finding={seas.length ? (() => { const s = [...seas].filter(x => finite(x.mean)).sort((a, b) => a.mean - b.mean); return `Widest-going month: ${s[0]?.name} (${signed(s[0]?.mean, 2)} pts on average); best recovery: ${s.at(-1)?.name} (${signed(s.at(-1)?.mean, 2)} pts). Tax-loss selling predicts November–December widening and a January bounce; this shows how much of that the last five years carried.`; })() : "Seasonality appears once histories are built."}
          table={<MiniTable columns={[{ key: "name", label: "Month" }, { key: "mean", label: "Mean change, pts", fmt: v => signed(v, 2) }, { key: "median", label: "Median, pts", fmt: v => signed(v, 2) }, { key: "n", label: "Fund-months" }]} rows={seas} />}>
          <Legend items={[["Discounts narrowed", C[1]], ["Discounts widened", NEG]]} />
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={seas} margin={{ top: 8, right: 20, left: 0, bottom: 0 }} barCategoryGap={3}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v.toFixed(1)}`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={v => [`${signed(v, 2)} pts`, "Mean change"]} cursor={{ fill: "var(--bg-subtle)" }} />
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              <Bar dataKey="mean" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {seas.map(s => <Cell key={s.m} fill={s.mean >= 0 ? C[1] : NEG} stroke={s.m === m ? "var(--text-primary)" : "none"} strokeWidth={s.m === m ? 1.5 : 0} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <VizCard eyebrow={`${shown.length} of ${funds.length} funds · CEFConnect, ${d.snapshotDate ? dayLabel(d.snapshotDate.slice(0, 10)) : ""}`} title="Screener"
        right={<>
          <Seg label="Family" value={fam} onChange={setFam} options={FAMS} />
          <Seg label="Liquidity" value={minAdv} onChange={setMinAdv} options={[[0, "Any volume"], [250e3, "≥$250k/day"], [1e6, "≥$1M/day"]]} />
          <button type="button" className="ochip" aria-pressed={hideRoc} onClick={() => setHideRoc(v => !v)} title="Hide funds where more than half of the last year's payouts were return of capital">Hide ROC-heavy</button>
          <input className="oinput" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search funds" style={{ width: 110 }} />
        </>}
        finding={`Sorted by ${COLS.find(c => c.key === sort.key)?.label}. A wide discount alone is not the signal: the z-score asks whether it is wide for this fund. Click a fund for its history.`}
        note="Z and percentile cells shade blue where the fund is cheap against its own history and red where it is rich; numbers stay readable on the tint. Coverage is net investment income per share against the distribution: under 100% means part of the payout comes from gains or capital.">
        <div className="otable-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr>{COLS.map(c => <th key={c.key} title={c.title} style={{ textAlign: c.key === "t" || c.key === "cat" || c.key === "events" ? "left" : "right" }}>{c.sort ? <button type="button" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? -s.dir : c.key === "t" || c.key === "cat" || c.key === "z1y" || c.key === "pct5y" || c.key === "disc" ? 1 : -1 }))}>{c.label}{sort.key === c.key ? (sort.dir < 0 ? " ▾" : " ▴") : ""}</button> : c.label}</th>)}</tr></thead>
            <tbody>{shown.map(f => (
              <tr key={f.t} className="oclick" onClick={() => open(f.t)} style={f.t === sel ? { outline: "2px solid var(--oc-1)", outlineOffset: -2 } : undefined}>
                <td style={{ textAlign: "left" }}><strong>{f.t}</strong> <span className="onote" title={f.name}>{(f.name || "").slice(0, 26)}</span>{f.term && <span className="otag" style={{ marginLeft: 4 }}>term</span>}</td>
                <td style={{ textAlign: "left" }} title={f.cat}><span className="onote" style={{ margin: 0 }}>{(f.cat || "").replace(/^Morningstar US CEF /, "").slice(0, 22)}</span></td>
                <td style={{ textAlign: "right" }}>{usd(f.price)}</td>
                <td style={{ textAlign: "right" }}>{pct1(f.disc)}</td>
                <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{pct1(f.disc52)}</td>
                <td style={{ textAlign: "right", background: divBg(finite(f.z1y) ? f.z1y / 3 : null) }}>{fx(f.z1y, 2)}</td>
                <td style={{ textAlign: "right", background: divBg(finite(f.pct5y) ? (f.pct5y - 50) / 50 : null) }}>{finite(f.pct5y) ? Math.round(f.pct5y) : "—"}</td>
                <td style={{ textAlign: "left" }}><Spark values={f.spark} width={80} ref0={0} /></td>
                <td style={{ textAlign: "right" }}>{pct1(f.distPrice)}</td>
                <td style={{ textAlign: "right", color: f.roc12 > 0.5 ? "var(--oc-bad)" : undefined }}>{finite(f.roc12) ? `${Math.round(f.roc12 * 100)}%` : "—"}</td>
                <td style={{ textAlign: "right", color: finite(f.coverage) && f.coverage < 0.8 ? "var(--oc-bad)" : undefined }}>{finite(f.coverage) ? `${Math.round(f.coverage * 100)}%` : "—"}</td>
                <td style={{ textAlign: "right" }}>{pct1(f.lev)}</td>
                <td style={{ textAlign: "right" }}>{pct1(f.expense)}</td>
                <td style={{ textAlign: "right" }}>{usdK(f.advUsd)}</td>
                <td style={{ textAlign: "right" }}>{signed(f.ret1yNav, 1, "%")}</td>
                <td style={{ textAlign: "left" }}>{(f.events || []).map((e, i) => <a key={i} className="otag" href={e.url} target="_blank" rel="noreferrer" onClick={ev => ev.stopPropagation()} style={{ marginRight: 3, borderColor: "var(--oc-2)", textDecoration: "none" }}>{e.label || e.type}</a>)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </VizCard>

      <div ref={detailRef} style={{ marginTop: 12 }}>{sel && <FundDetail t={sel} row={row} />}</div>

      <VizCard eyebrow={`Monthly rebalance · ${result?.rows.length || 0} months · equal weight · next month's total return`} title="Backtest: buy the cheapest, hold a month"
        right={<>
          <Seg label="Signal" value={bt.signal} onChange={v => setBt(b => ({ ...b, signal: v }))} options={[["z", "Cheap vs own year (z)"], ["rel", "Cheap vs category"], ["disc", "Widest discount"]]} />
          <Seg label="Funds held" value={bt.n} onChange={v => setBt(b => ({ ...b, n: v }))} options={[[10, "10"], [20, "20"], [30, "30"]]} />
          <Seg label="Cost per trade" value={bt.cost} onChange={v => setBt(b => ({ ...b, cost: v }))} options={[[0, "0%"], [0.0025, "0.25%"], [0.005, "0.5%"], [0.01, "1%"]]} />
          <Seg label="Family" value={bt.fam} onChange={v => setBt(b => ({ ...b, fam: v }))} options={FAMS} />
          <Seg label="Entry" value={bt.lag} onChange={v => setBt(b => ({ ...b, lag: v }))} options={[[0, "At the signal"], [1, "A month later"]]} />
        </>}
        finding={result?.cheap ? `Holding the ${bt.n} ${bt.signal === "z" ? "funds cheapest against their own past year" : bt.signal === "rel" ? "funds cheapest against their category" : "widest-discount funds"} returned ${signed(result.cheap.ann, 1, "%")} a year after costs, against ${signed(result.uni.ann, 1, "%")} for the equal-weight universe and ${signed(result.rich.ann, 1, "%")} for the ${bt.n} richest; it beat the universe in ${Math.round(result.hit)}% of months, replacing about ${Math.round(result.turnover)}% of the portfolio each month.${delayed?.cheap ? ` Waiting a month before buying cuts that to ${signed(delayed.cheap.ann, 1, "%")} (universe ${signed(delayed.uni.ann, 1, "%")}): much of the first month is fast reversal, part of it bounce in the very closing prices the signal is read from, which a real order placed after the close cannot capture.` : bt.lag ? " This is the delayed entry: the signal is read at one month-end and the funds are held over the month after next." : ""}` : "The backtest needs the five-year histories; they are still being built."}
        note="Survivorship: only funds listed today have history, so funds that merged, liquidated or converted are missing (those exits often happened at NAV, which this leaves out). Month-end is the last weekly price; trades fill at that close plus the cost per trade on both sides of each change; distributions are added in the month they go ex and not reinvested; no taxes. Five years is one cycle, not a law.">
        {result?.rows.length > 0 && (<>
          <div className="ogrid ogrid-2" style={{ marginBottom: 0 }}>
            <div>
              <Legend items={[[`Cheapest ${bt.n}`, C[1]], ["Equal-weight universe", "var(--text-muted)", true], [`Richest ${bt.n}`, C[2]]]} />
              <div className="ochart"><ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.rows} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="m" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => `${MON[+v.slice(5, 7) - 1]} ${v.slice(2, 4)}`} minTickGap={40} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v.toFixed(2)}`} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [`$${v.toFixed(3)}`, n]} />
                  <ReferenceLine y={1} stroke="var(--border-subtle)" />
                  <Line dataKey="uni" name="Equal-weight universe" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line dataKey="rich" name={`Richest ${bt.n}`} stroke={C[2]} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  <Line dataKey="cheap" name={`Cheapest ${bt.n}`} stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer></div>
              <div className="onote" style={{ margin: 0 }}>Growth of $1, after the cost per trade</div>
            </div>
            <div>
              <Legend items={[["Beat the universe", C[1]], ["Lagged", NEG]]} />
              <div className="ochart"><ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.quint} margin={{ top: 8, right: 20, left: 0, bottom: 0 }} barCategoryGap={8}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="q" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={q => (q === "Q1" ? "Q1 cheapest" : q === "Q5" ? "Q5 richest" : q)} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v.toFixed(2)}%`} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={v => [`${signed(v, 3)}% a month`, "vs universe"]} cursor={{ fill: "var(--bg-subtle)" }} />
                  <ReferenceLine y={0} stroke="var(--text-muted)" />
                  <Bar dataKey="ex" isAnimationActive={false} radius={[3, 3, 0, 0]}>{result.quint.map(x => <Cell key={x.q} fill={x.ex >= 0 ? C[1] : NEG} />)}</Bar>
                </BarChart>
              </ResponsiveContainer></div>
              <div className="onote" style={{ margin: 0 }}>Next month&apos;s return by signal quintile, against the universe, before costs. A real signal steps down from Q1 to Q5.</div>
            </div>
          </div>
          <div className="ogrid ogrid-2" style={{ marginTop: 10, marginBottom: 0 }}>
            <MiniTable columns={[{ key: "k", label: "Portfolio" }, { key: "ann", label: "Return a year", fmt: v => signed(v, 1, "%") }, { key: "vol", label: "Volatility", fmt: v => pct1(v) }, { key: "dd", label: "Worst drawdown", fmt: v => pct1(v) }, { key: "months", label: "Months" }]}
              rows={[{ k: `Cheapest ${bt.n}`, ...result.cheap }, { k: "Equal-weight universe", ...result.uni }, { k: `Richest ${bt.n}`, ...result.rich }]} />
            <div>
              <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>What the rule holds now · month-end {result.asOf}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {result.now.cheap.map(x => <button key={x.t} type="button" className="ochip" onClick={() => open(x.t)} title={`discount ${pct1(x.disc)} · signal ${fx(x.s, 2)}`}>{x.t} <span style={{ color: "var(--text-muted)" }}>{pct1(x.disc)}</span></button>)}
              </div>
              <p className="onote">Educational: these are the funds the backtested rule would pick from the latest month-end data, not recommendations. Check liquidity, return of capital, leverage and any activist or tender activity before reading anything into a name.</p>
            </div>
          </div>
        </>)}
      </VizCard>
      {(d.notes || []).length > 0 && <ul className="ostrat-notes">{d.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      <p className="onote">Source: CEFConnect (Nuveen) daily pricing, five-year weekly price and NAV histories and distribution histories, kept on this machine and not published with the dashboard. Discounts are recomputed as price ÷ NAV − 1. Events come from Special Situations (activist 13Ds and tender offers on fund tickers).</p>
    </div>
  );
}
