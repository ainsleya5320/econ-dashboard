import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, fx, signed, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, MiniTable, Kpi, RangeStrip, Seg, Legend } from "../options/ui.jsx";
import { useAiPulse } from "../AiPulseTab.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// NEBIUS SPOT: the live, market-clearing price of a preemptible GPU-hour, by
// GPU and region (the feed behind nebius.com/spot-prices). Nebius moves each
// market's price between a floor and a ceiling with demand, so the prices
// read spare capacity directly: parked at the floor is slack, pinned at the
// ceiling is sold out. Shown: the cross-region median per GPU over 30 days
// (log scale, so a doubling looks the same at $1 and at $9), one GPU's
// regions with their range, and every live market with where it sits in its
// own 30-day range, beside Vast.ai's on-demand marketplace for context.
// Data: /api/nebius-spot (server/nebiusSpot.js); hourly history is limited
// to 30 days by the API, and data/ai/nebius-spot-daily.json keeps the rest.
// ============================================================================

const money = v => (finite(v) ? `$${v.toFixed(2)}` : "—");
const chgTxt = v => (finite(v) ? `${signed(v, 0, "%")}` : "—");
const dayHour = t => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" }) + " UTC";
const dayOnly = t => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const VAST = { H100: "H100 SXM", H200: "H200", B200: "B200" };
const STATE = { floor: ["at floor", "var(--oc-1)"], ceiling: ["at ceiling", "var(--oc-pos)"], between: ["between", "var(--text-muted)"] };

// a step series sampled onto shared hourly timestamps (the API sends change points)
function sampleSteps(series, ts) {
  return ts.map(t => { let v = null; for (const p of series) { if (p[0] > t) break; v = p[1]; } return v; });
}

export default function NebiusSpot() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [gpu, setGpu] = useState(null), [span, setSpan] = useState("launch"), [grain, setGrain] = useState("day");
  const pulse = useAiPulse();
  useEffect(() => {
    let alive = true;
    fetch("/api/nebius-spot").then(r => r.json()).then(j => { if (!alive) return; if (j.error && !j.markets) setErr(j.error); else { setD(j); setGpu(g => g || j.byGpu?.[0]?.gpu || null); } }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);

  const launch = d?.dynamicSince ? Date.parse(d.dynamicSince) : null;
  const from = span === "launch" && launch ? launch - 864e5 : Date.now() - (span === "launch" ? 30 : span) * 864e5;
  const spanOpts = [[7, "7d"], ...(launch ? [["launch", "Since market pricing"]] : []), [30, "30d"]];
  // chart 1: the cross-region median per GPU on one hourly grid
  const medianChart = useMemo(() => {
    if (!d) return [];
    const ts = [...new Set(d.byGpu.flatMap(g => g.medSeries.map(p => p[0])))].filter(t => t >= from).sort((a, b) => a - b);
    const cols = d.byGpu.map(g => sampleSteps(g.medSeries, ts));
    return ts.map((t, i) => Object.fromEntries([["t", t], ...d.byGpu.map((g, k) => [g.gpu, cols[k][i]])]));
  }, [d, from]);
  // chart 1, daily: the time-weighted daily mean, averaged across a GPU's regions (complete UTC days, from the archive)
  const dailyChart = useMemo(() => {
    if (!d?.daily) return [];
    const by = new Map();
    for (const r of d.daily) { if (Date.parse(`${r.d}T12:00:00Z`) < from) continue; const k = r.d; const g = by.get(k) || {}; (g[r.gpu] ||= []).push(r.mean); by.set(k, g); }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dd, g]) => Object.fromEntries([["t", Date.parse(`${dd}T12:00:00Z`)], ...Object.entries(g).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])]));
  }, [d, from]);
  // chart 2: one GPU's regions
  const sel = d?.byGpu.find(g => g.gpu === gpu);
  const regions = useMemo(() => (d ? d.markets.filter(m => m.gpu === gpu) : []), [d, gpu]);
  const regionChart = useMemo(() => {
    const ts = [...new Set(regions.flatMap(m => m.points.map(p => p[0])))].filter(t => t >= from).sort((a, b) => a - b);
    const cols = regions.map(m => sampleSteps(m.points, ts));
    return ts.map((t, i) => Object.fromEntries([["t", t], ...regions.map((m, k) => [m.region, cols[k][i]])]));
  }, [regions, from]);

  if (err) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Nebius spot prices are unavailable: {err}</p></div></div>;
  if (!d) return <div className="options-research"><div className="ocard"><p className="ocard-finding">Loading Nebius spot prices…</p></div></div>;

  const vast = Object.fromEntries((pulse?.gpu?.vast || []).filter(v => finite(v.median)).map(v => [v.gpu, v.median]));
  const atCeil = d.byGpu.filter(g => g.atCeil > 0), atFloor = d.byGpu.filter(g => g.atFloor > 0 && g.atFloor === g.regions);
  const mover = [...d.byGpu].filter(g => finite(g.chg7d)).sort((a, b) => Math.abs(b.chg7d) - Math.abs(a.chg7d))[0];
  const nCeil = d.markets.filter(m => m.state === "ceiling").length, nFloor = d.markets.filter(m => m.state === "floor").length;
  const tightWord = d.tight >= 0.25 ? "tight" : d.tight <= -0.25 ? "slack" : "mixed";
  const headline = [
    atCeil.length ? `${atCeil.map(g => `${g.gpu} is at its market-pricing high in ${g.atCeil} of ${g.regions} region${g.regions > 1 ? "s" : ""} (${money(g.ceil)})`).join("; ")}` : null,
    atFloor.length ? `${atFloor.map(g => g.gpu).join(" and ")} ${atFloor.length > 1 ? "sit" : "sits"} at the floor everywhere (${money(atFloor[0].floor)})` : null,
    mover ? `biggest weekly move: ${mover.gpu} median ${chgTxt(mover.chg7d)}` : null,
  ].filter(Boolean).join("; ");
  const ticks = [0.5, 1, 2, 4, 8, 16];

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <p className="ohead-line">
        <span className="otag" style={{ marginRight: 6 }}>{tightWord}</span>
        {headline}. {nCeil} of {d.markets.length} markets are pinned at their ceiling and {nFloor} parked at their floor.
      </p>
      <div className="okpis">
        {d.byGpu.map(g => (
          <Kpi key={g.gpu} label={`${g.gpu} spot`} value={money(g.median)}
            sub={`${g.regions > 1 ? `${money(g.min)}–${money(g.max)} · ` : ""}7d ${chgTxt(g.chg7d)}${finite(g.vsFixed) ? ` · ${chgTxt(g.vsFixed)} vs fixed ${money(g.fixed)}` : ""}${VAST[g.gpu] && finite(vast[VAST[g.gpu]]) ? ` · Vast ${money(vast[VAST[g.gpu]])}` : ""}`}
            tone={g.atCeil ? "var(--oc-pos)" : g.atFloor === g.regions ? "var(--oc-1)" : undefined}
            title={`Cross-region median of ${g.regions} market${g.regions > 1 ? "s" : ""}; floor ${money(g.floor)}, ceiling ${money(g.ceil)} since market pricing began; fixed preemptible price before it ${money(g.fixed)}`} />
        ))}
        <Kpi label="Tightness" value={signed(d.tight, 2)} sub={`ceiling minus floor share of ${d.markets.length} markets`} title="+1: every market pinned at its 30-day ceiling (sold out); −1: every market at its floor (slack)" />
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`Cross-region median, hourly · log scale · USD per GPU-hour`} title="Spot price by GPU"
          right={<><Seg label="Grain" value={grain} onChange={setGrain} options={[["day", "Daily average"], ["hour", "Hourly median"]]} /><Seg label="Span" value={span} onChange={setSpan} options={spanOpts} /></>}
          finding={`${grain === "day" ? "Each point is a GPU's time-weighted daily average price, averaged across its regions (complete UTC days)" : "Each line is the hourly median of a GPU's regions"}. Until ${launch ? dayOnly(launch) : "market pricing began"} every market had one fixed preemptible price; since then Nebius reprices each market as capacity fills or frees, so prices move in steps. On a log scale a doubling is the same height at $1 as at $9, so B300's jump and H100's slide compare directly.`}
          table={<MiniTable columns={[{ key: "gpu", label: "GPU" }, { key: "median", label: "Median now", fmt: money }, { key: "min", label: "Cheapest", fmt: money }, { key: "cheapest", label: "Where", align: "left" }, { key: "chg1d", label: "1d", fmt: chgTxt }, { key: "chg7d", label: "7d", fmt: chgTxt }, { key: "fixed", label: "Fixed price before", fmt: money }, { key: "vsFixed", label: "vs fixed", fmt: chgTxt }, { key: "floor", label: "Floor", fmt: money }, { key: "ceil", label: "Ceiling", fmt: money }]} rows={d.byGpu} />}>
          <Legend items={d.byGpu.map((g, i) => [g.gpu, C[(i % 5) + 1]])} />
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={grain === "day" ? dailyChart : medianChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={dayOnly} minTickGap={40} />
              <YAxis scale="log" domain={[0.5, 16]} ticks={ticks} allowDataOverflow tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayHour} formatter={(v, n) => [money(v), n]} />
              {launch && <ReferenceLine x={launch} stroke="var(--text-muted)" strokeDasharray="2 3" label={{ value: "market pricing", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
              {d.byGpu.map((g, i) => <Line key={g.gpu} dataKey={g.gpu} type={grain === "day" ? "linear" : "stepAfter"} stroke={C[(i % 5) + 1]} strokeWidth={g.gpu === gpu ? 2.5 : 1.75} dot={grain === "day" ? { r: 3, strokeWidth: 0, fill: C[(i % 5) + 1] } : false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>

        <VizCard eyebrow={`${regions.length} region${regions.length === 1 ? "" : "s"} · hourly · USD per GPU-hour`} title={`${gpu} by region`}
          right={<Seg label="GPU" value={gpu} onChange={setGpu} options={d.byGpu.map(g => [g.gpu, g.gpu])} />}
          finding={sel ? `Since market pricing began, ${gpu} has ranged from ${money(sel.floor)} to ${money(sel.ceil)} (dashed lines; the fixed price before was ${money(sel.fixed)}). ${regions.map(m => `${m.region} ${money(m.price)}${m.state === "ceiling" ? " at the ceiling" : m.state === "floor" ? " at the floor" : ""}`).join(", ")}.` : ""}
          table={<MiniTable columns={[{ key: "t", label: "Hour (UTC)", fmt: dayHour }, ...regions.map(m => ({ key: m.region, label: m.region, fmt: money }))]} rows={[...regionChart].reverse().slice(0, 400)} />}>
          <Legend items={regions.map((m, i) => [m.region, C[(i % 5) + 1]])} />
          <div className="ochart" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={regionChart} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={dayOnly} minTickGap={40} />
              <YAxis domain={[0, "auto"]} tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={dayHour} formatter={(v, n) => [money(v), n]} />
              {launch && <ReferenceLine x={launch} stroke="var(--text-muted)" strokeDasharray="2 3" />}
              {sel && <ReferenceLine y={sel.floor} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "floor", position: "insideBottomLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
              {sel && <ReferenceLine y={sel.ceil} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "ceiling", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10 }} />}
              {regions.map((m, i) => <Line key={m.sku} dataKey={m.region} type="stepAfter" stroke={C[(i % 5) + 1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        </VizCard>
      </div>

      <VizCard eyebrow={`${d.markets.length} live markets · prices as of ${d.snapshotTime ? dayHour(d.snapshotTime) : "—"}`} title="Every market, against its own range"
        finding="The bar runs from each market's floor to its ceiling since market pricing began; the dot is today. The 7-day columns are the share of the last week spent at the floor or the ceiling, a steadier read than one snapshot."
        note={`${d.source} Daily archive: ${d.history.days} days (${d.history.from} to ${d.history.to}). Preemptible capacity can be reclaimed at short notice, so these prices sit below on-demand rates; their direction, not their level, is the signal.`}>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr>{["GPU", "Region", "Price", "Since", "State", "Range since market pricing", "1d", "7d", "vs fixed", "7d at floor", "7d at ceiling"].map((h, i) => <th key={h} style={{ textAlign: i < 2 || i === 4 || i === 5 ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>{d.markets.map(m => {
              const [label, color] = STATE[m.state] || ["—", "var(--text-muted)"];
              const pc = (a, b) => (finite(a) && finite(b) && b > 0 ? chgTxt((a / b - 1) * 100) : "—");
              return (
                <tr key={m.sku} className="oclick" onClick={() => setGpu(m.gpu)} title={`Show ${m.gpu} by region`}>
                  <td style={{ textAlign: "left" }}><strong>{m.gpu}</strong></td>
                  <td style={{ textAlign: "left" }}>{m.region}</td>
                  <td style={{ textAlign: "right" }}>{money(m.price)}</td>
                  <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{m.effective ? dayHour(m.effective) : "—"}</td>
                  <td style={{ textAlign: "left" }}><span className="otag" style={{ borderColor: color, color: "var(--text-primary)" }}>{label}</span></td>
                  <td style={{ textAlign: "left" }}><RangeStrip min={m.floor30} max={m.ceil30} value={m.price} width={130} color={color === "var(--text-muted)" ? C[1] : color} /></td>
                  <td style={{ textAlign: "right" }}>{pc(m.price, m.d1)}</td>
                  <td style={{ textAlign: "right" }}>{pc(m.price, m.d7)}</td>
                  <td style={{ textAlign: "right" }} title={finite(m.fixedPrice) ? `fixed price before: ${money(m.fixedPrice)}` : undefined}>{pc(m.price, m.fixedPrice)}</td>
                  <td style={{ textAlign: "right" }}>{finite(m.floorShare7) ? `${Math.round(m.floorShare7 * 100)}%` : "—"}</td>
                  <td style={{ textAlign: "right" }}>{finite(m.ceilShare7) ? `${Math.round(m.ceilShare7 * 100)}%` : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </VizCard>
      {d.stale && <p className="onote">Showing the last saved prices: {d.error}</p>}
    </div>
  );
}
