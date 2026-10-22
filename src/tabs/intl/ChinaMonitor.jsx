import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// CHINA: OBJECTIVE VERSUS COST — Li Lu's reading of China's development model
// (Columbia Graham & Dodd event, Oct 2026): every decade or so Beijing sets an
// objective and some other part of the economy pays for it. Since about 2021
// the objective has been moving manufacturing up from low/mid-end to mid/high-
// end and technology self-sufficiency (chips above all); the cost has been the
// middle-class household balance sheet, through housing. The page sets the two
// sides next to each other from 2016, each series marked at 2021 where the
// paths diverged, and tests his figures against the data.
// Data: /api/china-monitor (server/chinaMonitor.js: FRED/BIS, DBnomics mirrors
// of NBS and PBoC releases, World Bank).
// ============================================================================

const SIDES = [["cost", "The cost: households and housing", "var(--oc-pos)"], ["objective", "The objective: manufacturing and technology", C[1]], ["context", "Context", "var(--text-secondary)"]];
const VERDICT = { consistent: ["consistent", C[1]], partly: ["partly", "var(--oc-4)"], "not supported": ["not supported", "var(--oc-pos)"], "no data": ["no data", "var(--text-muted)"] };
const num = (v, unit) => (!finite(v) ? "—" : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}`) + (unit && /%/.test(unit) && finite(v) ? "%" : "");
const per = p => String(p || "");
const toX = p => { const s = per(p); if (/^\d{4}-\d{2}$/.test(s)) return +s.slice(0, 4) + (+s.slice(5, 7) - 0.5) / 12; if (/^\d{4}-Q\d$/.test(s)) return +s.slice(0, 4) + (+s.slice(6) - 0.5) / 4; if (/^\d{4}$/.test(s)) return +s + 0.5; return null; };

function Mini({ s, color, from }) {
  const data = (s.points || []).map(([p, v]) => ({ x: toX(p), p, v })).filter(r => finite(r.x) && finite(r.v) && r.x >= from);
  const pctUnit = /%/.test(s.unit || "") || /yoy/.test(s.transform || "");
  return (
    <section className="ocard" style={{ padding: "10px 12px 6px" }}>
      <div className="ocard-eyebrow" title={`${s.source}${s.transform ? ` · ${s.transform}` : ""}`}>{s.freq === "M" ? "monthly" : s.freq === "Q" ? "quarterly" : "annual"} · {s.transform || s.unit}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <h3 className="ocard-title" style={{ fontSize: 13 }}>{s.label}</h3>
        <strong style={{ font: "600 15px var(--font-body)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{num(s.latest?.value, s.unit)}</strong>
      </div>
      <div className="onote" style={{ margin: "0 0 2px" }}>
        {per(s.latest?.period)}{finite(s.chgFromPeak) ? ` · ${signed(s.chgFromPeak, 0, "%")} from peak (${per(s.peak?.period)})` : ""}{finite(s.chg2021) ? ` · ${signed(s.chg2021, 0, "%")} vs 2021` : ""}
      </div>
      <div className="ochart-sm" style={{ height: 110 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => String(Math.floor(v))} minTickGap={24} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={38} domain={["auto", "auto"]} tickFormatter={v => num(v)} />
          <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={(x, p) => p?.[0]?.payload?.p || ""} formatter={v => [`${num(v, s.unit)}${pctUnit ? "" : s.unit ? ` ${s.unit}` : ""}`, s.label]} />
          <ReferenceLine x={2021} stroke="var(--text-muted)" strokeDasharray="3 3" />
          {pctUnit && <ReferenceLine y={0} stroke="var(--text-muted)" />}
          {/index/.test(s.transform || "") && <ReferenceLine y={100} stroke="var(--text-muted)" />}
          <Line dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer></div>
      {s.url && <div className="onote" style={{ margin: 0 }}><a href={s.url} target="_blank" rel="noreferrer">{s.source}</a></div>}
    </section>
  );
}

export default function ChinaMonitor() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [from, setFrom] = useState(2016);
  useEffect(() => {
    let alive = true;
    fetch("/api/china-monitor").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.series) setErr(j.error); else setD(j); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  // the hero: three series per side, each rebased so 2021 = 100 (an index series as is; a level by its 2021
  // value or average), on a log scale so a halving and a quadrupling read alike
  const HERO = [["cost", "rpp_bis_real", "Home prices, real (BIS)"], ["cost", "resid_sales_value", "Home sales value"], ["cost", "fai_re_index", "Property investment"],
    ["objective", "fai_mfg_index", "Manufacturing investment"], ["objective", "ic_output", "Chip output"], ["objective", "ev_sales", "EV sales"]];
  const hero = useMemo(() => {
    const idx = HERO.map(([side, id, label]) => {
      const s = (d?.series || []).find(x => x.id === id); if (!s) return null;
      const indexed = /2021\s*=\s*100/.test(s.transform || "");
      const base = indexed ? 100 : (() => { const v = s.points.filter(p => String(p[0]).startsWith("2021")).map(p => p[1]).filter(finite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
      if (!finite(base) || base <= 0) return null;
      return { id, side, label, points: s.points.map(([p, v]) => [p, finite(v) ? (v / base) * 100 : null]) };
    }).filter(Boolean);
    const xs = [...new Set(idx.flatMap(s => s.points.map(p => toX(p[0]))))].filter(x => finite(x) && x >= from).sort((a, b) => a - b);
    return { idx, rows: xs.map(x => ({ x, ...Object.fromEntries(idx.map(s => [s.id, s.points.find(p => toX(p[0]) === x)?.[1] ?? null])) })) };
  }, [d, from]);
  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">The China monitor is unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading China data…</p></div></div>;
  const by = side => (d.series || []).filter(s => s.side === side);
  const checks = d.checks || [];
  const costIdx = hero.idx.filter(s => s.side === "cost"), objIdx = hero.idx.filter(s => s.side === "objective");

  return (
    <div className="options-research">
      <p className="ohead-line">
        Li Lu&apos;s reading of China: each decade Beijing picks an objective and another part of the economy pays for it. Since 2021 the objective has been higher-end manufacturing and technology self-sufficiency; the cost has fallen on households through housing. Of his {checks.length} figures, {["consistent", "partly", "not supported", "no data"].map(v => [v, checks.filter(c => c.verdict === v).length]).filter(([, n]) => n).map(([v, n]) => `${n} ${v === "consistent" ? "check out" : v === "partly" ? "partly hold" : v === "no data" ? "can't be tested" : "aren't supported"}`).join(", ")}.
      </p>
      <div className="okpis">
        {[...by("cost").slice(0, 3), ...by("objective").slice(0, 3)].map(s => (
          <Kpi key={s.id} label={s.label} value={num(s.latest?.value, s.unit)} sub={`${per(s.latest?.period)}${finite(s.chg2021) ? ` · ${signed(s.chg2021, 0, "%")} vs 2021` : finite(s.chgFromPeak) ? ` · ${signed(s.chgFromPeak, 0, "%")} from peak` : ""}`} tone={s.side === "cost" ? "var(--oc-pos)" : C[1]} />
        ))}
      </div>

      {hero.idx.length >= 2 && (
        <VizCard eyebrow="Indexed so 2021 = 100" title="The divergence"
          right={<Seg label="From" value={from} onChange={setFrom} options={[[2010, "2010"], [2016, "2016"], [2019, "2019"]]} />}
          finding={`Warm lines are the cost side, cool lines the objective side, all at 2021 = 100 on a log scale. Latest: ${hero.idx.map(s => `${s.label} ${num(s.points.filter(p => finite(p[1])).at(-1)?.[1])}`).join("; ")}.`}
          table={<MiniTable columns={[{ key: "x", label: "Period", fmt: v => (finite(v) ? `${Math.floor(v)}-${String(Math.round((v % 1) * 12 + 0.5)).padStart(2, "0")}` : "—") }, ...hero.idx.map(s => ({ key: s.id, label: s.label, fmt: v => num(v) }))]} rows={[...hero.rows].reverse()} />}>
          <Legend items={[...costIdx.map((s, i) => [s.label, ["var(--oc-pos)", "var(--oc-2)", "var(--oc-4)"][i]]), ...objIdx.map((s, i) => [s.label, [C[1], C[3], C[1]][i], i === 2])]} />
          <div className="ochart" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={hero.rows} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => String(Math.floor(v))} minTickGap={30} />
              <YAxis scale="log" domain={[25, 500]} ticks={[25, 50, 100, 200, 400]} allowDataOverflow tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={v => String(Math.floor(v))} formatter={(v, n) => [num(v), hero.idx.find(s => s.id === n)?.label || n]} />
              <ReferenceLine y={100} stroke="var(--text-muted)" />
              <ReferenceLine x={2021} stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "2021", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />
              {costIdx.map((s, i) => <Line key={s.id} dataKey={s.id} stroke={["var(--oc-pos)", "var(--oc-2)", "var(--oc-4)"][i]} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: ["var(--oc-pos)", "var(--oc-2)", "var(--oc-4)"][i] }} isAnimationActive={false} connectNulls />)}
              {objIdx.map((s, i) => <Line key={s.id} dataKey={s.id} stroke={[C[1], C[3], C[1]][i]} strokeDasharray={i === 2 ? "5 3" : undefined} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: [C[1], C[3], C[1]][i] }} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      )}

      {checks.length > 0 && (
        <VizCard eyebrow="His figures against the data" title="Checking Li Lu's numbers" style={{ marginTop: 12 }}
          finding="Each figure from the talk, paraphrased, next to what the series show. Several are household-survey or industry estimates without an official monthly series; those are marked.">
          <div className="otable-wrap"><table className="otable">
            <thead><tr><th style={{ textAlign: "left" }}>He said</th><th style={{ textAlign: "left" }}>The data</th><th style={{ textAlign: "left" }}>Verdict</th></tr></thead>
            <tbody>{checks.map((c, i) => { const [v, col] = VERDICT[c.verdict] || [c.verdict, "var(--text-muted)"]; return (
              <tr key={i}><td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 220 }}>{c.claim}</td><td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 260 }}>{c.ours}</td><td style={{ textAlign: "left" }}><span className="otag" style={{ borderColor: col, color: "var(--text-primary)" }}>{v}</span></td></tr>
            ); })}</tbody>
          </table></div>
        </VizCard>
      )}

      {SIDES.map(([side, title, color]) => by(side).length > 0 && (
        <div key={side} style={{ marginTop: 12 }}>
          <div className="ocard-eyebrow" style={{ margin: "0 0 6px" }}>{title}</div>
          <div className="ogrid ogrid-3">{by(side).map(s => <Mini key={s.id} s={s} color={color} from={from} />)}</div>
        </div>
      ))}
      {(d.missing || []).length > 0 && <p className="onote">Not tracked (no free, scriptable source): {d.missing.map(m => `${m.metric} (${m.reason})`).join("; ")}.</p>}
      {d.note && <p className="onote">{d.note}</p>}
    </div>
  );
}
