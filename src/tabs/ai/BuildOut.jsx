import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// AI BUILD-OUT TRACKER — AI Economy → Build-Out. Two theses on the AI capex
// boom, scored signal by signal: the funding loop (Craig Moffett: money moving
// inside the AI complex, increasingly on debt and off-balance-sheet structures,
// adds nothing unless outside customers pay) against productivity (AI already
// creates value, so output per worker should rise). Value creation and value
// capture are scored separately because both can be true at once.
// Data: /api/ai-buildout (server/aiBuildout.js). Rules live in
// data/ai-tracker/thresholds.json, hand inputs in manual-inputs.json; the
// detailed charts this page scores stay on their own tabs (Pulse: hyperscaler
// capex, Compute: capex returns and the AI debt market, Dark Output).
// ============================================================================

const STATUS = {
  moffett: ["Leans funding loop", C[2]],
  productivity: ["Leans productivity", C[1]],
  neutral: ["Neutral", "var(--text-muted)"],
  context: ["Context", "var(--border-subtle)"],
  nodata: ["No data yet", "var(--border-subtle)"],
};
const PANELS = [
  ["A", "Panel A · The funding loop", "Is the build paid for by the businesses' own cash, or increasingly by borrowing, vendor financing and structures that keep it off the balance sheet?"],
  ["B", "Panel B · The boundary", "Are new dollars arriving from customers outside the AI complex, fast enough to justify the spend?"],
  ["C", "Panel C · Productivity", "Is the economy producing more per hour and per worker, the way it should if AI is creating real value?"],
];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lbl = p => { const s = String(p ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : /^\d{4}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : s.replace(/^(\d{4})-Q(\d)$/, "Q$2 $1"); };
const year = p => String(p).slice(0, 4);
const yearTicks = rows => { const seen = new Set(); return rows.filter(r => { const y = year(r.p); if (seen.has(y)) return false; seen.add(y); return true; }).map(r => r.p); };
const bn = v => (finite(v) ? `$${v >= 100 ? v.toFixed(0) : v.toFixed(1)}bn` : "—");

function Badge({ status }) {
  const [t, c] = STATUS[status] || [status, "var(--border-subtle)"];
  return <span className="otag" style={{ borderColor: c, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{t}</span>;
}

function SignalCard({ s, compact }) {
  const cols = s.seriesCols || [s.unit || "value"];
  const rows = useMemo(() => (s.series || []).map(a => ({ p: String(a[0]), ...Object.fromEntries(cols.map((_, i) => [`v${i}`, a[i + 1]])) })), [s]);
  const fmt = v => (finite(v) ? `${fx(v, Math.abs(v) >= 100 ? 0 : 1)}${/%|pp/.test(s.unit || "") ? "%" : ""}` : "—"); // pp cards chart the two growth rates, in %
  return (
    <section className="ocard" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <strong style={{ font: "600 13px var(--font-body)", color: "var(--text-primary)" }}>{s.label}</strong>
        <Badge status={s.status} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ font: "600 22px var(--font-number)", color: "var(--text-primary)" }}>{s.display ?? "—"}</span>
        {s.period && <span className="onote" style={{ margin: 0 }}>{lbl(s.period)}</span>}
        {s.stale && <span className="otag" style={{ borderColor: "var(--oc-bad)", color: "var(--text-primary)" }} title="The latest observation is older than 1.5× this series' frequency plus its usual publication lag">stale</span>}
      </div>
      <p className="onote" style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>{s.why}</p>
      {!compact && rows.length > 2 && (<>
        {cols.length > 1 && <Legend items={cols.map((c, i) => [c, i === 0 ? C[1] : C[2]])} />}
        <div style={{ height: 120 }}><ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(rows)} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [fmt(v), cols[+n.slice(1)] || n]} />
            {finite(s.baseline) && <ReferenceLine y={s.baseline} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "2010s avg", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
            {(s.unit === "pp" || cols.length > 1) && <ReferenceLine y={0} stroke="var(--text-muted)" />}
            {cols.map((c, i) => <Line key={c} dataKey={`v${i}`} stroke={i === 0 ? C[1] : C[2]} strokeWidth={i === 0 ? 2 : 1.6} dot={false} isAnimationActive={false} connectNulls />)}
          </LineChart>
        </ResponsiveContainer></div>
      </>)}
      {s.note && <p className="onote" style={{ margin: 0 }}>{s.note}</p>}
      <p className="onote" style={{ margin: 0 }}>
        {s.source_url ? <a href={s.source_url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{s.source_name}</a> : s.source_name}
        {s.fetched_at ? ` · updated ${lbl(String(s.fetched_at).slice(0, 10))}` : ""}{s.frequency ? ` · ${s.frequency}` : ""}
      </p>
    </section>
  );
}

export default function BuildOut() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/ai-buildout").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.signals) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  const ratioRows = useMemo(() => {
    const by = new Map();
    for (const c of d?.companies || []) for (const [q, v] of c.capexOcfTtm) { const r = by.get(q) || { p: q }; r[c.name] = +(v * 100).toFixed(1); by.set(q, r); }
    return [...by.values()].sort((a, b) => a.p.localeCompare(b.p));
  }, [d]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The build-out tracker is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading SEC filings, Census, BEA and SF Fed data…</p></div></div>;
  const S = id => d.signals.find(s => s.id === id);
  const events = (d.events || []).filter(e => !e.example);
  const last = arr => (arr || []).at(-1);
  const sum4 = arr => { const a = (arr || []).slice(-4); return a.length === 4 ? a.reduce((s, x) => s + (x[1] || 0), 0) : null; };

  return (
    <div className="options-research">
      <header style={{ marginBottom: 10 }}>
        <div className="ocard-eyebrow">AI build-out tracker · latest complete quarter {lbl(d.lastQuarter)}</div>
        <h2 style={{ margin: "2px 0 6px", font: "600 24px var(--font-body)", letterSpacing: -0.3 }}>{d.synthesis?.line}</h2>
        <p className="ohead-line" style={{ margin: 0 }}>
          Two readings of the AI boom are tested here. The <strong>funding loop</strong> (Craig Moffett): deals inside the AI complex — chipmaker to lab to cloud and back — move money around without adding any, so what matters is whether new dollars arrive from customers outside it, or whether the build is increasingly funded by debt, vendor financing and off-balance-sheet structures.
          The <strong>productivity</strong> thesis: AI is already creating real value, coding first, so output per hour and per worker should rise. Both can be true at once — value created, but captured by the users of AI rather than the companies paying for the build — so the funding signals (A, B) and the productivity signals (C) are scored separately.
        </p>
      </header>

      <div className="ocard-eyebrow" style={{ margin: "10px 0 6px" }}>The three to watch</div>
      <div className="ogrid ogrid-3" style={{ marginBottom: 12 }}>
        {[S("capexOcf"), S("qssVsCapex"), S("tfp")].filter(Boolean).map(s => (
          <div key={s.id}>
            <SignalCard s={s} compact />
            {s.id === "capexOcf" && <p className="onote" style={{ margin: "4px 2px 0" }}>Off-balance-sheet and vendor-financing events logged in the last 12 months: <strong>{S("obs")?.value ?? 0}</strong>.</p>}
          </div>
        ))}
      </div>

      <div className="okpis" style={{ marginBottom: 12 }}>
        {PANELS.map(([p, t]) => <div key={p} className="okpi"><span className="okpi-label">{t.split(" · ")[1]}</span><strong className="okpi-value" style={{ fontSize: 15 }}><Badge status={d.synthesis?.[p]} /></strong><span className="okpi-sub">{d.signals.filter(s => s.panel === p && ["moffett", "productivity", "neutral"].includes(s.status)).length} scored signals</span></div>)}
      </div>

      {PANELS.map(([p, title, q]) => (
        <section key={p} style={{ marginTop: 14 }}>
          <div className="ocard-eyebrow" style={{ marginBottom: 2 }}>{title}</div>
          <p className="onote" style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--text-secondary)" }}>{q}</p>
          <div className="ogrid ogrid-2">
            {d.signals.filter(s => s.panel === p && !(p === "A" && s.id === "obs")).map(s => <SignalCard key={s.id} s={s} />)}
          </div>

          {p === "A" && (<>
            <div style={{ marginTop: 12 }}>
              <VizCard eyebrow="SEC XBRL · trailing four quarters, calendar quarters (Oracle's fiscal quarters end a month later)" title="Each hyperscaler's capex as a share of its operating cash flow"
                finding={(d.companies || []).map(c => `${c.name} ${fx(last(c.capexOcfTtm)?.[1] * 100, 0)}%`).join(" · ") + ". Above 100% means the company spent more on property and equipment than its operations brought in; the gap is filled by cash reserves or borrowing."}
                table={<MiniTable columns={[
                  { key: "name", label: "Company" }, { key: "q", label: "Latest quarter", fmt: lbl }, { key: "capex", label: "Capex, quarter", fmt: bn }, { key: "ocf", label: "Operating cash, quarter", fmt: bn },
                  { key: "ratio", label: "Capex ÷ OCF, 4Q", fmt: v => (finite(v) ? `${(v * 100).toFixed(0)}%` : "—") }, { key: "debt4", label: "Debt raised, 4Q", fmt: bn }, { key: "rpo", label: "Backlog", fmt: bn }, { key: "lease4", label: "Finance-lease adds, 4Q", fmt: bn },
                ]} rows={(d.companies || []).map(c => ({ name: c.name, q: last(c.capex)?.[0], capex: last(c.capex)?.[1], ocf: last(c.ocf)?.[1], ratio: last(c.capexOcfTtm)?.[1], debt4: sum4(c.debt), rpo: c.rpo.length && last(c.rpo)[0] >= "2024" ? last(c.rpo)[1] : null, lease4: sum4(c.leaseAdds) }))} />}>
                <Legend items={(d.companies || []).map((c, i) => [c.name, [C[1], C[2], C[3], C[4], C[5]][i]])} />
                <div className="ochart" style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ratioRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={year} ticks={yearTicks(ratioRows)} interval={0} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={lbl} formatter={(v, n) => [`${fx(v, 0)}%`, n]} />
                    <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "spending all operating cash", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />
                    {(d.companies || []).map((c, i) => <Line key={c.name} dataKey={c.name} stroke={[C[1], C[2], C[3], C[4], C[5]][i]} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />)}
                  </LineChart>
                </ResponsiveContainer></div>
              </VizCard>
            </div>
            <div style={{ marginTop: 12 }}>
              <VizCard eyebrow="Hand-kept log · data/ai-tracker/manual-inputs.json" title="Off-balance-sheet and vendor-financing events"
                finding={events.length ? `${events.length} events logged. These are the structures the funding-loop thesis worries about: SPVs and joint ventures that carry data centers off the builder's balance sheet, leases signed but not yet on it, chipmakers investing in or lending to their own customers, and backstops.` : "No events logged yet. Add each SPV, lease not yet commenced, vendor-financing deal or equity stake in a customer to data/ai-tracker/manual-inputs.json with its date and a source link; the count feeds the funding-loop panel. Announced debt facilities are already tracked on AI Economy → Compute (AI debt market)."}>
                {events.length > 0 && <MiniTable columns={[{ key: "date", label: "Date", fmt: lbl }, { key: "company", label: "Company" }, { key: "counterparty", label: "Counterparty", align: "left" }, { key: "type", label: "Type", align: "left" }, { key: "amountBn", label: "Amount", fmt: bn }, { key: "description", label: "What", align: "left" }, { key: "source_url", label: "Source", align: "left", fmt: v => (v ? <a href={v} target="_blank" rel="noreferrer">link</a> : "—") }]} rows={[...events].sort((a, b) => b.date.localeCompare(a.date))} />}
              </VizCard>
            </div>
          </>)}
        </section>
      ))}

      <VizCard style={{ marginTop: 14 }} eyebrow="Hand-kept series · data/ai-tracker/manual-inputs.json" title="Inputs with no API"
        finding="These have no machine-readable source, so they stay hand-fed. Each value needs a date and a source link; nothing is estimated.">
        <MiniTable columns={[{ key: "label", label: "Series" }, { key: "unit", label: "Unit" }, { key: "frequency", label: "Frequency" }, { key: "n", label: "Values" }, { key: "lastDate", label: "Latest", fmt: lbl }]}
          rows={Object.entries(d.manualSeries || {}).map(([id, s]) => ({ id, label: s.label, unit: s.unit, frequency: s.frequency, n: (s.values || []).length, lastDate: (s.values || []).map(v => v.date).sort().at(-1) || null }))} />
        {d.manualError && <p className="onote" style={{ color: "var(--oc-bad)" }}>manual-inputs.json could not be read: {d.manualError}</p>}
      </VizCard>

      <VizCard style={{ marginTop: 12 }} eyebrow="data/ai-tracker/thresholds.json" title="How the badges are set"
        finding="Every rule is a starting point to argue with, kept in one editable file; the page reads it on each load, so a change shows on refresh.">
        <ul className="onote" style={{ margin: "0 0 0 18px", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          <li>Capex ÷ operating cash flow above {fx(d.thresholds?.capexOcf?.moffettAbove * 100, 0)}%{d.thresholds?.capexOcf?.moffettRequiresRising ? " and rising over four quarters" : ""} → leans funding loop; below {fx(d.thresholds?.capexOcf?.productivityBelow * 100, 0)}% → leans productivity.</li>
          <li>Debt raised over four quarters up more than {d.thresholds?.debtIssuance?.moffettYoyAbovePct}% on the year → leans funding loop.</li>
          <li>Census 518 revenue growth minus capex growth below {d.thresholds?.qssVsCapex?.moffettBelowPp} points → leans funding loop; above {d.thresholds?.qssVsCapex?.productivityAbovePp} → leans productivity.</li>
          <li>TFP and labor productivity: the average of the last {d.thresholds?.tfp?.window} quarters above the {d.thresholds?.tfp?.baseline?.join("–")} average → leans productivity.</li>
          <li>Software output growth minus software employment growth above {d.thresholds?.softwareOutputVsJobs?.productivityAbovePp} points → leans productivity.</li>
          <li>The synthesis line combines the panels: funding signals deteriorating while productivity improves reads as "both theses holding". Context signals are shown but not scored.</li>
        </ul>
        {d.thresholdsError && <p className="onote" style={{ color: "var(--oc-bad)" }}>thresholds.json could not be read: {d.thresholdsError}</p>}
      </VizCard>

      <p className="onote">Where the detail lives: hyperscaler capex on AI Economy → Pulse; capex returns and the AI debt market on Compute; GPU and token prices on Compute and Tokens; services revenue, software jobs and productivity on Dark Output. Series list and how to update the hand-kept inputs: docs/ai-tracker.md.</p>
      {(d.sourceErrors || []).length > 0 && <p className="onote" style={{ color: "var(--oc-bad)" }}>{d.sourceErrors.join(" · ")}</p>}
      <p className="onote">Sources: {(d.sources || []).map(s => `${s.label} (${s.from === "live" ? "fetched" : `${s.from} copy`} ${String(s.fetched || "").slice(0, 10)})`).join("; ")}.</p>
    </div>
  );
}
