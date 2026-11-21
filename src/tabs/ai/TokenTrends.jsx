import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { finite, C, VizCard, Kpi, Legend, axisTick, gridProps, tipStyle, tipLabel } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// TOKEN TRENDS — AI Economy → Tokens: how a token's price evolves, two ways.
//   QualityPrice     the price of a fixed capability (server/qualityPrice.js):
//                    step lines of the cheapest model at or above a level, on
//                    a log scale. Left, Epoch's benchmark levels, 2021 to
//                    early 2025; right, this year's levels on the Artificial
//                    Analysis index from OpenRouter's catalogue. Different
//                    yardsticks, so two panels, never spliced.
//   TokenElasticity  does spending rise when tokens get cheaper
//                    (server/tokenElasticity.js): price, volume and implied
//                    spend on OpenRouter indexed to the first week; the mix
//                    behind the price; three reads in one table; and the
//                    Vercel gateway's labs.
// Lines in a chart take the colour slots in a fixed order; the tables carry
// every series, coloured or not.
// ============================================================================

const SLOT = [C[1], C[2], C[3], C[4], C[5]];
const usd = v => (!finite(v) ? "—" : v >= 1 ? `$${Number.isInteger(v) ? v : v.toFixed(2)}` : `$${v.toFixed(3).replace(/0$/, "")}`);
const el = v => (finite(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}` : "—");
const monLong = d => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—");
const pct = (v, dp = 0) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%` : "—");
const times = v => (finite(v) ? `${v >= 100 ? Math.round(v) : v.toFixed(1)}×` : "—");
const day = d => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const mon = d => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : "");
const left = { textAlign: "left" }, right = { textAlign: "right" };

// step lines of a falling price on a log scale; each series ends with its label
function StepChart({ series, label, height = 250 }) {
  const [hover, setHover] = useState(null);
  const W = 620, H = height, m = { l: 44, r: 208, t: 8, b: 22 };
  const all = series.flatMap(s => s.steps), t0 = Math.min(...all.map(p => Date.parse(p.d))), t1 = Math.max(...all.map(p => Date.parse(p.d)));
  const lo = Math.floor(Math.log10(Math.min(...all.map(p => p.price)))), hi = Math.ceil(Math.log10(Math.max(...all.map(p => p.price))));
  const x = t => m.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r), y = v => m.t + (1 - (Math.log10(v) - lo) / Math.max(1, hi - lo)) * (H - m.t - m.b);
  const decades = []; for (let e = lo; e <= hi; e++) decades.push(e);
  const span = (t1 - t0) / (365.25 * 864e5), ticks = [];
  if (span > 1.5) for (let yy = new Date(t0).getUTCFullYear() + 1; Date.UTC(yy, 0, 1) <= t1; yy++) ticks.push([Date.UTC(yy, 0, 1), String(yy)]);
  else for (let k = 0; k <= 4; k++) { const t = t0 + ((t1 - t0) * k) / 4; ticks.push([t, mon(new Date(t).toISOString())]); }
  // a step path: hold each price until the next model arrives, then drop; run the last one to the right edge
  const path = s => s.steps.map((p, i) => `${i ? "H" : "M"}${x(Date.parse(p.d))}${i ? `V${y(p.price)}` : `,${y(p.price)}`}`).join("") + `H${x(t1)}`;
  const ends = series.map((s, i) => ({ s, i, py: y(s.last.price) })).sort((a, b) => a.py - b.py);
  for (let k = 1; k < ends.length; k++) if (ends[k].py - ends[k - 1].py < 12) ends[k].py = ends[k - 1].py + 12;
  const move = e => {
    const b = e.currentTarget.getBoundingClientRect(), mx = ((e.clientX - b.left) / b.width) * W, my = ((e.clientY - b.top) / b.height) * H;
    let best = null, bd = 20 ** 2;
    series.forEach((s, i) => s.steps.forEach(p => { const q = (x(Date.parse(p.d)) - mx) ** 2 + (y(p.price) - my) ** 2; if (q < bd) { bd = q; best = { s, i, p }; } }));
    setHover(best);
  };
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${Math.max(H, ends.at(-1).py + 10)}`} role="img" aria-label={label} style={{ display: "block" }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {decades.map(e => <g key={e}><line x1={m.l} x2={W - m.r} y1={y(10 ** e)} y2={y(10 ** e)} stroke="var(--border-subtle)" /><text x={m.l - 6} y={y(10 ** e) + 3.5} textAnchor="end" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{10 ** e >= 1 ? `$${10 ** e}` : `$${(10 ** e).toFixed(-e)}`}</text></g>)}
        {ticks.map(([t, text]) => <g key={t}><line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} stroke="var(--border-subtle)" strokeDasharray="2 3" /><text x={x(t)} y={H - 7} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{text}</text></g>)}
        {series.map((s, i) => (
          <g key={s.key} opacity={hover && hover.s !== s ? 0.3 : 1}>
            <path d={path(s)} fill="none" stroke={SLOT[i % SLOT.length]} strokeWidth="2" strokeLinejoin="round" />
            {s.steps.map(p => <circle key={p.d + p.price} cx={x(Date.parse(p.d))} cy={y(p.price)} r={3.5} fill={SLOT[i % SLOT.length]} stroke="var(--card-bg)" strokeWidth="1.5" />)}
          </g>))}
        {ends.map(({ s, py }) => <text key={s.key} x={W - m.r + 6} y={py + 3.5} style={{ fontSize: 10.5, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-number)" }}>{s.short} {usd(s.last.price)}</text>)}
        {hover && <circle cx={x(Date.parse(hover.p.d))} cy={y(hover.p.price)} r={7} fill="none" stroke="var(--text-primary)" strokeWidth="1.3" />}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {hover ? <><b style={{ color: "var(--text-primary)" }}>{hover.s.label}</b> · from {day(hover.p.d)} the cheapest is {hover.p.model} at {usd(hover.p.price)} per million</> : <>Hover a dot for the model that set each price. Per million tokens, log scale.</>}
      </div>
    </div>
  );
}

export function QualityPrice() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; fetch("/api/quality-price").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  const drawn = useMemo(() => {
    if (!d) return [];
    const want = [["MMLU|GPT-3", "GPT-3 level"], ["MMLU|GPT-3.5 Turbo", "GPT-3.5 Turbo level"], ["MMLU|GPT-4-0314", "GPT-4 level (MMLU)"], ["GPQA Diamond|GPT-4-0314", "GPT-4 level (GPQA)"], ["LMSys Chatbot Arena ELO|GPT-4o-2024-05", "GPT-4o level (Arena)"]];
    return want.map(([k, short]) => { const s = d.epoch.series.find(x => x.key === k); return s && { ...s, short }; }).filter(Boolean);
  }, [d]);
  if (err) return <div className="options-research"><p className="onote">The constant-quality price curve could not be built: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading the price history of fixed capability levels…</p></div>;

  const e = d.epoch, cat = d.catalog, gpt4 = e.series.find(s => s.key === "MMLU|GPT-4-0314"), cs = cat.series.map(s => ({ ...s, short: `Index ${s.level}+` })).slice(0, 5), mid = cat.series.find(s => s.level === 40) || cat.series[0];
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow="The cheapest model at or above a fixed level · per million tokens · log scale" title="The price of a fixed capability"
        finding={`Holding capability fixed, the price of a token has fallen by a median of ${times(e.medianPerYear)} a year across Epoch's benchmark levels (${times(e.range?.[0])} to ${times(e.range?.[1])} depending on the level), ${day(e.from)} to ${day(e.through)}.${gpt4 ? ` GPT-4-level performance cost ${usd(gpt4.first.price)} per million when it arrived in ${monLong(gpt4.first.d)} and ${usd(gpt4.last.price)} ${gpt4.months} months later.` : ""}${mid ? ` It is still happening: this year the cheapest model at index ${mid.level} or better went from ${usd(mid.first.price)} to ${usd(mid.last.price)} in ${mid.months} months.` : ""} The falls are steepest just after a level is first reached.`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Median fall, a year" value={times(e.medianPerYear)} sub={`${e.series.filter(s => finite(s.perYear)).length} benchmark levels with a year or more of history (Epoch)`} tone={C[1]} />
          {gpt4 && <Kpi label="GPT-4 level, then and now" value={`${usd(gpt4.first.price)} → ${usd(gpt4.last.price)}`} sub={`${times(gpt4.times)} cheaper in ${gpt4.months} months; ${gpt4.last.model} by ${mon(gpt4.last.d)}`} />}
          {cat.series.map(s => s.level).includes(50) && (s => <Kpi label="Index 50 or better, this year" value={`${usd(s.first.price)} → ${usd(s.last.price)}`} sub={`${times(s.times)} cheaper in ${s.months} months; ${s.last.model}`} tone={C[4]} />)(cat.series.find(s => s.level === 50))}
          {d.own.latest && <Kpi label="Cheapest today, by level" value={[20, 30, 40, 50].filter(k => finite(d.own.latest[k])).map(k => usd(d.own.latest[k])).join(" · ")} sub={`index 20 · 30 · 40 · 50 or better; archived daily since ${day(d.own.from)}`} />}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Benchmark levels · {mon(e.from)} to {mon(e.through)} · prices as listed then (Epoch AI)</div>
            {drawn.length ? <StepChart series={drawn} label="Cheapest model at or above each benchmark level, 2021 to 2025" /> : <p className="onote">Epoch's file could not be read.</p>}
          </div>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Index levels · this year · today's prices by release date (OpenRouter)</div>
            {cs.length ? <StepChart series={cs} label="Cheapest model at or above each Artificial Analysis index level, by release date" /> : <p className="onote">OpenRouter's catalogue could not be read.</p>}
          </div>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Every level on file</div>
        <div className="otable-wrap" style={{ maxHeight: 330, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Level</th><th style={left}>Yardstick</th><th style={right}>First price</th><th style={left}>set by</th><th style={right}>Latest</th><th style={left}>set by</th><th style={right}>Cheaper by</th><th style={right}>Over</th><th style={right} title="Only where the record spans a year or more">Per year</th></tr></thead>
            <tbody>
              {cat.series.map(s => <tr key={s.key}><td style={{ ...left, fontFamily: "var(--font-body)" }}>Index {s.level} or better</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>AA intelligence index, {s.count} models</td><td style={right}>{usd(s.first.price)}</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.first.model} · {mon(s.first.d)}</td><td style={{ ...right, fontWeight: 600 }}>{usd(s.last.price)}</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.last.model} · {mon(s.last.d)}</td><td style={right}>{times(s.times)}</td><td style={right}>{s.months} mo</td><td style={right}>{times(s.perYear)}</td></tr>)}
              {e.series.map(s => <tr key={s.key}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{s.level} level</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.benchmark}{finite(s.floor) ? `, ${s.floor}+` : ""}</td><td style={right}>{usd(s.first.price)}</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.first.model} · {mon(s.first.d)}</td><td style={{ ...right, fontWeight: 600 }}>{usd(s.last.price)}</td><td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{s.last.model} · {mon(s.last.d)}</td><td style={right}>{times(s.times)}</td><td style={right}>{s.months} mo</td><td style={right}>{times(s.perYear)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: <a href={e.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{e.license}</a>; OpenRouter models API ({cat.models} models carry an index score).{d.errors?.length ? ` Not read this build: ${d.errors.join("; ")}.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}

export function TokenElasticity() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; fetch("/api/token-elasticity").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The elasticity test could not be built: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Pricing seven months of routed tokens…</p></div>;

  const r = d.router, b = d.business?.latest, g = d.gateway, s0 = d.series[0];
  const idx = s0 ? d.series.map(s => ({ d: s.d, price: Math.round((s.price / s0.price) * 1000) / 10, volume: Math.round((s.tokens / s0.tokens) * 1000) / 10, spend: Math.round((s.spend / s0.spend) * 1000) / 10, open: Math.round(s.openShare * 1000) / 10, output: Math.round(s.outputShare * 1000) / 10, coverage: s.coverage })) : [];
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow="The Jevons question · volume against price · three reads" title="When tokens get cheaper, does spending rise?"
        finding={`${r ? `On OpenRouter the price of the average routed token fell ${Math.round(Math.abs(r.priceChange) * 100)}% between ${day(r.from)} and ${day(r.to)} while volume rose ${times(r.volumeMultiple)} and the spending the two imply rose ${times(r.spendMultiple)}: an elasticity of about ${el(r.arc)}. The price fell because of what people routed to: open-weights models went from ${Math.round(r.open[0] * 100)}% to ${Math.round(r.open[1] * 100)}% of tokens. ` : ""}${b ? `Ramp's customers show the same shape in one month: price ${pct(b.priceChange)}, volume ${pct(b.volumeGrowth)}, spend ${pct(b.spendGrowth)} (elasticity ${el(b.arc)}). ` : ""}Spending rose as price fell in ${d.verdict.up} of ${d.verdict.n} reads.${g?.fit ? ` Across labs on Vercel's gateway the link is weak (${el(g.fit.slope)}): a lab getting cheaper did not by itself win share.` : ""} Adoption grows volume whatever the price, so these overstate the pure price response; the direction is the sturdy part.`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          {r && <Kpi label="Price of the average token" value={pct(r.priceChange)} sub={`OpenRouter, ${d.series.length} weekly snapshots; mix at today's list prices`} tone={C[2]} />}
          {r && <Kpi label="Volume" value={times(r.volumeMultiple)} sub={`tokens routed, ${day(r.from)} to ${day(r.to)}`} tone={C[1]} />}
          {r && <Kpi label="Implied spend" value={times(r.spendMultiple)} sub="volume × price: the dollars rose while the price fell" tone={C[3]} />}
          {r && <Kpi label="Elasticity, router" value={el(r.arc)} sub={`over the whole span; week to week ${r.weekly ? `${el(r.weekly.slope)} (R² ${r.weekly.r2})` : "—"}`} />}
          {b && <Kpi label="Elasticity, businesses" value={el(b.arc)} sub={`Ramp, one month: price ${pct(b.priceChange)}, volume ${pct(b.volumeGrowth)}`} />}
          <Kpi label="Spend up as price fell" value={`${d.verdict.up} of ${d.verdict.n}`} sub="beyond −1, cheaper tokens bring more dollars in" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14 }}>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>OpenRouter · price, volume and implied spend · first week = 100 · log scale</div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={idx} margin={{ top: 6, right: 22, bottom: 0, left: -10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="d" tick={axisTick} tickFormatter={mon} minTickGap={36} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={axisTick} allowDataOverflow />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={day} formatter={(v, k) => [v, k]} />
                  <Line name="Volume" dataKey="volume" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name="Implied spend" dataKey="spend" stroke={C[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name="Price of the average token" dataKey="price" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["Volume", C[1]], ["Implied spend", C[3]], ["Price of the average token", C[2]]]} />
          </div>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Why the price fell · the mix · share of tokens</div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={idx} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="d" tick={axisTick} tickFormatter={mon} minTickGap={36} />
                  <YAxis tick={axisTick} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={day} formatter={(v, k) => [`${v}%`, k]} />
                  <Line name="Open-weights models" dataKey="open" stroke={C[4]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name="Output tokens" dataKey="output" stroke={C[5]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["Open-weights models' share of tokens", C[4]], ["Output's share of tokens", C[5]]]} />
          </div>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>The three reads</div>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={left}>Read</th><th style={left}>Over</th><th style={right}>Price</th><th style={right}>Volume</th><th style={right}>Spend</th><th style={right} title="Change in volume over change in price, in logs">Elasticity</th><th style={left}>Spend rose as price fell</th><th style={left}>Sample</th></tr></thead>
            <tbody>{d.reads.map(x => (
              <tr key={x.id}>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{x.label}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{x.span}</td>
                <td style={right}>{pct(x.priceChange)}</td><td style={right}>{pct(x.volume)}</td><td style={right}>{pct(x.spend)}</td>
                <td style={{ ...right, fontWeight: 600 }}>{el(x.elasticity)}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{x.spendUp ? "yes" : "no"}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{x.n}</td>
              </tr>))}</tbody>
          </table>
        </div>

        {g?.labs?.length > 0 && <>
          <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Vercel gateway · each lab over the past eight weeks · relative price against share</div>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Lab</th><th style={right} title="Share of spend over share of tokens: what its tokens cost against the gateway's average">Relative price</th><th style={right}>Change</th><th style={right}>Token share</th><th style={right}>Spend share</th><th style={left}>Read</th></tr></thead>
              <tbody>{g.labs.map(l => { const cheaper = l.priceChange < -0.05, dearer = l.priceChange > 0.05, spendUp = l.spendShare[1] > l.spendShare[0]; return (
                <tr key={l.key}>
                  <td style={{ ...left, fontFamily: "var(--font-body)" }}>{l.name}</td>
                  <td style={right}>{l.ratio[0].toFixed(2)}× → {l.ratio[1].toFixed(2)}×</td>
                  <td style={{ ...right, fontWeight: 600 }}>{pct(l.priceChange)}</td>
                  <td style={right}>{l.tokenShare[0]}% → {l.tokenShare[1]}%</td><td style={right}>{l.spendShare[0]}% → {l.spendShare[1]}%</td>
                  <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{cheaper ? (spendUp ? "cheaper, and took more of the spend" : "cheaper, and took less of the spend") : dearer ? (spendUp ? "dearer, and took more of the spend" : "dearer, and took less of the spend") : "price about flat"}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        </>}
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: {d.source}.{d.errors?.length ? ` Not read this build: ${d.errors.join("; ")}.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}
