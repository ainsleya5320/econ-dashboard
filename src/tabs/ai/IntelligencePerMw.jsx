import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { fonts } from "../../lib/styles.js";
import { AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, GREEN, fin, card, note, tip, axis, chip, DenseHeader, Panel, Note, DataTable, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// INTELLIGENCE PER MEGAWATT: how much model capability a megawatt of
// data-centre power delivers. The index multiplies a model's Artificial
// Analysis Intelligence Index by the output tokens per second a chip serves it
// at per provisioned megawatt, at the best operating point that still gives
// every user 50 tokens a second, counting only frontier-class models (within
// 75% of the best score benchmarked). Rebased to 100 in the first month of
// each workload's history. Data: /api/intelligence-mw
// (server/intelligencePerMw.js); assumptions in data/ai/intelligence-mw.json
// and data/ai/gpu-econ.json. The cost side of the same throughput is the GPU
// unit-economics panel above.
// ============================================================================

const FAM = { Blackwell: GREEN, Rubin: VIOLET, AMD: RED, Hopper: AMBER };
const LINES = [["all", "Frontier", "var(--text-primary)"], ["Blackwell", "Blackwell", GREEN], ["Rubin", "Rubin", VIOLET], ["AMD", "AMD", RED], ["Hopper", "Hopper", AMBER]];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mon = ym => (ym ? `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : "—");
const k = v => (!fin(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v / 1e3).toLocaleString()}k` : Math.round(v).toLocaleString());
const quad = v => (fin(v) ? `${(v / 1e15).toFixed(1)} quadrillion` : "—");
const pill = on => ({ padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono, border: `1px solid ${on ? "#818cf8" : "var(--border-subtle)"}`, background: on ? "rgba(129,140,248,0.12)" : "transparent", color: on ? "var(--text-primary)" : "var(--text-muted)" });

export default function IntelligencePerMwPanel() {
  const phone = useIsPhone();
  const [d, setD] = useState(null), [err, setErr] = useState(null), [wl, setWl] = useState("agentic");
  useEffect(() => { fetch("/api/intelligence-mw").then(r => r.json()).then(j => (j.error ? setErr(j.error) : setD(j))).catch(e => setErr(e.message)); }, []);
  const W = d?.workloads?.[wl] || null;
  const V = useMemo(() => {
    if (!W?.base) return null;
    const rel = v => (fin(v) ? Math.round((v / W.base.value) * 1000) / 10 : null);
    const history = W.history.map(h => ({ ...h, x: h.m, ...Object.fromEntries(LINES.map(([key]) => [key, rel(h[key])])) }));
    const pts = W.combos.map(c => ({ ...c, x: c.idx, y: c.tpsPerMw, rel: rel(c.ipmw) }));
    const lead = W.combos.find(c => c.frontierClass) || null, last = history[history.length - 1];
    return { history, pts, lead, last, rel };
  }, [W]);

  if (err) return <div style={{ ...card, fontSize: 11, color: AMBER, fontFamily: fonts.mono, marginBottom: 12 }}>Intelligence per megawatt is unavailable: {err}</div>;
  if (!d || !W || !V) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginBottom: 12 }}>Loading InferenceX runs…</div>;
  const { lead, last } = V, perGwYear = lead ? lead.tpsPerMw * 1000 * 86400 * 365 : null;
  const fam = g => last?.[g];

  return (<>
    <DenseHeader
      eyebrow={`Intelligence per megawatt · ${W.label} · InferenceX × Artificial Analysis${d.stale ? " · cached" : ""}`}
      headline={lead ? <>A megawatt serves {k(lead.tpsPerMw)} tokens a second of {lead.model} (Artificial Analysis {lead.idx}) on {lead.chip}; the index stands at {Math.round(last.all)}, against 100 in {mon(W.base.m)}</> : "No frontier-class runs yet"}
      blurb={<>Power, not chips, is now the binding constraint on AI build-outs, so the useful question is how much intelligence a megawatt buys. The index multiplies a model&apos;s
        intelligence score by the tokens per second a chip serves it at per megawatt of provisioned data-centre power, holding every user to at least {d.floor} tokens a second.
        It rises when a smarter model, a newer chip or faster serving software arrives. Only frontier-class models count: within {Math.round((1 - d.band) * 100)}% of the best score benchmarked.</>}
      meta={<>SemiAnalysis InferenceX · Artificial Analysis<br />{W.runs.toLocaleString()} qualifying runs · built {d.built.slice(0, 10)}</>}
      chips={[
        chip("Index", fin(last?.all) ? Math.round(last.all) : "—", "var(--text-primary)", `${mon(W.base.m)} = 100 · frontier class`),
        chip("Tokens/s per MW", lead ? k(lead.tpsPerMw) : "—", "var(--text-primary)", lead ? `${lead.model} · ${lead.chip}` : ""),
        chip("Per gigawatt-year", perGwYear ? quad(perGwYear) : "—", "var(--text-primary)", "output tokens at that frontier"),
        chip("Frontier-class bar", `${W.bar.min}+`, "var(--text-primary)", `best benchmarked ${W.bar.top} (AA)`),
        chip("Blackwell", fin(fam("Blackwell")) ? Math.round(fam("Blackwell")) : "—", GREEN, "best on B200/B300/GB200/GB300"),
        chip("Rubin", fin(fam("Rubin")) ? Math.round(fam("Rubin")) : "—", VIOLET, "first Vera Rubin runs"),
        chip("AMD", fin(fam("AMD")) ? Math.round(fam("AMD")) : "—", RED, "best on MI300X–MI355X"),
        chip("Hopper", fin(fam("Hopper")) ? Math.round(fam("Hopper")) : "—", AMBER, "best on H100/H200"),
      ]}
    />
    <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={note}>Workload</span>
      {Object.entries(d.workloads).map(([key, w]) => <button key={key} onClick={() => setWl(key)} style={pill(wl === key)}>{w.label}</button>)}
      <span style={{ ...note, marginLeft: 6 }}>{W.note}</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="The index over time" right={`frontier and best per chip family · ${mon(W.base.m)} = 100`} style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 240)}>
          <LineChart data={V.history} margin={{ top: 6, right: 8, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="x" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={mon} minTickGap={20} />
            <YAxis tick={axis} axisLine={false} tickLine={false} />
            <ReferenceLine y={100} stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={(m, p) => { const h = p?.[0]?.payload; return h?.lead ? `${mon(m)} · leader ${h.lead.model} on ${h.lead.chip} · bar ${h.bar}+` : mon(m); }} formatter={(v, nm) => [fin(v) ? Math.round(v) : "—", nm]} />
            {LINES.map(([key, name, color]) => <Line key={key} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={key === "all" ? 2.4 : 1.4} strokeDasharray={key === "all" ? undefined : "4 3"} dot={{ r: 2 }} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 4px" }}>{LINES.map(([key, name, color]) => <span key={key} style={{ ...note, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 2, background: color, display: "inline-block" }} />{name}</span>)}</div>
      </Panel>
      <Panel title="Intelligence against tokens per megawatt" right="every model on every chip · shaded = frontier class" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 240)}>
          <ScatterChart margin={{ top: 6, right: 8, left: phone ? -10 : 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis type="number" dataKey="x" name="intelligence" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} domain={["dataMin - 2", "dataMax + 2"]} label={{ value: "Artificial Analysis Intelligence Index", position: "insideBottom", offset: -2, style: { ...axis } }} />
            <YAxis type="number" dataKey="y" name="tokens/s per MW" scale="log" domain={["auto", "auto"]} tick={axis} axisLine={false} tickLine={false} tickFormatter={k} width={48} />
            <ZAxis range={[46, 46]} />
            <ReferenceArea x1={W.bar.min} x2={W.bar.top + 2} fill="#818cf8" fillOpacity={0.07} />
            <Tooltip contentStyle={tip} cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => { const p = payload?.[0]?.payload; return p ? <div style={{ ...tip, padding: "6px 8px", fontFamily: fonts.mono, fontSize: 10.5, color: "#e2e8f0" }}>{p.model} on {p.chip}<br />score {p.idx} · {k(p.tpsPerMw)} tok/s per MW<br />{p.tps.toLocaleString()} tok/s per GPU at {p.intvty} per user · index {Math.round(p.rel)}</div> : null; }} />
            {Object.entries(FAM).map(([f, color]) => <Scatter key={f} name={f} data={V.pts.filter(p => p.family === f)} fill={color} fillOpacity={0.85} />)}
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 4px" }}>{Object.entries(FAM).map(([f, color]) => <span key={f} style={{ ...note, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: color, display: "inline-block" }} />{f}</span>)}</div>
      </Panel>
    </div>

    <Panel title="Model on chip" right={`best demonstrated run at ≥ ${d.floor} tok/s per user · index ${mon(W.base.m)} frontier = 100`}>
      <DataTable dense rows={W.combos.slice(0, 24).map(c => ({ ...c, key: `${c.ix}|${c.hw}` }))} cols={[
        { key: "model", label: "model", primary: true, render: c => <span style={{ color: c.frontierClass ? "var(--text-primary)" : "var(--text-muted)" }}>{c.model}</span> },
        { key: "chip", label: "chip", render: c => <span style={{ color: FAM[c.family] }}>{c.chip}</span> },
        { key: "idx", label: "score", render: c => <span title={c.idxSource === "live" ? "Artificial Analysis, live" : "snapshot in the config"}>{c.idx}</span> },
        { key: "tps", label: "tok/s per GPU", hide: true, render: c => c.tps.toLocaleString() },
        { key: "intvty", label: "per user", hide: true, render: c => `${Math.round(c.intvty)}/s` },
        { key: "kw", label: "kW per GPU", hide: true, render: c => <span title={`${c.ratedW} W rated (${c.powerConfidence}) × system factor × PUE`}>{c.facilityKw.toFixed(2)}</span> },
        { key: "tpsPerMw", label: "tok/s per MW", render: c => k(c.tpsPerMw) },
        { key: "rel", label: "index", render: c => (c.frontierClass ? Math.round(V.rel(c.ipmw)) : <span style={{ color: DIM }} title="below the frontier-class bar">({Math.round(V.rel(c.ipmw))})</span>) },
        { key: "w", label: "measured W", hide: true, render: c => (fin(c.measuredW) ? <span title="InferenceX's average GPU power at this operating point, against the rating">{c.measuredW} of {c.ratedW}</span> : "—") },
      ]} note={<>
        Each row is the best throughput InferenceX has shown for that model on that chip while every user still gets {d.floor}+ tokens a second; grey rows score below
        the frontier-class bar ({W.bar.min}) and are shown in brackets. Megawatts are provisioned facility power: the chip&apos;s rated board power, times
        {` ${d.systemFactor.box}×`} for an eight-GPU server or {d.systemFactor.rack}× for an NVL72-class rack (CPUs, networking, cooling inside the rack), times a PUE of {d.pue}.
        Measured GPU draw, where InferenceX logs it, usually runs well under the rating; a data centre still has to provision for the rating.
      </>} />
    </Panel>
    <Note style={{ marginTop: -6, marginBottom: 14 }}>
      What it is and is not: open-weight models on public hardware, the only combination anyone measures in the open, so Gemini on TPUs, GPT and Claude are not in it.
      Google has not published an intelligence-per-megawatt series; the nearest public number is its August 2025 report that the median Gemini Apps text prompt used
      0.24 watt-hours, 33 times less than a year earlier. Scores are Artificial Analysis&apos;s current index for each model ({d.models.filter(m => m.idxSource === "live").length} of {d.models.length} live);
      reasoning models spend some output tokens thinking, so tokens are capacity, not answers. Workloads are synthetic: InferenceX replays agent sessions and fixed
      chat prompts. Board power for B300, GB300 and Vera Rubin is reported, not yet from datasheets (Rubin&apos;s is an estimate). {d.modelsNote}
      {d.errors?.length ? <span style={{ color: AMBER }}> Missing this build: {d.errors.join("; ")}.</span> : null}
    </Note>
  </>);
}
