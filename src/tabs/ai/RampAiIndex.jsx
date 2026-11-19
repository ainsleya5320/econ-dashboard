import React, { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { finite, axisTick, gridProps, tipStyle, tipLabel, C, VizCard, Kpi, Seg, Legend } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// RAMP AI INDEX — AI Economy → Tokens: what American businesses actually pay
// for AI, from card and bill-pay transactions of 85,000-odd firms on Ramp.
//   KPIs       adoption, the lab mix, spend per employee, AI's share of
//              business spend, the latest week's token shares and price
//   adoption   share of businesses paying for AI, overall and by lab
//   spend      AI spend per employee per month (median firm, top 10%, top 1%)
//              on one log axis, and AI's share of all non-payroll spend
//   tokens     the latest week's token spend and volume shares and blended
//              price against a month earlier (the archive builds weekly)
//   who        adoption by size and industry, a year's change, and where the
//              data allows each industry's AI share of spend and spend per head
// Data: /api/ramp-ai (server/rampAi.js), from Ramp's AI Index page with FRED
// as the fallback. Labs and lines use the categorical slots in a fixed order.
// ============================================================================

const LAB_COLOR = { Anthropic: C[1], OpenAI: C[2], xAI: C[3], DeepSeek: C[4], "Mistral AI": C[5] };
const pct = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const pp = (v, dp = 1) => { if (!finite(v)) return "—"; const r = Number(v.toFixed(dp)); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(dp)} pt`; };
const usd = v => (!finite(v) ? "—" : v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`);
const mon = m => (m ? new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—");
const left = { textAlign: "left" }, right = { textAlign: "right" };

export default function RampAiIndex() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [who, setWho] = useState("industry");
  useEffect(() => { let live = true; fetch("/api/ramp-ai").then(r => r.json()).then(j => { if (live) { if (j.error && !j.series) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  if (err) return <div className="options-research"><p className="onote">The Ramp AI Index could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Loading the Ramp AI Index…</p></div>;

  const last = d.series.at(-1), ago = d.series.find(r => r.m === d.yearAgo);
  const labs = d.vendors.filter(v => d.series.some(r => (r[v] ?? 0) >= 1));
  const t = d.tokens, ant = t?.spendShare?.find(x => x.name === "Anthropic"), oai = t?.spendShare?.find(x => x.name === "OpenAI"), blend = t?.price?.find(x => /&/.test(x.name));
  const leader = labs[0];
  const spendX = finite(last.median) && finite(ago?.median) && ago.median > 0 ? last.median / ago.median : null;
  const rows = who === "industry" ? d.byIndustry : d.bySize;

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Ramp AI Index · card and bill-pay data from 85,000-odd U.S. businesses · to ${mon(d.asOf)}`} title="What businesses actually pay for AI"
        finding={`${pct(last.overall)} of businesses on Ramp paid for AI in ${mon(d.asOf)}, against ${pct(ago?.overall)} a year earlier. ${leader} now leads on adoption (${pct(last[leader])} of businesses, from ${pct(ago?.[leader])}), and the median firm paying for AI spends ${usd(last.median)} per employee a month${spendX ? `, ${spendX.toFixed(1)}× a year ago` : ""}. AI is ${pct(last.share, 2)} of all non-payroll business spend.${t ? ` In API tokens, ${ant ? `Anthropic takes ${pct(ant.latest)} of spend` : ""}${oai ? ` and OpenAI ${pct(oai.latest)}` : ""}, and token spending rose ${pct(t.spendGrowth)} on a month earlier while volume rose ${pct(t.volumeGrowth)}: prices are falling.` : ""}`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Businesses paying for AI" value={pct(last.overall)} sub={`${pp(last.overall - (ago?.overall ?? NaN))} on a year; ${mon(d.asOf)}`} />
          {labs.slice(0, 2).map(v => <Kpi key={v} label={`Paying ${v}`} value={pct(last[v])} sub={`${pp(last[v] - (ago?.[v] ?? NaN))} on a year`} tone={LAB_COLOR[v]} />)}
          <Kpi label="AI spend per employee" value={`${usd(last.median)}/mo`} sub={`median firm paying for AI; top 1%: ${usd(last.top1)}`} />
          <Kpi label="AI share of business spend" value={pct(last.share, 2)} sub={`non-payroll; ${pct(ago?.share, 2)} a year ago`} />
          {t && <Kpi label="Token spend share, Anthropic" value={pct(ant?.latest)} sub={`week ending ${t.week}; ${pct(ant?.prior)} a month before`} tone={LAB_COLOR.Anthropic} />}
          {blend && <Kpi label="Blended token price" value={`$${blend.latest.toFixed(2)}/M`} sub={`OpenAI and Anthropic; $${blend.prior?.toFixed(2)} a month before`} />}
        </div>
        {d.error && <p className="onote">The page could not be read on the last try ({d.error}); showing the copy from {d.fetched?.slice(0, 10)}.</p>}
      </VizCard>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow="Share of businesses with a paid AI transaction in the month" title="Adoption, and which lab"
          finding={`${leader} passed ${labs[1]} in the past year: ${labs.slice(0, 2).map(v => `${v} ${pct(ago?.[v])} → ${pct(last[v])}`).join(", ")}. A business can pay more than one.`}
          table={<table className="otable"><thead><tr><th style={left}>Month</th><th style={right}>All</th>{labs.map(v => <th key={v} style={right}>{v}</th>)}</tr></thead><tbody>{d.series.slice(-13).map(r => <tr key={r.m}><td style={left}>{mon(r.m)}</td><td style={right}>{pct(r.overall)}</td>{labs.map(v => <td key={v} style={right}>{pct(r[v])}</td>)}</tr>)}</tbody></table>}>
          <Legend items={[["All businesses", "var(--text-primary)"], ...labs.map(v => [v, LAB_COLOR[v]])]} />
          <div className="ochart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="m" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={mon} minTickGap={40} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={mon} formatter={(v, n) => [pct(v), n]} />
                <Line dataKey="overall" name="All businesses" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                {labs.map(v => <Line key={v} dataKey={v} name={v} stroke={LAB_COLOR[v]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </VizCard>

        <VizCard eyebrow="Among firms paying for AI · per employee per month · log scale" title="How much they spend"
          finding={`The median firm spends ${usd(last.median)} per employee a month, the top 10% ${usd(last.top10)} and the top 1% ${usd(last.top1)}. A year ago: ${usd(ago?.median)}, ${usd(ago?.top10)} and ${usd(ago?.top1)}.`}
          table={<table className="otable"><thead><tr><th style={left}>Month</th><th style={right}>Median</th><th style={right}>Top 10%</th><th style={right}>Top 1%</th><th style={right}>Share of spend</th></tr></thead><tbody>{d.series.slice(-13).map(r => <tr key={r.m}><td style={left}>{mon(r.m)}</td><td style={right}>{usd(r.median)}</td><td style={right}>{usd(r.top10)}</td><td style={right}>{usd(r.top1)}</td><td style={right}>{pct(r.share, 2)}</td></tr>)}</tbody></table>}>
          <Legend items={[["Median firm", C[1]], ["Top 10%", C[2]], ["Top 1%", C[3]]]} />
          <div className="ochart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.series.filter(r => finite(r.median))} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="m" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={mon} minTickGap={40} />
                <YAxis scale="log" domain={[1, "auto"]} allowDataOverflow tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={v => (v >= 1000 ? `$${v / 1000}k` : `$${v}`)} ticks={[1, 10, 100, 1000, 10000]} />
                <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={mon} formatter={(v, n) => [usd(v), n]} />
                <Line dataKey="median" name="Median firm" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="top10" name="Top 10%" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="top1" name="Top 1%" stroke={C[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="onote" style={{ marginTop: 4 }}>AI's share of all non-payroll business spend: {pct(last.share, 2)} in {mon(d.asOf)}, {pct(ago?.share, 2)} a year earlier (in the table view).</p>
        </VizCard>
      </div>

      <div className="ogrid ogrid-2">
        {t && <VizCard eyebrow={`API tokens · week ending ${t.week} against the same week a month earlier`} title="Token spend, volume and price by lab"
          finding={`Token spending rose ${pct(t.spendGrowth)} and volume ${pct(t.volumeGrowth)}, so the blended price fell${blend ? ` from $${blend.prior?.toFixed(2)} to $${blend.latest.toFixed(2)} per million tokens` : ""}. Ramp publishes only the latest week against a month earlier; this dashboard keeps each week it sees (${d.tokenHistory.length} so far).`}>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={left}>Lab</th><th style={right}>Share of spend</th><th style={right}>A month before</th><th style={right}>Share of volume</th><th style={right}>A month before</th></tr></thead>
              <tbody>{[...new Set([...t.spendShare, ...t.volumeShare].map(x => x.name))].map(n => { const sp = t.spendShare.find(x => x.name === n), vo = t.volumeShare.find(x => x.name === n); return (
                <tr key={n}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{LAB_COLOR[n] && <i aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: LAB_COLOR[n], marginRight: 6 }} />}{n}</td><td style={right}>{pct(sp?.latest)}</td><td style={{ ...right, color: "var(--text-secondary)" }}>{pct(sp?.prior)}</td><td style={right}>{pct(vo?.latest)}</td><td style={{ ...right, color: "var(--text-secondary)" }}>{pct(vo?.prior)}</td></tr>); })}</tbody>
            </table>
          </div>
          <div className="otable-wrap" style={{ marginTop: 8 }}>
            <table className="otable">
              <thead><tr><th style={left}>Blended price per million tokens</th><th style={right}>Latest</th><th style={right}>A month before</th><th style={right}>Change</th></tr></thead>
              <tbody>{t.price.map(p => <tr key={p.name}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{p.name}</td><td style={right}>${p.latest?.toFixed(2)}</td><td style={{ ...right, color: "var(--text-secondary)" }}>{finite(p.prior) ? `$${p.prior.toFixed(2)}` : "—"}</td><td style={right}>{finite(p.prior) && p.prior > 0 ? `${((p.latest / p.prior - 1) * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="onote" style={{ marginTop: 4 }}>Blended price is token spend over token volume, input and output together, for businesses buying API access through Ramp: a realized price, not a list price. Compare with the Ornn realized token price index on Models &amp; Labs and OpenRouter's volumes above.</p>
        </VizCard>}

        <VizCard eyebrow={`Adoption in ${mon(d.asOf)} and its change on a year`} title="Who is adopting"
          right={<Seg label="Breakdown" value={who} onChange={setWho} options={[["industry", "By industry"], ["size", "By size"]]} />}
          finding={who === "industry" ? "Every industry is up on the year. Where Ramp publishes them, the columns on the right show what AI already is in each industry's budget: its share of non-payroll spend, and spend per employee at the median firm paying for it." : "Mid-sized firms adopt most; the smallest least. Enterprise adoption trails because a large firm often buys AI through channels Ramp does not see (cloud contracts, enterprise agreements)."}>
          <div className="otable-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="otable">
              <thead><tr><th style={left}>{who === "industry" ? "Industry" : "Size"}</th><th style={right}>Adoption</th><th style={left}></th><th style={right}>On a year</th>{who === "industry" && <><th style={right}>AI share of spend</th><th style={right}>Per employee</th></>}</tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.name}>
                  <td style={{ ...left, fontFamily: "var(--font-body)", whiteSpace: "normal", minWidth: 160 }}>{r.name}</td>
                  <td style={right}>{pct(r.latest)}</td>
                  <td style={left}><svg width={90} height={10} role="img" aria-label={`${pct(r.latest)} of businesses`} style={{ display: "block" }}><rect x={0} y={1} width={90} height={8} rx={2} fill="var(--border-subtle)" />{finite(r.yearAgo) && <rect x={0} y={1} width={(r.yearAgo / 100) * 90} height={8} rx={2} fill={C[1]} opacity={0.35} />}<rect x={0} y={1} width={(r.latest / 100) * 90} height={8} rx={2} fill={C[1]} opacity={0.85} /></svg></td>
                  <td style={right}>{pp(r.change)}</td>
                  {who === "industry" && <><td style={right}>{pct(r.spendShare, 2)}</td><td style={right}>{finite(r.pepm) ? `${usd(r.pepm)}/mo` : "—"}</td></>}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Legend items={[["Now", `color-mix(in srgb, ${C[1]} 85%, transparent)`], ["A year ago", `color-mix(in srgb, ${C[1]} 35%, transparent)`]]} />
        </VizCard>
      </div>
      <p className="onote">Source: <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)" }}>Ramp AI Index</a> ({d.source}; the adoption series are also on FRED as {d.fred.slice(0, 3).join(", ")} and others). {d.notes.join(" ")}</p>
    </div>
  );
}
