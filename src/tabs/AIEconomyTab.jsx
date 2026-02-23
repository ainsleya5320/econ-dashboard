import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LineChart, Line, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

const PRICING_TIERS = [
  { label: "Free", color: "#10B981", test: p => p === 0 },
  { label: "Budget", range: "< $1/M", color: "#3B82F6", test: p => p > 0 && p < 1 },
  { label: "Mid", range: "$1 – $10/M", color: "#F59E0B", test: p => p >= 1 && p < 10 },
  { label: "Premium", range: "$10 – $50/M", color: "#F97316", test: p => p >= 10 && p < 50 },
  { label: "Ultra", range: "$50+/M", color: "#E8553A", test: p => p >= 50 },
];
const CTX_TIERS = [
  { label: "< 16K", color: "#8B5CF6", test: c => c < 16000 },
  { label: "16K–64K", color: "#6366F1", test: c => c >= 16000 && c < 64000 },
  { label: "64K–200K", color: "#3B82F6", test: c => c >= 64000 && c < 200000 },
  { label: "200K–1M", color: "#10B981", test: c => c >= 200000 && c < 1000000 },
  { label: "1M+", color: "#F59E0B", test: c => c >= 1000000 },
];

function AIEconomyTab({ models, loading }) {
  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}><div style={{ fontSize: 18 }}>Loading model data from OpenRouter...</div></div>;
  if (!models.length) return <div style={{ textAlign: "center", padding: 60, color: "#64748b", fontFamily: fonts.heading }}>No model data loaded yet.</div>;

  // Derived data
  const prices = models.map(m => parseFloat(m.pricing?.prompt || "0") * 1e6);
  const paidPrices = prices.filter(p => p > 0).sort((a, b) => a - b);
  const medianPrice = paidPrices.length ? paidPrices[Math.floor(paidPrices.length / 2)] : 0;
  const providers = {};
  models.forEach(m => { const p = m.id.split("/")[0]; providers[p] = (providers[p] || 0) + 1; });
  const provSorted = Object.entries(providers).sort((a, b) => b[1] - a[1]);
  const provChartData = provSorted.slice(0, 14).map(([name, count]) => ({ name, count }));
  const provColors = ["#E8553A", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6", "#F97316", "#D946EF", "#F2A93B", "#4ECDC4", "#818cf8", "#94a3b8"];

  // Pricing tiers
  const tierCounts = PRICING_TIERS.map(t => ({ ...t, count: prices.filter(p => t.test(p)).length, models: models.filter((m, i) => t.test(prices[i])) }));

  // Context tiers
  const ctxCounts = CTX_TIERS.map(t => ({ ...t, count: models.filter(m => t.test(m.context_length)).length }));
  const ctxChartData = ctxCounts.map(t => ({ name: t.label, count: t.count }));

  // Top expensive & cheapest
  const withPrice = models.map((m, i) => ({ ...m, inPrice: prices[i], outPrice: parseFloat(m.pricing?.completion || "0") * 1e6 }));
  const topExpensive = [...withPrice].filter(m => m.inPrice > 0).sort((a, b) => b.inPrice - a.inPrice).slice(0, 12);
  const cheapest = [...withPrice].filter(m => m.inPrice > 0).sort((a, b) => a.inPrice - b.inPrice).slice(0, 10);

  // Modalities
  const mods = {};
  models.forEach(m => { const mo = m.architecture?.modality || "unknown"; mods[mo] = (mods[mo] || 0) + 1; });
  const modLabels = { "text->text": "Text Only", "text+image->text": "Text + Image", "text+image+file->text": "Text + Image + File", "text+image+file+audio+video->text": "Full Multimodal In", "text+image+video->text": "Text + Image + Video", "text+audio->text+audio": "Audio I/O", "text+image->text+image": "Image Generation" };
  const modSorted = Object.entries(mods).sort((a, b) => b[1] - a[1]);

  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.06)" };

  return (<>
    {/* ══════════════ ANTHROPIC ECONOMIC INDEX (front and center) ══════════════ */}
    <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 4, letterSpacing: -0.5 }}>Anthropic Economic Index</div>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 18 }}>How AI is reshaping work — based on 2M Claude conversations (Nov 2025). Source: <a href="https://www.anthropic.com/economic-index" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>anthropic.com/economic-index</a></div>

    {/* Key Stats */}
    <SH>The State of AI at Work</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      {[
        { label: "Jobs Using AI", val: "49%", sub: "≥25% of tasks (up from 36%)", color: "#8B5CF6" },
        { label: "Augmentation", val: "52%", sub: "Human-AI collaboration", color: "#3B82F6" },
        { label: "Automation", val: "45%", sub: "AI handles task alone", color: "#F97316" },
        { label: "Task Success", val: "67%", sub: "Claude.ai success rate", color: "#10B981" },
        { label: "Productivity", val: "+1.2pp", sub: "Est. annual growth", color: "#E8553A" },
      ].map(c => (
        <div key={c.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c.color, borderRadius: "14px 14px 0 0" }} />
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{c.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{c.val}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{c.sub}</div>
        </div>
      ))}
    </div>

    {/* Augmentation vs Automation trend */}
    <SH>Augmentation vs. Automation</SH>
    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Augmentation has overtaken automation</strong> as of Nov 2025 (was 41%/55% in Jan 2025). "Directive" conversations fell from 39% to 32%, while "task iteration" (back-and-forth collaboration) grew. Within augmentation: Task Iteration = 31%, Learning = 23%, Validation = 3%. Within automation: Directive = 28%, Feedback Loop = 15%.
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
          <Area type="monotone" dataKey="aug" name="Augmentation" stroke="#3B82F6" fill="url(#g-aug)" strokeWidth={2} dot={{ r: 3 }} />
          <Area type="monotone" dataKey="auto" name="Automation" stroke="#F97316" fill="url(#g-auto)" strokeWidth={2} dot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    {/* Occupation breakdown */}
    <SH>AI Usage by Occupation</SH>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Claude.ai Task Share</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart layout="vertical" data={[
            { name: "Computer & Math", share: 34 }, { name: "Education & Library", share: 15 }, { name: "Management", share: 8 },
            { name: "Arts & Entertainment", share: 7 }, { name: "Business & Financial", share: 6 }, { name: "Office & Admin", share: 5 },
            { name: "Life & Physical Sci.", share: 4 }, { name: "Healthcare", share: 4 }, { name: "Sales", share: 3 },
            { name: "Legal", share: 3 }, { name: "Architecture & Eng.", share: 2 }, { name: "Other", share: 9 },
          ]} margin={{ top: 0, right: 12, left: 5, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}%`, "Share"]} />
            <Bar dataKey="share" radius={[0, 4, 4, 0]} fill="#6366F1" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>API Task Share</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart layout="vertical" data={[
            { name: "Computer & Math", share: 46 }, { name: "Office & Admin", share: 13 }, { name: "Management", share: 7 },
            { name: "Business & Financial", share: 6 }, { name: "Education & Library", share: 4 }, { name: "Sales", share: 4 },
            { name: "Arts & Entertainment", share: 4 }, { name: "Life & Physical Sci.", share: 3 }, { name: "Legal", share: 3 },
            { name: "Healthcare", share: 2 }, { name: "Architecture & Eng.", share: 2 }, { name: "Other", share: 6 },
          ]} margin={{ top: 0, right: 12, left: 5, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}%`, "Share"]} />
            <Bar dataKey="share" radius={[0, 4, 4, 0]} fill="#E8553A" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Massive overrepresentation in tech.</strong> Computer & math roles = 37% of Claude conversations but only 3.4% of the workforce. Arts & media = 10% of conversations vs 1.4% of workers. Task concentration is extreme: top 10 tasks account for 24% of Claude.ai usage and 32% of API traffic. The #1 task is "modifying software to correct errors" at 6% of all Claude.ai conversations.
    </InfoBox>

    {/* How People Use AI */}
    <SH>How People Use AI</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      {[{ label: "Work", pct: 46, color: "#E8553A" }, { label: "Personal", pct: 35, color: "#3B82F6" }, { label: "Coursework", pct: 19, color: "#10B981" }].map(u => (
        <div key={u.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: u.color, borderRadius: "14px 14px 0 0" }} />
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{u.label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{u.pct}%</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>of Claude.ai usage</div>
        </div>
      ))}
    </div>

    {/* Wage & Adoption */}
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
            { tier: "Lowest wage (<$30K)", adoption: "Minimal", pattern: "Physical/manual work limits AI use (e.g., shampooers, laborers)", color: "#64748b" },
            { tier: "Low-mid ($30K–$50K)", adoption: "Low", pattern: "Some admin/clerical tasks automated", color: "#94a3b8" },
            { tier: "Mid wage ($50K–$80K)", adoption: "Moderate", pattern: "Growing use in education, office, sales roles", color: "#3B82F6" },
            { tier: "Mid-high ($80K–$150K)", adoption: "Highest", pattern: "Software dev, copywriting, data analysis — peak AI leverage", color: "#10B981" },
            { tier: "Highest wage (>$200K)", adoption: "Minimal", pattern: "Hands-on expertise limits AI (surgeons, executives)", color: "#64748b" },
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
    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>AI adoption follows a bell curve, not a straight line.</strong> Mid-to-high earners (programmers, analysts, copywriters) benefit most. Both the lowest-wage jobs (physical work) and highest-wage roles (surgeons, executives) show minimal AI usage — reflecting both the limits of current AI and practical barriers. AI-covered tasks require ~14.4 years of education on average vs 13.2 for all tasks.
    </InfoBox>

    {/* Productivity & Complexity */}
    <SH>AI Productivity & Complexity</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left" }}>Metric</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Claude.ai</th>
          <th style={{ ...thStyle, textAlign: "right" }}>API</th>
        </tr></thead>
        <tbody>
          {[
            { metric: "Avg. task education level", claudeai: "14.4 yrs", api: "14.4 yrs" },
            { metric: "High school task speedup", claudeai: "9x", api: "Higher" },
            { metric: "College-level task speedup", claudeai: "12x", api: "Higher" },
            { metric: "Task success rate", claudeai: "67%", api: "49%" },
            { metric: "Success (simple tasks, <12 yrs)", claudeai: "70%", api: "—" },
            { metric: "Success (complex tasks, 16+ yrs)", claudeai: "66%", api: "—" },
            { metric: "50% success task horizon", claudeai: "~19 hrs", api: "~3.5 hrs" },
            { metric: "Avg. human-AI time per task", claudeai: "15 min", api: "5 min" },
            { metric: "Est. productivity growth/yr", claudeai: "+1.2pp", api: "+1.0pp" },
            { metric: "Automation rate", claudeai: "45%", api: "77%" },
            { metric: "Price elasticity", claudeai: "—", api: "-0.29" },
          ].map((row, i, arr) => (
            <tr key={row.metric} style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>{row.metric}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#93c5fd", textAlign: "right", fontWeight: 600 }}>{row.claudeai}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right" }}>{row.api}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>AI boosts complex work fastest.</strong> College-level tasks see 12x speedup vs 9x for high school tasks. API automation rate is 77% (vs 45% on Claude.ai) — enterprises lean heavily toward automation. Price elasticity of -0.29 means a 10% cost reduction increases usage only 3%, suggesting AI demand is relatively inelastic. Technology diffusion is 10x faster than 20th-century innovations.
    </InfoBox>

    {/* Global AI Adoption */}
    <SH>Global AI Adoption</SH>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Per Capita Usage Index (Sept 2025)</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart layout="vertical" data={[
            { name: "Israel", aui: 7.0 }, { name: "Singapore", aui: 4.6 }, { name: "Australia", aui: 4.1 },
            { name: "New Zealand", aui: 4.1 }, { name: "South Korea", aui: 3.7 }, { name: "United States", aui: 3.6 },
            { name: "Canada", aui: 2.9 }, { name: "United Kingdom", aui: 2.7 }, { name: "Indonesia", aui: 0.4 },
            { name: "India", aui: 0.3 }, { name: "Nigeria", aui: 0.2 },
          ]} margin={{ top: 0, right: 12, left: 5, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={[0, 8]} tickFormatter={v => `${v}x`} />
            <YAxis type="category" dataKey="name" width={85} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}x expected`, "Usage Index"]} />
            <ReferenceLine x={1.0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
            <Bar dataKey="aui" radius={[0, 4, 4, 0]}>{
              [7,4.6,4.1,4.1,3.7,3.6,2.9,2.7,0.4,0.3,0.2].map((v, i) => <Cell key={i} fill={v >= 3 ? "#10B981" : v >= 1 ? "#3B82F6" : "#64748b"} />)
            }</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Top U.S. States</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart layout="vertical" data={[
            { name: "Washington DC", aui: 3.82 }, { name: "Utah", aui: 3.78 }, { name: "California", aui: 2.13 },
            { name: "Washington", aui: 1.92 }, { name: "Colorado", aui: 1.85 }, { name: "New York", aui: 1.58 },
            { name: "Virginia", aui: 1.57 }, { name: "Massachusetts", aui: 1.55 }, { name: "Texas", aui: 1.12 },
            { name: "US Average", aui: 1.0 },
          ]} margin={{ top: 0, right: 12, left: 5, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={[0, 4.5]} tickFormatter={v => `${v}x`} />
            <YAxis type="category" dataKey="name" width={95} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v}x avg`, "Usage Index"]} />
            <ReferenceLine x={1.0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
            <Bar dataKey="aui" radius={[0, 4, 4, 0]}>{
              [3.82,3.78,2.13,1.92,1.85,1.58,1.57,1.55,1.12,1.0].map((v, i) => <Cell key={i} fill={v >= 2 ? "#10B981" : v >= 1 ? "#3B82F6" : "#64748b"} />)
            }</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>Adoption correlates with GDP & tech workforce.</strong> 1% higher GDP per capita = 0.7% more AI usage. Each 1% increase in computer/math workers = 0.36% higher usage per capita (explains 2/3 of cross-state variation). Top 5 U.S. states = 50% of usage (38% of population), but the gap is narrowing: Gini fell from 0.37 to 0.32 in 3 months. Projected state-level parity in 2–5 years — 10x faster diffusion than historical technologies.
    </InfoBox>

    {/* Global Usage Share */}
    <SH>Global Usage Share & Purpose</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 450 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left" }}>Country</th>
          <th style={{ ...thStyle, textAlign: "right" }}>% of Global Use</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Primary Purpose</th>
        </tr></thead>
        <tbody>
          {[
            { c: "United States", share: "21.6%", purpose: "Work & Personal", color: "#E8553A" },
            { c: "India", share: "7.2%", purpose: "Coursework-heavy", color: "#3B82F6" },
            { c: "Brazil", share: "3.7%", purpose: "Work-heavy", color: "#10B981" },
            { c: "United Kingdom", share: "3.5%", purpose: "Work & Personal", color: "#8B5CF6" },
            { c: "Indonesia", share: "2.8%", purpose: "Highest coursework share", color: "#F59E0B" },
            { c: "Balkans region", share: "~2%", purpose: "Highest work share", color: "#EC4899" },
          ].map((row, i, arr) => (
            <tr key={row.c} style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>{row.c}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: row.color, textAlign: "right", fontWeight: 600 }}>{row.share}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{row.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* Task Concentration */}
    <SH>Task Concentration</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 450 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left" }}>Metric</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Claude.ai</th>
          <th style={{ ...thStyle, textAlign: "right" }}>API</th>
        </tr></thead>
        <tbody>
          {[
            { m: "Top 10 tasks share", ai: "24%", api: "32%" },
            { m: "#1 task: Modifying software to fix errors", ai: "6%", api: "10%" },
            { m: "Unique work tasks identified", ai: "3,000+", api: "—" },
            { m: "Bottom 80% of task categories", ai: "12.7%", api: "10.5%" },
            { m: "Gini coefficient (concentration)", ai: "0.84", api: "0.86" },
            { m: "Occupations ≥75% task coverage", ai: "~4%", api: "—" },
          ].map((row, i, arr) => (
            <tr key={row.m} style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>{row.m}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#93c5fd", textAlign: "right", fontWeight: 600 }}>{row.ai}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right" }}>{row.api}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <InfoBox color="#D946EF">
      <strong style={{ color: "#cbd5e1" }}>AI usage is extremely concentrated.</strong> Gini coefficients of 0.84–0.86 indicate most conversations cluster in a few task types. No occupation has reached 100% AI task coverage — AI augments and automates specific subtasks, not entire jobs. High-adoption countries use AI more collaboratively (augmentation), while low-adoption countries lean toward automation.
    </InfoBox>

    {/* ══════════════ OPENROUTER MODEL DATA (bottom) ══════════════ */}
    <div style={{ height: 28 }} />
    <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 4, letterSpacing: -0.5 }}>AI Model Market</div>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 18 }}>Live data from <a href="https://openrouter.ai" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>OpenRouter API</a> — {models.length} models across {provSorted.length} providers</div>

    <SH>Market Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Total Models" value={models.length} color="#6366F1" format="plain" subtitle="Across all providers" />
      <RateCard label="Providers" value={provSorted.length} color="#3B82F6" format="plain" subtitle="Model authors" />
      <RateCard label="Free Models" value={tierCounts[0].count} color="#10B981" format="plain" subtitle="No cost to use" />
      <RateCard label="Median Price" value={medianPrice} color="#F59E0B" format="plain" subtitle="Input $/M tokens" />
    </div>

    <SH>Provider Market Share</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>Models per Provider (Top 14)</div>
      <ResponsiveContainer width="100%" height={360}>
        <BarChart layout="vertical" data={provChartData} margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [v, "Models"]} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>{provChartData.map((_, i) => <Cell key={i} fill={provColors[i % provColors.length]} />)}</Bar>
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

    <SH>Most Expensive Models</SH>
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
          {topExpensive.map((m, i) => (
            <tr key={m.id} style={{ borderBottom: i < topExpensive.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#e2e8f0", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{m.id.split("/")[0]}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#f87171", textAlign: "right", fontWeight: 600 }}>${m.inPrice.toFixed(2)}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#fb923c", textAlign: "right" }}>${m.outPrice.toFixed(2)}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{m.context_length >= 1e6 ? `${(m.context_length/1e6).toFixed(1)}M` : `${(m.context_length/1e3).toFixed(0)}K`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <SH>Cheapest Non-Free Models</SH>
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
          {cheapest.map((m, i) => (
            <tr key={m.id} style={{ borderBottom: i < cheapest.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#e2e8f0", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{m.id.split("/")[0]}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#4ade80", textAlign: "right", fontWeight: 600 }}>${m.inPrice.toFixed(4)}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#86efac", textAlign: "right" }}>${m.outPrice.toFixed(4)}</td>
              <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{m.context_length >= 1e6 ? `${(m.context_length/1e6).toFixed(1)}M` : `${(m.context_length/1e3).toFixed(0)}K`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

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
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>{modLabels[mod] || mod}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right", fontWeight: 600 }}>{count}</td>
              <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{(count / models.length * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}


export default AIEconomyTab;
