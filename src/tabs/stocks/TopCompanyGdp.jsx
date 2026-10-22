import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea } from "recharts";
import { finite, fx, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// THE BIGGEST COMPANY ÷ GDP — Tano Santos's concentration chart (Columbia,
// Oct 2026): the market value of the most valuable US company as a share of
// US GDP, which historically sat between 2% and 4% and is now near 15%. Also
// the top five and top ten together, and who led when. Data:
// /api/top-company-gdp (server/topCompanyGdp.js: FMP market values, FRED GDP).
// ============================================================================

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLbl = m => (m ? `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "");
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const bnT = v => (!finite(v) ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${Math.round(v)}B`);

export default function TopCompanyGdp() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [show, setShow] = useState("leader"), [early, setEarly] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/top-company-gdp").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.series) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  // before coverageFrom the candidate list misses delisted giants (pre-1984 AT&T, GM): hidden unless asked for
  const rows = useMemo(() => (d?.series || []).filter(r => early || !d.coverageFrom || r.m >= d.coverageFrom), [d, early]);
  // eras: consecutive months with the same leader
  const eras = useMemo(() => {
    const out = [];
    for (const r of rows) { const e = out.at(-1); if (e && e.leader === r.leader) { e.to = r.m; if (r.ratio > e.peak) { e.peak = r.ratio; e.peakM = r.m; } } else out.push({ leader: r.leader, name: r.leaderName, from: r.m, to: r.m, peak: r.ratio, peakM: r.m }); }
    return out;
  }, [rows]);
  if (err) return <VizCard eyebrow="Concentration" title="The biggest company ÷ GDP" finding={`Unavailable: ${err}`} />;
  if (!d) return <VizCard eyebrow="Concentration" title="The biggest company ÷ GDP" finding="Loading…" />;
  const cur = d.current?.leaders?.[0], st = d.stats || {};
  const lines = show === "leader" ? [["ratio", "Most valuable company", C[1]]] : [["ratio", "Most valuable company", C[1]], ["top5", "Top five", C[2]], ["top10", "Top ten", C[3]]];
  return (
    <div className="options-research" style={{ marginTop: 16 }}>
      <VizCard eyebrow={`US · market value ÷ nominal GDP · monthly from ${mLbl(d.coverageFrom)}`} title="The biggest company ÷ GDP"
        right={<><Seg label="Series" value={show} onChange={setShow} options={[["leader", "Leader"], ["tops", "With top 5 / 10"]]} /><Seg label="Span" value={early} onChange={setEarly} options={[[false, `From ${d.coverageFrom?.slice(0, 4) || "1984"}`], [true, "From 1962 (incomplete)"]]} /></>}
        finding={cur ? `${cur.name || cur.symbol} is worth ${bnT(cur.cap)}, ${pct(cur.pctGdp)} of US GDP. Before 2015 the leader peaked at ${pct(st.pre2015Max?.ratio)} (${st.pre2015Max?.leader}, ${mLbl(st.pre2015Max?.m)}); the median since ${d.coverageFrom?.slice(0, 4)} is ${pct(st.median)}. The shaded band is the 2–4% range Tano Santos called normal.` : ""}
        table={<MiniTable columns={[{ key: "m", label: "Month", fmt: mLbl }, { key: "leader", label: "Leader", align: "left" }, { key: "leaderCap", label: "Value", fmt: bnT }, { key: "ratio", label: "÷ GDP", fmt: v => pct(v) }, { key: "top5", label: "Top 5", fmt: v => pct(v) }, { key: "top10", label: "Top 10", fmt: v => pct(v) }]} rows={[...rows].reverse()} />}
        note={`${d.method === "price-x-shares" ? "Market values are monthly price × shares outstanding, so they carry share-count error." : "Market values: FMP historical market capitalization."} The candidate list holds companies that could have led since ${d.coverageFrom?.slice(0, 4)}; delisted giants before then (pre-1984 AT&T) are not covered. GDP is quarterly, annualized. ${d.note || ""}`}>
        <div className="okpis" style={{ marginBottom: 8 }}>
          <Kpi label="Leader now" value={pct(cur?.pctGdp)} sub={`${cur?.symbol || ""} · ${bnT(cur?.cap)}`} tone="var(--oc-pos)" />
          <Kpi label="Top 10 now" value={pct(rows.at(-1)?.top10)} sub="of US GDP" />
          <Kpi label="Median since" value={pct(st.median)} sub={`${d.coverageFrom?.slice(0, 4)} on · 90th pct ${pct(st.p90)}`} />
          <Kpi label="Previous record" value={pct(st.pre2015Max?.ratio)} sub={`${st.pre2015Max?.leader || ""} · ${mLbl(st.pre2015Max?.m)}`} />
        </div>
        <Legend items={lines.map(([, l, c]) => [l, c])} />
        <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="m" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={m => m.slice(0, 4)} minTickGap={40} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}%`} domain={[0, "auto"]} />
            <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={(m, p) => `${mLbl(m)}${p?.[0]?.payload?.leader ? ` · leader ${p[0].payload.leader}` : ""}`} formatter={(v, n) => [pct(v), lines.find(l => l[0] === n)?.[1] || n]} />
            <ReferenceArea y1={2} y2={4} fill="var(--text-muted)" fillOpacity={0.12} />
            {lines.map(([k, , c]) => <Line key={k} dataKey={k} stroke={c} strokeWidth={k === "ratio" ? 2.25 : 1.5} dot={false} isAnimationActive={false} connectNulls />)}
          </LineChart>
        </ResponsiveContainer></div>
        {eras.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Who led · reigns of six months or more; hover for dates and peak</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {eras.filter((e, i) => i === eras.length - 1 || (+e.to.slice(0, 4) - +e.from.slice(0, 4)) * 12 + (+e.to.slice(5, 7) - +e.from.slice(5, 7)) >= 5).map((e, i) => <span key={i} className="otag" title={`${e.name || e.leader}: ${mLbl(e.from)} to ${mLbl(e.to)}, peak ${pct(e.peak)} (${mLbl(e.peakM)})`}>{e.leader} {e.from.slice(0, 4)}{e.to.slice(0, 4) !== e.from.slice(0, 4) ? `–${e.to.slice(2, 4)}` : ""} · {fx(e.peak, 1)}%</span>)}
            </div>
          </div>
        )}
      </VizCard>
    </div>
  );
}
