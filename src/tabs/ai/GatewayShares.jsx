import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { finite, C, VizCard, Kpi, Seg, Legend, axisTick, gridProps, tipStyle, tipLabel } from "../options/ui.jsx";
import "../options/OptionsResearch.css";

// ============================================================================
// GATEWAY SHARES — AI Economy → Tokens: managed inference as a second router
// shows it (server/gatewayShares.js). Vercel's AI Gateway publishes shares of
// tokens and of spend by lab and model; OpenRouter, the other public router,
// is already on this tab. Shares only: nothing here is a volume.
//   open       the open-weights labs' share of tokens and of spend by week, and
//              the share of tokens that cost nothing
//   labs       weekly share by lab, tokens or spend, for the five labs that
//              matter most now (the rest folded into one grey line)
//   table      the past 7 days by lab: token share, spend share, their ratio,
//              the change in eight weeks, and the same lab on OpenRouter
//   models     the same for the 15 most-used models
// A lab keeps its colour whichever view is showing; labs beyond the five
// fixed slots are grey and named in the table.
// ============================================================================

const LAB_COLOR = { anthropic: C[2], openai: C[3], google: C[1], deepseek: C[5], zai: C[4] };
const pctv = (v, dp = 1) => (finite(v) ? `${v.toFixed(dp)}%` : "—");
const pp = v => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} pt` : "—");
const ratio = v => (!finite(v) ? "—" : v === 0 ? "free" : `${v.toFixed(2)}×`);
const wk = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const mon = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : "");
const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const left = { textAlign: "left" }, right = { textAlign: "right" };

export default function GatewayShares() {
  const [d, setD] = useState(null), [err, setErr] = useState(null), [metric, setMetric] = useState("tokens");
  useEffect(() => { let live = true; fetch("/api/gateway-shares").then(r => r.json()).then(j => { if (live) { if (j.error && !j.labs) setErr(j.error); else setD(j); } }).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  // the five labs drawn: the fixed-colour ones that have reached 5% of tokens or spend, in a fixed order
  const drawn = useMemo(() => (d ? Object.keys(LAB_COLOR).filter(k => d.shown.some(s => s.key === k)) : []), [d]);
  const series = useMemo(() => (d ? d.weekly[metric].map(r => ({ w: r.w, ...Object.fromEntries(drawn.map(k => [k, r[k]])), rest: Math.round((100 - drawn.reduce((s, k) => s + (r[k] || 0), 0)) * 10) / 10 })) : []), [d, metric, drawn]);
  if (err) return <div className="options-research"><p className="onote">The gateway shares could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="onote">Reading the Vercel AI Gateway leaderboards…</p></div>;

  const byTok = d.labs[0], bySpend = [...d.labs].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0], name = k => d.shown.find(s => s.key === k)?.name || k;
  const paid = d.labs.filter(l => l.priceRatio > 0), dear = [...paid].sort((a, b) => b.priceRatio - a.priceRatio)[0], cheap = [...paid].filter(l => l.tokens >= 2 && l.priceRatio >= 0.05).sort((a, b) => a.priceRatio - b.priceRatio)[0];
  const free = d.weekly.open.at(-1)?.free, open0 = d.weekly.open[0];
  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <VizCard eyebrow={`Vercel AI Gateway · text models · shares, not volumes · 7 days to ${day(d.asOf)}`} title="Managed inference: what a second router routes to"
        finding={`Open-weights labs carry ${pctv(d.open.tokens, 0)} of the gateway's tokens but ${pctv(d.open.spend, 0)} of its spend${finite(d.open.openRouter) ? ` (on OpenRouter they are ${pctv(d.open.openRouter, 0)} of tokens)` : ""}; in ${new Date(`${d.from}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })} they were ${pctv(open0?.tokens, 0)} of tokens. ${byTok.name} leads on tokens (${pctv(byTok.tokens, 0)}) and ${bySpend.name} on spend (${pctv(bySpend.spend, 0)}).${dear && cheap ? ` ${dear.name}'s tokens cost ${dear.priceRatio.toFixed(1)}× the gateway's average token and ${cheap.name}'s ${cheap.priceRatio.toFixed(2)}×.` : ""}${finite(free) && free >= 1 ? ` ${pctv(free, 0)} of tokens last week were free.` : ""}`}
        style={{ marginBottom: 12 }}>
        <div className="okpis" style={{ marginBottom: 10 }}>
          <Kpi label="Open-weights share of tokens" value={pctv(d.open.tokens, 0)} sub={`on Vercel; ${finite(d.open.openRouter) ? `${pctv(d.open.openRouter, 0)} on OpenRouter` : "OpenRouter unread"}`} tone={C[3]} />
          <Kpi label="Open-weights share of spend" value={pctv(d.open.spend, 0)} sub="the money still goes to closed labs" tone={C[1]} />
          <Kpi label="Most tokens" value={byTok.name} sub={`${pctv(byTok.tokens)} of tokens, ${pctv(byTok.spend)} of spend`} />
          <Kpi label="Most spend" value={bySpend.name} sub={`${pctv(bySpend.spend)} of spend on ${pctv(bySpend.tokens)} of tokens`} />
          {finite(free) && <Kpi label="Free tokens" value={pctv(free, 0)} sub="labs with tokens and no spend last week: launch promotions" />}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 14 }}>
          <div>
            <div className="ocard-eyebrow" style={{ marginBottom: 4 }}>Open-weights labs · share of tokens and of spend · weekly</div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.weekly.open} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="w" tick={axisTick} tickFormatter={mon} minTickGap={36} />
                  <YAxis tick={axisTick} tickFormatter={v => `${v}%`} domain={[0, "auto"]} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={w => `Week of ${wk(w)}`} formatter={(v, k) => [`${v}%`, k]} />
                  <Line name="Share of tokens" dataKey="tokens" stroke={C[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name="Share of spend" dataKey="spend" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name="Free tokens" dataKey="free" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[["Share of tokens", C[3]], ["Share of spend", C[1]], ["Free tokens (any lab)", "var(--text-muted)", true]]} />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <div className="ocard-eyebrow">By lab · share of {metric} · weekly</div>
              <Seg label="Measure" value={metric} onChange={setMetric} options={[["tokens", "Tokens"], ["spend", "Spend"]]} />
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 22, bottom: 0, left: -14 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="w" tick={axisTick} tickFormatter={mon} minTickGap={36} />
                  <YAxis tick={axisTick} tickFormatter={v => `${v}%`} domain={[0, "auto"]} />
                  <Tooltip contentStyle={tipStyle} labelStyle={tipLabel} labelFormatter={w => `Week of ${wk(w)}`} formatter={(v, k) => [`${v}%`, k]} />
                  <Line name="All other labs" dataKey="rest" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  {drawn.map(k => <Line key={k} name={name(k)} dataKey={k} stroke={LAB_COLOR[k]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[...drawn.map(k => [name(k), LAB_COLOR[k]]), ["All other labs", "var(--text-muted)", true]]} />
          </div>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>By lab · {day(d.window[0])} to {day(d.window[1])}{d.openRouterWeek ? ` · OpenRouter week of ${wk(d.openRouterWeek)}` : ""}</div>
        <div className="otable-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Lab</th><th style={left}>Weights</th><th style={right}>Token share</th><th style={right}>Spend share</th><th style={right} title="Spend share over token share: what its tokens cost against the gateway's average token">Price ratio</th><th style={right}>Token share, 8-wk change</th><th style={right}>On OpenRouter</th></tr></thead>
            <tbody>{d.labs.filter(l => l.tokens >= 0.3 || l.spend >= 0.3).map(l => (
              <tr key={l.key}>
                <td style={{ ...left, fontFamily: "var(--font-body)" }}>{LAB_COLOR[l.key] && <i aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: LAB_COLOR[l.key], marginRight: 6 }} />}{l.name}</td>
                <td style={{ ...left, fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{l.open ? "open" : "closed"}</td>
                <td style={{ ...right, fontWeight: 600 }}>{pctv(l.tokens)}</td><td style={right}>{pctv(l.spend)}</td>
                <td style={right}>{ratio(l.priceRatio)}</td>
                <td style={{ ...right, color: !finite(l.change8w) || l.change8w === 0 ? "var(--text-muted)" : l.change8w > 0 ? C[1] : C[2] }}>{pp(l.change8w)}</td>
                <td style={{ ...right, color: "var(--text-secondary)" }}>{pctv(l.openRouter)}</td>
              </tr>))}</tbody>
          </table>
        </div>

        <div className="ocard-eyebrow" style={{ margin: "12px 0 4px" }}>The 15 most-used models on the gateway</div>
        <div className="otable-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={left}>Model</th><th style={right}>Token share</th><th style={right}>Spend share</th><th style={right}>Price ratio</th></tr></thead>
            <tbody>{d.models.map(m => (
              <tr key={m.name}><td style={{ ...left, fontFamily: "var(--font-body)" }}>{m.name}</td><td style={{ ...right, fontWeight: 600 }}>{pctv(m.tokens)}</td><td style={right}>{finite(m.spend) ? pctv(m.spend) : <span style={{ color: "var(--text-muted)" }}>free</span>}</td><td style={right}>{finite(m.spend) ? ratio(m.priceRatio) : "—"}</td></tr>))}</tbody>
          </table>
        </div>
        <ul className="onote" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Source: <a href={d.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{d.license}</a>, read {day(d.fetched.slice(0, 10))}; OpenRouter from this dashboard's archive.{d.error ? ` The latest read failed (${d.error}); this is the last good copy.` : ""}</li>
        </ul>
      </VizCard>
    </div>
  );
}
