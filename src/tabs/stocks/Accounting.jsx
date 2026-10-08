import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { fetchFMP } from "../../lib/api.js";
import { isBankOrInsurer } from "../../lib/stockResearch.js";
import { assess, fromFmp, streetVsGaap, BENEISH, MONTIER, M_CUT, M_STRICT, C_ZONE } from "../../lib/accountingQuality.js";
import { GREEN, AMBER, RED, INDIGO, SLATE, DIM, fin, card, note, tip, axis, chip, DenseHeader, Panel, Note, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// ACCOUNTING: the stock page's sin check, in two halves.
//   the numbers   Beneish M-score, Montier C-score and Sloan accruals from the
//                 FMP statements the page already holds (formulas in
//                 src/lib/accountingQuality.js); the footnote lines SEC XBRL
//                 adds (useful life of PP&E, the bad-debt allowance, contract
//                 assets, capitalised software, the pension assumption, cash
//                 against book taxes, restructuring); FMP's street EPS against
//                 GAAP EPS (one extra call)
//   the filings   what a company has to file when something goes wrong:
//                 restatements, auditor changes, late filings, material
//                 weaknesses, going-concern language, preferability letters,
//                 CFO changes, SEC comment letters, Friday-night 8-Ks
//                 (server/accountingFlags.js)
// The rank among the 500 largest non-financial filers comes from Stocks →
// Sin & Folly (/api/sin-monitor). A screen, not a verdict: it says which
// filings to read. The receivable, inventory and cash-conversion charts live
// on Debt & cash; this tab scores them rather than drawing them again.
// ============================================================================

const n = v => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const div = (a, b) => (fin(a) && fin(b) && b !== 0 ? a / b : null);
// a share of operating cash flow only means something when that cash flow is positive
const ofCfo = (a, cfo) => (fin(cfo) && cfo > 0 ? div(a, cfo) : null);
// small shares need more decimals (a 0.4% reserve is not "0%")
const pctS = v => (fin(v) && Math.abs(v) < 0.01 && v !== 0 ? pct(v, 2) : pct(v, 1));
const money = v => { if (!fin(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(0)}M` : `${s}$${a.toFixed(0)}`; };
const pct = (v, dp = 0) => (fin(v) ? `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const num = (v, dp = 2) => (fin(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}` : "—");
const yrs = v => (fin(v) ? `${v.toFixed(1)} yrs` : "—");
const day = s => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / 864e5;
const mTone = m => (!fin(m) ? DIM : m > M_CUT ? RED : m > M_STRICT ? AMBER : GREEN);
const cTone = c => (!fin(c) ? DIM : c >= C_ZONE ? RED : c === 3 ? AMBER : GREEN);
const accTone = a => (!fin(a) ? DIM : a > 0.1 ? RED : a > 0.05 ? AMBER : GREEN);

// filings types: [label, severity]
const TYPES = {
  restatement: ["Restatement (8-K Item 4.02)", RED], late: ["Late filing", RED], weakness: ["Material weakness", RED],
  goingConcern: ["Going-concern language", RED], delisting: ["Delisting notice (3.01)", RED], bankruptcy: ["Bankruptcy (1.03)", RED],
  trigger: ["Debt trigger (2.04)", RED], auditor: ["Auditor change (4.01)", AMBER], preferability: ["Preferability letter", AMBER],
  impairment: ["Material impairment (2.06)", AMBER], cfo: ["CFO change (5.02)", AMBER],
};
// 8-K items that are bad news on their face; 5.02 also covers routine pay and board
// matters, so a Friday-night 5.02 counts only when it names a CFO change
const BAD_ITEMS = ["4.01", "4.02", "2.06", "3.01", "2.04", "1.03"];
const isBad = f => f.cfo || BAD_ITEMS.some(i => f.items.split(",").includes(i));

// where v sits in a distribution given as its 10/25/50/75/90th percentiles
function fromDeciles(qs, v) {
  if (!qs || !fin(v)) return null;
  const at = [0.1, 0.25, 0.5, 0.75, 0.9];
  if (v <= qs[0]) return 0.05;
  if (v >= qs[4]) return 0.95;
  for (let i = 0; i < 4; i++) if (v <= qs[i + 1]) return at[i] + ((v - qs[i]) / ((qs[i + 1] - qs[i]) || 1)) * (at[i + 1] - at[i]);
  return null;
}

function MiniTable({ head, rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: i ? "right" : "left", padding: "4px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.key} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            {r.cells.map((c, i) => <td key={i} title={c?.title} style={{ padding: "3px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: i ? "right" : "left", whiteSpace: "nowrap", color: c?.color || (i ? "var(--text-primary)" : "var(--text-secondary)"), fontWeight: r.strong ? 700 : 400 }}>{c?.v ?? c}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function Accounting({ data, fmpKey }) {
  const phone = useIsPhone();
  const cik = n(data.prof?.cik);
  const [flags, setFlags] = useState(null), [flagErr, setFlagErr] = useState(null);
  const [earn, setEarn] = useState(null), [monitor, setMonitor] = useState(null);

  useEffect(() => {
    let live = true;
    setFlags(null); setFlagErr(null);
    fetch(`/api/accounting-flags?symbol=${encodeURIComponent(data.symbol)}${cik ? `&cik=${cik}` : ""}`)
      .then(r => r.json()).then(j => { if (!live) return; if (j.error) setFlagErr(j.error); else setFlags(j); })
      .catch(e => live && setFlagErr(e.message));
    fetchFMP(`/earnings?symbol=${encodeURIComponent(data.symbol)}&limit=40`, fmpKey).then(r => live && setEarn(Array.isArray(r) ? r : [])).catch(() => live && setEarn([]));
    fetch("/api/sin-monitor").then(r => r.json()).then(j => live && !j.error && setMonitor(j)).catch(() => {});
    return () => { live = false; };
  }, [data.symbol, cik, fmpKey]);

  const rows = useMemo(() => assess(fromFmp(data)), [data]);
  const sic = flags?.sic ?? null;
  const financial = sic ? sic >= 6000 && sic <= 6999 : isBankOrInsurer(data);
  const scored = rows.filter(r => r.beneish?.m != null || r.montier);
  const last = rows[rows.length - 1], lastScored = scored[scored.length - 1];
  const cols = rows.filter(r => r.beneish || r.montier).slice(-5);
  const facts = flags?.facts || [];
  const factAt = end => (end ? facts.find(f => Math.abs(day(f.end) - day(end)) <= 10) : null);
  const eps = useMemo(() => streetVsGaap(earn, data.qinc), [earn, data.qinc]);
  const eps4 = eps.slice(-4), sumS = eps4.reduce((s, r) => s + r.street, 0), sumG = eps4.reduce((s, r) => s + r.gaap, 0);
  const epsGap = eps4.length === 4 && sumG > 0 ? sumS / sumG - 1 : null, above = eps.filter(r => r.street > r.gaap + 0.005).length;
  const league = monitor?.league?.find(r => (cik && r.cik === cik) || r.ticker === data.symbol) || null;

  // every filing that signals trouble, newest first
  const events = useMemo(() => {
    if (!flags) return [];
    const ft = Object.values(flags.fullText || {}).flat().filter(Boolean);
    return [...flags.events, ...ft].filter(e => TYPES[e.type]).sort((a, b) => b.date.localeCompare(a.date));
  }, [flags]);
  const counts = events.reduce((m, e) => ({ ...m, [e.type]: (m[e.type] || 0) + 1 }), {});
  const redCount = events.filter(e => TYPES[e.type][1] === RED).length;
  const fridayBad = (flags?.fridays?.late || []).filter(isBad);

  // the footnote table: the last six fiscal years, FMP and SEC lines side by side
  const fcols = rows.slice(-6).map(r => ({ r, x: factAt(r.end) }));
  const lifeOf = x => (x && x.ppeGross > 0 && x.dep > 0 ? x.ppeGross / x.dep : null);
  const lifeRows = facts.map(x => ({ end: x.end, life: lifeOf(x) })).filter(x => fin(x.life));
  const life = lifeRows[lifeRows.length - 1], life3 = lifeRows.length >= 4 ? lifeRows[lifeRows.length - 4] : null;
  const lifeChg = life && life3 ? life.life / life3.life - 1 : null;

  // what stands out, worst first
  const stands = [];
  const add = (tone, text) => stands.push({ tone, text });
  if (!financial && lastScored) {
    const b = lastScored.beneish, m = b?.m;
    if (fin(m) && m > M_STRICT) {
      const drivers = BENEISH.filter(([k, , clean, , w]) => w > 0 && fin(b.idx[k])).map(([k, name, clean, , w]) => [name, w * ((k === "tata" ? b.idx[k] : b.idx[k]) - clean)]).sort((a, z) => z[1] - a[1]).slice(0, 2).map(d => d[0].toLowerCase());
      add(m > M_CUT ? RED : AMBER, `Beneish M-score ${num(m)} for FY${lastScored.y} is ${m > M_CUT ? "above −1.78, the profile of his manipulators" : "between −2.22 and −1.78, the grey zone"}; most of it comes from ${drivers.join(" and ")}.`);
    }
    const c = lastScored.montier;
    if (c && c.score >= 3) add(c.score >= C_ZONE ? RED : AMBER, `Montier C-score ${c.score} of ${c.testable} for FY${lastScored.y}: ${MONTIER.filter(([k]) => c.tests[k]).map(t => t[2]).join("; ")}.`);
    if (fin(lastScored.accruals) && lastScored.accruals > 0.05) add(lastScored.accruals > 0.1 ? RED : AMBER, `Net income ran ahead of operating cash flow by ${pct(lastScored.accruals, 1)} of assets in FY${lastScored.y}.`);
    const five = rows.slice(-5).filter(r => fin(r.ni) && fin(r.cfo));
    const gap5 = five.reduce((s, r) => s + r.ni - r.cfo, 0);
    if (five.length === 5 && gap5 > 0) add(AMBER, `Over the last five fiscal years reported earnings exceeded operating cash flow by ${money(gap5)} in total.`);
  }
  if (fin(lifeChg) && lifeChg > 0.15) add(AMBER, `The implied useful life of PP&E (gross PP&E ÷ depreciation) went from ${yrs(life3.life)} to ${yrs(life.life)} in three years; longer lives mean a smaller depreciation charge.`);
  {
    const al = facts.filter(x => fin(x.allowance) && fin(x.arNet)).map(x => ({ end: x.end, r: x.allowance / (x.arNet + x.allowance), ar: x.arNet }));
    const a1 = al[al.length - 1], a0 = al.length >= 4 ? al[al.length - 4] : null;
    if (a1 && a0 && a0.r >= 0.005 && a0.r - a1.r >= 0.0025 && a1.r / a0.r - 1 < -0.3 && a1.ar > a0.ar) add(AMBER, `The bad-debt allowance fell from ${pctS(a0.r)} to ${pctS(a1.r)} of receivables over three years while receivables grew (O'glove's reserve release).`);
    const tx = facts.slice(-3).filter(x => fin(x.taxPaid) && x.taxExp > 0);
    const paid = tx.reduce((s, x) => s + x.taxPaid, 0), booked = tx.reduce((s, x) => s + x.taxExp, 0);
    if (tx.length === 3 && booked > 0 && paid / booked < 0.5) add(AMBER, `Cash taxes paid were ${pct(paid / booked)} of the tax expense booked over three years: earnings reported to shareholders run well ahead of those reported to the IRS.`);
    const rs = facts.slice(-6).filter(x => x.restructuring > 0).length;
    if (rs >= 4) add(AMBER, `Restructuring charges appear in ${rs} of the last six fiscal years: "one-time" costs that recur.`);
    const pr = facts.filter(x => fin(x.pensionRoa)).pop();
    if (pr && pr.pensionRoa >= 0.075) add(AMBER, `The pension plan assumes a ${pct(pr.pensionRoa, 1)} return on its assets; a higher assumption lowers the pension cost booked.`);
    const sw = facts.slice(-1).filter(x => x.capSoftware > 0 && x.cfo > 0)[0];
    if (sw && sw.capSoftware / sw.cfo > 0.1) add(AMBER, `Capitalised software was ${pct(sw.capSoftware / sw.cfo)} of operating cash flow in the latest year: spending that skips the income statement.`);
  }
  if (eps.length >= 8 && above >= eps.length - 1) add(fin(epsGap) && epsGap > 0.2 ? RED : AMBER, `Street EPS beat GAAP EPS in ${above} of the last ${eps.length} quarters${fin(epsGap) ? `, by ${pct(epsGap)} over the last four` : ""}: the "one-time" adjustments recur.`);
  else if (fin(epsGap) && epsGap > 0.2) add(AMBER, `Street EPS ran ${pct(epsGap)} above GAAP EPS over the last four quarters.`);
  for (const [t, [label, tone]] of Object.entries(TYPES)) if (counts[t] && tone === RED) add(RED, `${label}: ${counts[t]} filing${counts[t] > 1 ? "s" : ""} since ${flags.since.slice(0, 4)}, latest ${events.find(e => e.type === t).date}.`);
  if (counts.auditor) add(AMBER, `Auditor changed ${counts.auditor === 1 ? "once" : `${counts.auditor} times`} since ${flags.since.slice(0, 4)} (latest ${events.find(e => e.type === "auditor").date}).`);
  if (counts.preferability) add(AMBER, `${counts.preferability} filing${counts.preferability > 1 ? "s" : ""} carry a preferability letter: the company chose to change an accounting method.`);
  if (counts.cfo >= 3) add(AMBER, `${counts.cfo} 8-Ks since ${flags.since.slice(0, 4)} name a CFO appointment or departure.`);
  if (fridayBad.length) add(AMBER, `${fridayBad.length} bad-news 8-K${fridayBad.length > 1 ? "s were" : " was"} accepted after 4 pm ET on a Friday or a holiday eve (${[...new Set(fridayBad.flatMap(f => [...f.items.split(",").filter(i => BAD_ITEMS.includes(i)).map(i => `item ${i}`), ...(f.cfo ? ["a CFO change"] : [])]))].join(", ")}).`);
  if (flags?.comments?.letters) add(SLATE, `SEC staff sent ${flags.comments.letters} comment letter${flags.comments.letters > 1 ? "s" : ""} since ${flags.since.slice(0, 4)}; the company's replies (CORRESP) show what the staff questioned.`);
  if (flags?.formerNames?.length) { const recent = flags.formerNames.filter(f => f.to && f.to >= flags.since); if (recent.length) add(SLATE, `Renamed since ${flags.since.slice(0, 4)}: formerly ${recent.map(f => f.name).join("; ")}.`); }
  if (league?.comp >= 0.9) add(AMBER, `Ranks #${league.rank} of ${monitor.league.length} on aggressiveness among the 500 largest non-financial filers (SEC figures, FY ending ${league.end}).`);
  const order = [RED, AMBER, SLATE];
  stands.sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone));

  if (!rows.length) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>No statement history is available for {data.symbol}.</div>;
  const mLast = lastScored?.beneish?.m, cLast = lastScored?.montier;
  const chart = rows.filter(r => r.y >= (rows[rows.length - 1].y - 14)).map(r => ({ y: String(r.y), m: fin(r.beneish?.m) ? +r.beneish.m.toFixed(2) : null, acc: fin(r.accruals) ? +(r.accruals * 100).toFixed(2) : null }));

  return (<>
    <DenseHeader
      eyebrow={`Accounting · ${data.symbol}${flags?.sicDesc ? ` · ${flags.sicDesc.toLowerCase()}` : ""}${last ? ` · FY${last.y}` : ""}`}
      headline={financial
        ? <>A financial company: the earnings-manipulation scores were built on industrial companies and do not apply. The filings below still do.</>
        : <>
          {fin(mLast) ? <>M-score {num(mLast)} ({mLast > M_CUT ? "manipulator profile" : mLast > M_STRICT ? "grey zone" : "clean-firm range"})</> : "M-score unavailable"}
          {cLast ? <>, C-score {cLast.score} of {cLast.testable}</> : ""}
          {fin(lastScored?.accruals) ? <>, accruals {pct(lastScored.accruals, 1)} of assets</> : ""}
          {flags ? <>; {redCount ? `${redCount} red-flag filing${redCount > 1 ? "s" : ""}` : "no red-flag filings"} since {flags.since.slice(0, 4)}</> : ""}
        </>}
      blurb={<>Mechanical tests from the books on forensic accounting: earnings that outrun cash, receivables and inventory that outrun sales, slower depreciation, adjustments that recur, and the filings a company has to make when something goes wrong. It flags what to read; it proves nothing.</>}
      meta={<>FMP statements and earnings<br />SEC submissions, full-text search, XBRL</>}
      chips={[
        chip("Beneish M-score", financial ? "n/a" : num(mLast), financial ? SLATE : mTone(mLast), "above −1.78 = manipulator profile"),
        chip("Montier C-score", financial || !cLast ? "n/a" : `${cLast.score} / ${cLast.testable}`, financial ? SLATE : cTone(cLast?.score), "4+ = his danger zone"),
        chip("Accruals", financial ? "n/a" : pct(lastScored?.accruals, 1), financial ? SLATE : accTone(lastScored?.accruals), "(NI − CFO) ÷ avg assets"),
        chip("Street vs GAAP EPS", fin(epsGap) ? `${epsGap >= 0 ? "+" : ""}${pct(epsGap)}` : earn ? "—" : "…", fin(epsGap) ? (epsGap > 0.2 ? RED : epsGap > 0.08 ? AMBER : GREEN) : DIM, eps.length ? `last 4 qtrs · above GAAP in ${above} of ${eps.length}` : "FMP earnings"),
        chip("Useful life of PP&E", life ? yrs(life.life) : flags ? "—" : "…", fin(lifeChg) && lifeChg > 0.15 ? AMBER : "var(--text-primary)", fin(lifeChg) ? `${lifeChg >= 0 ? "+" : ""}${pct(lifeChg)} in 3 yrs` : "gross PP&E ÷ depreciation"),
        chip("Red-flag filings", flags ? String(redCount) : flagErr ? "—" : "…", flags ? (redCount ? RED : GREEN) : DIM, flags ? `since ${flags.since.slice(0, 4)} · ${events.length} flagged in all` : "SEC filings"),
        chip("Among the 500", league?.rank ? `#${league.rank}` : monitor ? "not ranked" : "…", league?.comp >= 0.9 ? AMBER : "var(--text-primary)", league?.rank ? `of ${monitor.league.length}, most aggressive = #1` : "largest non-financial filers"),
      ]}
    />

    <Panel title="What stands out" right={flags ? `filings since ${flags.since}` : flagErr ? "SEC filings unavailable" : "reading SEC filings…"}>
      {stands.length ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {stands.map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0", borderTop: i ? "1px solid var(--border-subtle)" : "none", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: s.tone, flex: "0 0 7px", transform: "translateY(-1px)" }} />
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      ) : <div style={{ ...note, fontSize: 10.5 }}>{flags || flagErr ? "Nothing trips the tests: earnings track cash, the ratios behave and the filings are quiet." : "Checking…"}</div>}
      {flagErr && <Note style={{ color: AMBER }}>SEC filings could not be read: {flagErr}</Note>}
    </Panel>

    {!financial && cols.length > 0 && (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
        <Panel title="Beneish M-score" right="index by fiscal year · his averages for clean firms and manipulators" style={{ marginBottom: 0 }}>
          <MiniTable head={["index", ...cols.map(c => `FY${c.y}`), "clean", "manip."]} rows={[
            ...BENEISH.map(([k, name, clean, manip, w, what]) => ({
              key: k,
              cells: [{ v: name, title: `${what} (weight ${w})` }, ...cols.map(c => {
                const v = c.beneish?.idx?.[k], tone = !fin(v) || w < 0 ? undefined : v >= manip ? RED : v >= (clean + manip) / 2 ? AMBER : undefined;
                return { v: fin(v) ? num(v, k === "tata" ? 3 : 2) : "·", color: fin(v) ? tone : DIM };
              }), { v: num(clean, k === "tata" ? 3 : 3), color: DIM }, { v: num(manip, 3), color: DIM }],
            })),
            { key: "m", strong: true, cells: ["M-score", ...cols.map(c => ({ v: num(c.beneish?.m), color: mTone(c.beneish?.m), title: c.beneish?.neutral?.length ? `set to neutral (missing inputs): ${c.beneish.neutral.join(", ")}` : undefined })), { v: "", color: DIM }, { v: "", color: DIM }] },
          ]} />
          <Note>Amber: past the midpoint between Beneish's clean-firm and manipulator averages; red: at or past the manipulator average. SG&A and leverage carry negative weights, so they are not coloured. A dot is an index whose inputs FMP does not report; it counts as neutral (1).</Note>
        </Panel>
        <Panel title="Montier C-score" right="six yes/no tests against the year before" style={{ marginBottom: 0 }}>
          <MiniTable head={["test", ...cols.map(c => `FY${c.y}`)]} rows={[
            ...MONTIER.map(([k, name, what]) => ({ key: k, cells: [{ v: name, title: what }, ...cols.map(c => { const t = c.montier?.tests?.[k]; return t == null ? { v: "n/a", color: DIM } : t ? { v: "yes", color: RED } : { v: "·", color: DIM }; })] })),
            { key: "c", strong: true, cells: ["C-score", ...cols.map(c => ({ v: c.montier ? `${c.montier.score}/${c.montier.testable}` : "—", color: cTone(c.montier?.score) }))] },
          ]} />
          <Note>Montier's tests: profit outrunning cash, receivable and inventory days rising, other current assets rising faster than sales, depreciation slowing relative to PP&E, assets growing over 10%. He read 4 or more as a company likely to be flattering its numbers. Without inventory the test is n/a and the score is out of 5.</Note>
        </Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
        <Panel title="M-score over time" right="above the red line looks like Beneish's manipulators" style={{ marginBottom: 0 }}>
          <ResponsiveContainer width="100%" height={chartH(phone, 190)}>
            <ComposedChart data={chart} margin={{ top: 6, right: 8, left: phone ? -18 : -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={14} />
              <YAxis tick={axis} axisLine={false} tickLine={false} domain={[dataMin => Math.min(-3.5, Math.floor(dataMin)), dataMax => Math.max(-1, Math.ceil(dataMax))]} />
              <ReferenceLine y={M_CUT} stroke={RED} strokeDasharray="4 3" />
              <ReferenceLine y={M_STRICT} stroke={AMBER} strokeDasharray="2 3" />
              <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={v => [num(v), "M-score"]} />
              <Line type="monotone" dataKey="m" name="M-score" stroke={INDIGO} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Accruals: profit not backed by cash" right="(net income − operating cash flow) ÷ average assets, %" style={{ marginBottom: 0 }}>
          <ResponsiveContainer width="100%" height={chartH(phone, 190)}>
            <BarChart data={chart} margin={{ top: 6, right: 8, left: phone ? -18 : -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={14} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
              <ReferenceLine y={0} stroke="var(--border-subtle)" />
              <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={v => [`${v}%`, "accruals"]} />
              <Bar dataKey="acc" name="accruals" fill={SLATE} fillOpacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
          <Note>Above zero, earnings ran ahead of operating cash. Sloan (1996) found the companies with the highest accruals went on to the weakest returns.</Note>
        </Panel>
      </div>
    </>)}

    <FootnoteTable fcols={fcols} flags={flags} financial={financial} />

    <Panel title="Street EPS against GAAP EPS" right={eps.length ? `${eps.length} quarters · FMP` : earn ? "no matched quarters" : "loading…"}>
      {eps.length > 0 ? (<>
        <ResponsiveContainer width="100%" height={chartH(phone, 200)}>
          <BarChart data={eps} margin={{ top: 6, right: 8, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={8} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => (v < 0 ? `−$${Math.abs(v)}` : `$${v}`)} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, nm) => [`$${num(v)}`, nm]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Bar dataKey="gaap" name="GAAP diluted EPS" fill={SLATE} fillOpacity={0.65} />
            <Bar dataKey="street" name="street (adjusted) EPS" fill={INDIGO} fillOpacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
        <Note>Clapham's test: how far the number the company wants you to use sits above the audited one, and whether the "one-time" items come back every quarter. Street EPS is FMP's reported actual, the basis analysts compare with; where it equals GAAP, the company reports on a GAAP basis.</Note>
      </>) : <div style={note}>{earn ? "FMP has no earnings history to match against the quarterly statements." : "Loading FMP earnings…"}</div>}
    </Panel>

    <FilingsPanel flags={flags} flagErr={flagErr} events={events} />
  </>);
}

function FootnoteTable({ fcols, flags, financial }) {
  const L = [
    ["Useful life of PP&E", c => (c.x && c.x.ppeGross > 0 && c.x.dep > 0 ? c.x.ppeGross / c.x.dep : null), v => (fin(v) ? `${v.toFixed(1)}y` : "—"), "gross PP&E ÷ depreciation; rising = slower depreciation", "sec"],
    ["Bad-debt allowance ÷ gross receivables", c => (c.x && fin(c.x.allowance) && fin(c.x.arNet) ? c.x.allowance / (c.x.arNet + c.x.allowance) : null), pctS, "falling while receivables rise = reserves released into profit", "sec"],
    ["Contract assets ÷ revenue", c => div(c.x?.contractAssets, c.x?.rev ?? c.r.rev), v => pct(v, 1), "revenue recognised before it can be billed", "sec"],
    ["Capitalised software ÷ operating cash flow", c => ofCfo(c.x?.capSoftware, c.r.cfo), v => pct(v, 1), "development spending kept off the income statement", "sec"],
    ["Deferred revenue ÷ revenue", c => div(c.r.defRev, c.r.rev), v => pct(v, 1), "falling = less cash collected ahead of revenue", "fmp"],
    ["Stock comp ÷ operating cash flow", c => ofCfo(c.r.sbc, c.r.cfo), v => pct(v), "operating cash flow flattered by adding stock pay back", "fmp"],
    ["Payables build ÷ operating cash flow", c => ofCfo(c.r.apChange, c.r.cfo), v => pct(v), "paying suppliers later lifts operating cash flow once", "fmp"],
    ["Acquisitions ÷ operating cash flow", c => (fin(c.r.acq) && c.r.acq < 0 ? ofCfo(-c.r.acq, c.r.cfo) : null), v => pct(v), "buying growth (and cash flow) rather than building it", "fmp"],
    ["Cash taxes ÷ book tax expense", c => div(c.x?.taxPaid ?? c.r.taxPaid, c.x?.taxExp ?? c.r.taxExp), v => pct(v), "far below 100% for years = book earnings ahead of taxable earnings", "both"],
    ["Pension: assumed return on assets", c => c.x?.pensionRoa ?? null, v => pct(v, 2), "a higher assumption books a smaller pension cost", "sec"],
    ["Restructuring charges ÷ revenue", c => div(c.x?.restructuring, c.x?.rev ?? c.r.rev), v => pct(v, 1), "\"one-time\" if it happens once", "sec"],
    ["Goodwill and asset impairments", c => (c.x && (fin(c.x.gwImpair) || fin(c.x.assetImpair)) ? (c.x.gwImpair ?? 0) + (c.x.assetImpair ?? 0) : null), money, "write-downs, often a new team's first-year bath", "sec"],
  ]
    // a bank's operating cash flow and "revenue" swing with its balance sheet, so the ratios to them mean nothing
    .filter(([label]) => !financial || !/operating cash flow|revenue/.test(label))
    .filter(([, get]) => fcols.some(c => fin(get(c)) && get(c) !== 0));
  if (!L.length) return null;
  const showLife = L.some(([label]) => label === "Useful life of PP&E");
  return (
    <Panel title="Footnote tests" right={`last ${fcols.length} fiscal years · FMP statements${flags?.facts?.length ? " and SEC XBRL" : ""}`}>
      <MiniTable head={["measure", ...fcols.map(c => `FY${c.r.y}`)]} rows={L.map(([label, get, fmt, hint, src]) => ({ key: label, cells: [{ v: label, title: `${hint} (${src === "sec" ? "SEC XBRL" : src === "fmp" ? "FMP" : "SEC XBRL, else FMP"})` }, ...fcols.map(c => ({ v: fmt(get(c)) }))] }))} />
      <Note>
        Hover a measure for what it catches.
        {showLife ? <> The useful life uses depreciation alone where the company reports it separately{flags?.facts?.some(f => f.depKind === "D&A") ? "; this company reports only depreciation and amortization together, so its life reads short" : ""}.</> : ""}
        These are the O'glove and Schilit checks a filing read would make: reserves, capitalisation, tax and pension assumptions, recurring charges.
        Shares of operating cash flow are blank in years when it was negative.
        {financial ? " For a financial company most of these lines do not exist." : ""} Blank: the company does not tag the line.
      </Note>
    </Panel>
  );
}

function FilingsPanel({ flags, flagErr, events }) {
  if (!flags) return <Panel title="Filings that signal trouble" right="SEC"><div style={note}>{flagErr ? `SEC filings could not be read: ${flagErr}` : "Reading the company's EDGAR record…"}</div></Panel>;
  const fr = flags.fridays || { eightKs: 0, late: [] };
  const link = (url, text) => <a href={url} target="_blank" rel="noreferrer" style={{ color: INDIGO, textDecoration: "none" }}>{text}</a>;
  return (
    <Panel title="Filings that signal trouble" right={`EDGAR since ${flags.since} · ${flags.name}`}>
      {events.length ? (
        <MiniTable head={["filing", "date", "form", "items"]} rows={events.slice(0, 40).map((e, i) => ({
          key: `${e.type}-${e.date}-${i}`,
          cells: [{ v: TYPES[e.type][0], color: TYPES[e.type][1] }, { v: link(e.url, e.date) }, e.form || "", (e.items || []).join(", ")],
        }))} />
      ) : <div style={{ ...note, fontSize: 10.5 }}>No restatements, auditor changes, late filings, material weaknesses, going-concern language, preferability letters or CFO changes since {flags.since.slice(0, 4)}.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginTop: 10 }}>
        <div>
          <div style={{ ...note, color: "var(--text-secondary)", marginBottom: 4 }}>Friday-night and holiday-eve 8-Ks: {fr.late.length} of {fr.eightKs}</div>
          {fr.late.slice(0, 8).map((f, i) => (
            <div key={i} style={{ ...note, fontSize: 10 }}>{link(f.url, f.date)} · {f.time}{f.eve ? " (holiday eve)" : ""} · items {f.items || "—"}{isBad(f) ? <span style={{ color: AMBER }}> · {f.cfo ? "CFO change" : "bad-news item"}</span> : ""}</div>
          ))}
          {!fr.late.length && <div style={{ ...note, fontSize: 10 }}>None: nothing filed late on a Friday.</div>}
        </div>
        <div>
          <div style={{ ...note, color: "var(--text-secondary)", marginBottom: 4 }}>SEC comment letters: {flags.comments.letters} letters, {flags.comments.replies} replies</div>
          {Object.entries(flags.comments.byYear).sort().reverse().slice(0, 6).map(([y, c]) => <div key={y} style={{ ...note, fontSize: 10 }}>{y}: {c} letter{c > 1 ? "s" : ""}</div>)}
          {flags.comments.recent.slice(0, 3).map((f, i) => <div key={i} style={{ ...note, fontSize: 10 }}>{link(f.url, `letter of ${f.date}`)}</div>)}
          <div style={{ ...note, color: "var(--text-secondary)", margin: "8px 0 4px" }}>Officer and director changes (8-K Item 5.02): {flags.officers.count}</div>
          {flags.amendments.length > 0 && <div style={{ ...note, fontSize: 10 }}>Amended 10-K/10-Q filings: {flags.amendments.length} (latest {link(flags.amendments[0].url, flags.amendments[0].date)}; most are routine)</div>}
          {flags.formerNames.length > 0 && <div style={{ ...note, fontSize: 10, marginTop: 4 }}>Former names: {flags.formerNames.map(f => `${f.name} (to ${f.to || "?"})`).join("; ")}</div>}
        </div>
      </div>
      <Note>
        From the company's EDGAR record: 8-K item numbers, late-filing notices and comment letters come from the filing index; material weaknesses
        (controls "not effective"), going-concern language, preferability letters and CFO changes from full-text search, the same queries the
        Sin &amp; Folly monitor counts market-wide. Acceptance times are EDGAR's, converted to New York time.{flags.stale ? ` Showing a cached copy: ${flags.stale}.` : ""}
      </Note>
    </Panel>
  );
}
