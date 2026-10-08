import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { M_CUT, MONTIER } from "../../lib/accountingQuality.js";
import { GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, ORANGE, TEAL, PINK, fin, card, note, tip, axis, chip, DenseHeader, Panel, Note, DataTable, useIsPhone } from "../../components/dense.jsx";

// ============================================================================
// SIN & FOLLY: Munger's tell for a bubble, made countable. "Sin" is what
// companies do to their books; "folly" is what gets sold to investors. All
// from free SEC sources via /api/sin-monitor (server/sinMonitor.js, built by
// server/sinMonitorSeed.js):
//   the 500     the largest non-financial 10-K filers by revenue each year
//               since 2010, an S&P 500 proxy without survivorship bias:
//               accruals, the share in Beneish's manipulator zone, Montier
//               C-scores, the implied useful life of PP&E, stock pay,
//               receivable and inventory days, goodwill
//   the league  those 500 ranked on accruals, Beneish and Montier; each name
//               opens its stock page, where the Accounting tab has the detail
//   trouble     restatements, auditor changes, late 10-Ks, material
//               weaknesses, going-concern doubts and preferability letters per
//               quarter since 2001, for all filers and for the 500
//   folly       8-Ks mentioning blockchain, the metaverse, AI or a crypto
//               treasury, and SPAC registrations
// The formulas are src/lib/accountingQuality.js, shared with the stock page.
// ============================================================================

const pct = (v, dp = 1) => (fin(v) ? `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const num = (v, dp = 2) => (fin(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}` : "—");
const bil = v => (fin(v) ? `$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B` : "—");
const mTone = m => (!fin(m) ? DIM : m > M_CUT ? RED : m > -2.22 ? AMBER : "var(--text-secondary)");
const cTone = c => (!fin(c) ? DIM : c >= 4 ? RED : c === 3 ? AMBER : "var(--text-secondary)");
const accTone = a => (!fin(a) ? DIM : a > 0.1 ? RED : a > 0.05 ? AMBER : "var(--text-secondary)");
const thisQuarter = () => { const d = new Date(); return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`; };
const TONES = [INDIGO, AMBER, TEAL, PINK, CYAN, ORANGE, VIOLET];

// one small chart; zoom = scale the axis to the data rather than from zero
function Mini({ title, sub, data, x = "x", series, fmt = v => v, bar = false, refY, zoom = false, height = 150 }) {
  const phone = useIsPhone();
  const C = bar ? BarChart : LineChart;
  return (
    <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: "8px 8px 4px" }}>
      <div style={{ fontSize: 10.5, fontFamily: fonts.heading, fontWeight: 600, color: "var(--text-primary)", padding: "0 4px" }}>{title}</div>
      {sub && <div style={{ ...note, fontSize: 8.5, padding: "0 4px" }}>{sub}</div>}
      <ResponsiveContainer width="100%" height={phone ? Math.round(height * 0.85) : height}>
        <C data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey={x} tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={22} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={fmt} width={46} domain={zoom ? ["auto", "auto"] : [0, "auto"]} />
          {fin(refY) && <ReferenceLine y={refY} stroke="var(--border-subtle)" />}
          <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, nm) => [fmt(v), nm]} />
          {series.map((s, i) => bar
            ? <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color || TONES[i]} fillOpacity={0.75} />
            : <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color || TONES[i]} strokeWidth={s.thin ? 1.2 : 2} strokeDasharray={s.dash} dot={false} connectNulls />)}
        </C>
      </ResponsiveContainer>
      {series.length > 1 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 4px 2px" }}>{series.map((s, i) => <span key={s.key} style={{ ...note, fontSize: 8.5, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 2, background: s.color || TONES[i], display: "inline-block" }} />{s.name}</span>)}</div>}
    </div>
  );
}

export default function SinFolly({ onSelectStock }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [view, setView] = useState("aggressive"), [q, setQ] = useState("");
  useEffect(() => {
    fetch("/api/sin-monitor").then(r => r.json()).then(j => (j.error ? setErr(j.error) : setD(j))).catch(e => setErr(e.message));
  }, []);

  const years = useMemo(() => (d ? Object.keys(d.agg).map(Number).filter(y => !d.agg[y].partial).sort((a, b) => a - b) : []), [d]);
  const A = useMemo(() => years.map(y => {
    const a = d.agg[y];
    return {
      x: String(y), accMed: a.accruals.med, accW: a.accruals.wtd, mShare: a.m.share, cShare: a.c.share,
      life: a.life.agg, lifeMed: a.life.med, sbc: a.sbc.agg, sbcMed: a.sbc.med, dso: a.dso.agg, dio: a.dio.agg, gw: a.gw.agg,
    };
  }), [years, d]);
  // full-text counts: complete quarters only; 10-K-based series as trailing four-quarter sums
  const cur = thisQuarter();
  const ev = useMemo(() => {
    if (!d) return null;
    const Q = d.events.quarters, keep = Q.map((l, i) => (l < cur ? i : -1)).filter(i => i >= 0);
    const roll = arr => arr.map((_, i) => (i >= 3 && [0, 1, 2, 3].every(k => fin(arr[i - k])) ? arr[i] + arr[i - 1] + arr[i - 2] + arr[i - 3] : null));
    const ANNUAL = new Set(["late10k", "weakness", "goingConcern", "preferability"]);
    const all = Object.fromEntries(d.events.defs.map(df => [df.key, ANNUAL.has(df.key) ? roll(d.events.all[df.key]) : d.events.all[df.key]]));
    return { keep, Q, all, annual: ANNUAL };
  }, [d, cur]);
  const fo = useMemo(() => {
    if (!d) return null;
    const Q = d.folly.quarters, keep = Q.map((l, i) => (l < cur ? i : -1)).filter(i => i >= 0);
    return keep.map(i => ({ x: Q[i], ...Object.fromEntries(d.folly.defs.map(df => [df.key, d.folly.series[df.key][i]])) }));
  }, [d, cur]);
  // the 500's trouble filings summed by calendar year
  const bigYears = useMemo(() => {
    if (!d) return [];
    const by = {};
    d.events.quarters.forEach((l, i) => {
      if (l >= cur) return;
      const y = l.slice(0, 4);
      for (const k of d.events.bigKeys) { const v = d.events.big[k]?.[i]; if (fin(v)) { by[y] ??= { y, key: y }; by[y][k] = (by[y][k] ?? 0) + v; } }
    });
    return Object.values(by).sort((a, b) => b.y.localeCompare(a.y));
  }, [d, cur]);

  if (err) return <div style={{ ...card, fontSize: 11, color: AMBER, fontFamily: fonts.mono }}>Sin &amp; Folly is unavailable: {err}</div>;
  if (!d) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Loading the SEC monitor…</div>;

  const L = A[A.length - 1] || {}, F = A[0] || {};
  const range = k => { const v = A.map(r => r[k]).filter(fin); return v.length ? [Math.min(...v), Math.max(...v)] : [null, null]; };
  const last4 = key => { const s = d.events.all[key], idx = ev.keep.slice(-4); return idx.every(i => fin(s[i])) ? idx.reduce((t, i) => t + s[i], 0) : null; };
  const prior4 = key => { const s = d.events.all[key], idx = ev.keep.slice(-8, -4); return idx.every(i => fin(s[i])) ? idx.reduce((t, i) => t + s[i], 0) : null; };
  const aiLast = fo.slice(-4).reduce((t, r) => t + (r.ai ?? 0), 0), aiPrior = fo.slice(-8, -4).reduce((t, r) => t + (r.ai ?? 0), 0);
  const [mLo, mHi] = range("mShare"), [aLo, aHi] = range("accMed");
  const latestYear = years[years.length - 1];

  const league = d.league;
  const needle = q.trim().toLowerCase();
  const shown = (needle ? league.filter(r => r.name.toLowerCase().includes(needle) || (r.ticker || "").toLowerCase() === needle) : view === "aggressive" ? league.slice(0, 25) : view === "conservative" ? league.filter(r => fin(r.comp)).slice(-25).reverse() : league).map(r => ({ ...r, key: r.cik }));
  const open = r => r.ticker && onSelectStock?.(r.ticker);
  const TESTS = Object.fromEntries(MONTIER.map(([k, name]) => [k, name]));

  const evRows = (key, def) => ev.keep.map(i => ({ x: ev.Q[i], v: ev.all[key][i] })).filter(r => r.x >= def.from);

  return (<>
    <DenseHeader
      eyebrow={`Sin & Folly · the ${d.universeSize} largest non-financial SEC filers · FY${latestYear}${d.refreshing ? " · refreshing recent years" : ""}`}
      headline={[
        `Median accruals ${pct(L.accMed)} of assets (${pct(aLo)} to ${pct(aHi)} since ${F.x})`,
        `${pct(L.mShare, 0)} of the ${d.universeSize} in Beneish's manipulator zone and ${pct(L.cShare, 0)} at a Montier C-score of 4+`,
        fin(last4("restatement")) ? `${last4("restatement")} restatement 8-Ks across all filers in the last four quarters` : null,
      ].filter(Boolean).join("; ")}
      blurb={<>Munger&apos;s tell for a bubble was sin and folly. Sin here is the forensic-accounting checklist (earnings outrunning cash, receivables and inventory outrunning sales, slower depreciation, stock pay) run on every large company&apos;s SEC filings, plus the filings companies make when the books go wrong. Folly is what gets sold: blockchain, the metaverse, AI, crypto treasuries, SPACs. These describe posture; they do not time the market.</>}
      meta={<>SEC XBRL frames, EDGAR full-text search<br />built {d.built.slice(0, 10)}</>}
      chips={[
        chip("Median accruals", pct(L.accMed), accTone(L.accMed), `size-weighted ${pct(L.accW)} · FY${latestYear}`),
        chip("In M-score zone", pct(L.mShare, 0), "var(--text-primary)", `share above −1.78 · ${pct(mLo, 0)}–${pct(mHi, 0)} since ${F.x}`),
        chip("C-score 4+", pct(L.cShare, 0), "var(--text-primary)", "Montier's danger zone"),
        chip("Useful life of PP&E", fin(L.life) ? `${L.life.toFixed(1)} yrs` : "—", "var(--text-primary)", fin(F.life) ? `${F.x}: ${F.life.toFixed(1)} yrs · aggregate` : "gross PP&E ÷ depreciation"),
        chip("Stock pay ÷ revenue", pct(L.sbc, 2), "var(--text-primary)", `median ${pct(L.sbcMed, 2)}`),
        chip("Restatements, 4 qtrs", fin(last4("restatement")) ? String(last4("restatement")) : "—", "var(--text-primary)", fin(prior4("restatement")) ? `prior 4 qtrs ${prior4("restatement")} · all filers` : "all filers"),
        chip("AI in 8-Ks, 4 qtrs", aiLast.toLocaleString(), "var(--text-primary)", `prior 4 qtrs ${aiPrior.toLocaleString()}`),
      ]}
    />

    <Panel title="How aggressive is large-company accounting?" right={`each fiscal year · the ${d.universeSize} largest non-financial 10-K filers by revenue`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(250px, 100%), 1fr))", gap: 8 }}>
        <Mini title="Accruals ÷ assets" sub="(net income − operating cash flow) ÷ average assets" data={A} zoom fmt={v => pct(v, 0)} refY={0} series={[{ key: "accMed", name: "median" }, { key: "accW", name: "size-weighted", thin: true }]} />
        <Mini title="In Beneish's manipulator zone" sub="share with an M-score above −1.78" data={A} fmt={v => pct(v, 0)} series={[{ key: "mShare", name: "share", color: RED }]} />
        <Mini title="Montier C-score of 4 or more" sub="share of companies with five or six testable signals" data={A} fmt={v => pct(v, 0)} series={[{ key: "cShare", name: "share", color: AMBER }]} />
        <Mini title="Useful life of PP&E" sub="gross PP&E ÷ depreciation, years" data={A} zoom fmt={v => (fin(v) ? v.toFixed(1) : "—")} series={[{ key: "life", name: "aggregate" }, { key: "lifeMed", name: "median", thin: true }]} />
        <Mini title="Stock pay ÷ revenue" sub="stock-based compensation" data={A} fmt={v => pct(v, 1)} series={[{ key: "sbc", name: "aggregate", color: VIOLET }, { key: "sbcMed", name: "median", thin: true, color: SLATE }]} />
        <Mini title="Receivable and inventory days" sub="aggregate days of sales and of cost of sales" data={A} zoom fmt={v => (fin(v) ? `${Math.round(v)}d` : "—")} series={[{ key: "dso", name: "receivables", color: INDIGO }, { key: "dio", name: "inventory", color: TEAL }]} />
        <Mini title="Goodwill ÷ assets" sub="acquisitions not yet written down" data={A} zoom fmt={v => pct(v, 1)} series={[{ key: "gw", name: "aggregate", color: ORANGE }]} />
      </div>
      <Note>
        Aggregate lines are sums across companies (size-weighted); medians are the middle company. Partial fiscal years are left out
        {d.partialYear ? ` (FY${d.partialYear} so far: ${d.agg[d.partialYear]?.n ?? 0} of the 500)` : ""}. One caution on accruals: for single companies, high
        accruals precede weak returns (Sloan, 1996), but Hirshleifer, Hou and Teoh (2009) found aggregate accruals preceded higher market returns. Read these as the
        posture of corporate accounting, not a market-timing signal.
      </Note>
    </Panel>

    <Panel title="The league table" right={`latest fiscal year per company · ranked on accruals, Beneish and Montier`}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        {[["aggressive", "Most aggressive 25"], ["conservative", "Most conservative 25"], ["all", `All ${league.length}`]].map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); setQ(""); }} style={{ padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono, border: `1px solid ${view === id && !needle ? "#818cf8" : "var(--border-subtle)"}`, background: view === id && !needle ? "rgba(129,140,248,0.12)" : "transparent", color: view === id && !needle ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="find a company or ticker" aria-label="Find a company" style={{ marginLeft: "auto", background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "4px 8px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", width: 190 }} />
      </div>
      <DataTable dense rows={shown} cols={[
        { key: "rank", label: "#", width: 30, render: r => r.rank ?? "—" },
        { key: "name", label: "company", primary: true, render: r => (
          <span onClick={() => open(r)} title={r.ticker ? `Open ${r.ticker}` : "no current ticker"} style={{ cursor: r.ticker ? "pointer" : "default" }}>
            {r.ticker && <span style={{ color: INDIGO, marginRight: 6 }}>{r.ticker}</span>}{r.name.length > 34 ? `${r.name.slice(0, 33)}…` : r.name}
          </span>) },
        { key: "end", label: "FY end", hide: true, render: r => r.end?.slice(0, 7) },
        { key: "rev", label: "revenue", hide: true, render: r => bil(r.rev) },
        { key: "growth", label: "growth", render: r => <span style={{ color: fin(r.growth) && r.growth > 0.3 ? AMBER : undefined }}>{pct(r.growth, 0)}</span> },
        { key: "accruals", label: "accruals", render: r => <span style={{ color: accTone(r.accruals) }}>{pct(r.accruals)}</span> },
        { key: "m", label: "M-score", render: r => <span style={{ color: mTone(r.m) }}>{num(r.m)}</span> },
        { key: "c", label: "C-score", render: r => <span title={r.cTests.map(t => TESTS[t]).join(" · ")} style={{ color: cTone(r.c) }}>{fin(r.c) ? `${r.c}/${r.cTestable}` : "—"}</span> },
        { key: "life", label: "PP&E life", hide: true, render: r => (fin(r.life) ? `${r.life.toFixed(1)}y${fin(r.lifeChg3) ? ` (${r.lifeChg3 >= 0 ? "+" : "−"}${Math.abs(r.lifeChg3 * 100).toFixed(0)}%)` : ""}` : "—") },
        { key: "comp", label: "aggressive", render: r => (fin(r.comp) ? `${Math.round(r.comp * 100)}` : "—") },
      ]} note={<>
        "Aggressive" is the average percentile of accruals, M-score and C-score among these companies (100 = most aggressive). Fast growers rank high by construction: Beneish weights sales growth and Montier counts asset growth, so a high rank means "read the filings", not "cooking the books".
        PP&E life is gross PP&E ÷ depreciation with its three-year change (construction in progress inflates it during a build-out). SEC figures, latest filed, so the company page (FMP statements) can differ slightly.
      </>} />
    </Panel>

    <Panel title="Filings that signal trouble" right="EDGAR full-text search · documents per quarter, all SEC filers">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(250px, 100%), 1fr))", gap: 8 }}>
        {d.events.defs.map((df, i) => (
          <Mini key={df.key} bar={!ev.annual.has(df.key)} title={df.label} sub={ev.annual.has(df.key) ? "trailing four quarters" : "per quarter"} data={evRows(df.key, df)} fmt={v => (fin(v) ? Math.round(v).toLocaleString() : "—")} series={[{ key: "v", name: "documents", color: [RED, AMBER, ORANGE, PINK, VIOLET, TEAL][i] }]} />
        ))}
      </div>
      {bigYears.length > 0 && (<>
        <div style={{ ...note, color: "var(--text-secondary)", margin: "10px 0 4px" }}>The {d.universeSize} largest non-financial filers, by calendar year</div>
        <DataTable dense rows={bigYears} cols={[
          { key: "y", label: "year", primary: true },
          ...d.events.bigKeys.map(k => ({ key: k, label: d.events.defs.find(x => x.key === k).label.split(" (")[0].replace(", controls not effective", "").toLowerCase(), render: r => (fin(r[k]) ? r[k] : "—") })),
        ]} />
      </>)}
      <Note>
        Counts are documents, not filings (an exhibit repeating the phrase counts again), consistent over time. Non-reliance 8-Ks (Item 4.02) began in August 2004.
        The series move with rules as much as with sin: Sarbanes-Oxley drove the 2004–06 restatement wave, and the SEC&apos;s 2021 views on SPAC accounting (warrants in April, redeemable shares late in the year) drove 2021&apos;s two spikes.
        Material weaknesses count 10-Ks that pair "material weakness" with "was not effective"; going-concern counts 10-Ks with "substantial doubt" language, most of them small companies.
        Queries: {d.events.defs.map(df => `${df.key} = ${df.query} in ${df.forms}`).join("; ")}.
      </Note>
    </Panel>

    <Panel title="Folly: what gets sold" right="8-K documents per quarter mentioning each theme, all SEC filers">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(250px, 100%), 1fr))", gap: 8 }}>
        {d.folly.defs.map((df, i) => (
          <Mini key={df.key} bar title={df.label} sub={df.forms === "S-1" ? "S-1 documents" : "8-K documents"} data={fo} fmt={v => (fin(v) ? Math.round(v).toLocaleString() : "—")} series={[{ key: df.key, name: "documents", color: [VIOLET, PINK, CYAN, ORANGE, AMBER][i] }]} />
        ))}
      </div>
      <Note>
        Each 8-K and its press-release exhibits count separately. Themes surge when a word moves stock prices: blockchain in late 2017 (Long Island Iced Tea renamed itself
        Long Blockchain), again in late 2021 and most of all in 2025; the metaverse through 2022–23; SPAC registrations in 2020–21; crypto treasuries in mid-2025; artificial
        intelligence is still climbing. The current quarter is left out until it ends.
      </Note>
    </Panel>
  </>);
}
