import React, { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { finite, C, VizCard, Kpi, Legend, Spark, axisTick, gridProps, tipStyle, tipLabel } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// MEMORY PRICES — AI Economy → Memory: what memory costs, from HBM to NAND
// (server/memoryPrices.js). Memory is where a compute shortage shows first
// upstream: HBM takes the wafers conventional DRAM would have used.
//   per GB      every part on one log ladder of dollars per gigabyte: HBM
//               (hand-kept estimates), server DDR5, legacy DDR4, graphics
//               DRAM, NAND
//   since       the headline parts indexed to the first day on file, and DDR4
//               against DDR5 (above 1 the old part costs more than the new)
//   board       every part TrendForce quotes: price, per GB, the session, the
//               week, the month, since the archive began, and its line
//   contract    TrendForce's quarterly contract changes compounded into an
//               index, the monthly fixed prices the press quotes, the table of
//               changes by segment, and the contract tables shown in arrears
//   long view   retail dollars per GB since 2016 (Stanford's compilation) and
//               the Bank of Korea's export price indexes for DRAM and flash
//   HBM         prices, premiums and sold-out statements, with who said them
//   makers      what the memory makers reported on price and bits
// Families keep one colour everywhere: HBM pink, DDR5 blue, DDR4 orange, NAND
// green, graphics amber. A rise in memory is a cost to buyers and a gain to
// makers, so changes are signed, not coloured good or bad.
// ============================================================================

const FAM = { HBM: C[5], DDR5: C[1], DDR4: C[2], NAND: C[3], Graphics: C[4], DDR3: "var(--text-muted)", Cards: "var(--text-muted)", Other: "var(--text-muted)" };
const HEAD_COLOR = { ddr5: C[1], ddr4: C[2], tlc512: C[3], gddr6: C[4], ddr5rdimm: C[5] };
const usd = v => (!finite(v) ? "—" : v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const pct = (v, dp = 1) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const sess = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%` : "—");
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const md = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const when = d => { if (!d) return "—"; const [y, m] = String(d).split("-"); return m ? new Date(Date.UTC(+y, +m - 1, 15, 12)).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : y; };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };
const left = { textAlign: "left" }, right = { textAlign: "right" };
const tone = v => (!finite(v) || Math.abs(v) < 1e-9 ? "var(--text-muted)" : "var(--text-primary)");

// dollars per gigabyte on a log axis: one row per part, a range where the figure is an estimate
function GbLadder({ rows }) {
  const [hover, setHover] = useState(null);
  const vals = rows.flatMap(r => [r.perGb, r.low, r.high]).filter(v => finite(v) && v > 0), lo = Math.pow(10, Math.floor(Math.log10(Math.min(...vals) * 0.8))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...vals) * 1.2)));
  const W = 760, rowH = 28, m = { l: 250, r: 86, t: 18, b: 4 }, H = m.t + rows.length * rowH + m.b;
  const x = v => m.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - m.l - m.r);
  const ticks = []; for (let t = lo; t <= hi * 1.001; t *= 10) ticks.push(t);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dollars per gigabyte by memory type, on a log scale" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={H} stroke="var(--border-subtle)" /><text x={x(t)} y={10} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{t >= 1 ? `$${t}` : `$${t}`}</text></g>)}
        {rows.map((r, i) => { const y = m.t + i * rowH + rowH / 2, color = FAM[r.family] || "var(--text-muted)"; return (
          <g key={r.id} onMouseEnter={() => setHover(r)}>
            <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill={hover === r ? "var(--bg-subtle)" : "transparent"} />
            <text x={m.l - 10} y={y + 4} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--text-primary)", fontFamily: "var(--font-body)" }}>{r.label}{r.kind === "estimate" ? " (est.)" : ""}</text>
            <line x1={m.l} x2={x(r.perGb)} y1={y} y2={y} stroke={color} strokeWidth="2" opacity="0.4" />
            {finite(r.low) && finite(r.high) && r.high > r.low && <line x1={x(r.low)} x2={x(r.high)} y1={y} y2={y} stroke={color} strokeWidth="5" opacity="0.5" strokeLinecap="round" />}
            <circle cx={x(r.perGb)} cy={y} r={6} fill={color} stroke="var(--card-bg)" strokeWidth="2" />
            <text x={x(Math.max(r.perGb, r.high || 0)) + 11} y={y + 4} style={{ fontSize: 11.5, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-number)" }}>{usd(r.perGb)}</text>
          </g>); })}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {hover ? <><b style={{ color: "var(--text-primary)" }}>{hover.label}: {usd(hover.perGb)} per GB</b>{finite(hover.low) && hover.high > hover.low ? ` (${usd(hover.low)} to ${usd(hover.high)})` : ""} · {hover.note}{finite(hover.chg30) ? ` · ${pct(hover.chg30)} in 30 days` : ""}</> : <>Hover a row for the price behind it. Each gridline is ten times the one to its left.</>}
      </div>
      <Legend items={[...new Set(rows.map(r => r.family))].map(f => [f, FAM[f] || "var(--text-muted)"])} />
    </div>
  );
}

export default function MemoryPrices() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; fetch("/api/memory-prices").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">Memory prices could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading memory prices…</p></div>;

  const row = id => d.rows.find(r => r.head === id), ddr5 = row("ddr5"), ddr4 = row("ddr4"), rdimm = row("ddr5rdimm"), tlc = row("tlc512"), ratio = d.ratio.at(-1), ratio0 = d.ratio[0];
  const hbm = d.ladder.filter(l => l.family === "HBM"), topHbm = hbm.find(l => /HBM4, 2026/.test(l.label)) || hbm.at(-1), hbm3 = hbm.find(l => /HBM3E/.test(l.label)), hbm27 = hbm.find(l => /2027/.test(l.label)), mult = topHbm && ddr5?.perGb ? topHbm.perGb / ddr5.perGb : null, k = d.kept;
  const ct = d.contractTable, ci = d.contractIndex || [], ciNow = [...ci].reverse().find(r => r.q < d.now && finite(r["conventional DRAM"])), ciNand = [...ci].reverse().find(r => r.q < d.now && finite(r["overall NAND Flash"]));
  const xi = d.exportIndex?.months || [], q2 = q => q.replace("-", " ").slice(2);
  const fams = ["DDR5", "DDR4", "DDR3", "Graphics", "NAND", "Cards"].filter(f => d.rows.some(r => r.family === f));
  const drawn = d.heads.filter(h => HEAD_COLOR[h.id]);
  const rng = c => (c.low === c.high ? `${c.low > 0 ? "+" : ""}${c.low}%` : `${c.low > 0 ? "+" : ""}${c.low} to ${c.high > 0 ? "+" : ""}${c.high}%`);
  const perGbText = h => (finite(h.perGb) ? `${usd(h.perGb)}${finite(h.perGbHigh) ? ` to ${usd(h.perGbHigh)}` : ""} /GB` : null);
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Memory · spot ${day(d.asOf)}${d.daysStale > 3 ? ` (${d.daysStale} days old: the last read failed)` : ""} · this dashboard's archive since ${day(d.archiveFrom)}`} title="What memory costs, from HBM to NAND"
        finding={`${ddr5 ? `A gigabyte of DDR5 costs ${usd(ddr5.perGb)} on the spot market and a gigabyte of DDR4 ${usd(ddr4?.perGb)}: the legacy part is ${ratio ? `${ratio.ratio.toFixed(2)}×` : "—"} the current one${ratio0 && ratio ? `, ${ratio.ratio < ratio0.ratio ? "down" : "up"} from ${ratio0.ratio.toFixed(2)}× in ${md(ratio0.d)}` : ""}, because makers moved capacity away faster than demand left. ` : ""}${rdimm ? `The server module (32GB DDR5 RDIMM) is ${usd(rdimm.avg)}, ${pct(rdimm.chgAll, 0)} since the archive began and ${pct(rdimm.chg30, 0)} in the past month. ` : ""}${tlc ? `NAND is two orders of magnitude cheaper per gigabyte: a 512Gb TLC wafer die is ${usd(tlc.avg)}, ${usd(tlc.perGb)} a GB. ` : ""}${topHbm ? `HBM has no spot market; the estimates on file put HBM4 at about ${usd(topHbm.low)} to ${usd(topHbm.high)} a GB on this year's contracts${hbm3 ? ` and HBM3E at ${usd(hbm3.low)} to ${usd(hbm3.high)}` : ""}, which is now below spot DDR5 per gigabyte${hbm27 ? `, with forecasts of ${usd(hbm27.low)} to ${usd(hbm27.high)} for 2027` : ""}. ` : ""}${ciNow ? `Contract prices are the bigger story: compounding TrendForce's quarterly changes, conventional DRAM is about ${(ciNow["conventional DRAM"] / 100).toFixed(1)}× its mid-2024 level${ciNand ? ` and NAND ${(ciNand["overall NAND Flash"] / 100).toFixed(1)}×` : ""}. ` : ""}Over the past month ${d.breadth.month.down} of ${d.breadth.month.n} parts with a history fell and ${d.breadth.month.up} rose.`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          {topHbm && <Kpi label="HBM4, this year's contracts" value={`${usd(topHbm.low)}–${usd(topHbm.high)} /GB`} sub={`estimates, not quotes${finite(mult) ? `; ${mult.toFixed(1)}× spot DDR5` : ""}${hbm27 ? `; 2027 forecasts ${usd(hbm27.low)} to ${usd(hbm27.high)}` : ""}`} tone={FAM.HBM} />}
          {ciNow && <Kpi label="DRAM contract, since mid-2024" value={`${(ciNow["conventional DRAM"] / 100).toFixed(1)}×`} sub={`conventional DRAM, TrendForce quarterly changes compounded to ${q2(ciNow.q)}${ciNand ? `; NAND ${(ciNand["overall NAND Flash"] / 100).toFixed(1)}×` : ""}`} />}
          {ddr5 && <Kpi label="DDR5 16Gb chip" value={usd(ddr5.avg)} sub={`${usd(ddr5.perGb)} a GB; ${pct(ddr5.chg30)} in 30 days, ${pct(ddr5.chgAll, 0)} since ${md(ddr5.since)}`} tone={FAM.DDR5} />}
          {rdimm && <Kpi label="DDR5 RDIMM 32GB (server)" value={usd(rdimm.avg)} sub={`${usd(rdimm.perGb)} a GB; ${pct(rdimm.chg30)} in 30 days, ${pct(rdimm.chgAll, 0)} since ${md(rdimm.since)}`} tone={FAM.DDR5} />}
          {ddr4 && <Kpi label="DDR4 16Gb chip" value={usd(ddr4.avg)} sub={`${usd(ddr4.perGb)} a GB; ${pct(ddr4.chg30)} in 30 days, ${pct(ddr4.chgAll, 0)} since ${md(ddr4.since)}`} tone={FAM.DDR4} />}
          {ratio && <Kpi label="DDR4 over DDR5, per GB" value={`${ratio.ratio.toFixed(2)}×`} sub={`above 1 the legacy part costs more; ${ratio0 ? `${ratio0.ratio.toFixed(2)}× on ${md(ratio0.d)}` : ""}`} />}
          {tlc && <Kpi label="NAND 512Gb TLC wafer" value={usd(tlc.avg)} sub={`${usd(tlc.perGb)} a GB; session ${sess(tlc.session)}${finite(tlc.chg30) ? `; ${pct(tlc.chg30)} in 30 days` : "; on file from today"}`} tone={FAM.NAND} />}
        </div>

        <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Dollars per gigabyte · every type on one scale · log</div>
        <GbLadder rows={d.ladder} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14, marginTop: 12 }}>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Headline parts · first day on file = 100 · {d.archiveDays} days archived</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.indexed} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="d" tick={axisTick} tickFormatter={md} minTickGap={36} />
                  <YAxis tick={axisTick} domain={["auto", "auto"]} />
                  <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="3 3" />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={day} formatter={(v, name) => [v, name]} />
                  {drawn.map(h => <Line key={h.id} name={h.label} dataKey={h.id} stroke={HEAD_COLOR[h.id]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={drawn.map(h => [h.label, HEAD_COLOR[h.id]])} />
          </div>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>The legacy squeeze · DDR4 16Gb over DDR5 16Gb · spot</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.ratio} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="d" tick={axisTick} tickFormatter={md} minTickGap={36} />
                  <YAxis tick={axisTick} domain={[0.8, "auto"]} tickFormatter={v => `${v.toFixed(1)}×`} />
                  <ReferenceLine y={1} stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "same price per GB", position: "insideBottomLeft", fontSize: 10, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={day} formatter={(v, name, e) => [`${v}× (DDR4 $${e.payload.ddr4}, DDR5 $${e.payload.ddr5})`, "DDR4 over DDR5"]} />
                  <Line dataKey="ratio" stroke={FAM.DDR4} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="onote" style={{ marginTop: 2 }}>A new generation normally costs more than the one it replaces. Above 1, the old one is scarce: capacity went to DDR5 and HBM before the installed base stopped buying DDR4.</p>
          </div>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Every part quoted · spot</div>
        <div className="otable-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Part</th><th style={right}>Price</th><th style={right}>Per GB</th><th style={right}>Session</th><th style={right}>7 days</th><th style={right}>30 days</th><th style={right}>Since first on file</th><th style={left}>Line</th></tr></thead>
            <tbody>{fams.map(f => (
              <React.Fragment key={f}>
                <tr><td colSpan={8} style={{ ...left, background: "var(--bg-subtle)", fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 11.5, color: "var(--text-primary)" }}><i aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: FAM[f], marginRight: 6 }} />{f === "Cards" ? "Memory cards" : f === "Graphics" ? "Graphics DRAM" : f}</td></tr>
                {d.rows.filter(r => r.family === f).map(r => (
                  <tr key={r.n}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{r.n}<span style={{ color: "var(--text-muted)", fontFamily: "var(--font-number)", fontSize: 10.5 }}> {r.g === "module" ? "module" : r.g === "wafer" ? "wafer" : ""}</span></td>
                    <td style={{ ...right, fontWeight: 600 }}>{usd(r.avg)}</td><td style={right}>{usd(r.perGb)}</td>
                    <td style={{ ...right, color: tone(r.session) }}>{sess(r.session)}</td>
                    <td style={{ ...right, color: tone(r.chg7) }}>{pct(r.chg7)}</td><td style={{ ...right, color: tone(r.chg30) }}>{pct(r.chg30)}</td>
                    <td style={{ ...right, color: tone(r.chgAll) }}>{pct(r.chgAll)}<span style={{ color: "var(--text-muted)", fontSize: 10.5 }}> {md(r.since)}</span></td>
                    <td style={left}>{r.spark.filter(finite).length > 2 ? <Spark values={r.spark} width={90} height={20} color={FAM[f]} /> : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  </tr>))}
              </React.Fragment>))}</tbody>
          </table>
        </div>

        {(ci.length > 2 || d.levels?.length > 2) && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14, marginTop: 12 }}>
          {ci.length > 2 && <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Contract prices · TrendForce's quarterly changes compounded · mid-2024 = 100 · log</div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ci} margin={{ top: 6, right: 22, bottom: 0, left: -10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="q" tick={axisTick} tickFormatter={q2} minTickGap={20} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={axisTick} allowDataOverflow />
                  <ReferenceLine x={d.now} stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "now; forecasts after", position: "insideTopRight", fontSize: 10, fill: "var(--text-muted)" }} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={(q, e) => `${q2(q)}${e?.[0]?.payload?.forecast ? " (includes a forecast)" : ""}`} formatter={(v, name) => [v, name]} />
                  <Line name="Conventional DRAM" dataKey="conventional DRAM" stroke={FAM.DDR5} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: FAM.DDR5 }} isAnimationActive={false} />
                  <Line name="DRAM including HBM" dataKey="HBM-blended DRAM" stroke={FAM.HBM} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: FAM.HBM }} isAnimationActive={false} />
                  <Line name="NAND flash" dataKey="overall NAND Flash" stroke={FAM.NAND} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: FAM.NAND }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["Conventional DRAM", FAM.DDR5], ["DRAM including HBM", FAM.HBM], ["NAND flash", FAM.NAND]]} />
            <p className="onote" style={{ marginTop: 2 }}>The middle of each quarter's range, the reported figure where there is one and the latest forecast where not. A derived index, not a price.</p>
          </div>}
          {d.levels?.length > 2 && <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Fixed contract prices quoted in the press · dollars a part · log</div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.levels.filter(l => l.m >= "2023-01")} margin={{ top: 6, right: 22, bottom: 0, left: -10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="m" tick={axisTick} tickFormatter={when} minTickGap={36} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={axisTick} tickFormatter={v => `$${v}`} allowDataOverflow />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={when} formatter={(v, name) => [usd(v), name]} />
                  <Line name="DDR4 8Gb" dataKey="ddr4" stroke={FAM.DDR4} strokeWidth={2} connectNulls dot={{ r: 2.5, strokeWidth: 0, fill: FAM.DDR4 }} isAnimationActive={false} />
                  <Line name="DDR5 16Gb" dataKey="ddr5" stroke={FAM.DDR5} strokeWidth={2} connectNulls dot={{ r: 2.5, strokeWidth: 0, fill: FAM.DDR5 }} isAnimationActive={false} />
                  <Line name="NAND 128Gb MLC" dataKey="nand" stroke={FAM.NAND} strokeWidth={2} connectNulls dot={{ r: 2.5, strokeWidth: 0, fill: FAM.NAND }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["DDR4 8Gb", FAM.DDR4], ["DDR5 16Gb", FAM.DDR5], ["NAND 128Gb MLC", FAM.NAND]]} />
            <p className="onote" style={{ marginTop: 2 }}>Monthly fixed-transaction prices as the press quoted them from TrendForce; months nobody quoted are joined by a straight line.</p>
          </div>}
        </div>}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 12 }}>
          {ct?.rows?.length > 0 && <div style={{ flex: "1.8 1 520px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Quarterly contract price change · TrendForce · percent on the quarter before</div>
            <div className="otable-wrap">
              <table className="otable">
                <thead><tr><th style={left}>Segment</th>{ct.quarters.map(q => <th key={q} style={{ ...right, color: q > d.now ? "var(--text-muted)" : undefined }}>{q2(q)}</th>)}</tr></thead>
                <tbody>{ct.rows.map(r => (
                  <tr key={r.segment}><td style={{ ...left, fontFamily: "var(--font-body)", textTransform: "capitalize" }}>{r.segment.replace("overall ", "").replace("HBM-blended DRAM", "DRAM incl. HBM")}</td>
                    {r.cells.map((c, i) => <td key={i} style={{ ...right, whiteSpace: "nowrap", fontWeight: c?.kind === "actual" ? 600 : 400, color: !c ? "var(--text-muted)" : c.kind === "actual" ? "var(--text-primary)" : "var(--text-secondary)" }} title={c ? `${c.kind === "actual" ? "reported" : "forecast"}, issued ${c.issued || "—"}${c.note ? `. ${c.note}` : ""}` : undefined}>{c ? rng(c) : "—"}</td>)}
                  </tr>))}</tbody>
              </table>
            </div>
            <p className="onote" style={{ marginTop: 2 }}>Bold is a figure reported at or after the quarter's end; lighter is a forecast. Hover a cell for when it was issued. TrendForce stopped publishing most segment splits after 3Q25.</p>
          </div>}
          {d.contracts.length > 0 && <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Contract prices TrendForce shows in arrears</div>
            <div className="otable-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
              <table className="otable">
                <thead><tr><th style={left}>Part</th><th style={left}>For</th><th style={right}>Average</th><th style={right}>Per GB</th><th style={right}>Change</th></tr></thead>
                <tbody>{d.contracts.map(c => <tr key={c.n + c.period}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{c.n}</td><td style={{ ...left, color: "var(--text-secondary)" }}>{c.period || "—"}</td><td style={{ ...right, fontWeight: 600 }}>{usd(c.avg)}</td><td style={right}>{usd(c.perGb)}</td><td style={right}>{sess(c.chg)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>}
        </div>

        {(d.retail?.length > 12 || xi.length > 2) && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14, marginTop: 12 }}>
          {d.retail?.length > 12 && <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>The long view · retail dollars per GB · monthly · log</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.retail} margin={{ top: 6, right: 22, bottom: 0, left: -6 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="m" tick={axisTick} tickFormatter={m => m.slice(0, 4)} minTickGap={40} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={axisTick} tickFormatter={v => `$${v}`} allowDataOverflow />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={when} formatter={(v, name) => [`${usd(v)} a GB`, name]} />
                  <Line name="DRAM (historical record)" dataKey="dram" stroke="var(--text-muted)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  <Line name="DDR5" dataKey="ddr5" stroke={FAM.DDR5} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line name="DDR4" dataKey="ddr4" stroke={FAM.DDR4} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line name="NAND (cheapest SSD)" dataKey="nand" stroke={FAM.NAND} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["DDR5", FAM.DDR5], ["DDR4", FAM.DDR4], ["NAND (cheapest SSD)", FAM.NAND], ["DRAM, historical record to 2024", "var(--text-muted)"]]} />
            <p className="onote" style={{ marginTop: 2 }}>What a shopper pays, from Stanford's compilation of Amazon price history (Keepa) and John McCallum's record: retail lags and smooths the chip market, but it is the one free series with a decade of NAND.</p>
          </div>}
          {xi.length > 2 && <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Korea's export prices · Bank of Korea · dollar basis · 2020 = 100</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={xi} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="m" tick={axisTick} tickFormatter={when} minTickGap={36} />
                  <YAxis tick={axisTick} domain={["auto", "auto"]} />
                  <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="3 3" />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={when} formatter={(v, name) => [v, name]} />
                  <Line name="DRAM" dataKey="dram" stroke={FAM.DDR5} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: FAM.DDR5 }} isAnimationActive={false} />
                  <Line name="Flash memory" dataKey="flash" stroke={FAM.NAND} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: FAM.NAND }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["DRAM", FAM.DDR5], ["Flash memory", FAM.NAND]]} />
            <p className="onote" style={{ marginTop: 2 }}>The price index of what the two largest memory makers' home country ships: the official series closest to a contract price. {d.exportIndex.keyed ? "" : "Only the latest ten months are read without a key; a free Bank of Korea ECOS key in .env (BOK_ECOS_KEY) brings the record back to 2015."}</p>
          </div>}
        </div>}

        {k.available ? <>
          {k.hbm.length > 0 && <>
            <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>HBM · prices, premiums and supply statements · {k.hbm.length} sourced figures · hand-kept, reviewed {k.reviewed}</div>
            <div className="otable-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table className="otable">
                <thead><tr><th style={left}>Product</th><th style={left}>Measure</th><th style={right}>Figure</th><th style={right}>As of</th><th style={left}>Applies to</th><th style={left}>Said by</th><th style={left}>Conf.</th></tr></thead>
                <tbody>{[...k.hbm].sort((a, b) => String(b.asOf).localeCompare(String(a.asOf))).map((h, i) => (
                  <tr key={i} title={h.note || undefined}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{h.product}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{h.metric}</td>
                    <td style={{ ...right, fontWeight: 600, whiteSpace: "nowrap" }}>{perGbText(h) ? perGbText(h) : /USD|KRW/.test(h.unit || "") ? `${h.unit === "KRW" ? "₩" : "$"}${Number(h.value).toLocaleString("en-US")}${finite(h.valueHigh) ? ` to ${Number(h.valueHigh).toLocaleString("en-US")}` : ""}` : h.unit === "percent" ? `${h.value}${finite(h.valueHigh) ? ` to ${h.valueHigh}` : ""}%` : h.unit === "x" ? `${h.value}${finite(h.valueHigh) ? ` to ${h.valueHigh}` : ""}×` : `${h.value}${finite(h.valueHigh) ? ` to ${h.valueHigh}` : ""}`}</td>
                    <td style={right}>{when(h.asOf)}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 150 }}>{h.appliesTo || "—"}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 150 }}>{(h.statedBy || "—").slice(0, 60)}{h.url ? <> · <a href={h.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(h.url)}</a></> : null}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{h.confidence || "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>}
          {k.makers.length > 0 && <>
            <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>What the makers reported · average selling price and bit shipments, quarter on quarter</div>
            <div className="otable-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
              <table className="otable">
                <thead><tr><th style={left}>Maker</th><th style={left}>Quarter</th><th style={left}>Product</th><th style={left}>Measure</th><th style={right}>Figure</th><th style={left}>Source</th></tr></thead>
                <tbody>{[...k.makers].sort((a, b) => String(b.quarter).localeCompare(String(a.quarter)) || a.company.localeCompare(b.company)).map((r, i) => (
                  <tr key={i} title={r.note || undefined}>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{r.company}</td><td style={left}>{String(r.quarter).replace(" (calendar)", "")}</td>
                    <td style={{ ...left, fontFamily: "var(--font-body)" }}>{r.product}</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{r.metric}</td>
                    <td style={{ ...right, fontWeight: 600, whiteSpace: "nowrap" }}>{r.unit === "percent" ? `${r.value > 0 ? "+" : ""}${r.value}${finite(r.valueHigh) ? ` to ${r.valueHigh > 0 ? "+" : ""}${r.valueHigh}` : ""}%` : `${Number(r.value).toLocaleString("en-US")} ${r.unit || ""}`}</td>
                    <td style={left}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{host(r.url)}</a> : "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>}
        </> : <p className="onote" style={{ marginTop: 10 }}>HBM prices, TrendForce's quarterly contract forecasts and the makers' reported figures are hand-kept in the Research Database (data/curated/ai-memory-prices.json). {k.reason}</p>}

        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          {k.available && k.caveat ? <li>{k.caveat}</li> : null}
          <li>HBM against DDR5 here sets a contract estimate beside a spot price; TrendForce's own comparison is with server DDR5 contracts, where it put HBM3E at four to five times in 2025 and expected one to two times by the end of 2026.</li>
          {d.errors?.length > 0 && <li>Not read this build: {d.errors.join("; ")}.</li>}
          <li>HBM and packaging capacity are on Supply Chain; the memory signal in the shortage-or-glut board (Compute) reads the DDR5 chip from this archive. Source: {d.source}.</li>
        </ul>
      </VizCard>
    </div>
  );
}
