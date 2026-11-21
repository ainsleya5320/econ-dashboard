import React, { useEffect, useState } from "react";
import { finite, C, VizCard, Kpi, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// TOKEN LADDER — AI Economy → Tokens: what a million tokens costs to make and
// what it sells for at each step up (server/tokenMarket.js).
//   ladder      one row per rung on a log scale, from the GPU-derived cost,
//               through what providers charge for the same open model, to
//               what businesses actually pay and the closed labs' list prices.
//               Read as a typical token (the measured mix of input and
//               output), or as input or output alone
//   references  three open models: derived cost, cheapest, median and dearest
//               provider, and the margin those prices leave over the cost
//   providers   who serves the open models, how often cheapest, and their
//               price against each model's median
// The derivation of the cost itself lives on Compute (the token spot panel);
// this panel takes its output. Rungs are coloured by what kind of number they
// are (derived cost, open market, realized, closed list), and each says which.
// ============================================================================

const GROUP = { cost: ["Derived cost", C[2]], open: ["Open models, list", C[3]], realized: ["Realized", C[4]], closed: ["Closed labs, list", C[1]] };
const usd = v => (!finite(v) ? "—" : v >= 10 ? `$${v.toFixed(1)}` : v >= 1 ? `$${v.toFixed(2)}` : v >= 0.1 ? `$${v.toFixed(3).replace(/0$/, "")}` : `$${v.toFixed(3)}`);
const pctS = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%` : "—");
const day = d => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const left = { textAlign: "left" }, right = { textAlign: "right" };

// the rungs on a log axis: a hairline from the axis edge and a dot, value at the right
function Ladder({ rungs, mode }) {
  const [hover, setHover] = useState(null);
  const val = r => (mode === "mix" || !finite(r[mode]) ? r.mix : r[mode]);
  const vals = rungs.map(val).filter(finite), lo = Math.pow(10, Math.floor(Math.log10(Math.min(...vals) * 0.8))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...vals) * 1.2)));
  const W = 760, rowH = 30, m = { l: 330, r: 64, t: 18, b: 6 }, H = m.t + rungs.length * rowH + m.b;
  const x = v => m.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - m.l - m.r);
  const ticks = []; for (let t = lo; t <= hi * 1.001; t *= 10) ticks.push(t);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price per million tokens at each rung, on a log scale" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={H - m.b} stroke="var(--border-subtle)" /><text x={x(t)} y={10} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{t >= 1 ? `$${t}` : `$${t}`}</text></g>)}
        {rungs.map((r, i) => { const v = val(r), y = m.t + i * rowH + rowH / 2, color = GROUP[r.group][1], onlyAll = mode !== "mix" && !finite(r[mode]); return (
          <g key={r.id} onMouseEnter={() => setHover(i)}>
            <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill={hover === i ? "var(--bg-subtle)" : "transparent"} />
            <text x={m.l - 10} y={y + 4} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--text-primary)", fontFamily: "var(--font-body)" }}>{r.label}</text>
            {finite(v) && <>
              <line x1={m.l} x2={x(v)} y1={y} y2={y} stroke={color} strokeWidth="2" opacity="0.45" />
              <circle cx={x(v)} cy={y} r={6} fill={color} stroke="var(--card-bg)" strokeWidth="2" />
              <text x={x(v) + 11} y={y + 4} style={{ fontSize: 11.5, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-number)" }}>{usd(v)}{onlyAll ? "*" : ""}</text>
            </>}
          </g>); })}
      </svg>
      <div style={{ fontSize: 11.5, fontFamily: "var(--font-number)", color: "var(--text-secondary)", minHeight: 18 }}>
        {hover != null ? (r => <><b style={{ color: "var(--text-primary)" }}>{r.label}</b> · {GROUP[r.group][0].toLowerCase()}, {r.kind}{finite(r.input) ? <> · input {usd(r.input)}, output {usd(r.output)}, typical token {usd(r.mix)}</> : <> · one price for every token: {usd(r.mix)}</>} · {r.note}</>)(rungs[hover]) : <>Hover a row for input, output and where the number comes from.{mode !== "mix" ? " * one price for every token, shown as is." : ""}</>}
      </div>
      <Legend items={Object.values(GROUP)} />
    </div>
  );
}

export default function TokenLadder() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [mode, setMode] = useState("mix");
  useEffect(() => { let live = true; fetch("/api/token-market").then(r => r.json()).then(j => { if (live) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The token ladder could not be built: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading provider prices…</p></div>;

  const by = id => d.ladder.find(r => r.id === id), cost = by("cost-contract"), cheap = by("open-cheapest"), med = by("open-median"), real = by("realized"), two = by("two-used"), cache = by("two-cache");
  const main = d.references.find(r => r.archetype === "dense70b") || d.references[0], share = `${(d.outputShare * 100).toFixed(1)}%`;
  const val = (r, k) => (k === "mix" || !finite(r?.[k]) ? r?.mix : r?.[k]);
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Per million tokens · log scale · built ${day(d.built)}`} title="The token ladder: what it costs to make, and what it sells for"
        right={<Seg label="Which token" value={mode} onChange={setMode} options={[["mix", `Typical token (${share} output)`], ["input", "Input"], ["output", "Output"]]} />}
        finding={`${main ? `A typical token from ${main.label} costs about ${usd(cost?.mix)} per million to serve on a rented H100, by this dashboard's cost model. The cheapest provider sells it for ${usd(cheap?.mix)} and the median provider for ${usd(med?.mix)}: a margin of ${pctS(d.reads.marginMedian)} at the median and ${pctS(d.reads.marginCheapest)} at the cheapest, so the low end is selling below the model's floor. ` : ""}${real && two ? `Businesses pay ${usd(real.mix)} per million for OpenAI and Anthropic tokens against a list price of ${usd(two.mix)} for the same mix, ${Math.round(d.reads.realizedOverList * 100)}% of list${cache ? `, because most tokens are prompts re-read from cache (${usd(cache.mix)})` : ""}. ` : ""}${finite(d.reads.closedOverOpen) ? `Closed-lab models list at ${d.reads.closedOverOpen}× the open ones people actually use.` : ""}`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Cost to serve" value={usd(val(cost, mode))} sub={`${main?.label || "70B open model"}, H100 at $${d.rates.contract?.toFixed(2)}/hr; derived, not measured`} tone={GROUP.cost[1]} />
          <Kpi label="Cheapest provider" value={usd(val(cheap, mode))} sub={`${cheap?.note || ""}; margin over cost ${pctS(d.reads.marginCheapest)}`} tone={GROUP.open[1]} />
          <Kpi label="Median provider" value={usd(val(med, mode))} sub={`${main?.n} providers; margin over cost ${pctS(d.reads.marginMedian)}`} tone={GROUP.open[1]} />
          <Kpi label="Businesses pay" value={usd(real?.mix)} sub={`Ramp, every kind of token; ${finite(d.reads.realizedOverList) ? `${Math.round(d.reads.realizedOverList * 100)}% of list` : ""}`} tone={GROUP.realized[1]} />
          <Kpi label="Closed over open" value={finite(d.reads.closedOverOpen) ? `${d.reads.closedOverOpen}×` : "—"} sub="usage-weighted list price, closed labs against open-weights models" tone={GROUP.closed[1]} />
          <Kpi label="Output share of tokens" value={share} sub={`measured on OpenRouter; the cost model assumes ${Math.round(d.assumedShare * 100)}%`} />
        </div>
        <Ladder rungs={d.ladder} mode={mode} />
        <p className="onote" style={{ marginTop: 6 }}>The derivation of the cost (batch, context, utilisation, why input is cheap and output dear) is on Compute, "A Spot Price for Tokens". {d.history.length > 1 ? `This ladder has been kept daily since ${day(d.history[0].d)}.` : "A row is kept each day from today, so the ladder builds a history."}</p>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Three open models · derived cost against what providers charge · {mode === "mix" ? `typical token (${share} output)` : mode}</div>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={left}>Model</th><th style={right}>Derived cost</th><th style={right}>Cheapest</th><th style={left}>from</th><th style={right}>Median</th><th style={right}>Dearest</th><th style={right}>Providers</th><th style={right} title="1 − cost ÷ price, at the typical token">Margin, cheapest</th><th style={right} title="1 − cost ÷ price, at the typical token">Margin, median</th></tr></thead>
            <tbody>{d.references.map(r => (
              <tr key={r.id} title={r.cost && !r.cost.fits ? "The weights do not fit the eight-H100 node the cost model assumes, so its floor does not apply to this model" : r.archetypeLabel}>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{r.label}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{r.archetypeLabel}</div></td>
                <td style={right}>{r.cost?.fits ? usd(val(r.cost, mode)) : <span style={{ color: "var(--text-muted)" }}>does not fit</span>}</td>
                <td style={{ ...right, fontWeight: 600 }}>{usd(val(r.cheapest, mode))}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{r.cheapest?.provider}{r.cheapest?.quant ? ` · ${r.cheapest.quant}` : ""}</td>
                <td style={right}>{usd(val(r.median, mode))}</td><td style={right}>{usd(val(r.dearest, mode))}</td><td style={right}>{r.n}</td>
                <td style={right}>{pctS(r.marginCheapest)}</td><td style={right}>{pctS(r.marginMedian)}</td>
              </tr>))}</tbody>
          </table>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>Who serves the open models · {d.models.length} models: {d.models.map(m => m.label).join(", ")}</div>
        <div className="otable-wrap" style={{ maxHeight: 330, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Provider</th><th style={right}>Models served</th><th style={right}>Times cheapest</th><th style={right} title="The provider's price over each model's median provider price, median across the models it serves">Price vs median</th><th style={left}>Serves</th></tr></thead>
            <tbody>{d.providers.slice(0, 24).map(p => (
              <tr key={p.provider}>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{p.provider}</td>
                <td style={right}>{p.models}</td><td style={right}>{p.cheapest || "—"}</td>
                <td style={right}>{finite(p.vsMedian) ? `${p.vsMedian.toFixed(2)}×` : "—"}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)", whiteSpace: "normal", minWidth: 220 }}>{p.served.join(", ")}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: {d.source}.{d.errors?.length ? ` Feeds that failed this build: ${d.errors.join("; ")}.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}
