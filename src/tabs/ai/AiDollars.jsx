import React, { useEffect, useState } from "react";
import { finite, C, VizCard, Kpi, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// AI DOLLARS — AI Economy → Models & Labs: what new dollars are entering the AI
// ecosystem, and whose they are (server/aiDollars.js; the disclosures are
// hand-kept in the Research Database's ai-dollars.json).
//   ledger     one bar per line, dollars a year: what customers pay (four
//              tiers that overlap), what builders and investors put in (capex
//              as filed and as guided, neocloud capex, venture funding), and
//              the enterprise-spending surveys as a cross-check
//   revenue    every company behind the tiers: latest run-rate, the figure
//              nearest a year earlier, dollars added, source
//   capital    capex guidance by company; venture funding by year and quarter
//              and the largest rounds
//   surveys    the enterprise AI spending estimates, with their restatements
// Customers' money is blue (--oc-1), capital orange (--oc-2), surveys grey.
// The tiers are never summed: the chart puts them side by side.
// ============================================================================

const bn = v => (!finite(v) ? "—" : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e11 ? `$${Math.round(v / 1e9)}B` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`);
const when = d => { if (!d) return "—"; const [y, m] = d.split("-"); return new Date(Date.UTC(+y, +m - 1, 15, 12)).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
const cents = v => (finite(v) ? `${Math.round(v * 100)}¢` : "—");
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };
const left = { textAlign: "left" }, right = { textAlign: "right" };
const KIND = { customers: ["Customers pay (annualised revenue)", C[1]], capital: ["Capital put in (a year)", C[2]], survey: ["Survey estimates (cross-check)", "var(--text-muted)"] };

// one bar per line of the ledger, grouped, on a shared dollar axis; a range is a hairline over the bar
function LedgerBars({ rows }) {
  const [hover, setHover] = useState(null);
  const W = 1000, rowH = 28, head = 22, m = { l: 330, r: 96 }, max = Math.max(...rows.map(r => r.high || r.usd)) * 1.04;
  const x = v => m.l + (v / max) * (W - m.l - m.r);
  let yy = 4; const placed = [];
  for (const k of Object.keys(KIND)) { const list = rows.filter(r => r.kind === k); if (!list.length) continue; placed.push({ header: k, y: yy }); yy += head; for (const r of list) { placed.push({ r, y: yy }); yy += rowH; } yy += 6; }
  const step = max > 6e11 ? 2e11 : max > 3e11 ? 1e11 : 5e10, ticks = []; for (let t = 0; t <= max; t += step) ticks.push(t);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${yy + 16}`} role="img" aria-label="Dollars a year by line of the ledger: customers' revenue, capital, and survey estimates" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={yy} stroke="var(--border-subtle)" /><text x={x(t)} y={yy + 12} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{t === 0 ? "$0" : bn(t)}</text></g>)}
        {placed.map(pl => pl.header ? (
          <text key={pl.header} x={0} y={pl.y + 14} style={{ fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", fill: "var(--text-secondary)", fontFamily: "var(--font-number)" }}>{KIND[pl.header][0]}</text>
        ) : (
          <g key={pl.r.id} onMouseEnter={() => setHover(pl.r)}>
            <rect x={0} y={pl.y} width={W} height={rowH} fill={hover === pl.r ? "var(--bg-subtle)" : "transparent"} />
            <text x={m.l - 10} y={pl.y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--text-primary)", fontFamily: "var(--font-body)" }}>{pl.r.label}</text>
            <rect x={m.l} y={pl.y + 6} width={Math.max(2, x(pl.r.usd) - m.l)} height={rowH - 12} rx={3} fill={KIND[pl.r.kind][1]} opacity={pl.r.soft ? 0.55 : 1} />
            {finite(pl.r.low) && pl.r.high > pl.r.low && <line x1={x(pl.r.low)} x2={x(pl.r.high)} y1={pl.y + rowH / 2} y2={pl.y + rowH / 2} stroke="var(--text-primary)" strokeWidth="2" />}
            <text x={x(pl.r.high || pl.r.usd) + 8} y={pl.y + rowH / 2 + 4} style={{ fontSize: 11.5, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-number)" }}>{bn(pl.r.usd)}</text>
          </g>))}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18, marginTop: 2 }}>
        {hover ? <><b style={{ color: "var(--text-primary)" }}>{hover.label}: {bn(hover.usd)}</b>{finite(hover.low) && hover.high > hover.low ? ` (${bn(hover.low)} to ${bn(hover.high)})` : ""} · {hover.detail}</> : <>Hover a bar for what it counts. Bars in one group overlap and are not to be added: an application's revenue is partly a lab's, a lab's partly a cloud's.</>}
      </div>
      <Legend items={Object.values(KIND)} />
    </div>
  );
}

export default function AiDollars() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; fetch("/api/ai-dollars").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The AI dollar ledger could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading the disclosures…</p></div>;
  if (!d.available) return <div className="options-research"><section className="ocard" style={{ marginBottom: 12 }}><h3 className="ocard-title">The AI dollar ledger</h3><p className="ocard-finding">{d.reason} The disclosures are hand-kept in the Research Database (data/curated/ai-dollars.json).</p></section></div>;

  const r = d.reads, cap = d.capital, T = Object.fromEntries(d.tiers.map(t => [t.id, t])), labs = T.labs;
  const win = t => (t.months ? (t.months[0] === t.months[1] ? `${t.months[0]} months` : `${t.months[0]} to ${t.months[1]} months`) : null);
  const menlo = k => d.survey.find(s => /Menlo/.test(s.entity) && /2026 report/.test(s.entity) && k.test(s.metric) && /per year/.test(s.unit || ""));
  const dep = menlo(/deployment spend, annualized/i), dev = menlo(/Development spend/i);
  const rows = [
    ...d.tiers.map(t => ({ id: t.id, kind: "customers", label: t.label, usd: t.total, soft: t.id === "inference" || t.id === "applications", detail: `${t.what}; ${t.entities.length} companies${t.added > 0 ? `; ${bn(t.added)} added over ${win(t)} by the ${t.withHistory} with a history` : ""}. ${t.caveat[0].toUpperCase()}${t.caveat.slice(1)}.` })),
    cap.filed && { id: "filed", kind: "capital", label: "Hyperscaler capex, as filed (four quarters)", usd: cap.filed.usd, detail: `five hyperscalers, four quarters to ${when(cap.filed.through)}; ${bn(cap.filed.prior)} the four before. All capex, not only AI. Operating cash flow over the same quarters ${bn(cap.filed.operatingCashFlow)}.` },
    cap.guided.total > 0 && { id: "guided", kind: "capital", label: "Hyperscaler capex, guided for the calendar year", usd: cap.guided.total, low: cap.guided.low, high: cap.guided.high, soft: true, detail: cap.guided.entities.map(e => `${e.entity} ${bn(e.usd)}${e.basis !== "guidance" ? ` (${e.basis})` : ""}`).join("; ") + "." },
    cap.neocloud.total > 0 && { id: "neo", kind: "capital", label: "Neocloud capex, guided", usd: cap.neocloud.total, low: cap.neocloud.low, high: cap.neocloud.high, soft: true, detail: cap.neocloud.entities.map(e => `${e.entity} ${bn(e.usd)}`).join("; ") + "." },
    r.ventureYear && { id: "vc", kind: "capital", label: `Venture funding to AI companies, ${r.ventureYear.period.replace("calendar ", "")}`, usd: r.ventureYear.usd, detail: `${r.ventureYear.label}${r.ventureQuarter ? `; ${bn(r.ventureQuarter.usd)} in ${r.ventureQuarter.period} alone` : ""}. ${r.ventureYear.note || ""}` },
    dep && { id: "dep", kind: "survey", label: "Enterprise AI deployment spend (Menlo, run-rate)", usd: dep.usd, detail: `${dep.entity}, ${dep.period}. ${dep.note || ""}` },
    dev && { id: "dev", kind: "survey", label: "Spend on building AI (Menlo, run-rate)", usd: dev.usd, detail: `${dev.entity}, ${dev.period}. ${dev.note || ""}` },
  ].filter(Boolean);
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Dollars entering the AI ecosystem · a year · disclosed figures${d.reviewed ? `, reviewed ${d.reviewed}` : ""}`} title="The AI dollar ledger: who is paying, and who is investing"
        finding={`Customers pay the AI labs about ${bn(r.labs)} a year at the latest run-rates${labs.added > 0 ? `, ${bn(labs.added)} more than ${win(labs)} earlier` : ""}; with the clouds' own AI lines it is ${bn(r.endRevenue)}, some of it counted twice. Against that, the five hyperscalers spent ${bn(cap.filed?.usd ?? cap.guided.total)} on capex over the past four quarters${cap.filed ? `, ${bn(cap.filed.added)} more than the four before` : ""}: the labs take in ${cents(r.labsPerCapexDollar)} for each capex dollar${finite(r.capexPerNewRevenueDollar) ? `, and each new dollar of lab revenue came with ${`$${r.capexPerNewRevenueDollar.toFixed(1)}`} of new capex` : ""}.${finite(r.capexCoverage) ? ` Operating cash flow still covers it: capex is ${Math.round(r.capexCoverage * 100)}% of the hyperscalers' cash from operations.` : ""}${r.ventureYear ? ` Venture investors added ${bn(r.ventureYear.usd)} in ${r.ventureYear.period.replace("calendar ", "")}${r.ventureQuarter ? ` and ${bn(r.ventureQuarter.usd)} in ${r.ventureQuarter.period} alone` : ""}.` : ""}`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Customers pay the labs" value={`${bn(r.labs)}/yr`} sub={`${labs.entities.length} labs' latest run-rates; ${bn(r.endRevenue)} with the clouds' AI lines (overlapping)`} tone={C[1]} />
          <Kpi label="Lab revenue added" value={bn(labs.added)} sub={`over ${win(labs) || "—"}, by the ${labs.withHistory} labs with a history`} tone={C[1]} />
          <Kpi label="Hyperscaler capex" value={`${bn(cap.filed?.usd ?? cap.guided.total)}/yr`} sub={cap.filed ? `filed, four quarters to ${when(cap.filed.through)}; guided ${bn(cap.guided.total)} for the calendar year` : "guided"} tone={C[2]} />
          <Kpi label="Lab revenue per capex dollar" value={cents(r.labsPerCapexDollar)} sub={`${cents(r.endPerCapexDollar)} counting the clouds' AI lines too`} />
          {finite(r.capexPerNewRevenueDollar) && <Kpi label="New capex per new revenue dollar" value={`$${r.capexPerNewRevenueDollar.toFixed(1)}`} sub={`capex up ${bn(r.capexAdded)} on the prior four quarters; lab revenue up ${bn(labs.added)}`} />}
          {finite(r.capexCoverage) && <Kpi label="Capex as a share of operating cash" value={`${Math.round(r.capexCoverage * 100)}%`} sub="under 100% means the hyperscalers fund it from operations; over, from borrowing or cash" />}
        </div>
        <LedgerBars rows={rows} />

        <div className="ocard-eyebrow" style={{ margin: "14px 0 4px" }}>Who is paying · every company behind the tiers</div>
        <div className="otable-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Company</th><th style={right}>Annualised</th><th style={right}>As of</th><th style={left}>Basis</th><th style={right}>Earlier figure</th><th style={right}>Added</th><th style={right} title="The yearly multiple between the two figures">Per year</th><th style={left}>Said by</th><th style={left}>Conf.</th></tr></thead>
            <tbody>{d.tiers.map(t => (
              <React.Fragment key={t.id}>
                <tr><td colSpan={9} style={{ ...left, background: "var(--bg-subtle)", fontFamily: "var(--font-body)", color: "var(--text-primary)" }}><b>{t.label}</b> · {bn(t.total)} a year · <span style={{ color: "var(--text-secondary)" }}>{t.what}; {t.caveat}</span></td></tr>
                {t.entities.map(e => (
                  <tr key={t.id + e.entity} title={e.note || undefined}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{e.entity}</td>
                    <td style={{ ...right, fontWeight: 600 }}>{bn(e.usd)}</td><td style={right}>{when(e.asOf)}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{e.basis}</td>
                    <td style={right}>{e.prior ? `${bn(e.prior.usd)} · ${when(e.prior.asOf)}` : "—"}</td>
                    <td style={right}>{finite(e.added) ? `${bn(e.added)} / ${e.months} mo` : "—"}</td>
                    <td style={right}>{finite(e.multiple) ? `${e.multiple}×` : "—"}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 150 }}>{(e.statedBy || "—").slice(0, 70)}{e.url ? <> · <a href={e.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(e.url)}</a></> : null}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{e.confidence || "—"}</td>
                  </tr>))}
              </React.Fragment>))}</tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 12 }}>
          <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Who is investing · capex guidance by company</div>
            <div className="otable-wrap">
              <table className="otable">
                <thead><tr><th style={left}>Company</th><th style={right}>A year</th><th style={left}>Range</th><th style={left}>For</th><th style={left}>Basis</th><th style={left}>Conf.</th></tr></thead>
                <tbody>{[...cap.guided.entities, ...cap.neocloud.entities].map(e => (
                  <tr key={e.entity} title={e.note || undefined}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{e.entity}{e.url ? <> · <a href={e.url} target="_blank" rel="noreferrer" style={{ color: "inherit", fontFamily: "var(--font-number)", fontSize: 10.5 }}>{host(e.url)}</a></> : null}</td>
                    <td style={{ ...right, fontWeight: 600 }}>{bn(e.usd)}</td>
                    <td style={left}>{e.high > e.low ? `${bn(e.low)} to ${bn(e.high)}` : "—"}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{e.period}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{e.basis}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{e.confidence || "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>
          <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Venture funding to AI companies · and the largest rounds</div>
            <div className="otable-wrap">
              <table className="otable">
                <thead><tr><th style={left}>Period or round</th><th style={right}>Amount</th><th style={left}>Source</th></tr></thead>
                <tbody>
                  {[...cap.venture.years, ...cap.venture.quarters].map((v, i) => <tr key={`p${i}`} title={v.note || undefined}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{v.period.replace("calendar ", "")} · {v.label}</td><td style={{ ...right, fontWeight: 600 }}>{bn(v.usd)}</td><td style={left}>{v.url ? <a href={v.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(v.url)}</a> : "—"}</td></tr>)}
                  {cap.venture.rounds.map((v, i) => <tr key={`r${i}`} title={v.note || undefined}><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{v.label} · {v.period}</td><td style={right}>{bn(v.usd)}</td><td style={left}>{v.url ? <a href={v.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(v.url)}</a> : "—"}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Enterprise spending surveys · the cross-check, with their restatements</div>
        <div className="otable-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Survey</th><th style={left}>Measure</th><th style={right}>Figure</th><th style={left}>For</th><th style={left}>Note</th></tr></thead>
            <tbody>{d.survey.map((s, i) => (
              <tr key={i}>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{s.entity}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "inherit", fontFamily: "var(--font-number)", fontSize: 10.5 }}>{host(s.url)}</a></> : null}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 200 }}>{s.metric}</td>
                <td style={{ ...right, fontWeight: 600 }}>{bn(s.usd)}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.period}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 240 }}>{(s.note || "").slice(0, 180)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Where the capex is funded from (cash flow, debt, equity) is on Build-Out; who the labs pay is "Who pays whom" below. Source: {d.source}.</li>
        </ul>
      </VizCard>
    </div>
  );
}
