import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, BarChart, Bar, ReferenceLine, Cell } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { CPI_SERIES, CPI_COMPONENTS, PCE_COMPONENTS } from "../lib/constants.js";
import { fmtDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

/* ── tiny clickable wrapper around RateCard ── */
function ClickableCard({ onClick, expanded, children }) {
  return (
    <div onClick={onClick} style={{ cursor: "pointer", position: "relative" }}>
      {children}
      <div style={{ position: "absolute", top: 8, right: 12, fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
        {expanded ? "▲ hide" : "▼ details"}
      </div>
    </div>
  );
}

/* ── horizontal bar row for a single component ── */
function ComponentBar({ label, value, color, maxAbs, isQuarterly }) {
  if (value == null) return null;
  const pct = maxAbs > 0 ? Math.abs(value) / maxAbs : 0;
  const isNeg = value < 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <div style={{ width: 170, fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
        {label}{isQuarterly ? <span style={{ fontSize: 8, color: "var(--text-muted)", marginLeft: 3 }}>Q</span> : null}
      </div>
      <div style={{ flex: 1, height: 18, background: "rgba(255,255,255,0.04)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          [isNeg ? "right" : "left"]: "50%",
          width: `${pct * 50}%`,
          background: isNeg ? "#EF4444" : color,
          borderRadius: 4,
          opacity: 0.85,
          transition: "width 0.4s ease"
        }} />
        {/* center zero line */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.15)" }} />
      </div>
      <div style={{ width: 54, fontSize: 11, fontWeight: 600, color: isNeg ? "#f87171" : "#4ade80", fontFamily: fonts.mono, textAlign: "right", flexShrink: 0 }}>
        {value > 0 ? "+" : ""}{value.toFixed(1)}%
      </div>
    </div>
  );
}

/* ── group header row ── */
function GroupHeader({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 6px" }}>
      <div style={{ width: 170, fontSize: 10, fontWeight: 600, color: "var(--text-muted)", fontFamily: fonts.heading, textAlign: "right", textTransform: "uppercase", letterSpacing: 0.8, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
    </div>
  );
}

/* ── expandable component breakdown panel ── */
function ComponentPanel({ components, cd, headline, headlineColor }) {
  const items = Object.entries(components)
    .map(([id, m]) => ({ id, label: m.label, color: m.color, group: m.group, freq: m.freq, yoy: cd[id]?.yoy }))
    .filter(x => x.yoy != null);
  if (!items.length) return <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 11, fontFamily: fonts.mono }}>Loading component data...</div>;
  const maxAbs = Math.max(...items.map(x => Math.abs(x.yoy)), 0.1);

  // Group items, then sort within each group by yoy descending
  const groups = [];
  const seen = new Set();
  // Preserve original group order from constants definition
  for (const item of items) {
    if (!seen.has(item.group)) { seen.add(item.group); groups.push(item.group); }
  }
  const grouped = groups.map(g => ({ group: g, items: items.filter(x => x.group === g).sort((a, b) => b.yoy - a.yoy) }));

  return (
    <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, animation: "fadeIn 0.3s ease" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: headlineColor, fontFamily: fonts.heading, marginBottom: 4, letterSpacing: 0.3 }}>{headline}</div>
      {grouped.map(g => (
        <div key={g.group}>
          <GroupHeader label={g.group} />
          {g.items.map(x => <ComponentBar key={x.id} label={x.label} value={x.yoy} color={x.color} maxAbs={maxAbs} isQuarterly={x.freq === "Q"} />)}
        </div>
      ))}
      <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 8 }}>
        Latest: {cd[items[0]?.id]?.lastDate ? fmtDate(cd[items[0].id].lastDate) : "—"} · YoY % change · <span style={{ fontStyle: "italic" }}>Q = quarterly frequency</span>
      </div>
    </div>
  );
}

/* ── BLS CPI Category Section ── */
const BLS_CATEGORIES = [
  { id: "CUSR0000SA0",    label: "All Items",        color: "#E8553A", icon: "📦" },
  { id: "CUSR0000SA0L1E", label: "Core CPI",         color: "#3B82F6", icon: "🎯" },
  { id: "CUSR0000SAF1",   label: "Food",             color: "#F97316", icon: "🍎" },
  { id: "CUSR0000SA0E",   label: "Energy",           color: "#FBBF24", icon: "⚡" },
  { id: "CUSR0000SAH1",   label: "Shelter",          color: "#60A5FA", icon: "🏠" },
  { id: "CUSR0000SAM",    label: "Medical Care",     color: "#EC4899", icon: "🏥" },
  { id: "CUSR0000SAT",    label: "Transportation",   color: "#10B981", icon: "🚗" },
  { id: "CUSR0000SAA",    label: "Apparel",          color: "#8B5CF6", icon: "👕" },
  { id: "CUSR0000SAR",    label: "Recreation",       color: "#14B8A6", icon: "🎮" },
  { id: "CUSR0000SAE",    label: "Education & Comm", color: "#6366F1", icon: "📚" },
  { id: "CUSR0000SETA02", label: "Used Cars",        color: "#34D399", icon: "🚙" },
  { id: "CUSR0000SETA01", label: "New Vehicles",     color: "#4ADE80", icon: "🚘" },
];

function BLSCpiSection() {
  const [blsData, setBlsData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/bls-cpi")
      .then(r => r.json())
      .then(setBlsData)
      .catch(e => console.error("BLS CPI error:", e))
      .finally(() => setLoading(false));
  }, []);

  const fmtMonth = (d) => {
    if (!d) return "";
    const [y, m] = d.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[+m - 1]} ${y}`;
  };

  // Build category bar chart data (exclude All Items and Core CPI — those are KPI tiles)
  const catBarData = useMemo(() => {
    if (!blsData) return [];
    return BLS_CATEGORIES
      .filter(c => c.id !== "CUSR0000SA0" && c.id !== "CUSR0000SA0L1E")
      .map(c => {
        const s = blsData[c.id];
        return { name: c.label, value: s?.yoy ?? 0, color: c.color, icon: c.icon };
      })
      .sort((a, b) => a.value - b.value);
  }, [blsData]);

  // Build trend chart data for key categories
  const trendKeys = ["CUSR0000SA0", "CUSR0000SAF1", "CUSR0000SA0E", "CUSR0000SAH1", "CUSR0000SAT"];
  const trendData = useMemo(() => {
    if (!blsData) return [];
    const allHistory = blsData["CUSR0000SA0"]?.history || [];
    return allHistory.map(pt => {
      const row = { d: pt.d };
      for (const k of trendKeys) {
        const match = blsData[k]?.history?.find(h => h.d === pt.d);
        if (match) row[k] = match.v;
      }
      return row;
    });
  }, [blsData]);

  if (loading) return <div style={{ padding: 16, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 11 }}>Loading BLS CPI Category Data...</div>;
  if (!blsData) return (
    <div style={{ padding: 16, background: cardBg, border: cardBorder, borderRadius: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#F59E0B", fontFamily: fonts.heading, marginBottom: 4 }}>BLS CPI Data Unavailable</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>
        Daily BLS API request limit reached (25/day without key). Register for a free API key at{" "}
        <a href="https://data.bls.gov/registrationEngine/" target="_blank" rel="noopener" style={{ color: "#60A5FA" }}>data.bls.gov</a>{" "}
        to increase to 500/day. Limit resets at midnight ET.
      </div>
    </div>
  );

  const allItem = blsData["CUSR0000SA0"];
  const coreItem = blsData["CUSR0000SA0L1E"];

  return (<>
    <SH>BLS CPI Category Breakdown</SH>
    <InfoBox color="#E8553A">
      <strong style={{ color: "var(--text-primary)" }}>Bureau of Labor Statistics CPI</strong> — Official Consumer Price Index data directly from the BLS. Shows YoY % change for major spending categories. The CPI-U covers all urban consumers, roughly 93% of the U.S. population.
    </InfoBox>

    {/* KPI tiles for All Items + Core */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
      {[
        { data: allItem, label: "CPI All Items (YoY)", color: "#E8553A", icon: "📦", sub: "All urban consumers" },
        { data: coreItem, label: "Core CPI (YoY)", color: "#3B82F6", icon: "🎯", sub: "Less food & energy" },
      ].map(tile => (
        <div key={tile.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: tile.color, borderRadius: "14px 14px 0 0" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>{tile.icon}</span>
            <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{tile.label}</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: tile.data?.yoy > 2 ? "#f87171" : "#4ade80", fontFamily: fonts.heading, letterSpacing: -0.5 }}>
            {tile.data?.yoy != null ? `${tile.data.yoy > 0 ? "+" : ""}${tile.data.yoy.toFixed(2)}%` : "—"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, fontFamily: fonts.mono }}>
            {fmtMonth(tile.data?.lastDate)} · {tile.sub} · <span style={{ color: "#94a3b8" }}>Source: BLS</span>
          </div>
        </div>
      ))}
    </div>

    {/* Category bar chart */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px 8px", marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>CPI by Category — {fmtMonth(allItem?.lastDate)} (YoY %)</div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={catBarData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} />
          <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-secondary)", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} width={110} />
          <Tooltip
            contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }}
            formatter={(v) => [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, "YoY"]}
          />
          <ReferenceLine x={0} stroke="var(--border-subtle)" />
          <ReferenceLine x={2} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: "2% target", fill: "#F59E0B", fontSize: 9, fontFamily: fonts.mono }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {catBarData.map((entry, i) => (
              <Cell key={i} fill={entry.value > 2 ? "#f87171" : entry.value < 0 ? "#4ade80" : "#60a5fa"} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* Trend chart */}
    {trendData.length > 1 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>BLS CPI — Category Trends (YoY %)</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trendData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-bls-all" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#E8553A" stopOpacity={0.3} /><stop offset="95%" stopColor="#E8553A" stopOpacity={0} /></linearGradient>
              <linearGradient id="g-bls-food" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F97316" stopOpacity={0.2} /><stop offset="95%" stopColor="#F97316" stopOpacity={0} /></linearGradient>
              <linearGradient id="g-bls-energy" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#FBBF24" stopOpacity={0.2} /><stop offset="95%" stopColor="#FBBF24" stopOpacity={0} /></linearGradient>
              <linearGradient id="g-bls-shelter" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60A5FA" stopOpacity={0.2} /><stop offset="95%" stopColor="#60A5FA" stopOpacity={0} /></linearGradient>
              <linearGradient id="g-bls-trans" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.2} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={fmtMonth} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} />
            <Tooltip
              contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }}
              labelStyle={{ color: "var(--text-secondary)" }}
              labelFormatter={fmtMonth}
              formatter={(v, n) => [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, n]}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <ReferenceLine y={2} stroke="#F59E0B" strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="var(--border-subtle)" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="CUSR0000SA0" name="All Items" stroke="#E8553A" fill="url(#g-bls-all)" strokeWidth={2.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="CUSR0000SAF1" name="Food" stroke="#F97316" fill="url(#g-bls-food)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="CUSR0000SA0E" name="Energy" stroke="#FBBF24" fill="url(#g-bls-energy)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="CUSR0000SAH1" name="Shelter" stroke="#60A5FA" fill="url(#g-bls-shelter)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="CUSR0000SAT" name="Transportation" stroke="#10B981" fill="url(#g-bls-trans)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}
  </>);
}

function CpiTab({ cd }) {
  const [expandCPI, setExpandCPI] = useState(false);
  const [expandPCE, setExpandPCE] = useState(false);
  const [beaPce, setBeaPce] = useState(null);

  // Fetch BEA PCE data (replaces stale FRED PCE)
  useEffect(() => {
    fetch("/api/bea-pce")
      .then(r => r.json())
      .then(d => { if (d && d.PCEPI) setBeaPce(d); })
      .catch(e => console.error("BEA PCE error:", e));
  }, []);

  // Use BEA data for PCE if available, fall back to FRED
  const pceData = beaPce?.PCEPI || cd.PCEPI;
  const corePceData = beaPce?.PCEPILFE || cd.PCEPILFE;
  const pceSource = beaPce ? "BEA" : "FRED";

  // Merge CPI (FRED) + PCE (BEA or FRED) for the combined chart
  const cpiHistory = cd.CPIAUCSL?.history || [];
  const ic = useMemo(() => {
    const allDates = new Set();
    cpiHistory.forEach(h => allDates.add(h.d));
    (pceData?.history || []).forEach(h => allDates.add(h.d));
    const sorted = Array.from(allDates).sort();
    return sorted.map(d => {
      const row = { d };
      const cpi = cpiHistory.find(x => x.d === d);
      const coreCpi = cd.CPILFESL?.history?.find(x => x.d === d);
      const pce = pceData?.history?.find(x => x.d === d);
      const corePce = corePceData?.history?.find(x => x.d === d);
      if (cpi) row.CPIAUCSL = cpi.v;
      if (coreCpi) row.CPILFESL = coreCpi.v;
      if (pce) row.PCEPI = pce.v;
      if (corePce) row.PCEPILFE = corePce.v;
      return row;
    });
  }, [cpiHistory, cd.CPILFESL, pceData, corePceData]);

  const sv = cd.T10Y2Y?.current;
  const sc = sv != null ? (sv < 0 ? "#EF4444" : sv < 0.5 ? "#F59E0B" : "#10B981") : "#64748b";
  return (<>
    <SH>Inflation Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <ClickableCard onClick={() => setExpandCPI(v => !v)} expanded={expandCPI}>
        <RateCard label="CPI (YoY)" value={cd.CPIAUCSL?.yoy} color="#E8553A" subtitle="All items · click for breakdown" date={cd.CPIAUCSL?.lastDate} />
      </ClickableCard>
      <RateCard label="Core CPI (YoY)" value={cd.CPILFESL?.yoy} color="#3B82F6" subtitle="Less food & energy" date={cd.CPILFESL?.lastDate} />
      <ClickableCard onClick={() => setExpandPCE(v => !v)} expanded={expandPCE}>
        <RateCard label="PCE (YoY)" value={pceData?.yoy} color="#F97316" subtitle={`All items · ${pceSource} · click for breakdown`} date={pceData?.lastDate} />
      </ClickableCard>
      <RateCard label="Core PCE (YoY)" value={corePceData?.yoy} color="#10B981" subtitle={`Fed's target · ${pceSource}`} date={corePceData?.lastDate} />
    </div>
    {expandCPI && <ComponentPanel components={CPI_COMPONENTS} cd={cd} headline="CPI Component Breakdown — YoY %" headlineColor="#E8553A" />}
    {expandPCE && <ComponentPanel components={PCE_COMPONENTS} cd={cd} headline="PCE Component Breakdown — YoY %" headlineColor="#F97316" />}
    <InfoBox color="#3B82F6"><strong style={{ color: "#cbd5e1" }}>Why three measures?</strong> CPI tracks consumer prices (BLS). The Fed prefers Core PCE (BEA) because it captures broader spending and adjusts for substitution. Fed target: 2% Core PCE. {beaPce ? <span style={{ color: "#4ade80" }}>✓ PCE sourced from BEA</span> : <span style={{ color: "#F59E0B" }}>PCE from FRED (BEA loading…)</span>}</InfoBox>
    <ChartCard data={ic} series={{ CPIAUCSL: { label: "CPI All Items", color: "#E8553A" }, CPILFESL: { label: "Core CPI", color: "#3B82F6" }, PCEPI: { label: "PCE All Items", color: "#F97316" }, PCEPILFE: { label: "Core PCE", color: "#10B981" } }} title="Inflation Measures — YoY %" refLine={2} />

    {/* ── BLS CPI Category Breakdown ── */}
    <BLSCpiSection />

    <SH>Market Inflation Expectations</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="10-Year Breakeven" value={cd.T10YIE?.current} color="#F59E0B" subtitle="Market-implied inflation" date={cd.T10YIE?.lastDate} />
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: sc, borderRadius: "14px 14px 0 0" }} />
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>10Y-2Y YIELD SPREAD</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: sc, fontFamily: fonts.heading }}>{sv != null ? `${sv > 0 ? "+" : ""}${sv.toFixed(2)}%` : "—"}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{sv != null ? (sv < 0 ? "⚠ Inverted — recession signal" : sv < 0.5 ? "Flat — cautious" : "Normal — expansion") : ""}</div>
      </div>
    </div>
    <InfoBox color="#F59E0B"><strong style={{ color: "#cbd5e1" }}>Breakeven inflation</strong> = what bond traders expect inflation to average over 10 years. The <strong style={{ color: "#cbd5e1" }}>yield spread</strong> (10Y minus 2Y) historically inverts before recessions.</InfoBox>
    <ChartCard data={(cd.T10YIE?.history || []).map(h => ({ d: h.d, T10YIE: h.v }))} series={{ T10YIE: { label: "10Y Breakeven", color: "#F59E0B" } }} title="10-Year Breakeven Inflation Rate" refLine={2} />
    <div style={{ height: 14 }} />
    <ChartCard data={(cd.T10Y2Y?.history || []).map(h => ({ d: h.d, T10Y2Y: h.v }))} series={{ T10Y2Y: { label: "10Y-2Y Spread", color: "#8B5CF6" } }} title="Yield Curve Spread (10Y - 2Y)" refLine={0} />
  </>);
}

export default CpiTab;
