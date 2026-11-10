import React, { useEffect, useMemo, useState } from "react";
import { finite, C, VizCard, Kpi, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// COMPUTE FLOWS: who pays whom. The named, dollar-denominated commitments
// between the labs, the cloud platforms, the neoclouds and chip vendors, and
// the hosts behind them, as bands whose width is contract value; then each
// supplier's reported backlog with the labs' commitments set beside it, and
// the agreements themselves with how good each number is.
// Data: /api/ai-flows (server/aiFlows.js), hand-kept in the Research Database
// because it names holdings; this file holds no company names. A band is solid
// when the amount is in a filing, lighter when it comes from an announcement,
// a research note or the press, and outlined when the money is cancellable,
// optional or a ceiling. Contract value is not revenue and not cash paid.
// ============================================================================

const TIERS = [["lab", "Labs"], ["platform", "Platforms & large buyers"], ["mid", "Neoclouds & chip vendors"], ["host", "Hosts"]];
const col = tier => (tier === "lab" ? 0 : tier === "platform" ? 1 : tier === "host" ? 3 : 2);
const usd = v => (finite(v) ? `$${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1).replace(/\.0$/, "")}B` : "—");
const pct = v => (finite(v) ? `${Math.round(v * 100)}%` : "—");
const BASIS = { filed: "Filed", announced: "Announced", secondary: "Research note", reported: "Press report" };
const right = { textAlign: "right" }, left = { textAlign: "left" };
const band = e => (!e.firm ? { fill: C[1], fillOpacity: 0.07, stroke: C[1], strokeOpacity: 0.7, strokeDasharray: "4 3" } : e.basis === "filed" ? { fill: C[1], fillOpacity: 0.55, stroke: "none" } : { fill: C[1], fillOpacity: 0.26, stroke: "none" });

function Sankey({ nodes, edges, onPick, picked }) {
  const W = 880, H = 470, NW = 12, PAD = 14, top = 26, x = [150, 370, 590, 760];
  const layout = useMemo(() => {
    const cols = [0, 1, 2, 3].map(i => nodes.filter(n => col(n.tier) === i && Math.max(n.in, n.out) > 0).sort((a, b) => Math.max(b.in, b.out) - Math.max(a.in, a.out)));
    const scale = Math.min(...cols.filter(c => c.length).map(c => (H - top - 8 - PAD * (c.length - 1)) / c.reduce((s, n) => s + Math.max(n.in, n.out), 0)));
    const pos = {};
    cols.forEach((c, i) => { let y = top; c.forEach(n => { const h = Math.max(3, Math.max(n.in, n.out) * scale); pos[n.id] = { x: x[i], y, h, i, out: 0, in: 0 }; y += h + PAD; }); });
    // bands leave and arrive in the order of the node at the other end, so they cross as little as they can
    const bands = [...edges].sort((a, b) => pos[a.to].y - pos[b.to].y || pos[a.from].y - pos[b.from].y).map(e => {
      const s = pos[e.from], t = pos[e.to], w = Math.max(1.5, e.amount * scale);
      const y0 = s.y + s.out; s.out += w;
      return { e, s, t, w, y0 };
    });
    [...bands].sort((a, b) => a.s.y - b.s.y || a.y0 - b.y0).forEach(bd => { bd.y1 = bd.t.y + bd.t.in; bd.t.in += bd.w; });
    return { pos, bands };
  }, [nodes, edges]);
  const path = ({ s, t, w, y0, y1 }) => { const xa = s.x + NW, xb = t.x, mx = (xa + xb) / 2; return `M${xa},${y0} C${mx},${y0} ${mx},${y1} ${xb},${y1} L${xb},${y1 + w} C${mx},${y1 + w} ${mx},${y0 + w} ${xa},${y0 + w} Z`; };
  const dim = id => picked && picked !== id;
  return (
    <div className="otable-wrap">
      <svg width={W} height={H} role="img" aria-label="Compute commitments flowing from payers on the left to suppliers on the right" style={{ display: "block" }}>
        {TIERS.map(([, label], i) => <text key={label} x={x[i] + (i === 0 ? NW : 0)} y={12} textAnchor={i === 0 ? "end" : "start"} style={{ fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-number)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</text>)}
        {layout.bands.map((bd, i) => (
          <path key={i} d={path(bd)} {...band(bd.e)} opacity={picked && bd.e.from !== picked && bd.e.to !== picked ? 0.25 : 1}>
            <title>{`${nodes.find(n => n.id === bd.e.from).label} → ${nodes.find(n => n.id === bd.e.to).label}: ${bd.e.upTo ? "up to " : ""}${usd(bd.e.amount)} (${bd.e.kind}, ${BASIS[bd.e.basis] || bd.e.basis}${bd.e.firm ? "" : ", not firm"}). ${bd.e.note || ""}`}</title>
          </path>
        ))}
        {nodes.filter(n => layout.pos[n.id]).map(n => {
          const p = layout.pos[n.id], lefty = p.i === 0, total = Math.max(n.in, n.out);
          return (
            <g key={n.id} onClick={() => onPick(picked === n.id ? null : n.id)} style={{ cursor: "pointer" }} opacity={dim(n.id) && !edges.some(e => (e.from === picked && e.to === n.id) || (e.to === picked && e.from === n.id)) ? 0.4 : 1}>
              <title>{`${n.label}: ${n.in ? `${usd(n.in)} committed to it` : ""}${n.in && n.out ? "; " : ""}${n.out ? `${usd(n.out)} committed by it` : ""}. Click to isolate.`}</title>
              <rect x={p.x} y={p.y} width={NW} height={p.h} rx={2} fill="var(--text-primary)" />
              <text x={lefty ? p.x - 7 : p.x + NW + 7} y={p.y + Math.min(p.h / 2, 14) + (p.h < 14 ? 2 : 0)} textAnchor={lefty ? "end" : "start"} dominantBaseline="middle" style={{ fontSize: 12, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-body)" }}>{n.label}</text>
              {p.h >= 26 && <text x={lefty ? p.x - 7 : p.x + NW + 7} y={p.y + Math.min(p.h / 2, 14) + 15} textAnchor={lefty ? "end" : "start"} dominantBaseline="middle" style={{ fontSize: 11, fill: "var(--text-secondary)", fontFamily: "var(--font-number)" }}>{usd(total)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function ComputeFlows() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [picked, setPicked] = useState(null), [show, setShow] = useState("all");
  useEffect(() => { let alive = true; fetch("/api/ai-flows").then(r => r.json()).then(j => { if (alive) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => alive && setErr(e.message)); return () => { alive = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">Compute flows could not be loaded: {err}</p></div>;
  if (!d) return null;
  if (!d.available) return <div className="options-research"><section className="ocard" style={{ marginBottom: 12 }}><h3 className="ocard-title">Who pays whom</h3><p className="ocard-finding">{d.reason} The table of agreements is hand-kept in the Research Database (data/curated/ai-flows.json).</p></section></div>;

  const name = id => d.nodes.find(n => n.id === id)?.label || id;
  const labs = d.nodes.filter(n => n.tier === "lab");
  const edges = d.edges.filter(e => (!picked || e.from === picked || e.to === picked) && (show === "all" || (show === "firm" ? e.firm : show === "checked" ? e.checked : !e.checked)));
  const drawn = show === "firm" ? d.edges.filter(e => e.firm) : d.edges;
  const max = Math.max(1e-9, ...d.suppliers.map(s => s.backlog || 0));

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`${d.totals.edges} named agreements · ${d.units || "USD billions of contract value"}`} title="Who pays whom for compute"
        finding={`${labs.map(l => `${l.label} has committed ${usd(l.outFirm)}`).join(" and ")} in the agreements on file, against a combined ${usd(d.totals.firm)} of firm commitments drawn here and ${usd(d.totals.soft)} that is cancellable, optional or a ceiling. Width is the size of the contract, not what has been paid: most of it falls due over five to ten years.`}
        right={<Seg label="Draw" value={show === "firm" ? "firm" : "all"} onChange={v => setShow(v)} options={[["all", "Everything"], ["firm", "Firm only"]]} />}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          {labs.map(l => <Kpi key={l.id} label={`${l.label}, firm`} value={usd(l.outFirm)} sub={l.out > l.outFirm ? `plus ${usd(l.out - l.outFirm)} not firm` : "committed to suppliers"} />)}
          <Kpi label="Read from the document" value={`${d.totals.checked} of ${d.totals.edges}`} sub="the rest still need the filing beside them" />
        </div>
        <Legend items={[["In a filing", `color-mix(in srgb, ${C[1]} 62%, transparent)`], ["Announced, research note or press", `color-mix(in srgb, ${C[1]} 30%, transparent)`], ["Cancellable, optional or a ceiling", C[1], true]]} />
        <Sankey nodes={d.nodes} edges={drawn} picked={picked} onPick={setPicked} />
        <p className="onote" style={{ marginTop: 6 }}>Hover a band for the agreement; click a company to isolate its bands{picked ? <> (showing {name(picked)}; <button type="button" onClick={() => setPicked(null)} style={{ background: "none", border: 0, padding: 0, color: "var(--oc-1)", cursor: "pointer", font: "inherit" }}>show all</button>)</> : ""}. Only agreements with a stated dollar amount are drawn: capacity deals priced in gigawatts are not.</p>
      </VizCard>

      <VizCard eyebrow={`Backlog as reported${d.backlogReviewed ? ` · reviewed ${d.backlogReviewed}` : ""}`} title="How much of each supplier's backlog is a few named payers"
        finding="Each supplier's reported backlog with the firm commitments on file set beside it: the two labs', and every named payer's. Read each share as a rough ceiling: contract value is not the part still unrecognized, and an agreement signed after the backlog date is not in that backlog yet."
        style={{ marginBottom: 12 }}>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={left}>Supplier</th><th style={left}>Backlog measure</th><th style={right}>Backlog</th><th style={left}>Named payers within it (at most)</th><th style={right}>Labs</th><th style={right}>Share</th><th style={right}>All named</th><th style={right}>Share</th><th style={left}>Named payers</th></tr></thead>
            <tbody>{d.suppliers.map(s => (
              <tr key={s.id}>
                <td style={{ ...left, fontFamily: "var(--font-body)", fontWeight: 600 }}>{s.label}</td>
                <td style={{ ...left, whiteSpace: "normal", minWidth: 130 }}>{s.backlogLabel}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>at {s.backlogAsOf}</div></td>
                <td style={right}>{usd(s.backlog)}</td>
                <td style={left}>
                  <svg width={180} height={12} role="img" aria-label={`${pct(s.labCeiling)} of backlog`} style={{ display: "block" }}>
                    <rect x={0} y={2} width={Math.max(2, (s.backlog / max) * 180)} height={8} rx={2} fill="var(--border-subtle)" />
                    {s.named > 0 && <rect x={0} y={2} width={Math.max(2, (Math.min(s.named, s.backlog) / max) * 180)} height={8} rx={2} fill={C[1]} opacity={0.4} />}
                    {s.fromLabs > 0 && <rect x={0} y={2} width={Math.max(2, (Math.min(s.fromLabs, s.backlog) / max) * 180)} height={8} rx={2} fill={C[1]} />}
                  </svg>
                </td>
                <td style={right}>{s.fromLabs ? usd(s.fromLabs) : "—"}</td>
                <td style={right}>{s.fromLabs ? `≤ ${pct(s.labCeiling)}` : "—"}</td>
                <td style={right}>{s.named ? usd(s.named) : "—"}</td>
                <td style={right}>{s.named && s.backlog ? `≤ ${pct(Math.min(1, s.named / s.backlog))}` : "—"}</td>
                <td style={{ ...left, whiteSpace: "normal", minWidth: 220, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.payers.map((p, i) => <span key={i}>{i ? " · " : ""}<span style={{ color: p.tier === "lab" ? "var(--text-primary)" : undefined }}>{p.from} {usd(p.amount)}</span></span>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Legend items={[["Reported backlog", "var(--border-subtle)"], ["All named payers", `color-mix(in srgb, ${C[1]} 40%, transparent)`], ["Of which the labs", C[1]]]} />
      </VizCard>

      <VizCard eyebrow={picked ? `Agreements touching ${name(picked)}` : "Every agreement on file"} title="The agreements"
        right={<Seg label="Show" value={show} onChange={setShow} options={[["all", "All"], ["firm", "Firm"], ["checked", "Read from the document"], ["unchecked", "Still to check"]]} />}
        style={{ marginBottom: 12 }}>
        <div className="otable-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Payer → supplier</th><th style={right}>Amount</th><th style={left}>Term</th><th style={left}>Kind</th><th style={left}>Basis</th><th style={left}>What it says</th><th style={left}>Source</th></tr></thead>
            <tbody>{[...edges].sort((a, b) => b.amount - a.amount).map((e, i) => (
              <tr key={i}>
                <td style={{ ...left, fontFamily: "var(--font-body)", fontWeight: 600 }}>{name(e.from)} → {name(e.to)}</td>
                <td style={right}>{e.upTo ? "≤ " : ""}{usd(e.amount)}</td>
                <td style={left}>{e.term}</td>
                <td style={left}>{e.kind}{!e.firm && <span className="otag" style={{ marginLeft: 5 }}>not firm</span>}</td>
                <td style={left}><span className="otag">{BASIS[e.basis] || e.basis}</span>{e.checked ? <span title="Read from the cited document" style={{ marginLeft: 5, color: "var(--text-secondary)" }}>✓ read</span> : <span title="Entered from the announcement as remembered; the filing has not been put beside it" style={{ marginLeft: 5, color: "var(--text-muted)" }}>to check</span>}</td>
                <td style={{ ...left, whiteSpace: "normal", minWidth: 260, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{e.note}</td>
                <td style={{ ...left, whiteSpace: "normal", minWidth: 150 }}>{e.source?.url ? <a href={e.source.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)" }}>{e.source.title}</a> : <span style={{ color: "var(--text-muted)" }}>{e.source?.title || "—"}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </VizCard>
      <p className="onote">Hand-kept in the Research Database (data/curated/ai-flows.json, reviewed {d.reviewed || "—"}; read from {d.universe === "local" ? "its checkout" : "GitHub"}). A row marked "to check" was entered from the announcement and has not had the filing put beside it.</p>
    </div>
  );
}
