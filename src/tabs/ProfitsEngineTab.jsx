import React, { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

/* ── Profits Engine — the Kalecki-Levy decomposition ─────────────────────────
   Profits = Investment + Dividends − Household Saving − Gov Saving − RoW Saving
   (Variant Perception / Levy Forecasting framing.) Every driver charted as a
   signed contribution in % of GDP, with actual profits overlaid — so "where
   do profits come from" is one picture. Data: /api/kalecki (NIPA via FRED). */

const DRIVERS = [
  { key: "gov", label: "Government deficit", color: "#f87171" },
  { key: "hh",  label: "Household (dis)saving", color: "#fbbf24" },
  { key: "inv", label: "Net investment", color: "#4ade80" },
  { key: "div", label: "Dividends", color: "#818cf8" },
  { key: "row", label: "Rest of world", color: "#64748b" },
];

const chartTooltip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };

function StackedContribChart({ rows, height = 300, xFmt }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }} stackOffset="sign">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={xFmt} minTickGap={30} />
        <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
        <Tooltip contentStyle={chartTooltip} formatter={(v, n) => [`${(+v).toFixed(2)}pp`, n]} labelFormatter={xFmt} />
        <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
        <ReferenceLine y={0} stroke="rgba(148,163,184,0.4)" />
        {DRIVERS.map(dr => (
          <Bar key={dr.key} dataKey={dr.key} name={dr.label} stackId="k" fill={dr.color} fillOpacity={0.75} isAnimationActive={false} />
        ))}
        <Line type="monotone" dataKey="actual" name="Actual profits (% GDP)" stroke="#f1f5f9" strokeWidth={2.2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function ProfitsEngineTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/kalecki")
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setData(d); })
      .catch(() => setError(true));
  }, []);

  if (error) return <InfoBox color="#F97316">Unable to load the Kalecki-Levy decomposition — FRED may be temporarily unavailable.</InfoBox>;
  if (!data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Decomposing corporate profits…</div>;

  const v = data.verdict, l = data.latest;
  const contribs = DRIVERS.map(dr => ({ ...dr, val: l[dr.key] })).sort((a, b) => b.val - a.val);
  const maxAbs = Math.max(...contribs.map(c => Math.abs(c.val)), 1);

  return (<>
    {/* ── Verdict hero ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: v.color }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
        Profits Engine — Kalecki-Levy Decomposition · {l.d.slice(0, 7)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: v.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{v.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>
          profits {l.actual.toFixed(1)}% of GDP · p{data.pct} · engine impulse {data.impulse >= 0 ? "+" : ""}{data.impulse}pp /4q
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, maxWidth: 900, lineHeight: 1.55 }}>{v.note}</div>
    </div>

    {/* ── Latest-quarter decomposition ── */}
    <SH>Where This Quarter&apos;s Profits Come From</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 22px", marginBottom: 14 }}>
      {contribs.map(c => {
        const w = (Math.abs(c.val) / maxAbs) * 46;
        const pos = c.val >= 0;
        return (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0" }}>
            <span style={{ width: 150, fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right", flexShrink: 0 }}>{c.label}</span>
            <div style={{ flex: 1, position: "relative", height: 16 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.16)" }} />
              <div style={{ position: "absolute", top: 2, bottom: 2, borderRadius: 3, background: c.color, opacity: 0.85, left: pos ? "50%" : `${50 - w}%`, width: `${w}%` }} />
            </div>
            <span style={{ width: 66, fontSize: 11.5, fontFamily: fonts.mono, fontWeight: 700, color: c.val >= 0 ? "#4ade80" : "#f87171", flexShrink: 0, textAlign: "right" }}>
              {c.val >= 0 ? "+" : ""}{c.val.toFixed(2)}pp
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 4 }}>
        <span style={{ width: 150, fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 700, textAlign: "right", flexShrink: 0 }}>= Profits (% GDP)</span>
        <div style={{ flex: 1 }} />
        <span style={{ width: 66, fontSize: 12.5, fontFamily: fonts.mono, fontWeight: 700, color: "#f1f5f9", flexShrink: 0, textAlign: "right" }}>{l.actual.toFixed(2)}%</span>
      </div>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 8, lineHeight: 1.5 }}>
        Signed contributions in percentage points of GDP (identity closes to within ~{data.identity.medianResidual}pp — the NIPA statistical discrepancy). Positive household bar = households dissaving into corporate revenue; positive government bar = the deficit doing the same.
      </div>
    </div>

    {/* ── The long history ── */}
    <SH>Six Decades of Profit Engines — Annual, % of GDP</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <StackedContribChart rows={data.annual} height={320} xFmt={d => d} />
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        The white line is actual after-tax profits as % of GDP; the stacked bars are the engines. Watch the red bar: the Clinton surplus years (negative red = fiscal drag), the 2009/2020 spikes (deficits carrying profits through collapse), and the post-2020 era — profits at record GDP share with the deficit as standing support. When the red shrinks, something else must grow, or the white line falls. That is the whole fiscal-cliff-for-margins argument in one chart.
      </div>
    </div>

    {/* ── Recent quarters ── */}
    <SH>The Last Four Years — Quarterly Detail</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <StackedContribChart rows={data.quarterly} height={260} xFmt={d => String(d).slice(0, 7)} />
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>Your savings-rate + fiscal instinct, systematized.</strong> You&apos;ve used the savings rate and fiscal impulse as bullish tells — this identity is why they work: every dollar households dissave and every dollar of deficit is, by accounting necessity, someone&apos;s revenue, and it lands disproportionately in corporate profits. The framework&apos;s honest limits: it&apos;s an <em>identity, not a forecast</em> — it tells you where profits came from and which engine is load-bearing, not when the engine cuts out. Read it for QUALITY and FRAGILITY: investment-driven profits compound; deficit-driven profits (today&apos;s regime, +{l.gov.toFixed(1)}pp) depend on Washington&apos;s willingness to keep borrowing ~6% of GDP; household-dissaving-driven profits exhaust themselves. Pair with the Consumer tab (savings rate) and Fed. Budget tab (the deficit&apos;s path) — those two series ARE the forward-looking inputs to this lens.
    </InfoBox>
  </>);
}
