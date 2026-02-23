import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LineChart, Line, CartesianGrid, Area, AreaChart, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

const PRICING_TIERS = [
  { label: "Free",    color: "#10B981", test: p => p === 0 },
  { label: "Budget",  range: "< $1/M",      color: "#3B82F6",  test: p => p > 0 && p < 1 },
  { label: "Mid",     range: "$1 – $10/M",   color: "#F59E0B",  test: p => p >= 1 && p < 10 },
  { label: "Premium", range: "$10 – $50/M",  color: "#F97316",  test: p => p >= 10 && p < 50 },
  { label: "Ultra",   range: "$50+/M",       color: "#E8553A",  test: p => p >= 50 },
];
const CTX_TIERS = [
  { label: "< 16K",    color: "#8B5CF6", test: c => c < 16000 },
  { label: "16K–64K",  color: "#6366F1", test: c => c >= 16000 && c < 64000 },
  { label: "64K–200K", color: "#3B82F6", test: c => c >= 64000 && c < 200000 },
  { label: "200K–1M",  color: "#10B981", test: c => c >= 200000 && c < 1000000 },
  { label: "1M+",      color: "#F59E0B", test: c => c >= 1000000 },
];

const PROV_COLORS = ["#E8553A","#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#6366F1","#14B8A6","#F97316","#D946EF","#F2A93B","#4ECDC4","#818cf8","#94a3b8"];
const MOD_LABELS  = {
  "text->text": "Text → Text",
  "text+image->text": "Text + Image → Text",
  "text+image+file->text": "Text + Image + File → Text",
  "text+image+file+audio+video->text": "Full Multimodal",
  "text+image+video->text": "Text + Image + Video → Text",
  "text+audio->text+audio": "Audio I/O",
  "text+image->text+image": "Image Generation",
};

// ─── Sub-tab pill ───────────────────────────────────────────────────────────
function SubTab({ id, label, active, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: "7px 18px", borderRadius: 20, border: "none", cursor: "pointer",
        fontSize: 12, fontFamily: fonts.heading, fontWeight: 600, letterSpacing: 0.2,
        background: active ? "rgba(99,102,241,0.18)" : "transparent",
        color: active ? "#a5b4fc" : "#64748b",
        outline: active ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
        transition: "all 0.15s",
      }}
    >{label}</button>
  );
}

// ─── Stat card (reusable small card) ────────────────────────────────────────
function StatCard({ label, val, sub, color }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{sub}</div>}
    </div>
  );
}

// ─── Sort icon ───────────────────────────────────────────────────────────────
function SortIcon({ col, sortCol, sortAsc }) {
  if (sortCol !== col) return <span style={{ color: "#334155", marginLeft: 4 }}>⇅</span>;
  return <span style={{ color: "#a5b4fc", marginLeft: 4 }}>{sortAsc ? "↑" : "↓"}</span>;
}

// ═══════════════════════════════════════════════════════════
// SUB-TAB 1: ECONOMIC INDEX
// ═══════════════════════════════════════════════════════════
function EconomicIndexTab() {
  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.06)" };
  return (<>
    <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 4, letterSpacing: -0.5 }}>Anthropic Economic Index</div>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 18 }}>
      How AI is reshaping work — based on 2M Claude conversations (Nov 2025). Source:{" "}
      <a href="https://www.anthropic.com/economic-index" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>anthropic.com/economic-index</a>
    </div>

    <SH>The State of AI at Work</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      {[
        { label: "Jobs Using AI",  val: "49%",    sub: "≥25% of tasks (up from 36%)", color: "#8B5CF6" },
        { label: "Augmentation",   val: "52%",    sub: "Human-AI collaboration",       color: "#3B82F6" },
        { label: "Automation",     val: "45%",    sub: "AI handles task alone",         color: "#F97316" },
        { label: "Task Success",   val: "67%",    sub: "Claude.ai success rate",        color: "#10B981" },
        { label: "Productivity",   val: "+1.2pp", sub: "Est. annual growth",            color: "#E8553A" },
      ].map(c => <StatCard key={c.label} {...c} />)}
    </div>

    <SH>Augmentation vs. Automation</SH>
    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Augmentation has overtaken automation</strong> as of Nov 2025 (was 41%/55% in Jan 2025). "Directive" conversations fell from 39% to 32%, while "task iteration" (back-and-forth collaboration) grew.
    </InfoBox>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Augmentation vs. Automation Over Time (Claude.ai)</div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={[
          { d: "Jan 2025", aug: 41, auto: 55 }, { d: "Mar 2025", aug: 42, auto: 55 },
          { d: "Aug 2025", aug: 47, auto: 49 }, { d: "Nov 2025", aug: 52, auto: 45 },
        ]} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="g-aug" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} /><stop offset="95%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient>
            <linearGradient id="g-auto" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F97316" stopOpacity={0.25} /><stop offset="95%" stopColor="#F97316" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={[30, 60]} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}%`]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Area type="monotone" dataKey="aug"  name="Augmentation" stroke="#3B82F6" fill="url(#g-aug)"  strokeWidth={2} dot={{ r: 3 }} />
          <Area type="monotone" dataKey="auto" name="Automation"   stroke="#F97316" fill="url(#g-auto)" strokeWidth={2} dot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    <SH>AI Usage by Occupation</SH>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      {[
        { title: "Claude.ai Task Share", color: "#6366F1", data: [
          { name: "Computer & Math", share: 34 }, { name: "Education & Library", share: 15 },
          { name: "Management", share: 8 },        { name: "Arts & Entertainment", share: 7 },
          { name: "Business & Financial", share: 6 }, { name: "Office & Admin", share: 5 },
          { name: "Life & Physical Sci.", share: 4 }, { name: "Healthcare", share: 4 },
          { name: "Sales", share: 3 },               { name: "Legal", share: 3 },
          { name: "Architecture & Eng.", share: 2 }, { name: "Other", share: 9 },
        ]},
        { title: "API Task Share", color: "#E8553A", data: [
          { name: "Computer & Math", share: 46 }, { name: "Office & Admin", share: 13 },
          { name: "Management", share: 7 },        { name: "Business & Financial", share: 6 },
          { name: "Education & Library", share: 4 }, { name: "Sales", share: 4 },
          { name: "Arts & Entertainment", share: 4 }, { name: "Life & Physical Sci.", share: 3 },
          { name: "Legal", share: 3 },               { name: "Healthcare", share: 2 },
          { name: "Architecture & Eng.", share: 2 }, { name: "Other", share: 6 },
        ]},
      ].map(({ title, color, data }) => (
        <div key={title} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>{title}</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart layout="vertical" data={data} margin={{ top: 0, right: 12, left: 5, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}%`, "Share"]} />
              <Bar dataKey="share" radius={[0, 4, 4, 0]} fill={color} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Massive overrepresentation in tech.</strong> Computer & math roles = 37% of Claude conversations but only 3.4% of the workforce. Top 10 tasks account for 24% of Claude.ai usage. The #1 task is "modifying software to correct errors" at 6% of all Claude.ai conversations.
    </InfoBox>

    <SH>How People Use AI</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      {[{ label: "Work", val: "46%", color: "#E8553A" }, { label: "Personal", val: "35%", color: "#3B82F6" }, { label: "Coursework", val: "19%", color: "#10B981" }]
        .map(u => <StatCard key={u.label} label={u.label} val={u.val} sub="of Claude.ai usage" color={u.color} />)}
    </div>

    <SH>Who Benefits from AI?</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left" }}>Wage / Skill Tier</th>
          <th style={{ ...thStyle, textAlign: "right" }}>AI Adoption</th>
          <th style={{ ...thStyle, textAlign: "left", paddingLeft: 20 }}>Pattern</th>
        </tr></thead>
        <tbody>
          {[
            { tier: "Lowest wage (<$30K)",    adoption: "Minimal",  pattern: "Physical/manual work limits AI use",                   color: "#64748b" },
            { tier: "Low-mid ($30K–$50K)",    adoption: "Low",      pattern: "Some admin/clerical tasks automated",                  color: "#94a3b8" },
            { tier: "Mid wage ($50K–$80K)",   adoption: "Moderate", pattern: "Growing use in education, office, sales roles",        color: "#3B82F6" },
            { tier: "Mid-high ($80K–$150K)",  adoption: "Highest",  pattern: "Software dev, copywriting, data analysis — peak AI",   color: "#10B981" },
            { tier: "Highest wage (>$200K)",  adoption: "Minimal",  pattern: "Hands-on expertise limits AI (surgeons, executives)",  color: "#64748b" },
          ].map((row, i, arr) => (
            <tr key={row.tier} style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>{row.tier}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: row.color, textAlign: "right", fontWeight: 600 }}>{row.adoption}</td>
              <td style={{ padding: "10px 12px 10px 20px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{row.pattern}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <SH>Global AI Adoption</SH>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      {[
        { title: "Per Capita Usage Index (Sept 2025)", data: [
          { name: "Israel", aui: 7.0 }, { name: "Singapore", aui: 4.6 }, { name: "Australia", aui: 4.1 },
          { name: "New Zealand", aui: 4.1 }, { name: "South Korea", aui: 3.7 }, { name: "United States", aui: 3.6 },
          { name: "Canada", aui: 2.9 }, { name: "United Kingdom", aui: 2.7 }, { name: "Indonesia", aui: 0.4 },
          { name: "India", aui: 0.3 }, { name: "Nigeria", aui: 0.2 },
        ], maxDomain: 8, labelW: 85 },
        { title: "Top U.S. States", data: [
          { name: "Washington DC", aui: 3.82 }, { name: "Utah", aui: 3.78 }, { name: "California", aui: 2.13 },
          { name: "Washington", aui: 1.92 }, { name: "Colorado", aui: 1.85 }, { name: "New York", aui: 1.58 },
          { name: "Virginia", aui: 1.57 }, { name: "Massachusetts", aui: 1.55 }, { name: "Texas", aui: 1.12 },
          { name: "US Average", aui: 1.0 },
        ], maxDomain: 4.5, labelW: 95 },
      ].map(({ title, data, maxDomain, labelW }) => (
        <div key={title} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>{title}</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart layout="vertical" data={data} margin={{ top: 0, right: 12, left: 5, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={[0, maxDomain]} tickFormatter={v => `${v}x`} />
              <YAxis type="category" dataKey="name" width={labelW} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}x`, "Usage Index"]} />
              <ReferenceLine x={1.0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
              <Bar dataKey="aui" radius={[0, 4, 4, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.aui >= 3 ? "#10B981" : d.aui >= 1 ? "#3B82F6" : "#64748b"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>Adoption correlates with GDP & tech workforce.</strong> 1% higher GDP per capita = 0.7% more AI usage. Top 5 U.S. states = 50% of usage. Gini fell from 0.37 to 0.32 in 3 months — projected state-level parity in 2–5 years, 10x faster than historical tech diffusion.
    </InfoBox>
  </>);
}

// ═══════════════════════════════════════════════════════════
// SUB-TAB 2: MODEL MARKET
// ═══════════════════════════════════════════════════════════
function ModelMarketTab({ models }) {
  const prices     = models.map(m => parseFloat(m.pricing?.prompt || "0") * 1e6);
  const paidPrices = prices.filter(p => p > 0).sort((a, b) => a - b);
  const medianPrice = paidPrices.length ? paidPrices[Math.floor(paidPrices.length / 2)] : 0;

  const providers = {};
  models.forEach(m => { const p = m.id.split("/")[0]; providers[p] = (providers[p] || 0) + 1; });
  const provSorted    = Object.entries(providers).sort((a, b) => b[1] - a[1]);
  const provChartData = provSorted.slice(0, 14).map(([name, count]) => ({ name, count }));

  const tierCounts = PRICING_TIERS.map(t => ({ ...t, count: prices.filter(p => t.test(p)).length }));
  const ctxCounts  = CTX_TIERS.map(t => ({ ...t, count: models.filter(m => t.test(m.context_length)).length }));

  const withPrice    = models.map((m, i) => ({ ...m, inPrice: prices[i], outPrice: parseFloat(m.pricing?.completion || "0") * 1e6 }));
  const topExpensive = [...withPrice].filter(m => m.inPrice > 0).sort((a, b) => b.inPrice - a.inPrice).slice(0, 12);
  const cheapest     = [...withPrice].filter(m => m.inPrice > 0).sort((a, b) => a.inPrice - b.inPrice).slice(0, 10);

  const mods      = {};
  models.forEach(m => { const mo = m.architecture?.modality || "unknown"; mods[mo] = (mods[mo] || 0) + 1; });
  const modSorted = Object.entries(mods).sort((a, b) => b[1] - a[1]);

  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.06)" };

  return (<>
    <SH>Market Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Total Models"  val={models.length}       sub="Across all providers" color="#6366F1" />
      <StatCard label="Providers"     val={provSorted.length}   sub="Model authors"        color="#3B82F6" />
      <StatCard label="Free Models"   val={tierCounts[0].count} sub="No cost to use"       color="#10B981" />
      <StatCard label="Median Price"  val={`$${medianPrice.toFixed(2)}`} sub="Input $/M tokens" color="#F59E0B" />
    </div>

    <SH>Provider Market Share</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Models per Provider (Top 14)</div>
      <ResponsiveContainer width="100%" height={360}>
        <BarChart layout="vertical" data={provChartData} margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [v, "Models"]} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {provChartData.map((_, i) => <Cell key={i} fill={PROV_COLORS[i % PROV_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    <SH>Pricing Tiers</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 14 }}>
      {tierCounts.map(t => (
        <div key={t.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: t.color, borderRadius: "14px 14px 0 0" }} />
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{t.count}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{t.range || "$0"}</div>
        </div>
      ))}
    </div>

    {[
      { title: "Most Expensive Models", rows: topExpensive, priceColor: v => "#f87171", outColor: "#fb923c", fmt: v => `$${v.toFixed(2)}` },
      { title: "Cheapest Non-Free Models", rows: cheapest,     priceColor: v => "#4ade80", outColor: "#86efac", fmt: v => `$${v.toFixed(4)}` },
    ].map(({ title, rows, priceColor, outColor, fmt }) => (
      <React.Fragment key={title}>
        <SH>{title}</SH>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
            <thead><tr>
              <th style={{ ...thStyle, textAlign: "left" }}>Model</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Provider</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Input $/M</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Output $/M</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Context</th>
            </tr></thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.id} style={{ borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#e2e8f0", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{m.id.split("/")[0]}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: priceColor(m.inPrice), textAlign: "right", fontWeight: 600 }}>{fmt(m.inPrice)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: outColor, textAlign: "right" }}>{fmt(m.outPrice)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{m.context_length >= 1e6 ? `${(m.context_length/1e6).toFixed(1)}M` : `${(m.context_length/1e3).toFixed(0)}K`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </React.Fragment>
    ))}

    <SH>Context Window Distribution</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 14 }}>
      {ctxCounts.map(t => (
        <div key={t.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: t.color, borderRadius: "14px 14px 0 0" }} />
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{t.count}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>models</div>
        </div>
      ))}
    </div>

    <SH>Model Capabilities</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left" }}>Modality</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Models</th>
          <th style={{ ...thStyle, textAlign: "right" }}>% of Total</th>
        </tr></thead>
        <tbody>
          {modSorted.map(([mod, count], i) => (
            <tr key={mod} style={{ borderBottom: i < modSorted.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>{MOD_LABELS[mod] || mod}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right", fontWeight: 600 }}>{count}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{(count / models.length * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

// ═══════════════════════════════════════════════════════════
// SUB-TAB 3: RANKINGS (live OpenRouter token usage data)
// ═══════════════════════════════════════════════════════════
const fmtTokens = n => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};
const fmtReqs = n => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return String(n);
};
const fmtPct = v => {
  if (v == null) return "new";
  const pct = (v * 100).toFixed(1);
  return v >= 0 ? `+${pct}%` : `${pct}%`;
};
const pctColor = v => v == null ? "#8B5CF6" : v >= 0 ? "#10B981" : "#f87171";

const RANK_COLORS = ["#E8553A","#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#6366F1","#14B8A6","#F97316","#D946EF","#F2A93B","#4ECDC4","#818cf8","#94a3b8","#fb923c","#a78bfa","#34d399","#fbbf24","#f472b6","#67e8f9"];

function RankingsTab({ rankings, rankingsLoading }) {
  const [sortCol, setSortCol] = useState("totalTokens");
  const [sortAsc, setSortAsc]  = useState(false);
  const [search, setSearch]    = useState("");
  const [filterProv, setFilterProv] = useState("All");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // Process rankings: get latest date, aggregate, sort
  const { leaderboard, providerShare, trendData, heroStats, latestDate, allProviders } = useMemo(() => {
    if (!rankings || !rankings.length) return { leaderboard: [], providerShare: [], trendData: [], heroStats: {}, latestDate: null, allProviders: [] };

    const dates = [...new Set(rankings.map(r => r.date))].sort();
    const latest = dates[dates.length - 1];
    const latestRows = rankings.filter(r => r.date === latest);

    // Build leaderboard from latest date
    const lb = latestRows.map(r => {
      const parts = r.model_permaslug.split("/");
      const provider = parts[0];
      const modelName = parts.slice(1).join("/").replace(/-\d{8}$/, "").replace(/-preview$/, " Preview");
      return {
        slug: r.model_permaslug,
        name: modelName,
        provider,
        totalTokens: r.total_prompt_tokens + r.total_completion_tokens,
        promptTokens: r.total_prompt_tokens,
        completionTokens: r.total_completion_tokens,
        reasoningTokens: r.total_native_tokens_reasoning,
        cachedTokens: r.total_native_tokens_cached,
        requests: r.count,
        toolCalls: r.total_tool_calls,
        mediaPrompts: r.num_media_prompt,
        change: r.change,
      };
    }).sort((a, b) => b.totalTokens - a.totalTokens);

    // Provider market share
    const provMap = {};
    lb.forEach(m => { provMap[m.provider] = (provMap[m.provider] || 0) + m.totalTokens; });
    const totalTok = lb.reduce((s, m) => s + m.totalTokens, 0);
    const ps = Object.entries(provMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, tokens]) => ({ name, tokens, pct: ((tokens / totalTok) * 100).toFixed(1) }));

    // Trend data: top 8 models across all dates
    const top8slugs = lb.slice(0, 8).map(m => m.slug);
    const td = dates.map(date => {
      const row = { date: date.slice(5, 10) }; // "02-16"
      const dayRows = rankings.filter(r => r.date === date);
      top8slugs.forEach(slug => {
        const match = dayRows.find(r => r.model_permaslug === slug);
        row[slug] = match ? (match.total_prompt_tokens + match.total_completion_tokens) / 1e9 : 0;
      });
      return row;
    });

    const hs = {
      totalTokens: totalTok,
      totalRequests: latestRows.reduce((s, r) => s + r.count, 0),
      activeModels: latestRows.length,
      topModel: lb[0]?.name || "—",
      topProvider: ps[0]?.name || "—",
    };

    const ap = ["All", ...ps.map(p => p.name)];

    return { leaderboard: lb, providerShare: ps, trendData: td, heroStats: hs, latestDate: latest, allProviders: ap };
  }, [rankings]);

  // Filter + sort the leaderboard
  const filtered = useMemo(() => {
    let out = leaderboard;
    if (search) out = out.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.slug.toLowerCase().includes(search.toLowerCase()) || m.provider.toLowerCase().includes(search.toLowerCase()));
    if (filterProv !== "All") out = out.filter(m => m.provider === filterProv);
    return out;
  }, [leaderboard, search, filterProv]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va, vb;
      if (sortCol === "name")     return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      if (sortCol === "provider") return sortAsc ? a.provider.localeCompare(b.provider) : b.provider.localeCompare(a.provider);
      va = a[sortCol] ?? 0; vb = b[sortCol] ?? 0;
      return sortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [filtered, sortCol, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const toggleSort = col => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(col === "name" || col === "provider"); } setPage(0); };

  const selectStyle = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#cbd5e1", fontSize: 11, fontFamily: fonts.mono, padding: "6px 10px", cursor: "pointer" };
  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", background: "#0a0f1e" };

  if (rankingsLoading) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}><div style={{ fontSize: 18 }}>Loading rankings from OpenRouter...</div></div>;
  if (!rankings.length) return <div style={{ textAlign: "center", padding: 60, color: "#64748b", fontFamily: fonts.heading }}>No rankings data available. Rankings are fetched from OpenRouter's live usage data.</div>;

  const top8 = leaderboard.slice(0, 8);

  return (<>
    {/* Header */}
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>AI Model Rankings</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>
        Based on real usage data from millions of users · Week of {latestDate?.slice(0, 10)} · Source:{" "}
        <a href="https://openrouter.ai/rankings" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>OpenRouter</a>
      </div>
    </div>

    {/* Hero Stats */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard label="Total Tokens (Week)" val={fmtTokens(heroStats.totalTokens)} sub="Prompt + completion" color="#6366F1" />
      <StatCard label="Total Requests"      val={fmtReqs(heroStats.totalRequests)} sub="API calls this week" color="#3B82F6" />
      <StatCard label="Active Models"        val={heroStats.activeModels}           sub="With recorded usage" color="#10B981" />
      <StatCard label="#1 Model"             val={heroStats.topModel}               sub={`by ${heroStats.topProvider}`} color="#E8553A" />
    </div>

    {/* LLM Leaderboard - Top 10 */}
    <SH>LLM Leaderboard — Top 10 by Token Usage</SH>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
      {[leaderboard.slice(0, 5), leaderboard.slice(5, 10)].map((col, ci) => (
        <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {col.map((m, i) => {
            const rank = ci * 5 + i + 1;
            const maxTok = leaderboard[0]?.totalTokens || 1;
            const barPct = Math.max(4, (m.totalTokens / maxTok) * 100);
            return (
              <div key={m.slug} style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${barPct}%`, background: `${RANK_COLORS[rank - 1]}0D`, borderRadius: 12 }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: rank <= 3 ? "#f59e0b" : "#475569", fontFamily: fonts.mono, minWidth: 28, textAlign: "right", position: "relative" }}>
                  {rank <= 3 ? ["🥇","🥈","🥉"][rank-1] : `${rank}.`}
                </span>
                <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: fonts.heading, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>by {m.provider}</div>
                </div>
                <div style={{ textAlign: "right", position: "relative" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono }}>{fmtTokens(m.totalTokens)}</div>
                  <div style={{ fontSize: 10, color: pctColor(m.change), fontFamily: fonts.mono, fontWeight: 600 }}>{fmtPct(m.change)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>

    {/* Provider Market Share */}
    <SH>Provider Market Share by Token Volume</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 18 }}>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart layout="vertical" data={providerShare.slice(0, 12)} margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => fmtTokens(v)} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, name, props) => [`${fmtTokens(v)} tokens (${props.payload.pct}%)`, "Volume"]} />
          <Bar dataKey="tokens" radius={[0, 4, 4, 0]}>
            {providerShare.slice(0, 12).map((_, i) => <Cell key={i} fill={RANK_COLORS[i % RANK_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* Token Usage Trend */}
    <SH>Weekly Token Trend — Top 8 Models</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 18 }}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={trendData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(0)}B`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 10 }} formatter={v => [`${v.toFixed(1)}B tokens`]} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
          {top8.map((m, i) => (
            <Area key={m.slug} type="monotone" dataKey={m.slug} name={m.name.length > 24 ? m.name.slice(0, 22) + ".." : m.name} stroke={RANK_COLORS[i]} fill={RANK_COLORS[i]} fillOpacity={0.08} strokeWidth={1.5} dot={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>

    {/* Quick Stats Row */}
    <SH>Usage Breakdown — Latest Week</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard label="Tool Calls" val={fmtReqs(leaderboard.reduce((s, m) => s + m.toolCalls, 0))} sub="Function/tool invocations" color="#8B5CF6" />
      <StatCard label="Reasoning Tokens" val={fmtTokens(leaderboard.reduce((s, m) => s + m.reasoningTokens, 0))} sub="Chain-of-thought" color="#F59E0B" />
      <StatCard label="Cached Tokens" val={fmtTokens(leaderboard.reduce((s, m) => s + m.cachedTokens, 0))} sub="Prompt cache hits" color="#14B8A6" />
      <StatCard label="Media Inputs" val={fmtReqs(leaderboard.reduce((s, m) => s + m.mediaPrompts, 0))} sub="Images/files in prompts" color="#EC4899" />
    </div>

    {/* Full Table */}
    <SH>Full Model Rankings</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search models..." style={{ ...selectStyle, flex: "1 1 180px", minWidth: 160, padding: "6px 12px" }} />
        <select value={filterProv} onChange={e => { setFilterProv(e.target.value); setPage(0); }} style={selectStyle}>
          {allProviders.map(p => <option key={p}>{p}</option>)}
        </select>
        {(search || filterProv !== "All") && <button onClick={() => { setSearch(""); setFilterProv("All"); setPage(0); }} style={{ ...selectStyle, color: "#f87171", border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.07)" }}>Clear</button>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#475569", fontFamily: fonts.mono }}>{sorted.length} models</span>
      </div>
    </div>

    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "center", width: 40 }}>#</th>
          <th style={{ ...thStyle, textAlign: "left" }} onClick={() => toggleSort("name")}>Model <SortIcon col="name" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "left" }} onClick={() => toggleSort("provider")}>Provider <SortIcon col="provider" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("totalTokens")}>Total Tokens <SortIcon col="totalTokens" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("requests")}>Requests <SortIcon col="requests" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("toolCalls")}>Tool Calls <SortIcon col="toolCalls" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("cachedTokens")}>Cached <SortIcon col="cachedTokens" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("change")}>Change <SortIcon col="change" sortCol={sortCol} sortAsc={sortAsc} /></th>
        </tr></thead>
        <tbody>
          {pageData.map((m, i) => {
            const rank = page * PAGE_SIZE + i + 1;
            return (
              <tr key={m.slug} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.1s" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "10px 8px", textAlign: "center", fontSize: 12, fontFamily: fonts.mono, color: rank <= 3 ? "#f59e0b" : "#475569", fontWeight: rank <= 3 ? 700 : 400 }}>{rank <= 3 ? ["🥇","🥈","🥉"][rank-1] : rank}</td>
                <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                  <div style={{ fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                </td>
                <td style={{ padding: "10px 12px" }}><span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 6 }}>{m.provider}</span></td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>{fmtTokens(m.totalTokens)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: "#94a3b8" }}>{fmtReqs(m.requests)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: m.toolCalls > 0 ? "#a5b4fc" : "#334155" }}>{m.toolCalls > 0 ? fmtReqs(m.toolCalls) : "—"}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: m.cachedTokens > 0 ? "#5eead4" : "#334155" }}>{m.cachedTokens > 0 ? fmtTokens(m.cachedTokens) : "—"}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color: pctColor(m.change) }}>{fmtPct(m.change)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {totalPages > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <button onClick={() => setPage(0)} disabled={page === 0} style={{ ...selectStyle, opacity: page === 0 ? 0.3 : 1 }}>«</button>
        <button onClick={() => setPage(p => p - 1)} disabled={page === 0} style={{ ...selectStyle, opacity: page === 0 ? 0.3 : 1 }}>‹</button>
        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#64748b", padding: "0 8px" }}>Page {page + 1} of {totalPages}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>›</button>
        <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>»</button>
      </div>
    )}
  </>);
}

// ═══════════════════════════════════════════════════════════
// MAIN: AIEconomyTab
// ═══════════════════════════════════════════════════════════
function AIEconomyTab({ models, loading, rankings, rankingsLoading }) {
  const [subTab, setSubTab] = useState("rankings");

  const SUB_TABS = [
    { id: "rankings", label: "Rankings"        },
    { id: "index",    label: "Economic Index"  },
    { id: "market",   label: "Model Market"    },
  ];

  return (<>
    {/* Sub-tab nav */}
    <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {SUB_TABS.map(t => (
        <SubTab key={t.id} id={t.id} label={t.label} active={subTab === t.id} onClick={setSubTab} />
      ))}
    </div>

    {subTab === "rankings" && <RankingsTab rankings={rankings} rankingsLoading={rankingsLoading} />}
    {subTab === "index"    && <EconomicIndexTab />}
    {subTab === "market"   && <ModelMarketTab models={models} />}
  </>);
}

export default AIEconomyTab;
