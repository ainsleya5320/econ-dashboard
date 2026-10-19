import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend, divBg } from "../options/ui.jsx";
import { useAiPulse } from "../AiPulseTab.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// GPU MARKETS: the GPU-hour, every way it is sold, on one page.
//   ladder     per GPU, every live price on one log-dollar axis, in three
//              lanes: spot (Nebius, AWS, Azure, the GetDeploying spot median),
//              on-demand and marketplace (Vast.ai, RunPod, AWS and Azure list,
//              Shadeform and GetDeploying medians) and term (reservations,
//              the SemiAnalysis 1-year contract, CME futures). The spread from
//              the cheapest spot to the list price is how much slack there is.
//   futures    CME's Silicon Data H100 and B200 rental-index futures: the only
//              forward curve, three years out (settlement marks; personal use).
//   sold out   Shadeform: the share of instance types × regions across about
//              18 clouds that can be launched right now.
//   history    GetDeploying's weekly medians across ~40 providers for a year,
//              and the reservation term structure (CC BY 4.0).
//   hyperscal. AWS spot against on-demand by region; Azure spot, list and
//              1- and 3-year reserved.
//   hardware   AmCompute's used-GPU resale index.
// Data: /api/gpu-futures, /api/gpu-hyperscalers, /api/gpu-market-data,
// /api/nebius-spot and the AI pulse feed (Vast.ai, RunPod, SemiAnalysis).
// ============================================================================

const GPUS = ["GB300", "B300", "GB200", "B200", "H200", "H100", "MI355X", "MI300X", "A100"];
const money = v => (finite(v) ? `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}` : "—");
const usdBig = v => (finite(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const pctTxt = (v, dp = 0) => (finite(v) ? signed(v, dp, "%") : "—");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monLbl = m => (m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}` : "");
const useFeed = url => {
  const [s, setS] = useState({ d: null, err: null });
  useEffect(() => { let alive = true; fetch(url).then(r => r.json()).then(j => alive && setS(j?.error && !j.built ? { d: null, err: j.error } : { d: j, err: null })).catch(e => alive && setS({ d: null, err: e.message })); return () => { alive = false; }; }, [url]);
  return s;
};
const median = xs => { const v = xs.filter(finite).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2; };

// lanes of the ladder: family colours stay fixed whatever is present
const KIND_LABEL = { "on-demand": "On-demand", spot: "Spot", "reserved-12m": "1-yr reserved", "reserved-36m": "3-yr reserved" };
const LANES = [["spot", "Spot / preemptible", C[1]], ["list", "On-demand & marketplace", C[2]], ["term", "Reserved, contract & futures", C[3]]];

function Ladder({ rows }) {
  const [hover, setHover] = useState(null);
  const W = 760, L = 70, R = 16, rowH = 46, top = 22, lo = 0.5, hi = 24;
  const x = v => L + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (W - L - R);
  const H = top + rows.length * rowH + 8;
  const ticks = [0.5, 1, 2, 4, 8, 16];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label="Price of a GPU-hour by GPU and how it is sold">
        {ticks.map(t => (<g key={t}><line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 6} stroke="var(--border-subtle)" /><text x={x(t)} y={top - 10} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)" fontFamily="var(--font-number)">${t}</text></g>))}
        {rows.map((r, i) => {
          const y0 = top + i * rowH;
          const all = r.points.filter(p => finite(p.v) && p.v > 0);
          const span = all.length > 1 ? [Math.min(...all.map(p => p.v)), Math.max(...all.map(p => p.v))] : null;
          return (
            <g key={r.gpu}>
              <text x={L - 10} y={y0 + rowH / 2 + 4} textAnchor="end" fontSize="12.5" fontWeight="600" fill="var(--text-primary)" fontFamily="var(--font-body)">{r.gpu}</text>
              {span && <line x1={x(Math.max(lo, span[0]))} x2={x(Math.min(hi, span[1]))} y1={y0 + rowH / 2} y2={y0 + rowH / 2} stroke="var(--text-muted)" strokeWidth="1" opacity="0.5" />}
              {LANES.map(([lane, , color], k) => (
                <g key={lane}>
                  {all.filter(p => p.lane === lane).map((p, j) => {
                    const cy = y0 + 9 + k * 13, cx = x(Math.min(hi, Math.max(lo, p.v))), on = hover === `${r.gpu}|${p.label}`;
                    return (
                      <g key={j} onMouseEnter={() => setHover(`${r.gpu}|${p.label}`)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                        <circle cx={cx} cy={cy} r="10" fill="transparent" />
                        <circle cx={cx} cy={cy} r={on ? 6.5 : 5} fill={color} stroke="var(--card-bg)" strokeWidth="2" opacity={p.stale ? 0.55 : 1}><title>{`${r.gpu} · ${p.label}: ${money(p.v)} per GPU-hour${p.note ? ` · ${p.note}` : ""}`}</title></circle>
                      </g>
                    );
                  })}
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="onote" style={{ minHeight: 18, margin: "2px 0 0" }}>{hover ? (() => { const [g, lbl] = hover.split("|"); const p = rows.find(r => r.gpu === g)?.points.find(q => q.label === lbl); return p ? `${g} · ${p.label}: ${money(p.v)} per GPU-hour${p.note ? ` · ${p.note}` : ""}` : ""; })() : "Hover a dot for its source; the table view lists every price."}</div>
    </div>
  );
}

export default function GpuMarkets() {
  const fut = useFeed("/api/gpu-futures"), hyp = useFeed("/api/gpu-hyperscalers"), mkt = useFeed("/api/gpu-market-data"), neb = useFeed("/api/nebius-spot");
  const pulse = useAiPulse();
  const [futGpu, setFutGpu] = useState("both");
  const [histKind, setHistKind] = useState("on-demand");

  // ── the ladder: every price per GPU-hour we hold, by GPU and lane ──
  const ladder = useMemo(() => {
    const by = {};
    const add = (gpu, lane, label, v, note, stale) => { if (!gpu || !finite(v) || v <= 0) return; (by[gpu] ||= []).push({ lane, label, v, note, stale }); };
    for (const g of neb.d?.byGpu || []) add(g.gpu, "spot", "Nebius spot (median of regions)", g.median, `cheapest ${money(g.min)} in ${g.cheapest}`);
    const hb = hyp.d?.byGpu || {};
    for (const [g, v] of Object.entries(hb)) {
      add(g, "spot", "AWS spot (median of regions)", v.awsSpotMedian, finite(v.awsSpotMin) ? `cheapest region ${money(v.awsSpotMin)}` : "");
      add(g, "spot", "Azure spot (median of regions)", v.azureSpot);
      add(g, "list", "AWS on-demand", v.awsOd);
      add(g, "list", "Azure on-demand", v.azureOd);
      add(g, "term", "Azure 1-year reserved", v.azure1y);
      add(g, "term", "Azure 3-year reserved", v.azure3y);
    }
    const VAST = { "H100 SXM": "H100", H200: "H200", B200: "B200", "A100 SXM4": "A100" };
    for (const v of pulse?.gpu?.vast || []) add(VAST[v.gpu], "list", "Vast.ai on-demand median", v.median, `${v.n} offers`);
    const rp = pulse?.gpu?.runpod || {};
    for (const [k, v] of Object.entries(rp)) { const g = GPUS.find(x => k.toUpperCase().includes(x)); if (g && finite(typeof v === "number" ? v : v?.secure)) add(g, "list", `RunPod ${typeof v === "number" ? "" : "secure "}${k}`.trim(), typeof v === "number" ? v : v.secure); }
    add("H100", "term", "SemiAnalysis 1-year contract index", pulse?.gpu?.semi?.h100Contract, "weekly; date not always known", true);
    for (const [g, s] of Object.entries(mkt.d?.shadeform?.byGpu || {})) add(g, "list", "Shadeform list median (18 clouds)", s.listMedian, `${Math.round((s.share || 0) * 100)}% of ${s.rows} launchable now`);
    for (const [g, ts] of Object.entries(mkt.d?.getdeploying?.termStructure || {})) for (const t of ts.filter(t => [0, 1, 12, 36].includes(t.months))) add(g, t.months === 0 ? "list" : "term", t.months === 0 ? "GetDeploying on-demand median (~40 providers)" : `GetDeploying ${t.months}-month reservation median`, t.median);
    const gdSpot = (mkt.d?.getdeploying?.weekly || []).filter(w => w.kind === "spot");
    const lastWeek = gdSpot.reduce((m, w) => (w.week > m ? w.week : m), "");
    for (const w of gdSpot.filter(w => w.week === lastWeek)) add(w.gpu, "spot", "GetDeploying spot median", w.median, `week of ${w.week}`);
    for (const [g, curve] of Object.entries(fut.d?.latest?.curves || {})) { const front = curve.find(c => finite(c.settle)); if (front) add(g, "term", `CME futures, ${front.label} contract`, front.settle, `settlement ${fut.d.latest.tradeDate}${front.volume ? "" : ", no trades yet (a mark)"}`); }
    return GPUS.filter(g => (by[g] || []).length).map(g => ({ gpu: g, points: by[g] }));
  }, [neb.d, hyp.d, mkt.d, fut.d, pulse]);
  const ladderRows = ladder.flatMap(r => r.points.map(p => ({ gpu: r.gpu, lane: LANES.find(l => l[0] === p.lane)[1], label: p.label, v: p.v, note: p.note || "" })));

  // ── headline ──
  const spotOf = g => { const r = ladder.find(x => x.gpu === g); const s = r?.points.filter(p => p.lane === "spot").map(p => p.v) || []; return s.length ? Math.min(...s) : null; };
  const listOf = g => median(ladder.find(x => x.gpu === g)?.points.filter(p => p.lane === "list").map(p => p.v) || []);
  const sf = mkt.d?.shadeform?.byGpu || {};
  const soldOut = GPUS.filter(g => sf[g]?.rows >= 5 && sf[g].share === 0);
  const yoy = mkt.d?.getdeploying?.yoy?.H100;
  const h100fut = fut.d?.latest?.curves?.H100;

  // ── futures chart ──
  const futData = useMemo(() => {
    const cur = fut.d?.latest?.curves || {}, dates = fut.d?.dates || [];
    const first = dates.length > 1 ? dates[0] : null, firstC = first ? fut.d.curves?.[first] || {} : {};
    const months = [...new Set(Object.values(cur).flatMap(c => c.map(x => x.month)))].sort();
    return { first, months: months.map(m => ({ m, H100: cur.H100?.find(x => x.month === m)?.settle ?? null, B200: cur.B200?.find(x => x.month === m)?.settle ?? null, H100was: (firstC.H100 || []).find(x => x[0] === m)?.[1] ?? null, B200was: (firstC.B200 || []).find(x => x[0] === m)?.[1] ?? null })) };
  }, [fut.d]);

  // ── availability bars ──
  const avail = GPUS.filter(g => sf[g]?.rows).map(g => ({ gpu: g, share: Math.round((sf[g].share || 0) * 100), available: sf[g].available, rows: sf[g].rows, listMedian: sf[g].listMedian }));
  const availHist = useMemo(() => {
    const h = mkt.d?.shadeform?.history || [];
    const days = [...new Set(h.map(r => r.d))].sort();
    return days.map(d => Object.fromEntries([["d", d], ...h.filter(r => r.d === d).map(r => [r.gpu, Math.round((r.share || 0) * 100)])]));
  }, [mkt.d]);

  // ── a year of weekly medians ──
  const gd = mkt.d?.getdeploying;
  const gdGpus = ["B300", "B200", "H200", "H100", "A100"].filter(g => (gd?.gpus || []).includes(g));
  const gdWeekly = useMemo(() => {
    const rows = (gd?.weekly || []).filter(w => w.kind === histKind);
    const weeks = [...new Set(rows.map(w => w.week))].sort();
    return weeks.map(wk => Object.fromEntries([["week", wk], ...gdGpus.map(g => [g, rows.find(w => w.week === wk && w.gpu === g)?.median ?? null])]));
  }, [gd, histKind, gdGpus.join()]);

  const resale = mkt.d?.resale;
  const awsRows = (hyp.d?.aws?.instances || []).flatMap(i => (i.regions || []).map(r => ({ type: i.type, gpu: i.gpu, ...r })));
  const headParts = [
    finite(spotOf("H100")) && finite(listOf("H100")) ? `An H100 hour costs ${money(spotOf("H100"))} at the cheapest spot price we track and ${money(listOf("H100"))} at the median of the list prices` : null,
    finite(spotOf("B200")) && finite(listOf("B200")) ? `B200 ${money(spotOf("B200"))} spot against ${money(listOf("B200"))} list` : null,
    soldOut.length ? `nothing is launchable right now on Shadeform for ${soldOut.join(", ")}` : null,
    yoy ? `H100 on-demand is ${pctTxt(yoy.chg)} on a year ago across ~40 providers` : null,
    h100fut?.length ? `CME prices H100 at ${money(h100fut[0]?.settle)} for ${h100fut[0]?.label} and ${money(h100fut.at(-1)?.settle)} by ${h100fut.at(-1)?.label}` : null,
  ].filter(Boolean);
  const loading = !neb.d && !hyp.d && !mkt.d && !fut.d;
  if (loading) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading GPU market prices…</p></div></div>;

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      {headParts.length > 0 && <p className="ohead-line">{headParts.join("; ")}.</p>}
      <div className="okpis">
        {["H100", "H200", "B200", "B300"].filter(g => ladder.some(r => r.gpu === g)).map(g => (
          <Kpi key={g} label={`${g} spot · list`} value={`${money(spotOf(g))} · ${money(listOf(g))}`} sub={finite(spotOf(g)) && finite(listOf(g)) ? `spot is ${Math.round((spotOf(g) / listOf(g)) * 100)}% of list${sf[g]?.rows ? ` · ${Math.round((sf[g].share || 0) * 100)}% launchable` : ""}` : ""} />
        ))}
        {h100fut?.length > 0 && <Kpi label="CME H100 front" value={money(h100fut[0]?.settle)} sub={`${h100fut[0]?.label} · ${fut.d.latest.tradeDate}${h100fut[0]?.volume ? "" : " · mark, no trades"}`} />}
        {yoy && <Kpi label="H100 on-demand, 1 year" value={pctTxt(yoy.chg)} sub={`${money(yoy.yearAgo)} → ${money(yoy.now)} (median)`} />}
        {resale?.series?.length > 0 && <Kpi label="Used-GPU resale index" value={fx(resale.series.at(-1).index, 0)} sub={`${resale.series.at(-1).month} · base ${resale.base || 100}`} />}
      </div>

      <VizCard eyebrow="Every price we hold for an hour of one GPU · log scale · USD" title="The price ladder"
        finding={`Each row is a GPU; the three lanes are how the hour is sold: spot (reclaimable, market-priced), on-demand and marketplace list, and term (reservations, contracts, futures). A wide row means spare capacity is being dumped below list; a narrow one means even spot has caught up with list.`}
        table={<MiniTable columns={[{ key: "gpu", label: "GPU" }, { key: "lane", label: "Sold as", align: "left" }, { key: "label", label: "Source", align: "left" }, { key: "v", label: "$ / GPU-hr", fmt: money }, { key: "note", label: "Note", align: "left" }]} rows={ladderRows} maxHeight={480} />}
        note="Sources: Nebius billing API; AWS spot.json and on-demand price maps; Azure Retail Prices API; Vast.ai and RunPod; Shadeform; GetDeploying (CC BY 4.0); SemiAnalysis; CME settlements (personal use). Per GPU-hour throughout: instance prices are divided by their GPU count. Faded dots are older readings.">
        <Legend items={LANES.map(([, label, color]) => [label, color])} />
        <Ladder rows={ladder} />
      </VizCard>

      <div className="ogrid ogrid-2" style={{ marginTop: 12 }}>
        <VizCard eyebrow={`CME · Silicon Data GPU rental index futures · settlement ${fut.d?.latest?.tradeDate || "—"}`} title="The forward curve"
          right={<Seg label="GPU" value={futGpu} onChange={setFutGpu} options={[["both", "Both"], ["H100", "H100"], ["B200", "B200"]]} />}
          finding={fut.d?.latest ? `Futures on the Silicon Data rental index, settled monthly to ${monLbl(futData.months.at(-1)?.m)}. ${["H100", "B200"].map(g => { const c = fut.d.latest.curves?.[g] || []; return c.length ? `${g}: ${money(c[0].settle)} near, ${money(c.at(-1).settle)} far (${pctTxt((c.at(-1).settle / c[0].settle - 1) * 100)})` : null; }).filter(Boolean).join("; ")}. A downward-sloping curve is the market pricing cheaper compute ahead.${(fut.d.latest.curves?.H100 || []).every(c => !c.volume) ? " No contract has traded yet: these are the exchange's settlement marks." : ""}` : fut.err ? `CME settlements unavailable: ${fut.err}` : "Loading CME settlements…"}
          table={<MiniTable columns={[{ key: "m", label: "Contract", fmt: monLbl }, { key: "H100", label: "H100", fmt: money }, { key: "B200", label: "B200", fmt: money }, ...(futData.first ? [{ key: "H100was", label: `H100 ${futData.first}`, fmt: money }, { key: "B200was", label: `B200 ${futData.first}`, fmt: money }] : [])]} rows={futData.months} />}
          note="CME Group settlement data, for personal use under CME's terms; kept on this machine and not published.">
          <Legend items={[...(futGpu !== "B200" ? [["H100", C[1]]] : []), ...(futGpu !== "H100" ? [["B200", C[2]]] : []), ...(futData.first ? [[`first settlement (${futData.first})`, "var(--text-muted)", true]] : [])]} />
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={futData.months} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="m" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLbl} minTickGap={30} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v.toFixed(1)}`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={monLbl} formatter={(v, n) => [money(v), n]} />
              {futGpu !== "B200" && futData.first && <Line dataKey="H100was" name={`H100, ${futData.first}`} stroke={C[1]} strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />}
              {futGpu !== "H100" && futData.first && <Line dataKey="B200was" name={`B200, ${futData.first}`} stroke={C[2]} strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />}
              {futGpu !== "B200" && <Line dataKey="H100" name="H100" stroke={C[1]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />}
              {futGpu !== "H100" && <Line dataKey="B200" name="B200" stroke={C[2]} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>

        <VizCard eyebrow={`Shadeform · instance types × regions across ~18 clouds · ${mkt.d?.shadeform?.asOf ? new Date(mkt.d.shadeform.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }) : "—"}`} title="Can you launch one right now?"
          finding={avail.length ? `${avail.map(a => `${a.gpu} ${a.share}% (${a.available} of ${a.rows})`).join(", ")}. A GPU at 0% is sold out everywhere this aggregator can see: the quantity side of the price.` : mkt.err ? `Shadeform unavailable: ${mkt.err}` : "Loading availability…"}
          table={<MiniTable columns={[{ key: "gpu", label: "GPU" }, { key: "share", label: "Launchable", fmt: v => `${v}%` }, { key: "available", label: "Available" }, { key: "rows", label: "Listed" }, { key: "listMedian", label: "List median", fmt: money }]} rows={avail} />}
          note={availHist.length > 1 ? undefined : "The availability history starts today and grows with each refresh."}>
          <div className="ochart" style={{ height: Math.max(150, avail.length * 30 + 30) }}><ResponsiveContainer width="100%" height="100%">
            <BarChart data={avail} layout="vertical" margin={{ top: 4, right: 30, left: 6, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid stroke="var(--border-subtle)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="gpu" tick={axisTick} tickLine={false} axisLine={false} width={52} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n, p) => [`${v}% (${p.payload.available} of ${p.payload.rows})`, "Launchable now"]} cursor={{ fill: "var(--bg-subtle)" }} />
              <Bar dataKey="share" isAnimationActive={false} radius={[0, 4, 4, 0]} minPointSize={2}>{avail.map(a => <Cell key={a.gpu} fill={a.share === 0 ? "var(--oc-pos)" : C[1]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer></div>
          {availHist.length > 1 && (<>
            <div className="onote" style={{ margin: "4px 0 0" }}>Share launchable, daily</div>
            <div className="ochart-sm"><ResponsiveContainer width="100%" height="100%">
              <LineChart data={availHist} margin={{ top: 6, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="d" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} minTickGap={30} />
                <YAxis domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [`${v}%`, n]} />
                {avail.slice(0, 5).map((a, i) => <Line key={a.gpu} dataKey={a.gpu} stroke={C[i + 1]} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer></div>
          </>)}
        </VizCard>
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`GetDeploying · weekly median across ~40 providers · log scale · ${gd?.attribution || "CC BY 4.0"}`} title="A year of prices"
          right={<Seg label="Kind" value={histKind} onChange={setHistKind} options={(gd?.kinds || ["on-demand"]).filter(k => KIND_LABEL[k]).map(k => [k, KIND_LABEL[k]])} />}
          finding={gd ? `${Object.entries(gd.yoy || {}).filter(([g]) => gdGpus.includes(g)).map(([g, y]) => (finite(y.chg) ? `${g} ${pctTxt(y.chg)} on a year (${money(y.yearAgo)} → ${money(y.now)})` : finite(y.chgSinceFirst) ? `${g} ${pctTxt(y.chgSinceFirst)} since it was first listed (${y.firstWeek})` : null)).filter(Boolean).join("; ")} (on-demand medians). Medians across providers move slowly; the spot and spare-capacity feeds above move first.` : mkt.err ? `GetDeploying unavailable: ${mkt.err}` : "Loading…"}
          table={<MiniTable columns={[{ key: "week", label: "Week" }, ...gdGpus.map(g => ({ key: g, label: g, fmt: money }))]} rows={[...gdWeekly].reverse()} />}
          note={<>Data: <a href="https://getdeploying.com/gpus" target="_blank" rel="noreferrer">GetDeploying, GPU rental price history</a>, licensed <a href={gd?.license || "https://creativecommons.org/licenses/by/4.0/"} target="_blank" rel="noreferrer">CC BY 4.0</a>; medians of each provider&apos;s listed prices, the latest week partial.</>}>
          <Legend items={gdGpus.map((g, i) => [g, C[i + 1]])} />
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={gdWeekly} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={w => monLbl(w)} minTickGap={40} />
              <YAxis scale="log" domain={[0.5, 24]} ticks={[0.5, 1, 2, 4, 8, 16]} allowDataOverflow tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} formatter={(v, n) => [money(v), n]} />
              {gdGpus.map((g, i) => <Line key={g} dataKey={g} stroke={C[i + 1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>

        <VizCard eyebrow={`${resale?.attribution || "AmCompute GPU Resale Index"} · monthly`} title="Secondhand hardware"
          finding={resale?.series?.length ? `The index is ${fx(resale.series.at(-1).index, 0)} (${resale.series.at(-1).month}; base ${resale.base || "100"})${resale.series.length > 1 ? `, ${pctTxt((resale.series.at(-1).index / resale.series[0].index - 1) * 100)} since ${resale.series[0].month}` : ""}. ${resale.headline ? `Used H100 SXM board about ${usdBig(resale.headline.usedH100Sxm)}, 8-GPU HGX node about ${usdBig(resale.headline.hgxNode)}.` : ""} Falling used prices are capacity coming back to market, or the next generation making the old one cheaper.` : mkt.err ? `Resale index unavailable: ${mkt.err}` : "Loading…"}
          table={resale?.series ? <MiniTable columns={[{ key: "month", label: "Month" }, { key: "index", label: "Index", fmt: v => fx(v, 1) }]} rows={[...resale.series].reverse()} /> : null}
          note={<>Data: <a href={resale?.url || "https://www.amcompute.com/gpu-resale-index"} target="_blank" rel="noreferrer">American Compute, GPU Resale Index</a>{resale?.headline?.asOf ? `; used-H100 prices from its Rack Report, data through ${resale.headline.asOf}` : ""}.</>}>
          <div className="ochart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={resale?.series || []} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={monLbl} minTickGap={30} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={monLbl} formatter={v => [fx(v, 1), "Index"]} />
              <ReferenceLine y={resale?.base || 100} stroke="var(--text-muted)" strokeDasharray="4 3" />
              <Line dataKey="index" name="Index" stroke={C[1]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: C[1] }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <VizCard eyebrow={`AWS spot.json ${hyp.d?.aws?.spotAsOf ? `· ${hyp.d.aws.spotAsOf}` : ""} · per GPU-hour`} title="Hyperscaler spot against list, by region"
        finding={awsRows.length ? `Spot as a share of on-demand: under 40% is a region with spare GPUs, near 100% is one without. ${(hyp.d?.azure?.skus || []).filter(s => s.spotIsReal === false).map(s => s.gpu).join(", ") ? `Azure's ${(hyp.d.azure.skus || []).filter(s => s.spotIsReal === false).map(s => s.gpu).join(", ")} "spot" meters equal list, so no real spot market there.` : ""}` : hyp.err ? `Hyperscaler prices unavailable: ${hyp.err}` : "Loading…"}
        note="AWS: spot from the public spot.json, on-demand from AWS's price maps for five regions. Azure: Retail Prices API; reserved prices are the term total spread over its hours.">
        <div className="otable-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr>{["Instance", "GPU", "Region", "Spot / GPU", "On-demand / GPU", "Spot ÷ list"].map((h, i) => <th key={h} style={{ textAlign: i < 3 ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>{awsRows.sort((a, b) => GPUS.indexOf(a.gpu) - GPUS.indexOf(b.gpu) || (a.spotPerGpu ?? 99) - (b.spotPerGpu ?? 99)).map((r, i) => (
              <tr key={i}>
                <td style={{ textAlign: "left" }}>{r.type}</td><td style={{ textAlign: "left" }}><strong>{r.gpu}</strong></td><td style={{ textAlign: "left" }}>{r.region}</td>
                <td style={{ textAlign: "right" }}>{money(r.spotPerGpu)}</td><td style={{ textAlign: "right" }}>{money(r.odPerGpu)}</td>
                <td style={{ textAlign: "right", background: divBg(finite(r.ratio) ? (r.ratio - 0.5) * 2 : null) }}>{finite(r.ratio) ? `${Math.round(r.ratio * 100)}%` : "—"}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        {(hyp.d?.azure?.skus || []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Azure, median of regions, per GPU-hour</div>
            <MiniTable columns={[{ key: "sku", label: "SKU", align: "left" }, { key: "gpu", label: "GPU" }, { key: "spotPerGpuMedian", label: "Spot", fmt: (v, r) => (r.spotIsReal === false ? "= list" : money(v)) }, { key: "odPerGpuMedian", label: "On-demand", fmt: money }, { key: "r1yPerGpuMedian", label: "1-yr reserved", fmt: money }, { key: "r3yPerGpuMedian", label: "3-yr reserved", fmt: money }]} rows={hyp.d.azure.skus} />
          </div>
        )}
      </VizCard>
    </div>
  );
}
