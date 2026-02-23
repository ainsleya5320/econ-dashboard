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
// SUB-TAB 3: RANKINGS
// ═══════════════════════════════════════════════════════════
const SORT_COLS = [
  { id: "rank",    label: "#"         },
  { id: "name",    label: "Model"     },
  { id: "provider",label: "Provider"  },
  { id: "inPrice", label: "Input $/M" },
  { id: "outPrice",label: "Out $/M"   },
  { id: "context", label: "Context"   },
  { id: "created", label: "Released"  },
];

function RankingsTab({ models }) {
  const [search,      setSearch]      = useState("");
  const [sortCol,     setSortCol]     = useState("inPrice");
  const [sortAsc,     setSortAsc]     = useState(false);
  const [filterProv,  setFilterProv]  = useState("All");
  const [filterTier,  setFilterTier]  = useState("All");
  const [filterMod,   setFilterMod]   = useState("All");
  const [filterCtx,   setFilterCtx]   = useState("All");
  const [page,        setPage]        = useState(0);
  const PAGE_SIZE = 25;

  // Enrich models with derived fields
  const enriched = useMemo(() => models.map(m => ({
    ...m,
    provider:  m.id.split("/")[0],
    inPrice:   parseFloat(m.pricing?.prompt     || "0") * 1e6,
    outPrice:  parseFloat(m.pricing?.completion || "0") * 1e6,
    context:   m.context_length || 0,
    modality:  m.architecture?.modality || "unknown",
    createdTs: m.created || 0,
  })), [models]);

  // Unique filter options
  const providers = useMemo(() => ["All", ...Array.from(new Set(enriched.map(m => m.provider))).sort()], [enriched]);
  const modalities = useMemo(() => ["All", ...Array.from(new Set(enriched.map(m => m.modality))).sort()], [enriched]);

  // Filter
  const filtered = useMemo(() => {
    let out = enriched;
    if (search)           out = out.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()));
    if (filterProv !== "All")  out = out.filter(m => m.provider === filterProv);
    if (filterTier !== "All")  out = out.filter(m => PRICING_TIERS.find(t => t.label === filterTier)?.test(m.inPrice));
    if (filterMod  !== "All")  out = out.filter(m => m.modality === filterMod);
    if (filterCtx  !== "All")  out = out.filter(m => CTX_TIERS.find(t => t.label === filterCtx)?.test(m.context));
    return out;
  }, [enriched, search, filterProv, filterTier, filterMod, filterCtx]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va, vb;
      if (sortCol === "name")     { va = a.name;      vb = b.name;      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va); }
      if (sortCol === "provider") { va = a.provider;  vb = b.provider;  return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va); }
      if (sortCol === "inPrice")  { va = a.inPrice;   vb = b.inPrice; }
      if (sortCol === "outPrice") { va = a.outPrice;  vb = b.outPrice; }
      if (sortCol === "context")  { va = a.context;   vb = b.context; }
      if (sortCol === "created")  { va = a.createdTs; vb = b.createdTs; }
      if (sortCol === "rank")     { va = a.inPrice;   vb = b.inPrice; } // rank by price by default
      return sortAsc ? (va ?? 0) - (vb ?? 0) : (vb ?? 0) - (va ?? 0);
    });
    return arr;
  }, [filtered, sortCol, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = col => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(col === "name" || col === "provider"); }
    setPage(0);
  };

  const resetFilters = () => { setSearch(""); setFilterProv("All"); setFilterTier("All"); setFilterMod("All"); setFilterCtx("All"); setPage(0); };

  const fmtCtx  = v => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;
  const fmtDate = ts => { if (!ts) return "—"; const d = new Date(ts * 1000); return `${d.toLocaleString("default",{month:"short"})} ${d.getFullYear()}`; };
  const tierFor = price => PRICING_TIERS.find(t => t.test(price));

  const selectStyle = {
    background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
    color: "#cbd5e1", fontSize: 11, fontFamily: fonts.mono, padding: "6px 10px", cursor: "pointer",
  };
  const thStyle = {
    padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono,
    letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.08)",
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
    background: "#0a0f1e",
  };

  return (<>
    {/* Header */}
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>
        AI Model Rankings
      </div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>
        {enriched.length} models across {providers.length - 1} providers · Live data from{" "}
        <a href="https://openrouter.ai/rankings" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>OpenRouter</a>
      </div>
    </div>

    {/* Filters */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {/* Search */}
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search models..."
          style={{ ...selectStyle, flex: "1 1 180px", minWidth: 160, padding: "6px 12px" }}
        />
        {/* Provider */}
        <select value={filterProv} onChange={e => { setFilterProv(e.target.value); setPage(0); }} style={selectStyle}>
          {providers.map(p => <option key={p}>{p}</option>)}
        </select>
        {/* Pricing tier */}
        <select value={filterTier} onChange={e => { setFilterTier(e.target.value); setPage(0); }} style={selectStyle}>
          <option>All</option>
          {PRICING_TIERS.map(t => <option key={t.label}>{t.label}</option>)}
        </select>
        {/* Context */}
        <select value={filterCtx} onChange={e => { setFilterCtx(e.target.value); setPage(0); }} style={selectStyle}>
          <option>All</option>
          {CTX_TIERS.map(t => <option key={t.label}>{t.label}</option>)}
        </select>
        {/* Modality */}
        <select value={filterMod} onChange={e => { setFilterMod(e.target.value); setPage(0); }} style={{ ...selectStyle, maxWidth: 220 }}>
          {modalities.map(m => <option key={m} value={m}>{MOD_LABELS[m] || m}</option>)}
        </select>
        {/* Reset */}
        {(search || filterProv !== "All" || filterTier !== "All" || filterMod !== "All" || filterCtx !== "All") && (
          <button onClick={resetFilters} style={{ ...selectStyle, color: "#f87171", border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.07)" }}>
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#475569", fontFamily: fonts.mono, whiteSpace: "nowrap" }}>
          {sorted.length} result{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>

    {/* Table */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "center", width: 44 }} onClick={() => toggleSort("rank")}>#</th>
            <th style={{ ...thStyle, textAlign: "left" }} onClick={() => toggleSort("name")}>
              Model <SortIcon col="name" sortCol={sortCol} sortAsc={sortAsc} />
            </th>
            <th style={{ ...thStyle, textAlign: "left" }} onClick={() => toggleSort("provider")}>
              Provider <SortIcon col="provider" sortCol={sortCol} sortAsc={sortAsc} />
            </th>
            <th style={{ ...thStyle, textAlign: "center" }}>Tier</th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("inPrice")}>
              Input $/M <SortIcon col="inPrice" sortCol={sortCol} sortAsc={sortAsc} />
            </th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("outPrice")}>
              Output $/M <SortIcon col="outPrice" sortCol={sortCol} sortAsc={sortAsc} />
            </th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("context")}>
              Context <SortIcon col="context" sortCol={sortCol} sortAsc={sortAsc} />
            </th>
            <th style={{ ...thStyle, textAlign: "left", maxWidth: 160 }}>Modality</th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("created")}>
              Released <SortIcon col="created" sortCol={sortCol} sortAsc={sortAsc} />
            </th>
          </tr>
        </thead>
        <tbody>
          {pageData.map((m, i) => {
            const globalRank = page * PAGE_SIZE + i + 1;
            const tier = tierFor(m.inPrice);
            return (
              <tr
                key={m.id}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                {/* Rank */}
                <td style={{ padding: "10px 8px", textAlign: "center", fontSize: 12, fontFamily: fonts.mono, color: globalRank <= 3 ? "#f59e0b" : "#475569", fontWeight: globalRank <= 3 ? 700 : 400 }}>
                  {globalRank <= 3 ? ["🥇","🥈","🥉"][globalRank - 1] : globalRank}
                </td>
                {/* Model name */}
                <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                  <div style={{ fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                  <div style={{ fontSize: 10, fontFamily: fonts.mono, color: "#475569", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.id}</div>
                </td>
                {/* Provider */}
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 6 }}>
                    {m.provider}
                  </span>
                </td>
                {/* Tier badge */}
                <td style={{ padding: "10px 8px", textAlign: "center" }}>
                  {tier && (
                    <span style={{ fontSize: 10, fontFamily: fonts.mono, color: tier.color, background: `${tier.color}18`, border: `1px solid ${tier.color}30`, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
                      {tier.label}
                    </span>
                  )}
                </td>
                {/* Input price */}
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color: m.inPrice === 0 ? "#4ade80" : m.inPrice < 1 ? "#4ade80" : m.inPrice < 10 ? "#f1f5f9" : "#f87171" }}>
                  {m.inPrice === 0 ? "Free" : `$${m.inPrice < 0.01 ? m.inPrice.toFixed(4) : m.inPrice.toFixed(2)}`}
                </td>
                {/* Output price */}
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: m.outPrice === 0 ? "#4ade80" : "#94a3b8" }}>
                  {m.outPrice === 0 ? "—" : `$${m.outPrice < 0.01 ? m.outPrice.toFixed(4) : m.outPrice.toFixed(2)}`}
                </td>
                {/* Context */}
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: m.context >= 1e6 ? "#f59e0b" : m.context >= 200000 ? "#10B981" : "#94a3b8" }}>
                  {fmtCtx(m.context)}
                </td>
                {/* Modality */}
                <td style={{ padding: "10px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {MOD_LABELS[m.modality] || m.modality}
                </td>
                {/* Released */}
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 11, color: "#475569" }}>
                  {fmtDate(m.createdTs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Pagination */}
    {totalPages > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <button onClick={() => setPage(0)}         disabled={page === 0}            style={{ ...selectStyle, opacity: page === 0 ? 0.3 : 1 }}>«</button>
        <button onClick={() => setPage(p => p - 1)} disabled={page === 0}           style={{ ...selectStyle, opacity: page === 0 ? 0.3 : 1 }}>‹</button>
        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#64748b", padding: "0 8px" }}>
          Page {page + 1} of {totalPages} · {sorted.length} models
        </span>
        <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>›</button>
        <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>»</button>
      </div>
    )}
  </>);
}

// ═══════════════════════════════════════════════════════════
// MAIN: AIEconomyTab
// ═══════════════════════════════════════════════════════════
function AIEconomyTab({ models, loading }) {
  const [subTab, setSubTab] = useState("index");

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}>
      <div style={{ fontSize: 18 }}>Loading model data from OpenRouter...</div>
    </div>
  );
  if (!models.length) return (
    <div style={{ textAlign: "center", padding: 60, color: "#64748b", fontFamily: fonts.heading }}>
      No model data loaded yet.
    </div>
  );

  const SUB_TABS = [
    { id: "index",    label: "Economic Index" },
    { id: "market",   label: "Model Market"   },
    { id: "rankings", label: "Rankings"       },
  ];

  return (<>
    {/* Sub-tab nav */}
    <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {SUB_TABS.map(t => (
        <SubTab key={t.id} id={t.id} label={t.label} active={subTab === t.id} onClick={setSubTab} />
      ))}
    </div>

    {subTab === "index"    && <EconomicIndexTab />}
    {subTab === "market"   && <ModelMarketTab models={models} />}
    {subTab === "rankings" && <RankingsTab     models={models} />}
  </>);
}

export default AIEconomyTab;
