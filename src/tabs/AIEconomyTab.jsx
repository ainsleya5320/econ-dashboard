import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LineChart, Line, CartesianGrid, Area, AreaChart, ReferenceLine, ScatterChart, Scatter, ZAxis } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import ForecastPanel from "../components/ForecastPanel.jsx";

const PRICING_TIERS = [
  { label: "Free",    color: "#10B981", test: p => p === 0 },
  { label: "Budget",  range: "< $1/M",      color: "#3B82F6",  test: p => p > 0 && p < 1 },
  { label: "Mid",     range: "$1 - $10/M",   color: "#F59E0B",  test: p => p >= 1 && p < 10 },
  { label: "Premium", range: "$10 - $50/M",  color: "#F97316",  test: p => p >= 10 && p < 50 },
  { label: "Ultra",   range: "$50+/M",       color: "#E8553A",  test: p => p >= 50 },
];
const CTX_TIERS = [
  { label: "< 16K",    color: "#8B5CF6", test: c => c < 16000 },
  { label: "16K-64K",  color: "#6366F1", test: c => c >= 16000 && c < 64000 },
  { label: "64K-200K", color: "#3B82F6", test: c => c >= 64000 && c < 200000 },
  { label: "200K-1M",  color: "#10B981", test: c => c >= 200000 && c < 1000000 },
  { label: "1M+",      color: "#F59E0B", test: c => c >= 1000000 },
];

const PROV_COLORS = ["#E8553A","#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#6366F1","#14B8A6","#F97316","#D946EF","#F2A93B","#4ECDC4","#818cf8","#94a3b8"];
const MOD_LABELS  = {
  "text->text": "Text -> Text",
  "text+image->text": "Text + Image -> Text",
  "text+image+file->text": "Text + Image + File -> Text",
  "text+image+file+audio+video->text": "Full Multimodal",
  "text+image+video->text": "Text + Image + Video -> Text",
  "text+audio->text+audio": "Audio I/O",
  "text+image->text+image": "Image Generation",
};

// --- Sub-tab pill -----------------------------------------------------------
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

// --- Stat card (reusable small card) ----------------------------------------
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

// --- Sort icon ---------------------------------------------------------------
function SortIcon({ col, sortCol, sortAsc }) {
  if (sortCol !== col) return <span style={{ color: "#334155", marginLeft: 4 }}>{"<>"}</span>;
  return <span style={{ color: "#a5b4fc", marginLeft: 4 }}>{sortAsc ? "up" : "down"}</span>;
}

// ===========================================================
// SUB-TAB 1: AI ECONOMIC IMPACT (live data)
// ===========================================================

// Format large numbers
const fmtPct = (v, decimals = 2) => v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(decimals)}%`;
const fmtDate2 = (d) => {
  if (!d) return "";
  const p = d.split("-");
  const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1];
  return `${mn} ${p[0].slice(2)}`;
};

// --- AI capability on human-equivalent benchmarks ---------------------------
const HUMAN_BENCHMARKS_META = {
  asOf: "2026-Q1",
  basis: "Curated estimate",
  sources: "Benchmark papers, model reports, METR, Epoch AI",
};

// Hand-curated scores are best publicly disclosed frontier-model results;
// human baselines are expert/typical-human consensus values from the original
// benchmark papers and external AI tracking projects.
const HUMAN_BENCHMARKS = [
  {
    name: "SWE-bench Verified", domain: "Coding",
    task: "Resolve real GitHub issues - what a professional SWE does daily",
    humanBaseline: 70, frontierScore: 78, frontierModel: "Claude Opus 4.6", year: 2025,
    status: "at-human", note: "Frontier models now close real production bugs at senior-engineer level."
  },
  {
    name: "HumanEval", domain: "Coding",
    task: "Entry-level Python coding problems",
    humanBaseline: 80, frontierScore: 98, frontierModel: "Opus / GPT-5", year: 2024,
    status: "saturated", note: "Saturated - effectively solved."
  },
  {
    name: "GPQA Diamond", domain: "Reasoning",
    task: "Google-proof PhD-level science Q&A (physics, bio, chem)",
    humanBaseline: 81, frontierScore: 87, frontierModel: "GPT-5", year: 2025,
    status: "at-human", note: "Exceeds PhD experts answering questions in their own specialty."
  },
  {
    name: "ARC-AGI v1", domain: "Reasoning",
    task: "Abstract visual-pattern reasoning (fluid intelligence)",
    humanBaseline: 85, frontierScore: 87, frontierModel: "o3 (high-compute)", year: 2024,
    status: "at-human", note: "First AI to match average human on novel abstract reasoning."
  },
  {
    name: "MMLU", domain: "Knowledge",
    task: "College-level general knowledge across 57 subjects",
    humanBaseline: 89, frontierScore: 92, frontierModel: "GPT-5 / Opus 4.6", year: 2024,
    status: "saturated", note: "Saturated - frontier exceeds college-educated humans."
  },
  {
    name: "MATH", domain: "Math",
    task: "High-school math-olympiad competition problems",
    humanBaseline: 90, frontierScore: 98, frontierModel: "o3 / Gemini 2.5", year: 2024,
    status: "saturated", note: "Saturated - matches top competition students."
  },
  {
    name: "AIME 2025", domain: "Math",
    task: "American Invitational Math Exam",
    humanBaseline: 90, frontierScore: 96, frontierModel: "o3 / Opus 4.6", year: 2025,
    status: "at-human", note: "Top 5% of US high-school competition math."
  },
  {
    name: "MMMU", domain: "Multimodal",
    task: "College-level multimodal reasoning (text + images)",
    humanBaseline: 88, frontierScore: 84, frontierModel: "Gemini 3 / GPT-5", year: 2025,
    status: "approaching", note: "Approaching college-expert visual-reasoning level."
  },
  {
    name: "GAIA", domain: "Agentic",
    task: "Real-world assistant tasks - browsing, tool use, multi-step work",
    humanBaseline: 92, frontierScore: 80, frontierModel: "Agent systems (GPT-5)", year: 2025,
    status: "approaching", note: "Most economically relevant benchmark: can AI act like a knowledge-worker assistant?"
  },
  {
    name: "FrontierMath", domain: "Math",
    task: "Research-level math problems solvable by expert mathematicians",
    humanBaseline: 100, frontierScore: 25, frontierModel: "o3", year: 2025,
    status: "behind", note: "Hard research math - the active frontier. Still mostly out of reach."
  },
  {
    name: "Humanity's Last Exam", domain: "Knowledge",
    task: "Expert-level cross-domain questions designed to resist saturation",
    humanBaseline: 100, frontierScore: 27, frontierModel: "GPT-5", year: 2025,
    status: "behind", note: "Designed to be the 'final' benchmark - AI still well below expert humans."
  },
];

const STATUS_META = {
  saturated:    { label: "Saturated",     color: "#10B981" },
  "at-human":   { label: "At human level",color: "#22C55E" },
  approaching:  { label: "Approaching",   color: "#F59E0B" },
  behind:       { label: "Behind",        color: "#EF4444" },
};
const DOMAIN_COLORS = {
  Coding: "#6366F1", Reasoning: "#8B5CF6", Knowledge: "#3B82F6",
  Math: "#F59E0B", Multimodal: "#EC4899", Agentic: "#14B8A6",
};

function BenchmarkBar({ b }) {
  const ratio = Math.min(1.1, b.frontierScore / b.humanBaseline);
  const pctOfHuman = Math.round(ratio * 100);
  const stat = STATUS_META[b.status];
  const domainColor = DOMAIN_COLORS[b.domain] || "#64748b";
  return (
    <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{b.name}</span>
          <span style={{ fontSize: 9, color: domainColor, fontFamily: fonts.mono, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, background: `${domainColor}22` }}>{b.domain}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 11, color: stat.color, fontFamily: fonts.mono, fontWeight: 700 }}>{pctOfHuman}% of human</span>
          <span style={{ fontSize: 9, color: stat.color, fontFamily: fonts.mono, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, background: `${stat.color}22` }}>{stat.label}</span>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, marginBottom: 6 }}>{b.task}</div>
      {/* Progress bar: 0 -> human baseline = 100% mark; frontier score shown relative */}
      <div style={{ position: "relative", height: 8, background: "var(--bg-subtle)", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (b.frontierScore / 100) * 100)}%`, background: stat.color, borderRadius: 4, transition: "width 0.6s ease" }} />
        {/* Human baseline marker */}
        <div style={{ position: "absolute", left: `${b.humanBaseline}%`, top: -2, bottom: -2, width: 2, background: "var(--text-primary)", opacity: 0.85 }} title={`Human baseline: ${b.humanBaseline}%`} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono }}>
        <span>AI: <span style={{ color: stat.color, fontWeight: 600 }}>{b.frontierScore}</span> | Human: {b.humanBaseline} | {b.frontierModel} ({b.year})</span>
      </div>
      <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 4 }}>{HUMAN_BENCHMARKS_META.basis} | As of {HUMAN_BENCHMARKS_META.asOf} | {HUMAN_BENCHMARKS_META.sources}</div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 6, fontStyle: "italic" }}>{b.note}</div>
    </div>
  );
}

// --- GDPval-AA - agentic successor to OpenAI's GDPval benchmark -------------
// OpenAI's original GDPval (Sep 2025) scored one-shot deliverables as a
// win/tie/loss % vs a human expert (50% = parity). That metric has largely
// been superseded by GDPval-AA, run by Artificial Analysis: models get shell
// + browser access in an agentic loop, produce full deliverables against 220
// tasks (44 occupations, 9 sectors, same underlying OpenAI dataset), and are
// scored via Elo from blind pairwise comparisons — not directly comparable to
// the original win-rate numbers. Snapshot pulled 2026-07-07 from
// https://artificialanalysis.ai/evaluations/gdpval-aa (125 models tracked;
// top ~20 shown here). Update by re-checking that page — Elo shifts often.
const GDPVAL_AA_ASOF = "2026-07-07";
const GDPVAL_AA_SOURCE = "https://artificialanalysis.ai/evaluations/gdpval-aa";
const GDPVAL_AA_DATA = {
  totalModelsTracked: 125,
  totalTasks: 220,
  occupations: 44,
  sectors: 9,
  models: [
    { name: "Claude Fable 5 (Max Effort)",   org: "Anthropic", elo: 1760, ci: 20 },
    { name: "Claude Sonnet 5 (Max Effort)",  org: "Anthropic", elo: 1606, ci: 19 },
    { name: "Claude Opus 4.8 (Max Effort)",  org: "Anthropic", elo: 1600, ci: 18 },
    { name: "GLM-5.2 (max)",                 org: "Zhipu (Z AI)", elo: 1513, ci: 17 },
    { name: "Claude Sonnet 5 (Xhigh)",       org: "Anthropic", elo: 1510, ci: 19 },
    { name: "Claude Opus 4.7 (Max Effort)",  org: "Anthropic", elo: 1500, ci: 17 },
    { name: "GPT-5.5 (xhigh)",               org: "OpenAI",    elo: 1494, ci: 17 },
    { name: "GPT-5.5 (high)",                org: "OpenAI",    elo: 1471, ci: 17 },
    { name: "Claude Sonnet 5 (High)",        org: "Anthropic", elo: 1406, ci: 18 },
    { name: "MiniMax-M3",                    org: "MiniMax",   elo: 1396, ci: 17 },
    { name: "GPT-5.4 (xhigh)",               org: "OpenAI",    elo: 1395, ci: 17 },
    { name: "Claude Sonnet 4.6 (Max Effort)",org: "Anthropic", elo: 1380, ci: 17 },
    { name: "GPT-5.5 (medium)",              org: "OpenAI",    elo: 1373, ci: 19 },
    { name: "Gemini 3.5 Flash (high)",       org: "Google",    elo: 1347, ci: 17 },
    { name: "DeepSeek V4 Pro (Max Effort)",  org: "DeepSeek",  elo: 1308, ci: 17 },
    { name: "Qwen3.7 Max",                   org: "Alibaba",   elo: 1275, ci: 17 },
    { name: "GLM-5.1 (Reasoning)",           org: "Zhipu (Z AI)", elo: 1257, ci: 17 },
    { name: "Grok Build 0.1 0616",           org: "xAI",       elo: 1214, ci: 18 },
    { name: "GPT-5.5 (low)",                 org: "OpenAI",    elo: 1191, ci: 18 },
    { name: "Kimi K2.6",                     org: "Kimi",      elo: 1191, ci: 16 },
  ],
};
const GDP_ORG_COLOR = {
  Anthropic: "#E8553A", OpenAI: "#10B981", Google: "#3B82F6", DeepSeek: "#8B5CF6",
  "Zhipu (Z AI)": "#F59E0B", MiniMax: "#EC4899", Alibaba: "#22D3EE", xAI: "#94A3B8", Kimi: "#A78BFA",
};

// --- METR time horizon - the capability TREND, not a point score -----------
// METR (Model Evaluation & Threat Research) measures the "50%-task-completion
// time horizon": the length of software task (in how long it takes a skilled
// human) that a model can complete autonomously with 50% reliability, over a
// ~230-task suite. The finding that matters is the TREND — horizons are
// doubling roughly every 4 months (down from ~7mo pre-2023), a straight line
// on a log axis. Canonical points from METR "Time Horizon 1.1" (2026-01-29,
// https://metr.org/blog/2026-1-29-time-horizon-1-1/); the latest frontier
// point (Opus 4.6) is reported post-TH1.1 and flagged separately. Release
// dates are approximate (for the time axis). minutes = 50% time horizon.
const METR_ASOF = "2026-01-29";
const METR_SOURCE = "https://metr.org/blog/2026-1-29-time-horizon-1-1/";
const METR_DOUBLING_DAYS = 131; // METR's headline: ~4.3mo since 2023 (89d since 2024)
const METR_DATA = [
  { model: "GPT-4o",           org: "OpenAI",    date: "2024-05-15", minutes: 6 },
  { model: "Claude 3.7 Sonnet",org: "Anthropic", date: "2025-02-24", minutes: 60 },
  { model: "o3",               org: "OpenAI",    date: "2025-04-16", minutes: 121 },
  { model: "Claude Opus 4",    org: "Anthropic", date: "2025-05-22", minutes: 101 },
  { model: "GPT-5",            org: "OpenAI",    date: "2025-08-07", minutes: 214 },
  { model: "Claude Opus 4.5",  org: "Anthropic", date: "2025-11-24", minutes: 320 },
  { model: "Claude Opus 4.6",  org: "Anthropic", date: "2026-02-21", minutes: 870, reported: true },
];

// Trend line uses METR's OWN published doubling rate (fixed slope) with a
// least-squares LEVEL fit — an unconstrained regression overfits the recent
// points to a ~3mo doubling and projects horizons that contradict the latest
// measured value. Fixed-slope keeps the projection honest and anchored to
// METR's authority. Line extends to the 40-hour (2,400-min) work-week mark.
function metrFit(points) {
  const base = new Date("2024-01-01").getTime();
  const monthsSince = d => (new Date(d).getTime() - base) / (365.25 / 12 * 86400000);
  const xs = points.map(p => monthsSince(p.date));
  const ys = points.map(p => Math.log(p.minutes));
  const n = xs.length;
  const doublingMonths = METR_DOUBLING_DAYS / 30.4375;
  const slope = Math.log(2) / doublingMonths;           // fixed to METR's rate
  const intercept = (ys.reduce((a, b) => a + b, 0) / n) - slope * (xs.reduce((a, b) => a + b, 0) / n);
  const fitAt = mo => Math.exp(intercept + slope * mo);
  const moToDate = mo => { const d = new Date(base); d.setMonth(d.getMonth() + Math.round(mo)); return d.toISOString().slice(0, 7); };
  // month where the fit crosses 40h (2400 min) and 8h (480 min)
  const crossMo = mins => (Math.log(mins) - intercept) / slope;
  const workweekDate = moToDate(crossMo(2400));
  const workdayDate = moToDate(crossMo(480));
  // build merged chart rows: actual dots + a dense fit/projection line
  const xMin = Math.min(...xs), xMax = crossMo(2400) + 1;
  const rows = {};
  for (let mo = Math.floor(xMin); mo <= Math.ceil(xMax); mo += 1.5) rows[mo.toFixed(1)] = { x: +mo.toFixed(1), fit: +fitAt(mo).toFixed(1) };
  points.forEach(p => {
    const mo = +monthsSince(p.date).toFixed(1);
    rows[mo] = { ...(rows[mo] || { x: mo }), x: mo, mins: p.minutes, model: p.model, org: p.org, reported: p.reported, fit: rows[mo]?.fit ?? +fitAt(mo).toFixed(1) };
  });
  const chart = Object.values(rows).sort((a, b) => a.x - b.x);
  return { slope, intercept, doublingMonths, chart, workweekDate, workdayDate, monthsSince, moToLabel: mo => moToDate(mo) };
}

// FRED time series chart component
function FredChart({ series, title, yFormat, yoyHighlight }) {
  if (!series?.history?.length) return null;
  const tickInt = Math.max(0, Math.floor(series.history.length / 8) - 1);
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingLeft: 12, paddingRight: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>
        {yoyHighlight && series.yoy != null && (
          <div style={{ fontSize: 10, color: series.yoy > 0 ? "#4ade80" : "#f87171", fontFamily: fonts.mono, fontWeight: 600 }}>
            YoY: {fmtPct(series.yoy, 1)}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={series.history} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id={`ai-fred-${series.label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={series.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={series.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} tickFormatter={fmtDate2} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={yFormat || (v => v.toFixed(0))} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate2} formatter={v => [yFormat ? yFormat(v) : v.toFixed(2), series.label]} />
          <Area type="monotone" dataKey="v" stroke={series.color} fill={`url(#ai-fred-${series.label.replace(/\s/g, "")})`} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 4 }}>
        Latest: {fmtDate2(series.lastDate)} | Source: FRED ({series.freq === "Q" ? "Quarterly" : "Monthly"})
      </div>
    </div>
  );
}

// Helper: format values according to FRED series "unit" metadata
const fmtFredVal = (series) => {
  if (series?.current == null) return "-";
  const v = series.current;
  if (series.unit === "billions") return `$${v.toFixed(0)}B`;
  if (series.unit === "dollars_m") return `$${(v / 1000).toFixed(1)}B`; // millions -> billions display
  if (series.unit === "thousands") return `${(v / 1000).toFixed(2)}M`;   // thousands of jobs -> millions
  return v.toFixed(1);
};
const fmtFredChart = (series) => {
  if (series?.unit === "billions") return v => `$${v.toFixed(0)}B`;
  if (series?.unit === "dollars_m") return v => `$${(v/1000).toFixed(0)}B`;
  if (series?.unit === "thousands") return v => `${(v/1000).toFixed(1)}M`;
  return v => v.toFixed(1);
};

// ─── Hyperscaler AI Capex Panel ─────────────────────────────────────────────
// Quarterly capex for MSFT/GOOGL/META/AMZN/ORCL with a configurable per-company
// "AI share %" applied to estimate AI-specific spend. Raw company numbers are
// exact (from FMP); the AI carve-out is interpretation based on earnings-call
// disclosures. Best public proxy for hyperscaler AI infra demand.
const HS_AI_SHARE_DEFAULTS = {
  MSFT: 0.70,   // ~70% of MSFT capex is Azure AI infra per earnings commentary
  GOOGL: 0.65,  // GCP + AI training + data center expansion
  META: 0.55,   // AI for Reels, ads, Llama training — rest is general infra
  AMZN: 0.60,   // AWS AI infra, partially offset by general retail capex
  ORCL: 0.85,   // Oracle's recent pivot is almost entirely OCI AI infra
};

function HyperscalerCapexPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiShare, setAiShare] = useState(HS_AI_SHARE_DEFAULTS);

  useEffect(() => {
    fetch("/api/hyperscaler-capex")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error("Hyperscaler capex error:", e))
      .finally(() => setLoading(false));
  }, []);

  // Build a quarterly time-series keyed by date, with each company as a column
  // and an additional "AI capex" total column = sum(company.capex × aiShare)
  const chartData = useMemo(() => {
    if (!data?.companies) return [];
    const byDate = new Map();
    Object.values(data.companies).forEach(c => {
      c.quarters.forEach(q => {
        if (!byDate.has(q.date)) byDate.set(q.date, { date: q.date });
        const row = byDate.get(q.date);
        row[c.symbol] = (c.capex || 0) / 1e9;  // billions
        row[`${c.symbol}_AI`] = ((c.capex || 0) * (aiShare[c.symbol] || 0)) / 1e9;
      });
    });
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, aiShare]);

  // Latest period stats: total capex this Q, AI-share, YoY growth, trailing 4Q
  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const last = chartData[chartData.length - 1];
    const yoy = chartData[chartData.length - 5];
    const tot = (row, suffix = "") => Object.values(data.companies || {})
      .reduce((s, c) => s + (row[`${c.symbol}${suffix}`] || 0), 0);
    const lastTotal = tot(last);
    const lastAi = tot(last, "_AI");
    const yoyTotal = yoy ? tot(yoy) : null;
    const yoyAi = yoy ? tot(yoy, "_AI") : null;
    // Trailing 4 quarters total
    const last4 = chartData.slice(-4);
    const ttmTotal = last4.reduce((s, r) => s + tot(r), 0);
    const ttmAi = last4.reduce((s, r) => s + tot(r, "_AI"), 0);
    return {
      lastDate: last.date,
      lastTotal,
      lastAi,
      yoyGrowth: yoyTotal ? ((lastTotal - yoyTotal) / yoyTotal) * 100 : null,
      yoyAiGrowth: yoyAi ? ((lastAi - yoyAi) / yoyAi) * 100 : null,
      ttmTotal,
      ttmAi,
    };
  }, [chartData, data]);

  if (loading) return <div style={{ padding: 30, fontSize: 11, color: "#64748b", fontFamily: fonts.mono, textAlign: "center" }}>Loading hyperscaler capex from FMP...</div>;
  if (!data?.companies || !Object.keys(data.companies).length) {
    return <InfoBox color="#F97316">Hyperscaler capex data unavailable. FMP may be rate-limited.</InfoBox>;
  }

  const companies = Object.values(data.companies);
  const fmtB = v => `$${v.toFixed(1)}B`;
  const fmtPct1 = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const tickInt = Math.max(0, Math.floor(chartData.length / 8) - 1);

  return (<>
    <SH>Hyperscaler Capex — The Demand Behind the Buildout</SH>

    {/* Hero stats */}
    {stats && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="Total Capex Last Q" val={fmtB(stats.lastTotal)} sub={`${stats.lastDate} · ${fmtPct1(stats.yoyGrowth)} YoY`} color="#6366F1" />
        <StatCard label="Implied AI Capex" val={fmtB(stats.lastAi)} sub={`${fmtPct1(stats.yoyAiGrowth)} YoY${stats.lastTotal > 0 ? ` · ${((stats.lastAi/stats.lastTotal)*100).toFixed(0)}% of total` : ""}`} color="#10B981" />
        <StatCard label="TTM Total Capex" val={fmtB(stats.ttmTotal)} sub="Trailing 4 quarters" color="#3B82F6" />
        <StatCard label="TTM Implied AI" val={fmtB(stats.ttmAi)} sub={`Annualized: ${fmtB(stats.ttmAi)}/yr`} color="#F59E0B" />
      </div>
    )}

    {/* Stacked bar chart — total capex */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Quarterly Capex by Company ($B, stacked)</div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}B`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${v.toFixed(2)}B`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          {companies.map(c => (
            <Bar key={c.symbol} dataKey={c.symbol} name={`${c.symbol} (${c.name})`} stackId="capex" fill={c.color} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* AI-share sliders */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>AI Share Assumption per Company</div>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 14, lineHeight: 1.5 }}>
        Companies don&apos;t publish AI-specific capex; these sliders apply your estimate of what fraction is AI-related, based on earnings-call disclosures. Adjust to test scenarios.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {companies.map(c => (
          <div key={c.symbol}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontFamily: fonts.heading, color: c.color, fontWeight: 600 }}>{c.symbol} · {c.name}</span>
              <span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 700 }}>{((aiShare[c.symbol] || 0) * 100).toFixed(0)}%</span>
            </div>
            <input type="range" min="0" max="100" step="5" value={(aiShare[c.symbol] || 0) * 100}
              onChange={e => setAiShare({ ...aiShare, [c.symbol]: parseInt(e.target.value) / 100 })}
              style={{ width: "100%", accentColor: c.color }} />
          </div>
        ))}
      </div>
    </div>

    {/* AI-only chart */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Implied AI-Specific Capex ($B, stacked)</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}B`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${v.toFixed(2)}B AI`, n.replace("_AI", "")]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} formatter={n => n.replace("_AI", "")} />
          {companies.map(c => (
            <Bar key={c.symbol} dataKey={`${c.symbol}_AI`} name={`${c.symbol} AI`} stackId="ai" fill={c.color} fillOpacity={0.85} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* Per-company quarterly table — most recent quarter */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
        <thead>
          <tr>
            {["Company", "Latest Q", "Capex", "AI Share", "Implied AI", "YoY Total", "TTM Total"].map(h => (
              <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: h === "Company" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {companies.map(c => {
            const qs = c.quarters;
            const last = qs[qs.length - 1];
            const yoy = qs[qs.length - 5];
            const last4 = qs.slice(-4);
            const ttm = last4.reduce((s, q) => s + (q.capex || 0), 0) / 1e9;
            const yoyG = yoy ? ((last.capex - yoy.capex) / yoy.capex) * 100 : null;
            const lastB = (last.capex || 0) / 1e9;
            const aiB = lastB * (aiShare[c.symbol] || 0);
            return (
              <tr key={c.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: c.color, fontWeight: 600 }}>{c.symbol} · {c.name}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{last.date} {last.period}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600, textAlign: "right" }}>{fmtB(lastB)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{((aiShare[c.symbol] || 0) * 100).toFixed(0)}%</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#10B981", fontWeight: 600, textAlign: "right" }}>{fmtB(aiB)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, fontWeight: 600, textAlign: "right", color: (yoyG ?? 0) > 0 ? "#4ade80" : "#f87171" }}>{fmtPct1(yoyG)}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#a5b4fc", fontWeight: 600, textAlign: "right" }}>{fmtB(ttm)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>What this is telling you.</strong> Hyperscaler capex is the most important upstream demand signal in the AI economy — it&apos;s the dollars that get converted into chips, data centers, and ultimately tokens. Adjusted YoY growth above 50% (sustained) means we&apos;re still in expansion. A sharp deceleration would be the clearest signal yet that the build-out is peaking. Raw company numbers are exact (from quarterly filings); the AI-share split is your editorial call.
    </InfoBox>
  </>);
}

// ── Adoption breadth: Census BTOS % of firms using AI (curated releases) ────
function BtosAdoptionPanel() {
  const last = BTOS_AI_ADOPTION[BTOS_AI_ADOPTION.length - 1];
  const first = BTOS_AI_ADOPTION[0];
  return (<>
    <SH>Adoption Breadth — % of U.S. Firms Using AI (Census BTOS)</SH>
    <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", flex: "0 1 220px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: "#22C55E" }} />
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Using AI Now</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#22C55E", fontFamily: fonts.heading, marginTop: 4 }}>{last.pct}%</div>
        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5 }}>as of {last.d} — {(last.pct / first.pct).toFixed(1)}× since {first.d.slice(0, 4)}. Expected next 6mo: 20–23%.</div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px", flex: "1 1 300px" }}>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={BTOS_AI_ADOPTION} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v}%${p.payload.approx ? " (≈)" : ""}`, "firms using AI"]} />
            <Line type="monotone" dataKey="pct" stroke="#22C55E" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", flex: "0 1 260px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Who&apos;s Adopting (May 2026)</div>
        {BTOS_SPLITS.map(s => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, fontFamily: fonts.mono, padding: "2.5px 0" }}>
            <span style={{ color: "#cbd5e1" }}>{s.label}</span>
            <span style={{ color: s.pct >= 30 ? "#4ade80" : s.pct >= 18 ? "#fbbf24" : "#94a3b8", fontWeight: 700 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
    <InfoBox color="#22C55E">
      <strong style={{ color: "#cbd5e1" }}>Why breadth matters more than depth here.</strong> Capability (above) says AI <em>can</em> do the work; this says how much of the economy is actually letting it. ~1.2M firms surveyed biweekly by Census — the least gameable adoption number that exists. The 3.7%→{last.pct}% path in under three years is the diffusion curve steepening; when this crosses ~30–40% while capability keeps compounding, the productivity series below stops being an academic question. Points marked ≈ are press-reported between official releases — update from each BTOS release (biweekly cadence, curated in <code style={{ color: "#a5b4fc" }}>BTOS_AI_ADOPTION</code>).
    </InfoBox>
  </>);
}

// ── The power bottleneck, priced: PJM capacity auctions + retail electricity ─
function PowerBottleneckPanel() {
  const [elec, setElec] = useState(null);
  useEffect(() => {
    fetch("/api/fred?series_id=APU000072610&limit=240")
      .then(r => r.json())
      .then(d => {
        const obs = (d.observations || []).map(o => ({ d: o.date, v: +o.value })).filter(o => isFinite(o.v)).reverse();
        if (obs.length) setElec(obs);
      })
      .catch(() => {});
  }, []);
  const elecNow = elec?.length ? elec[elec.length - 1] : null;
  const elecYr = elec?.length > 12 ? elec[elec.length - 13] : null;
  const pjmLast = PJM_CAPACITY[PJM_CAPACITY.length - 1];
  const pjmPrev = PJM_CAPACITY[PJM_CAPACITY.length - 3]; // two auctions back = pre-spike base
  return (<>
    <SH>The Power Bottleneck — What the Grid Charges for Scarcity</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
          PJM Capacity Auction Clearing Price ($/MW-day)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={PJM_CAPACITY} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="auction" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`$${v}/MW-day`, "clearing price"]} />
            <Bar dataKey="price" radius={[4, 4, 0, 0]}>
              {PJM_CAPACITY.map((r, i) => <Cell key={i} fill={r.price > 100 ? "#f87171" : "#818cf8"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
          The largest US grid&apos;s price for guaranteed capacity: {pjmPrev ? `~${Math.round(pjmLast.price / pjmPrev.price)}× in two auctions` : "a step-change"} — the purest &ldquo;datacenters ate the slack&rdquo; market print. Public auction results; add each new BRA to <code style={{ color: "#a5b4fc" }}>PJM_CAPACITY</code>.
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingLeft: 14, paddingRight: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>US Retail Electricity ($/kWh)</div>
          {elecNow && elecYr && (
            <div style={{ fontSize: 10, color: elecNow.v > elecYr.v ? "#f87171" : "#4ade80", fontFamily: fonts.mono, fontWeight: 600 }}>
              {((elecNow.v / elecYr.v - 1) * 100).toFixed(1)}% YoY
            </div>
          )}
        </div>
        {elec ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={elec} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={40} />
              <YAxis domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`$${(+v).toFixed(3)}/kWh`, "avg retail price"]} labelFormatter={d => d.slice(0, 7)} />
              <Line type="monotone" dataKey="v" stroke="#F59E0B" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading FRED series…</div>}
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
          FRED APU000072610, monthly. The consumer-facing echo of grid tightness — politically explosive if datacenter demand keeps pushing it. Rising power prices are simultaneously the compute thesis CONFIRMING and its biggest regulatory risk.
        </div>
      </div>
    </div>
  </>);
}

function AIImpactTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = () => {
    setLoading(true);
    fetch("/api/ai-impact")
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(Date.now()); })
      .catch(e => console.error("AI Impact error:", e))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading && !data) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading real-economy AI metrics...</div>;
  }
  if (!data || !data.fred) {
    return <InfoBox color="#F97316">Unable to load real-economy data. FRED API may be temporarily unavailable.</InfoBox>;
  }

  const f = data.fred;
  // Convenience refs
  const prod     = f.OPHNFB;
  const infoProd = f.MPU4910063;
  const softInv  = f.Y694RX1Q020SBEA;
  const ipInv    = f.A679RC1Q027SBEA;
  const hwInv    = f.Y033RC1Q027SBEA;
  const semis    = f.IPG3344S;
  const mfgCons  = f.TLMFGCONS;
  const csdJobs  = f.CES6054150001;
  const infoJobs = f.USINFO;
  const power    = f.IPG2211A2N;

  // Loaded count for health badge
  const loadedCount = Object.keys(f).length;

  return (<>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5 }}>AI &amp; The Real Economy</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>{loadedCount} live series</span>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
          {lastRefresh ? `| Updated ${new Date(lastRefresh).toLocaleTimeString()}` : ""}
        </span>
        <button onClick={load} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>Refresh Refresh</button>
      </div>
    </div>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 18, maxWidth: 780 }}>
      Tracking AI&apos;s footprint on the real economy - not stock prices. If the AI thesis is right, we should see it show up in productivity growth, capital formation (chips, data centers, software), semiconductor output, and power demand. These are the series that will confirm or refute the boom.
    </div>

    {/* ======== CAPABILITY ON HUMAN TASKS ======== */}
    <SH>Capability - Can AI Actually Do Human Work?</SH>
    {(() => {
      const saturated = HUMAN_BENCHMARKS.filter(b => b.status === "saturated").length;
      const atHuman   = HUMAN_BENCHMARKS.filter(b => b.status === "at-human").length;
      const approaching = HUMAN_BENCHMARKS.filter(b => b.status === "approaching").length;
      const behind    = HUMAN_BENCHMARKS.filter(b => b.status === "behind").length;
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
          <StatCard label="Saturated Benchmarks"    val={`${saturated} / ${HUMAN_BENCHMARKS.length}`} sub="AI >= top human - solved"     color="#10B981" />
          <StatCard label="At Human Level"          val={`${atHuman} / ${HUMAN_BENCHMARKS.length}`}   sub="Matching expert humans"      color="#22C55E" />
          <StatCard label="Approaching Human"       val={`${approaching} / ${HUMAN_BENCHMARKS.length}`} sub="Within striking distance"  color="#F59E0B" />
          <StatCard label="Still Behind"            val={`${behind} / ${HUMAN_BENCHMARKS.length}`}    sub="The remaining frontier"     color="#EF4444" />
        </div>
      );
    })()}

    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Frontier-Model Benchmarks vs Human Baselines</div>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>White tick = human baseline | bar = AI score</div>
      </div>
      {HUMAN_BENCHMARKS.slice().sort((a, b) => {
        const order = { saturated: 0, "at-human": 1, approaching: 2, behind: 3 };
        return order[a.status] - order[b.status];
      }).map(b => <BenchmarkBar key={b.name} b={b} />)}
      <div style={{ padding: "10px 14px", fontSize: 9, color: "#64748b", fontFamily: fonts.mono, background: "rgba(255,255,255,0.02)" }}>
        Curated 2026-Q1. Sources: benchmark papers | METR | Epoch AI | model-maker disclosures. Human baselines are expert/typical-human consensus values.
      </div>
    </div>

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>Why capability comes before the macro data.</strong> For AI to show up in nonfarm productivity, it has to first be <em>good enough</em> to substitute for or augment human knowledge work. As of 2026, frontier models hit or exceed expert human performance on most coding, math, and reasoning benchmarks - and they&apos;re within striking distance on real-world agentic tasks (GAIA) that most closely resemble professional knowledge work. Whether that translates to GDP-level productivity is what the rest of this page measures.
    </InfoBox>

    {/* ======== METR TIME HORIZON ======== */}
    <SH>METR Time Horizon - How Long a Task AI Can Do Alone</SH>
    {(() => {
      const fit = metrFit(METR_DATA);
      const latest = METR_DATA[METR_DATA.length - 1];
      const fmtDur = m => m == null ? "—" : m >= 60 ? `${(m / 60).toFixed(m % 60 && m < 600 ? 1 : 0)}h` : `${Math.round(m)}m`;
      const fmtMoLabel = x => { const d = new Date("2024-01-01"); d.setMonth(d.getMonth() + Math.round(x)); return d.toISOString().slice(0, 7); };
      return (<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 10 }}>
          <StatCard label="Top Model Horizon" val={fmtDur(latest.minutes)} sub={`${latest.model} | 50% reliability`} color={GDP_ORG_COLOR[latest.org] || "#818cf8"} />
          <StatCard label="Doubling Time" val={`~${fit.doublingMonths.toFixed(1)} mo`} sub="down from ~7mo pre-2023" color="#E8553A" />
          <StatCard label="8-Hour Workday" val={fit.workdayDate} sub="trend crosses a full workday" color="#F59E0B" />
          <StatCard label="40-Hour Work-Week" val={fit.workweekDate} sub="if the doubling rate holds" color="#EF4444" />
        </div>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 12 }}>
          Source: <a href={METR_SOURCE} target="_blank" rel="noopener" style={{ color: "#818cf8" }}>METR Time Horizon 1.1</a> ({METR_ASOF}) — task length a model completes with 50% reliability, over ~230 software tasks. Trend line uses METR&apos;s published ~{fit.doublingMonths.toFixed(1)}-month doubling.
        </div>

        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6, paddingLeft: 12 }}>
            50% Task-Completion Time Horizon (log scale)
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={fit.chart} margin={{ top: 8, right: 20, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" dataKey="x" domain={["dataMin", "dataMax"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={fmtMoLabel} ticks={[4, 10, 16, 22, 28, 34, 40]} />
              <YAxis scale="log" domain={[3, 3000]} ticks={[6, 30, 60, 240, 480, 2400]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtDur} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                labelFormatter={fmtMoLabel}
                formatter={(v, n, p) => n === "mins" ? [`${fmtDur(v)}${p.payload.reported ? " (reported)" : ""}`, p.payload.model] : [fmtDur(v), "Trend (~" + fit.doublingMonths.toFixed(1) + "mo doubling)"]} />
              <ReferenceLine y={480} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: "8h workday", fill: "#F59E0B", fontSize: 9, fontFamily: fonts.mono, position: "insideTopRight" }} />
              <ReferenceLine y={2400} stroke="#EF4444" strokeDasharray="4 4" label={{ value: "40h work-week", fill: "#EF4444", fontSize: 9, fontFamily: fonts.mono, position: "insideTopRight" }} />
              <Line dataKey="fit" stroke="#64748b" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="mins" stroke="#818cf8" strokeWidth={0} dot={{ r: 4, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 4, lineHeight: 1.5 }}>
            Dots = measured models (dashed = trend at METR&apos;s doubling rate). A straight line on a log axis IS exponential growth — that&apos;s the whole point. The two dashed thresholds are where the trend crosses a human workday and work-week.
          </div>
        </div>

        <InfoBox color="#E8553A">
          <strong style={{ color: "#cbd5e1" }}>Why this is the most important AI chart for an investor.</strong> A static benchmark score tells you what AI can do <em>today</em>; METR&apos;s time horizon tells you the <em>rate</em>, and the rate is what compounds. Doubling every ~{fit.doublingMonths.toFixed(1)} months means task autonomy that&apos;s at ~{fmtDur(latest.minutes)} now reaches a full workday and then a work-week within roughly a year — the difference between &ldquo;AI assists a worker&rdquo; and &ldquo;AI does the job.&rdquo; That transition is the hinge for labor-displacement timing, the automation thesis behind the whole AI capex cycle, and which incumbents get disrupted.
        </InfoBox>

        <InfoBox color="#F59E0B">
          <strong style={{ color: "#cbd5e1" }}>Caveats.</strong> This is <em>software</em> tasks with clear success criteria at <em>50%</em> reliability — the 80% horizon is meaningfully shorter, and messy real-world work (ambiguous goals, judgment, stakeholders) isn&apos;t captured. The projection is a straight-line extrapolation of a doubling that could bend either way (compute limits, or a jump to continuous learning). METR&apos;s canonical points are through {METR_ASOF}; {latest.model} is a later reported figure. Treat the crossing dates as &ldquo;if the trend holds,&rdquo; not a forecast.
        </InfoBox>
      </>);
    })()}

    {/* ======== GDPval-AA ======== */}
    <SH>GDPval-AA - Agentic AI vs Real-World Economic Work</SH>
    {(() => {
      const sorted = [...GDPVAL_AA_DATA.models].sort((a, b) => b.elo - a.elo);
      const top = sorted[0];
      const byOrgBest = {};
      sorted.forEach(m => { if (!byOrgBest[m.org] || m.elo > byOrgBest[m.org].elo) byOrgBest[m.org] = m; });
      const orgsShown = Object.keys(byOrgBest).length;
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 10 }}>
          <StatCard label="Top Model" val={top.elo.toLocaleString()} sub={`${top.name} | Elo ±${top.ci}`} color={GDP_ORG_COLOR[top.org] || "#818cf8"} />
          <StatCard label="Labs Represented" val={`${orgsShown}`} sub={`in top ${sorted.length} of ${GDPVAL_AA_DATA.totalModelsTracked} tracked`} color="#6366F1" />
          <StatCard label="Benchmark Scope" val={`${GDPVAL_AA_DATA.totalTasks} tasks`} sub={`${GDPVAL_AA_DATA.occupations} occupations | ${GDPVAL_AA_DATA.sectors} sectors`} color="#8B5CF6" />
          <StatCard label="Data As Of" val={GDPVAL_AA_ASOF} sub="Artificial Analysis, GDPval-AA v2" color="#94a3b8" />
        </div>
      );
    })()}
    <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 14 }}>
      Source: <a href={GDPVAL_AA_SOURCE} target="_blank" rel="noopener" style={{ color: "#818cf8" }}>artificialanalysis.ai/evaluations/gdpval-aa</a> — re-check periodically and update the snapshot above; Elo shifts as new models are added.
    </div>

    {/* Elo leaderboard - horizontal bar chart, colored by lab */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>
        GDPval-AA Elo — Top {GDPVAL_AA_DATA.models.length} (of {GDPVAL_AA_DATA.totalModelsTracked} tracked)
      </div>
      <ResponsiveContainer width="100%" height={Math.max(260, GDPVAL_AA_DATA.models.length * 30)}>
        <BarChart layout="vertical" data={[...GDPVAL_AA_DATA.models].sort((a, b) => b.elo - a.elo)} margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" domain={[1100, 1800]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={195} tick={{ fill: "#cbd5e1", fontSize: 9.5, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, _n, p) => [`${v} ±${p.payload.ci}`, p.payload.org]} />
          <Bar dataKey="elo" radius={[0, 4, 4, 0]}>
            {[...GDPVAL_AA_DATA.models].sort((a, b) => b.elo - a.elo).map((m, i) => (
              <Cell key={i} fill={GDP_ORG_COLOR[m.org] || "#94a3b8"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 4 }}>
        Bar color = lab (see legend in caveats below). Several rows are the same base model at different reasoning-effort settings (e.g. Claude Sonnet 5 appears 4x) — that inflates the "125 models tracked" count relative to distinct frontier models.
      </div>
    </div>

    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>Why GDPval-AA matters more than other benchmarks.</strong> Unlike MMLU or HumanEval (closed-form academic problems), GDPval&apos;s underlying task set asks models to produce real deliverables - a legal memo, a financial model, a manufacturing SOP - drawn from 44 occupations across sectors covering most of US GDP. GDPval-AA extends this to an <em>agentic</em> setting: models get shell and browser access and must actually produce the file, not just describe it, then get ranked via blind pairwise comparison against other models&apos; outputs (Elo, not a fixed human bar). That&apos;s the closest public read on "can AI do the actual work," and it&apos;s the bridge between the capability benchmarks above and the productivity data below.
    </InfoBox>

    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>Caveats.</strong> This Elo is <em>relative to other AI models</em>, not a fixed "50% = human parity" bar like the original GDPval used - a big methodology change, so don&apos;t compare these numbers to older GDPval win-rate figures you may have seen. It&apos;s run by a third party (Artificial Analysis), not OpenAI. It measures task-level deliverable quality, not workflow integration, judgment under ambiguity, or sustained performance. And several leaderboard rows are the same underlying model at different effort/reasoning settings, so treat "125 models" as configs, not 125 distinct frontier labs.
    </InfoBox>

    {/* ======== ADOPTION BREADTH (Census BTOS) ======== */}
    <BtosAdoptionPanel />

    {/* ======== POWER BOTTLENECK ======== */}
    <PowerBottleneckPanel />

    {/* ======== PRODUCTIVITY ======== */}
    <SH>Productivity - The Ultimate Test</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Nonfarm Productivity (idx)" val={prod?.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(prod?.yoy, 1)} | 5y ${fmtPct(prod?.fiveYr, 1)}`} color="#10B981" />
      <StatCard label="Info Sector Productivity (idx)" val={infoProd?.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(infoProd?.yoy, 1)} | ${fmtDate2(infoProd?.lastDate)}`} color="#14B8A6" />
    </div>
    <FredChart series={prod} title="Nonfarm Business Labor Productivity (Index, Quarterly)" yoyHighlight yFormat={v => v.toFixed(1)} />
    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>The headline number.</strong> US nonfarm productivity has averaged ~2%/yr over the long run. A sustained break above ~2.5% would be the first direct evidence AI is delivering real economic value - not just speculative capex. Most economists consider 2023-24&apos;s uptick encouraging but not yet confirmation.
    </InfoBox>
    {infoProd?.history?.length > 0 && (
      <FredChart series={infoProd} title="Information Sector Labor Productivity (Index, Quarterly)" yoyHighlight yFormat={v => v.toFixed(1)} />
    )}

    {/* ======== CAPITAL FORMATION ======== */}
    <SH>Capital Formation - Where The Money Is Flowing</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Real Software Investment" val={fmtFredVal(softInv)} sub={`YoY ${fmtPct(softInv?.yoy, 1)} | 5y ${fmtPct(softInv?.fiveYr, 0)}`} color="#6366F1" />
      <StatCard label="Real IP Products Investment" val={fmtFredVal(ipInv)} sub={`YoY ${fmtPct(ipInv?.yoy, 1)} | 5y ${fmtPct(ipInv?.fiveYr, 0)}`} color="#8B5CF6" />
      <StatCard label="Info-Processing Equipment" val={fmtFredVal(hwInv)} sub={`YoY ${fmtPct(hwInv?.yoy, 1)} | 5y ${fmtPct(hwInv?.fiveYr, 0)}`} color="#A855F7" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <FredChart series={softInv} title="Real Software Investment ($B, SAAR)" yoyHighlight yFormat={fmtFredChart(softInv)} />
      <FredChart series={ipInv}   title="Real IP Products Investment ($B, SAAR)" yoyHighlight yFormat={fmtFredChart(ipInv)} />
    </div>
    <FredChart series={hwInv} title="Real Information-Processing Equipment Investment ($B, SAAR)" yoyHighlight yFormat={fmtFredChart(hwInv)} />
    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Following the capex.</strong> Software, IP products, and info-processing equipment together make up most of US business investment in &quot;intangibles + compute.&quot; If AI is driving a real investment cycle, these three should all be accelerating in tandem - and they largely are, especially hardware since 2023.
    </InfoBox>

    {/* ======== HYPERSCALER CAPEX ======== */}
    <HyperscalerCapexPanel />

    {/* ======== PHYSICAL BUILDOUT ======== */}
    <SH>Physical Buildout - Chips &amp; Data Centers</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Semi Production (idx)" val={semis?.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(semis?.yoy, 1)} | 5y ${fmtPct(semis?.fiveYr, 0)}`} color="#F59E0B" />
      <StatCard label="Manufacturing Construction" val={fmtFredVal(mfgCons)} sub={`YoY ${fmtPct(mfgCons?.yoy, 1)} | 5y ${fmtPct(mfgCons?.fiveYr, 0)}`} color="#EF4444" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <FredChart series={semis}   title="Industrial Production: Semiconductors (Index)" yoyHighlight yFormat={v => v.toFixed(1)} />
      <FredChart series={mfgCons} title="Private Manufacturing Construction ($M, Monthly)" yoyHighlight yFormat={fmtFredChart(mfgCons)} />
    </div>
    <InfoBox color="#EF4444">
      <strong style={{ color: "#cbd5e1" }}>CHIPS Act in motion.</strong> Manufacturing construction spending has roughly tripled since 2021 - an unprecedented, visible-from-space real-economy footprint. Semiconductor production itself has been more cyclical, but the fab-build boom is laying the foundation for the next decade of AI compute capacity.
    </InfoBox>

    {/* ======== EMPLOYMENT ======== */}
    <SH>Employment - Jobs In The AI Supply Chain</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Computer Systems Design" val={csdJobs?.current != null ? `${(csdJobs.current / 1000).toFixed(2)}M jobs` : "-"} sub={`YoY ${fmtPct(csdJobs?.yoy, 1)} | 5y ${fmtPct(csdJobs?.fiveYr, 0)}`} color="#3B82F6" />
      <StatCard label="Information Sector" val={infoJobs?.current != null ? `${(infoJobs.current / 1000).toFixed(2)}M jobs` : "-"} sub={`YoY ${fmtPct(infoJobs?.yoy, 1)} | 5y ${fmtPct(infoJobs?.fiveYr, 0)}`} color="#60A5FA" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <FredChart series={csdJobs}  title="Computer Systems Design Employment (thousands)" yoyHighlight yFormat={v => `${(v/1000).toFixed(2)}M`} />
      <FredChart series={infoJobs} title="Information Sector Employment (thousands)" yoyHighlight yFormat={v => `${(v/1000).toFixed(2)}M`} />
    </div>
    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>The labor paradox.</strong> Hyperscaler AI capex is projected at $300B+ in 2025-26, yet information-sector headcount has stagnated since 2022. That gap - huge compute spend, flat payrolls - is the signature of a productivity-driven investment cycle: output is rising faster than employment. Watch this spread widen or close.
    </InfoBox>

    {/* ======== POWER ======== */}
    {power?.history?.length > 0 && (<>
      <SH>Power Demand - AI&apos;s Physical Footprint</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="Electric Power Generation" val={power.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(power.yoy, 1)} | 5y ${fmtPct(power.fiveYr, 1)}`} color="#EAB308" />
      </div>
      <FredChart series={power} title="Electric Power Generation (Index, Monthly)" yoyHighlight yFormat={v => v.toFixed(1)} />
      <InfoBox color="#EAB308">
        <strong style={{ color: "#cbd5e1" }}>The power problem is real.</strong> US electricity demand was essentially flat for 15 years (2007-2022); utilities now forecast 15-20% growth by 2030, driven largely by AI data centers. Watch this series break from its decade-long flatline - it&apos;s the clearest physical tell that AI compute is expanding at scale.
      </InfoBox>
    </>)}

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>Data source:</strong> All time series from <a href="https://fred.stlouisfed.org" target="_blank" rel="noopener" style={{ color: "#a5b4fc" }}>FRED</a> (St. Louis Fed), originating from BLS, BEA, and Federal Reserve G.17 reports. Refreshes every 4 hours server-side. No equity or market-cap data included - this tab is intentionally about the real economy only.
    </InfoBox>
  </>);
}


// ===========================================================
// SUB-TAB 2: MODEL MARKET
// ===========================================================
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

// ===========================================================
// SUB-TAB 3: RANKINGS (live OpenRouter token usage data)
// ===========================================================
const fmtReqs = n => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return String(n);
};
const fmtPctFrac = v => {
  if (v == null) return "new";
  const pct = (v * 100).toFixed(1);
  return v >= 0 ? `+${pct}%` : `${pct}%`;
};
const pctColor = v => v == null ? "#8B5CF6" : v >= 0 ? "#10B981" : "#f87171";

const RANK_COLORS = ["#E8553A","#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#6366F1","#14B8A6","#F97316","#D946EF","#F2A93B","#4ECDC4","#818cf8","#94a3b8","#fb923c","#a78bfa","#34d399","#fbbf24","#f472b6","#67e8f9"];

function RankingsTab({ rankings, rankingsLoading }) {
  const [sortCol, setSortCol] = useState("downloads");
  const [sortAsc, setSortAsc]  = useState(false);
  const [search, setSearch]    = useState("");
  const [filterProv, setFilterProv] = useState("All");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // Process HF rankings: latest snapshot's leaderboard + day-over-day trend.
  // Row shape from /api/hf-rankings:
  //   { date, rank, id, author, downloads, likes, pipeline, library, lastModified, createdAt }
  const { leaderboard, providerShare, trendData, heroStats, latestDate, allProviders } = useMemo(() => {
    if (!rankings || !rankings.length) return { leaderboard: [], providerShare: [], trendData: [], heroStats: {}, latestDate: null, allProviders: [] };

    const dates = [...new Set(rankings.map(r => r.date))].sort();
    const latest = dates[dates.length - 1];
    const prior = dates.length > 1 ? dates[dates.length - 2] : null;
    const latestRows = rankings.filter(r => r.date === latest);
    const priorMap = new Map();
    if (prior) rankings.filter(r => r.date === prior).forEach(r => priorMap.set(r.id, r.downloads));

    // Build leaderboard from latest snapshot
    const lb = latestRows.map(r => {
      const parts = (r.id || "").split("/");
      const author = parts[0] || "—";
      const modelName = parts.slice(1).join("/") || r.id;
      const priorDl = priorMap.get(r.id);
      const change = (priorDl && priorDl > 0) ? (r.downloads - priorDl) / priorDl : null;
      return {
        id: r.id,
        name: modelName,
        provider: author,        // keep "provider" alias for legacy UI prop names
        downloads: r.downloads || 0,
        likes: r.likes || 0,
        pipeline: r.pipeline,
        library: r.library,
        lastModified: r.lastModified,
        createdAt: r.createdAt,
        rank: r.rank,
        change,
      };
    }).sort((a, b) => b.downloads - a.downloads);

    // Author / "provider" share by downloads
    const provMap = {};
    lb.forEach(m => { provMap[m.provider] = (provMap[m.provider] || 0) + m.downloads; });
    const totalDl = lb.reduce((s, m) => s + m.downloads, 0);
    const ps = Object.entries(provMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, downloads]) => ({ name, downloads, pct: totalDl > 0 ? ((downloads / totalDl) * 100).toFixed(1) : "0" }));

    // Trend: top 8 models across all archived dates (downloads in millions for chart readability)
    const top8ids = lb.slice(0, 8).map(m => m.id);
    const td = dates.map(date => {
      const row = { date: date.slice(5, 10) }; // "06-05"
      const dayRows = rankings.filter(r => r.date === date);
      top8ids.forEach(id => {
        const match = dayRows.find(r => r.id === id);
        row[id] = match ? match.downloads / 1e6 : 0;  // millions
      });
      return row;
    });

    const hs = {
      totalDownloads: totalDl,
      totalLikes: lb.reduce((s, m) => s + m.likes, 0),
      activeModels: latestRows.length,
      activeAuthors: ps.length,
      topModel: lb[0]?.name || "—",
      topAuthor: ps[0]?.name || "—",
    };

    const ap = ["All", ...ps.map(p => p.name)];

    return { leaderboard: lb, providerShare: ps, trendData: td, heroStats: hs, latestDate: latest, allProviders: ap };
  }, [rankings]);

  // Filter + sort the leaderboard
  const filtered = useMemo(() => {
    let out = leaderboard;
    if (search) out = out.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()) || m.provider.toLowerCase().includes(search.toLowerCase()));
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

  if (rankingsLoading) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}><div style={{ fontSize: 18 }}>Loading rankings from Hugging Face...</div></div>;
  if (!rankings.length) return <div style={{ textAlign: "center", padding: 60, color: "#64748b", fontFamily: fonts.heading }}>No rankings data available. Rankings are fetched from Hugging Face's model API.</div>;

  const top8 = leaderboard.slice(0, 8);
  const fmtDate = (d) => d ? d.slice(0, 10) : "";

  return (<>
    {/* Header */}
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>Open-Source AI Model Rankings</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>
        Top text-generation models by past-30-day downloads · Snapshot {fmtDate(latestDate)} · Source:{" "}
        <a href="https://huggingface.co/models?pipeline_tag=text-generation&sort=downloads" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>Hugging Face</a>
      </div>
    </div>

    {/* Hero Stats */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard label="Total Downloads (30d)" val={fmtReqs(heroStats.totalDownloads)} sub="Across tracked models" color="#6366F1" />
      <StatCard label="Total Likes"           val={fmtReqs(heroStats.totalLikes)}     sub="HF community stars"  color="#EC4899" />
      <StatCard label="Tracked Models"        val={heroStats.activeModels}            sub="Top text-generation" color="#10B981" />
      <StatCard label="#1 Model"              val={heroStats.topModel}                sub={`by ${heroStats.topAuthor}`} color="#E8553A" />
    </div>

    {/* Leaderboard - Top 10 */}
    <SH>Leaderboard - Top 10 by 30-Day Downloads</SH>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
      {[leaderboard.slice(0, 5), leaderboard.slice(5, 10)].map((col, ci) => (
        <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {col.map((m, i) => {
            const rank = ci * 5 + i + 1;
            const maxDl = leaderboard[0]?.downloads || 1;
            const barPct = Math.max(4, (m.downloads / maxDl) * 100);
            return (
              <div key={m.id} style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${barPct}%`, background: `${RANK_COLORS[rank - 1]}0D`, borderRadius: 12 }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: rank <= 3 ? "#f59e0b" : "#475569", fontFamily: fonts.mono, minWidth: 28, textAlign: "right", position: "relative" }}>
                  {rank <= 3 ? ["#1","#2","#3"][rank-1] : `${rank}.`}
                </span>
                <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: fonts.heading, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>by {m.provider} · ♥ {fmtReqs(m.likes)}</div>
                </div>
                <div style={{ textAlign: "right", position: "relative" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono }}>{fmtReqs(m.downloads)}</div>
                  <div style={{ fontSize: 10, color: pctColor(m.change), fontFamily: fonts.mono, fontWeight: 600 }}>{m.change != null ? fmtPctFrac(m.change) : "—"}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>

    {/* Author / "Provider" Market Share */}
    <SH>Author Market Share by 30-Day Downloads</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 18 }}>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart layout="vertical" data={providerShare.slice(0, 12)} margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => fmtReqs(v)} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, name, props) => [`${fmtReqs(v)} downloads (${props.payload.pct}%)`, "Volume"]} />
          <Bar dataKey="downloads" radius={[0, 4, 4, 0]}>
            {providerShare.slice(0, 12).map((_, i) => <Cell key={i} fill={RANK_COLORS[i % RANK_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* Daily Download Trend */}
    <SH>Daily Download Trend - Top 8 Models ({trendData.length} day{trendData.length === 1 ? "" : "s"} archived)</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 18 }}>
      {trendData.length <= 1 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 11 }}>
          <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 6 }}>Trend history is just starting to accumulate.</div>
          The server takes one daily snapshot. Come back tomorrow for the first trend line.
        </div>
      ) : (() => {
        // Drop today (partial day, but HF's 30-day rolling window means this is less critical here)
        const completeDays = trendData.length > 2 ? trendData.slice(0, -1) : trendData;
        const tickInt = Math.max(0, Math.floor(completeDays.length / 10) - 1);
        return (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={completeDays} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} />
              <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(0)}M`} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 10 }} formatter={v => [`${v.toFixed(1)}M downloads`]} />
              <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
              {top8.map((m, i) => (
                <Area key={m.id} type="monotone" dataKey={m.id} name={m.name.length > 24 ? m.name.slice(0, 22) + ".." : m.name} stroke={RANK_COLORS[i]} fill={RANK_COLORS[i]} fillOpacity={0.08} strokeWidth={1.5} dot={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );
      })()}
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Downloads are HF's rolling past-30-day count. Snapshots are saved daily — the archive grows by one date every 24h.
      </div>
    </div>

    {/* Quick Stats Row */}
    <SH>Model Mix - Latest Snapshot</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard label="Unique Authors"   val={heroStats.activeAuthors}                            sub="Distinct HF orgs/users"         color="#8B5CF6" />
      <StatCard label="Author Concentration" val={providerShare.slice(0, 3).reduce((s, p) => s + parseFloat(p.pct), 0).toFixed(0) + "%"} sub="Top-3 author share of downloads" color="#F59E0B" />
      <StatCard label="Top Author"       val={heroStats.topAuthor}                                sub={`${providerShare[0]?.pct || 0}% of downloads`} color="#14B8A6" />
      <StatCard label="Avg Likes / Model" val={fmtReqs(Math.round(heroStats.totalLikes / Math.max(1, heroStats.activeModels)))} sub="Community engagement" color="#EC4899" />
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
          <th style={{ ...thStyle, textAlign: "left" }} onClick={() => toggleSort("provider")}>Author <SortIcon col="provider" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("downloads")}>Downloads (30d) <SortIcon col="downloads" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("likes")}>Likes <SortIcon col="likes" sortCol={sortCol} sortAsc={sortAsc} /></th>
          <th style={{ ...thStyle, textAlign: "left" }}>Library</th>
          <th style={{ ...thStyle, textAlign: "left" }}>Last Modified</th>
          <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("change")}>Δ Day <SortIcon col="change" sortCol={sortCol} sortAsc={sortAsc} /></th>
        </tr></thead>
        <tbody>
          {pageData.map((m, i) => {
            const rank = page * PAGE_SIZE + i + 1;
            return (
              <tr key={m.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.1s" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "10px 8px", textAlign: "center", fontSize: 12, fontFamily: fonts.mono, color: rank <= 3 ? "#f59e0b" : "#475569", fontWeight: rank <= 3 ? 700 : 400 }}>{rank <= 3 ? ["#1","#2","#3"][rank-1] : rank}</td>
                <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                  <a href={`https://huggingface.co/${m.id}`} target="_blank" rel="noopener" style={{ fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", textDecoration: "none" }} title={m.id}>{m.name}</a>
                </td>
                <td style={{ padding: "10px 12px" }}><span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 6 }}>{m.provider}</span></td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>{fmtReqs(m.downloads)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: m.likes > 0 ? "#f472b6" : "#334155" }}>{m.likes > 0 ? fmtReqs(m.likes) : "—"}</td>
                <td style={{ padding: "10px 12px", fontFamily: fonts.mono, fontSize: 10, color: "#64748b" }}>{m.library || "—"}</td>
                <td style={{ padding: "10px 12px", fontFamily: fonts.mono, fontSize: 10, color: "#64748b" }}>{m.lastModified ? m.lastModified.slice(0, 10) : "—"}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color: pctColor(m.change) }}>{m.change != null ? fmtPctFrac(m.change) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {totalPages > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <button onClick={() => setPage(0)} disabled={page === 0} style={{ ...selectStyle, opacity: page === 0 ? 0.3 : 1 }}>{"<<"}</button>
        <button onClick={() => setPage(p => p - 1)} disabled={page === 0} style={{ ...selectStyle, opacity: page === 0 ? 0.3 : 1 }}>{"<"}</button>
        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#64748b", padding: "0 8px" }}>Page {page + 1} of {totalPages}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>{">"}</button>
        <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>{">>"}</button>
      </div>
    )}
  </>);
}

// ===========================================================
// SUB-TAB 4: AI PRICING (token + GPU spot prices with history)
// ===========================================================
const GPU_COLORS = {
  'H100 SXM': '#E8553A', 'H100 NVL': '#F97316', 'H200': '#fb923c', 'H200 NVL': '#fbbf24',
  'A100 SXM4': '#F59E0B', 'A100 PCIE': '#eab308',
  'L40S': '#8B5CF6', 'RTX A6000': '#6366F1',
  'RTX 5090': '#EC4899', 'RTX 4090': '#3B82F6', 'RTX 3090': '#10B981',
};
const TOKEN_COLORS = {
  'openai/gpt-4o': '#10B981', 'openai/gpt-4o-mini': '#34d399', 'openai/o3-mini': '#6ee7b7',
  'anthropic/claude-sonnet-4': '#E8553A', 'anthropic/claude-haiku-4.5': '#fb923c',
  'google/gemini-2.5-pro-preview': '#3B82F6', 'google/gemini-2.5-flash': '#60a5fa',
  'deepseek/deepseek-chat-v3-0324': '#F59E0B', 'deepseek/deepseek-r1': '#fbbf24',
  'meta-llama/llama-4-maverick': '#8B5CF6', 'meta-llama/llama-4-scout': '#a78bfa',
  'mistralai/mistral-medium-3': '#EC4899', 'x-ai/grok-3-mini-beta': '#14B8A6',
  'qwen/qwen3-235b-a22b': '#D946EF',
};

// --- Estimated quality scores per OpenRouter model ID ---
// MMLU + GPQA Diamond. Values are best-effort approximations from public evals
// (model release notes, METR, Artificial Analysis, lmarena cross-references).
// Used by the Intelligence-per-Dollar chart to compute quality-adjusted cost.
const MODEL_QUALITY = {
  "openai/gpt-5.5-pro":              { mmlu: 95, gpqa: 88 },
  "openai/gpt-5.5":                  { mmlu: 92, gpqa: 85 },
  "openai/gpt-5.4":                  { mmlu: 90, gpqa: 82 },
  "openai/gpt-5.4-mini":             { mmlu: 86, gpqa: 75 },
  "openai/gpt-5.4-nano":             { mmlu: 78, gpqa: 60 },
  "openai/gpt-5.2-pro":              { mmlu: 91, gpqa: 84 },
  "openai/gpt-5-codex":              { mmlu: 90, gpqa: 80 },
  "openai/o3-pro":                   { mmlu: 91, gpqa: 89 },
  "openai/gpt-4.1":                  { mmlu: 88, gpqa: 72 },
  "openai/gpt-4.1-mini":             { mmlu: 82, gpqa: 65 },
  "openai/gpt-oss-120b":             { mmlu: 79, gpqa: 62 },
  "anthropic/claude-opus-4.8":       { mmlu: 93, gpqa: 87 },
  "anthropic/claude-opus-4.7":       { mmlu: 92, gpqa: 86 },
  "anthropic/claude-opus-4.6":       { mmlu: 91, gpqa: 85 },
  "anthropic/claude-sonnet-4.6":     { mmlu: 89, gpqa: 80 },
  "anthropic/claude-sonnet-4.5":     { mmlu: 88, gpqa: 78 },
  "anthropic/claude-haiku-4.5":      { mmlu: 82, gpqa: 68 },
  "google/gemini-3.1-pro-preview":   { mmlu: 91, gpqa: 84 },
  "google/gemini-3.5-flash":         { mmlu: 87, gpqa: 76 },
  "google/gemini-2.5-pro":           { mmlu: 90, gpqa: 82 },
  "google/gemini-2.5-flash":         { mmlu: 84, gpqa: 72 },
  "google/gemini-2.5-flash-lite":    { mmlu: 76, gpqa: 60 },
  "x-ai/grok-4.3":                   { mmlu: 90, gpqa: 83 },
  "x-ai/grok-4.20":                  { mmlu: 89, gpqa: 81 },
  "deepseek/deepseek-v4-pro":        { mmlu: 87, gpqa: 75 },
  "deepseek/deepseek-v4-flash":      { mmlu: 79, gpqa: 60 },
  "deepseek/deepseek-v3.2":          { mmlu: 84, gpqa: 70 },
  "deepseek/deepseek-r1":            { mmlu: 86, gpqa: 79 },
  "meta-llama/llama-4-maverick":     { mmlu: 83, gpqa: 70 },
  "meta-llama/llama-4-scout":        { mmlu: 78, gpqa: 60 },
  "meta-llama/llama-3.3-70b-instruct": { mmlu: 75, gpqa: 50 },
  "mistralai/mistral-large-2512":    { mmlu: 80, gpqa: 65 },
  "mistralai/mistral-medium-3.1":    { mmlu: 75, gpqa: 55 },
  "qwen/qwen3.7-max":                { mmlu: 86, gpqa: 75 },
  "qwen/qwen3.5-397b-a17b":          { mmlu: 82, gpqa: 68 },
};

// Map provider prefix → color for charts
const PROVIDER_COLORS = {
  "openai":       "#10B981",
  "anthropic":    "#E8553A",
  "google":       "#3B82F6",
  "x-ai":         "#14B8A6",
  "deepseek":     "#F59E0B",
  "meta-llama":   "#8B5CF6",
  "mistralai":    "#EC4899",
  "qwen":         "#D946EF",
};
const providerColor = id => PROVIDER_COLORS[id.split("/")[0]] || "#94a3b8";

// ─── Intelligence-per-Dollar panel ──────────────────────────────────────────
// Cost per quality point. Reveals the TRUE deflation curve — controls for the
// fact that newer models are cheaper AND smarter.
function IntelligencePerDollarPanel({ data }) {
  const [benchmark, setBenchmark] = useState("composite"); // "mmlu" | "gpqa" | "composite"

  const liveModels = (data?.live?.tokens?.models) || [];
  // Score for each model based on selected benchmark
  const scoreFor = id => {
    const q = MODEL_QUALITY[id];
    if (!q) return null;
    if (benchmark === "mmlu") return q.mmlu;
    if (benchmark === "gpqa") return q.gpqa;
    return (q.mmlu + q.gpqa) / 2; // composite
  };

  // Current snapshot: each model → cost-quality index = output$/M ÷ (score/100)
  const currentRows = useMemo(() => {
    return liveModels
      .filter(m => scoreFor(m.id) != null && m.output > 0)
      .map(m => {
        const score = scoreFor(m.id);
        const costIndex = m.output / (score / 100); // $ per 1M quality-equivalent tokens
        return {
          id: m.id,
          name: m.name,
          provider: m.id.split("/")[0],
          output: m.output,
          score,
          costIndex,
          color: providerColor(m.id),
        };
      })
      .sort((a, b) => a.costIndex - b.costIndex);
  }, [liveModels, benchmark]);

  // Pareto frontier: at each quality level, the cheapest model
  const paretoModels = useMemo(() => {
    const sortedByQuality = [...currentRows].sort((a, b) => b.score - a.score);
    const pareto = [];
    let minCost = Infinity;
    for (const m of sortedByQuality) {
      if (m.output < minCost) { pareto.push(m); minCost = m.output; }
    }
    return pareto;
  }, [currentRows]);
  const paretoIds = new Set(paretoModels.map(m => m.id));

  // Time-series: best (lowest) cost-quality-index across all priced models, per snapshot date
  const hist = data?.history?.tokenHistory || [];
  const trendData = useMemo(() => {
    return hist.map(snap => {
      const models = snap.models || [];
      let best = Infinity, bestId = null;
      for (const m of models) {
        const sc = scoreFor(m.id);
        if (sc == null || !m.output) continue;
        const idx = m.output / (sc / 100);
        if (idx < best) { best = idx; bestId = m.id; }
      }
      return { date: snap.date, bestCostIndex: best === Infinity ? null : best, bestId };
    }).filter(r => r.bestCostIndex != null);
  }, [hist, benchmark]);

  // Deflation rate: bestCostIndex now vs N days ago
  const deflation = (() => {
    if (trendData.length < 2) return null;
    const last = trendData[trendData.length - 1];
    const first = trendData[0];
    const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
    return {
      lastVal: last.bestCostIndex,
      firstVal: first.bestCostIndex,
      pctChange: ((last.bestCostIndex - first.bestCostIndex) / first.bestCostIndex) * 100,
      days: Math.round(days),
      bestId: last.bestId,
    };
  })();

  const tickInt = Math.max(0, Math.floor(trendData.length / 10) - 1);

  return (<>
    <SH>Intelligence per Dollar — Quality-Adjusted Cost</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>
        Output-token price normalized by model quality. Lower bar = more intelligence per dollar.
        <strong style={{ color: "#a5b4fc" }}> The Pareto-frontier models</strong> (highlighted) are the only ones that aren't dominated by something both cheaper and smarter.
      </div>

      {/* Benchmark selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginRight: 4 }}>Quality metric:</span>
        {[{ v: "composite", l: "Composite (MMLU + GPQA)" }, { v: "mmlu", l: "MMLU" }, { v: "gpqa", l: "GPQA Diamond" }].map(opt => (
          <button key={opt.v} onClick={() => setBenchmark(opt.v)} style={{ background: benchmark === opt.v ? "rgba(99,102,241,0.18)" : "#0f172a", border: `1px solid ${benchmark === opt.v ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)"}`, borderRadius: 6, color: benchmark === opt.v ? "#a5b4fc" : "#94a3b8", fontSize: 10, fontFamily: fonts.mono, padding: "4px 10px", cursor: "pointer" }}>{opt.l}</button>
        ))}
      </div>

      {/* Hero stats */}
      {deflation && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 18 }}>
          <StatCard label="Best $/M Output Today" val={`$${deflation.lastVal.toFixed(2)}`} sub={`at 100% ${benchmark.toUpperCase()}`} color="#10B981" />
          <StatCard label={`Δ over ${deflation.days} days`} val={`${deflation.pctChange >= 0 ? "+" : ""}${deflation.pctChange.toFixed(1)}%`} sub={deflation.pctChange < 0 ? "deflation" : "inflation"} color={deflation.pctChange < 0 ? "#10B981" : "#F97316"} />
          <StatCard label="Pareto-Frontier Models" val={paretoModels.length} sub={`of ${currentRows.length} priced`} color="#6366F1" />
          <StatCard label="Best-Value Leader" val={(deflation.bestId || "").split("/").slice(-1)[0]} sub="Lowest cost-quality index" color="#F59E0B" />
        </div>
      )}

      {/* Bar chart of all models by cost-quality index */}
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>$ per 1M quality-equivalent output tokens (lower is better, log scale)</div>
      <ResponsiveContainer width="100%" height={Math.max(280, currentRows.length * 22)}>
        <BarChart data={currentRows} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} />
          <YAxis type="category" dataKey="name" width={170} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`$${v.toFixed(2)} / 1M @ 100% quality (raw $${p.payload.output.toFixed(2)}/M ÷ ${p.payload.score} score)`, "Cost-quality index"]} />
          <Bar dataKey="costIndex" radius={[0, 4, 4, 0]}>
            {currentRows.map((r, i) => (
              <Cell key={i} fill={paretoIds.has(r.id) ? r.color : `${r.color}55`} stroke={paretoIds.has(r.id) ? "#f1f5f9" : "transparent"} strokeWidth={paretoIds.has(r.id) ? 1.5 : 0} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* Quality vs price scatter — proper ScatterChart for per-point hover */}
    <SH>Quality vs. Price — Where's the Pareto Frontier?</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Output $/M (log Y) vs {benchmark.toUpperCase()} score · hover any dot to identify the model</div>
      {(() => {
        const scatterPts = currentRows.map(r => ({ ...r, x: r.score, y: r.output, onPareto: paretoIds.has(r.id) }));
        const paretoPts = scatterPts.filter(p => p.onPareto);
        const otherPts  = scatterPts.filter(p => !p.onPareto);
        const xMin = Math.min(...scatterPts.map(r => r.score)) - 3;
        const xMax = Math.max(...scatterPts.map(r => r.score)) + 3;
        const ParetoTip = ({ active, payload }) => {
          if (!active || !payload || !payload.length) return null;
          const r = payload[0].payload;
          return (
            <div style={{ background: "#0f172a", border: `1px solid ${r.color}`, borderRadius: 8, padding: "10px 13px", fontSize: 11, fontFamily: fonts.mono, boxShadow: "0 6px 20px rgba(0,0,0,0.5)", minWidth: 180 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: r.color, display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{r.name}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "3px 12px", color: "#cbd5e1" }}>
                <span style={{ color: "#64748b" }}>{benchmark.toUpperCase()} score</span><span style={{ textAlign: "right", fontWeight: 600 }}>{r.score.toFixed(1)}</span>
                <span style={{ color: "#64748b" }}>Output price</span><span style={{ textAlign: "right", fontWeight: 600 }}>${r.output.toFixed(2)}/M</span>
                <span style={{ color: "#64748b" }}>Cost-quality idx</span><span style={{ textAlign: "right", fontWeight: 600 }}>${r.costIndex.toFixed(2)}</span>
              </div>
              <div style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: r.onPareto ? "#4ade80" : "#94a3b8" }}>
                {r.onPareto ? "★ On the Pareto frontier — best-in-class value" : "Dominated by a cheaper, smarter option"}
              </div>
            </div>
          );
        };
        return (
          <ResponsiveContainer width="100%" height={380}>
            <ScatterChart margin={{ top: 10, right: 30, left: 5, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis type="number" dataKey="x" name="Score" domain={[xMin, xMax]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} label={{ value: `${benchmark.toUpperCase()} score →`, position: "insideBottom", offset: -8, style: { fill: "#64748b", fontSize: 10, fontFamily: "monospace" } }} />
              <YAxis type="number" dataKey="y" name="$/M output" scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} label={{ value: "↑ cheaper", angle: -90, position: "insideLeft", offset: 18, style: { fill: "#64748b", fontSize: 10, fontFamily: "monospace" } }} />
              <ZAxis range={[60, 60]} />
              <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.15)" }} content={<ParetoTip />} />
              <Scatter data={otherPts} fill="#64748b" isAnimationActive={false}
                shape={(props) => <circle cx={props.cx} cy={props.cy} r={5} fill={props.payload.color} opacity={0.45} />} />
              <Scatter data={paretoPts} isAnimationActive={false}
                shape={(props) => <circle cx={props.cx} cy={props.cy} r={7} fill={props.payload.color} stroke="#f1f5f9" strokeWidth={1.5} />} />
            </ScatterChart>
          </ResponsiveContainer>
        );
      })()}
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 4, paddingLeft: 4 }}>
        Bright outlined dots are on the Pareto frontier (nothing is both cheaper and smarter). Faded dots are dominated. Hover any point for full detail.
      </div>
    </div>

    {/* Deflation trend (if we have history) */}
    {trendData.length > 1 && (<>
      <SH>Best Cost-Quality Index Over Time ({trendData.length} snapshots)</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trendData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} />
            <YAxis scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`$${v.toFixed(2)} via ${(p.payload.bestId || "").split("/").slice(-1)[0]}`, "Best $/M at 100% quality"]} />
            <Line type="monotone" dataKey="bestCostIndex" stroke="#10B981" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 6 }}>
          The "deflation curve" — what it costs today to get 100% quality-equivalent output tokens, controlling for model intelligence. Log Y so a straight downward line = constant % deflation.
        </div>
      </div>
    </>)}

    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>What this metric controls for.</strong> Headline token-price comparisons mislead — newer models are cheaper AND smarter, so the raw price drop understates the real productivity gain. Quality-adjusted cost (price ÷ benchmark score) shows the <em>true</em> deflation. Historically this has fallen ~5-10× per year for frontier-comparable quality. Quality scores are estimates from public evals (MMLU and GPQA Diamond), so these are best-effort rankings rather than precise measurements.
    </InfoBox>
  </>);
}

function PricingTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [gpuSort, setGpuSort] = useState('median');
  const [gpuSortAsc, setGpuSortAsc] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ai-prices')
      .then(r => r.json())
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const tokenHistChart = useMemo(() => {
    if (!data?.history?.tokenHistory?.length) return [];
    return data.history.tokenHistory.map(snap => {
      const row = { d: snap.date };
      (snap.models || []).forEach(m => { row[m.id] = m.input; });
      row._median = snap.medianInput;
      return row;
    });
  }, [data]);

  const gpuHistChart = useMemo(() => {
    if (!data?.history?.gpuHistory?.length) return [];
    return data.history.gpuHistory.map(snap => {
      const row = { d: snap.date };
      // Prefer blended consensus; fall back to Vast median for older snapshots
      Object.entries(snap.gpus || {}).forEach(([key, g]) => { row[g.name] = g.consensus ?? g.median; });
      return row;
    });
  }, [data]);

  const gpuRows = useMemo(() => {
    if (!data?.live?.gpus) return [];
    const rows = Object.entries(data.live.gpus).map(([key, g]) => ({ key, ...g }));
    rows.sort((a, b) => {
      const va = a[gpuSort] ?? 0, vb = b[gpuSort] ?? 0;
      return gpuSortAsc ? va - vb : vb - va;
    });
    return rows;
  }, [data, gpuSort, gpuSortAsc]);

  const toggleGpuSort = col => {
    if (gpuSort === col) setGpuSortAsc(a => !a);
    else { setGpuSort(col); setGpuSortAsc(col === 'name'); }
  };

  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", background: "#0a0f1e" };

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}><div style={{ fontSize: 18 }}>Loading AI pricing data...</div><div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>Fetching from OpenRouter + Vast.ai (may take 15-30s on first load)</div></div>;
  if (error || !data) return <div style={{ textAlign: "center", padding: 60, color: "#f87171", fontFamily: fonts.heading }}>Failed to load pricing data. <button onClick={() => { setLoading(true); fetch('/api/ai-prices').then(r => r.json()).then(d => { setData(d); setError(false); }).catch(() => setError(true)).finally(() => setLoading(false)); }} style={{ color: "#818cf8", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button></div>;

  const live = data.live;
  const tokenModels = live?.tokens?.models || [];
  const snapCount = (data.history?.tokenHistory?.length || 0);

  return (<>
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>AI Pricing Tracker</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>
        Token prices from <a href="https://openrouter.ai" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>OpenRouter</a> | GPU spot from <a href="https://vast.ai" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>Vast.ai</a> | {snapCount} snapshot{snapCount !== 1 ? 's' : ''} saved | Auto-snapshots every 6h
      </div>
    </div>

    {/* -- Token Pricing -- */}
    <SH>LLM Token Prices (per 1M tokens)</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Models Tracked" val={live?.tokens?.totalModels || '-'} sub={`${live?.tokens?.paidModels || 0} paid`} color="#6366F1" />
      <StatCard label="Median Input" val={`$${(live?.tokens?.medianInput || 0).toFixed(2)}`} sub="Across all paid models" color="#F59E0B" />
      <StatCard label="Mean Input" val={`$${(live?.tokens?.meanInput || 0).toFixed(2)}`} sub="Weighted by outliers" color="#3B82F6" />
      <StatCard label="Cheapest" val={tokenModels.length ? `$${Math.min(...tokenModels.map(m => m.input)).toFixed(2)}` : '-'} sub={tokenModels.length ? tokenModels.reduce((a, b) => a.input < b.input ? a : b).id.split('/')[1] : ''} color="#10B981" />
    </div>

    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left", cursor: "default" }}>Model</th>
          <th style={{ ...thStyle, textAlign: "left", cursor: "default" }}>Provider</th>
          <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>Input $/M</th>
          <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>Output $/M</th>
          <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>Ratio</th>
          <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>Context</th>
        </tr></thead>
        <tbody>
          {tokenModels.map((m, i) => {
            const ratio = m.output > 0 && m.input > 0 ? (m.output / m.input).toFixed(1) : '-';
            const color = TOKEN_COLORS[m.id] || '#94a3b8';
            return (
              <tr key={m.id} style={{ borderBottom: i < tokenModels.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color, marginRight: 8, verticalAlign: "middle" }} />
                  {m.id.split('/')[1]}
                </td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{m.id.split('/')[0]}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 600 }}>${m.input.toFixed(2)}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#cbd5e1", textAlign: "right" }}>${m.output.toFixed(2)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{ratio}x</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{m.context >= 1e6 ? `${(m.context/1e6).toFixed(1)}M` : `${(m.context/1e3).toFixed(0)}K`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Token price history chart */}
    {tokenHistChart.length > 1 && (<>
      <SH>Token Price History (Input $/M)</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={tokenHistChart} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 10 }} formatter={v => [`$${Number(v).toFixed(2)}/M`]} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
            {Object.entries(TOKEN_COLORS).map(([id, color]) => (
              <Line key={id} type="monotone" dataKey={id} name={id.split('/')[1]} stroke={color} strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>)}
    {tokenHistChart.length <= 1 && (
      <InfoBox color="#6366F1">
        <strong style={{ color: "#cbd5e1" }}>Price history will build over time.</strong> The system saves daily snapshots of token and GPU prices. Check back tomorrow to see your first trend line - after a week you'll have meaningful price movement data.
      </InfoBox>
    )}

    {/* -- GPU Pricing -- */}
    <SH>GPU Spot Prices (Vast.ai + RunPod Consensus)</SH>
    {gpuRows.length > 0 ? (<>
      {(() => {
        const consensusVals = gpuRows.map(g => g.consensus ?? g.median).filter(v => v != null);
        const cheapest = gpuRows.reduce((a, b) => (a.consensus ?? a.median) < (b.consensus ?? b.median) ? a : b);
        const h100 = gpuRows.find(g => g.name.includes('H100 SXM'));
        const spreads = gpuRows.map(g => g.sourceSpread).filter(v => v != null);
        const avgSpread = spreads.length ? Math.round(spreads.reduce((a, b) => a + b, 0) / spreads.length) : null;
        const dualSource = gpuRows.filter(g => (g.sources || []).includes('runpod')).length;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
            <StatCard label="Cheapest GPU" val={`$${Math.min(...consensusVals).toFixed(2)}/hr`} sub={`${cheapest.name} · consensus`} color="#10B981" />
            <StatCard label="H100 SXM Consensus" val={h100 ? `$${(h100.consensus ?? h100.median).toFixed(2)}/hr` : '-'} sub={h100 ? `Vast $${h100.vastMedian?.toFixed(2)} · RunPod $${h100.runpodCommunity?.toFixed(2) ?? '—'}` : 'SXM5 on-demand'} color="#F97316" />
            <StatCard label="Dual-Source GPUs" val={`${dualSource}/${gpuRows.length}`} sub="Priced by both feeds" color="#6366F1" />
            <StatCard label="Avg Source Spread" val={avgSpread != null ? `${avgSpread}%` : '—'} sub="Vast vs RunPod disagreement" color={avgSpread != null && avgSpread > 25 ? "#F59E0B" : "#10B981"} />
          </div>
        );
      })()}

      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={{ ...thStyle, textAlign: "left" }} onClick={() => toggleGpuSort('name')}>GPU <SortIcon col="name" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleGpuSort('vram')}>VRAM <SortIcon col="vram" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleGpuSort('vastMedian')}>Vast Med <SortIcon col="vastMedian" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleGpuSort('runpodCommunity')}>RunPod <SortIcon col="runpodCommunity" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleGpuSort('consensus')}>Consensus <SortIcon col="consensus" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleGpuSort('sourceSpread')}>Spread <SortIcon col="sourceSpread" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
            <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleGpuSort('count')}>Vast Offers <SortIcon col="count" sortCol={gpuSort} sortAsc={gpuSortAsc} /></th>
          </tr></thead>
          <tbody>
            {gpuRows.map((g, i) => {
              const color = GPU_COLORS[g.name] || '#94a3b8';
              const consensus = g.consensus ?? g.median;
              const spreadColor = g.sourceSpread == null ? "#475569" : g.sourceSpread > 35 ? "#f87171" : g.sourceSpread > 20 ? "#fbbf24" : "#4ade80";
              return (
                <tr key={g.key} style={{ borderBottom: i < gpuRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color, marginRight: 8, verticalAlign: "middle" }} />
                    {g.name}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{g.vram ? `${g.vram} GB` : '-'}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{g.vastMedian != null ? `$${g.vastMedian.toFixed(2)}` : '-'}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: g.runpodCommunity != null ? "#94a3b8" : "#334155", textAlign: "right" }}>{g.runpodCommunity != null ? `$${g.runpodCommunity.toFixed(2)}` : '—'}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 700 }}>{consensus != null ? `$${consensus.toFixed(2)}` : '-'}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: spreadColor, textAlign: "right" }}>{g.sourceSpread != null ? `${g.sourceSpread}%` : '—'}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{g.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* GPU price history chart */}
      {gpuHistChart.length > 1 && (<>
        <SH>GPU Price History (Consensus $/hr — Vast + RunPod)</SH>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={gpuHistChart} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
              <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 10 }} formatter={v => [`$${Number(v).toFixed(2)}/hr`]} />
              <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
              {Object.entries(GPU_COLORS).map(([name, color]) => (
                <Line key={name} type="monotone" dataKey={name} name={name} stroke={color} strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </>)}
    </>) : (
      <InfoBox color="#E8553A">
        <strong style={{ color: "#cbd5e1" }}>GPU pricing unavailable.</strong> Both Vast.ai and RunPod may be rate-limiting or temporarily down. GPU prices will be captured in the next snapshot cycle.
      </InfoBox>
    )}

    {gpuRows.length > 0 && (
      <InfoBox color="#10B981">
        <strong style={{ color: "#cbd5e1" }}>Two-source consensus.</strong> Each GPU&apos;s headline price blends Vast.ai&apos;s marketplace median with RunPod&apos;s community on-demand price. Vast&apos;s raw marketplace is noisy — its median shifts with whatever machines happen to be listed that day — while RunPod is a curated single quote, so averaging the two smooths the day-to-day jitter you were seeing. The <strong>Spread</strong> column shows how far the two sources disagree: high spread (&gt;35%, red) means treat that GPU&apos;s price with more caution. The history chart plots the blended consensus going forward.
      </InfoBox>
    )}

    {data && <IntelligencePerDollarPanel data={data} />}

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>How this works:</strong> Every 6 hours (and on each page load), the server snapshots current token and GPU prices to a local file (<code style={{ color: "#a5b4fc" }}>ai-prices.json</code>). Over time, this builds a price history that lets you track the deflation curve for both LLM inference and GPU compute. Keep the dev server running to accumulate data points.
    </InfoBox>
  </>);
}

// ===========================================================
// SUB-TAB: TOKENOMICS (SemiAnalysis-style cost/margin model)
// ===========================================================
// Three panels:
//   1. Model unit economics — bottom-up cost per output token (memory-BW & FLOPS based)
//   2. Data center IRR — payback + steady-state yield for a GPU cluster
//   3. Live margin estimator — applies the model to current OpenRouter pricing
//
// Math (decode-dominant inference):
//   memBoundTimePerForward = (active_params × bytes_per_param) / memBW_bytes_per_sec
//   computeBoundTimePerForward = (2 × active_params × batch) / peak_FLOPS
//   timePerForwardSec = max(memBound, computeBound)
//   tokens_per_forward_per_gpu = batch_size   (one new token per sequence per pass)
//   throughput_tps = batch_size / timePerForwardSec
//   cost_per_M_output = ($/GPU-hr) × 1e6 / 3600 / throughput_tps
//   $/GPU-hr = (capex × (WACC + 1/life) + power × PUE × 8760 × $/kWh + opex) / (8760 × utilization)

// --- GPU spec library (NVIDIA + Google TPU) ---
const GPU_SPECS = {
  "H100-SXM":    { label: "H100 SXM (80GB)",          memGB: 80,  memBW: 3.35, fp8TFLOPS: 1979, bf16TFLOPS: 989,  watts: 700,  capex: 30000 },
  "H100-NVL":    { label: "H100 NVL (188GB)",         memGB: 188, memBW: 7.80, fp8TFLOPS: 1979, bf16TFLOPS: 989,  watts: 700,  capex: 35000 },
  "H200-SXM":    { label: "H200 SXM (141GB)",         memGB: 141, memBW: 4.80, fp8TFLOPS: 1979, bf16TFLOPS: 989,  watts: 700,  capex: 40000 },
  "B200":        { label: "B200 (192GB)",             memGB: 192, memBW: 8.00, fp8TFLOPS: 4500, bf16TFLOPS: 2250, watts: 1000, capex: 55000 },
  "GB200-NVL72": { label: "GB200 NVL72 (per-GPU)",    memGB: 192, memBW: 8.00, fp8TFLOPS: 4500, bf16TFLOPS: 2250, watts: 1200, capex: 70000 },
  "TPU-v5p":     { label: "Google TPU v5p (95GB)",    memGB: 95,  memBW: 2.76, fp8TFLOPS: 0,    bf16TFLOPS: 459,  watts: 700,  capex: 35000 },
};

// --- Model preset library: rumored / inferred architectures ---
// arch: "Dense" or "MoE"; totalB/activeB in billions
const MODEL_PRESETS = {
  "openai/gpt-5.5-pro":         { label: "OpenAI GPT-5.5 Pro",     totalB: 1800, activeB: 220, arch: "MoE",   notes: "Rumored 1.8T total / 220B active" },
  "openai/gpt-5.5":             { label: "OpenAI GPT-5.5",         totalB: 1800, activeB: 220, arch: "MoE" },
  "openai/gpt-5.4":             { label: "OpenAI GPT-5.4",         totalB: 1000, activeB: 150, arch: "MoE" },
  "openai/gpt-5.4-mini":        { label: "OpenAI GPT-5.4 Mini",    totalB: 200,  activeB: 60,  arch: "MoE" },
  "openai/gpt-5.4-nano":        { label: "OpenAI GPT-5.4 Nano",    totalB: 30,   activeB: 8,   arch: "MoE" },
  "openai/gpt-4.1":             { label: "OpenAI GPT-4.1",         totalB: 500,  activeB: 90,  arch: "MoE" },
  "openai/o3-pro":              { label: "OpenAI o3 Pro",          totalB: 1000, activeB: 200, arch: "MoE",   notes: "Reasoning model — output ~3-10× longer" },
  "anthropic/claude-opus-4.8":  { label: "Claude Opus 4.8",        totalB: 500,  activeB: 500, arch: "Dense", notes: "Anthropic believed to use dense models" },
  "anthropic/claude-opus-4.7":  { label: "Claude Opus 4.7",        totalB: 500,  activeB: 500, arch: "Dense" },
  "anthropic/claude-sonnet-4.6":{ label: "Claude Sonnet 4.6",      totalB: 70,   activeB: 70,  arch: "Dense" },
  "anthropic/claude-haiku-4.5": { label: "Claude Haiku 4.5",       totalB: 14,   activeB: 14,  arch: "Dense" },
  "google/gemini-3.1-pro-preview": { label: "Gemini 3.1 Pro",      totalB: 800,  activeB: 200, arch: "MoE",   notes: "Runs on TPU v5p in production" },
  "google/gemini-3.5-flash":    { label: "Gemini 3.5 Flash",       totalB: 250,  activeB: 70,  arch: "MoE" },
  "google/gemini-2.5-pro":      { label: "Gemini 2.5 Pro",         totalB: 700,  activeB: 180, arch: "MoE" },
  "google/gemini-2.5-flash":    { label: "Gemini 2.5 Flash",       totalB: 200,  activeB: 50,  arch: "MoE" },
  "deepseek/deepseek-v4-pro":   { label: "DeepSeek V4-Pro",        totalB: 700,  activeB: 40,  arch: "MoE",   notes: "Aggressive MoE — only 40B active" },
  "deepseek/deepseek-v4-flash": { label: "DeepSeek V4-Flash",      totalB: 200,  activeB: 15,  arch: "MoE" },
  "deepseek/deepseek-r1":       { label: "DeepSeek R1",            totalB: 671,  activeB: 37,  arch: "MoE" },
  "meta-llama/llama-4-maverick":{ label: "Llama 4 Maverick",       totalB: 400,  activeB: 17,  arch: "MoE" },
  "meta-llama/llama-4-scout":   { label: "Llama 4 Scout",          totalB: 109,  activeB: 17,  arch: "MoE" },
  "x-ai/grok-4.3":              { label: "xAI Grok 4.3",           totalB: 600,  activeB: 150, arch: "MoE" },
  "qwen/qwen3.7-max":           { label: "Qwen3.7 Max",            totalB: 400,  activeB: 80,  arch: "MoE" },
};

// --- Default DC assumptions (hyperscaler self-cost scenario) ---
const DC_DEFAULTS = {
  dcCapexPerGpu: 20000,   // shell + power + cooling, $/GPU
  electricityPerKWh: 0.06,
  pue: 1.25,
  usefulLifeYr: 5,
  wacc: 0.10,
  utilization: 0.55,      // realistic average for inference clusters
  opexPerGpuPerYr: 2000,  // staff, maintenance, networking
};

// --- Pre-defined scenarios for one-click loading ---
const TOKENOMICS_SCENARIOS = {
  "Hyperscaler self-cost":   { ...DC_DEFAULTS, dcCapexPerGpu: 18000, electricityPerKWh: 0.05, pue: 1.20, wacc: 0.08, utilization: 0.65 },
  "Frontier provider":       { ...DC_DEFAULTS, dcCapexPerGpu: 25000, electricityPerKWh: 0.07, pue: 1.30, wacc: 0.12, utilization: 0.50 },
  "Neocloud reseller":       { ...DC_DEFAULTS, dcCapexPerGpu: 30000, electricityPerKWh: 0.08, pue: 1.35, wacc: 0.14, utilization: 0.55 },
  "Open-source self-host":   { ...DC_DEFAULTS, dcCapexPerGpu: 5000,  electricityPerKWh: 0.12, pue: 1.50, wacc: 0.15, utilization: 0.35 },
};

// --- Math helpers ---
const gpuAnnualCost = (gpu, dc) => {
  const annualization = dc.wacc + 1 / dc.usefulLifeYr;
  const capexAnnual = (gpu.capex + dc.dcCapexPerGpu) * annualization;
  const elecAnnual = (gpu.watts / 1000) * dc.pue * 8760 * dc.electricityPerKWh;
  return { capexAnnual, elecAnnual, opexAnnual: dc.opexPerGpuPerYr, total: capexAnnual + elecAnnual + dc.opexPerGpuPerYr };
};
const gpuHourlyAllInCost = (gpu, dc) => {
  const { total } = gpuAnnualCost(gpu, dc);
  return total / (8760 * dc.utilization);
};

const decodeMath = (model, gpu, batch, precision) => {
  const bytesPerParam = precision === "FP8" ? 1 : 2;
  const activeParams = model.activeB * 1e9;
  const peakTFLOPS = precision === "FP8" ? gpu.fp8TFLOPS : gpu.bf16TFLOPS;
  // memBW in TB/s = 1e12 bytes/sec
  const memBoundSec = (activeParams * bytesPerParam) / (gpu.memBW * 1e12);
  const computeBoundSec = peakTFLOPS > 0 ? (2 * activeParams * batch) / (peakTFLOPS * 1e12) : Infinity;
  const timePerForwardSec = Math.max(memBoundSec, computeBoundSec);
  const throughputTps = batch / timePerForwardSec; // tokens/sec/GPU across the batch
  return {
    memBoundMs: memBoundSec * 1000,
    computeBoundMs: computeBoundSec * 1000,
    timePerForwardMs: timePerForwardSec * 1000,
    timePerTokenMs: (timePerForwardSec * 1000) / batch,
    throughputTps,
    bottleneck: memBoundSec > computeBoundSec ? "memory" : "compute",
  };
};

const costPerMOutput = (gpuHourly, throughputTps) => (gpuHourly / 3600) * 1e6 / throughputTps;

// Memory feasibility check: model + KV cache must fit in GPU memory pool
const memCheck = (model, gpu, batch, ctxLen, precision) => {
  const bytesPerParam = precision === "FP8" ? 1 : 2;
  // Total weights (full MoE weights resident; active for compute only)
  const modelGB = (model.totalB * 1e9 * bytesPerParam) / 1e9;
  // KV cache: rough estimate = 2 (K,V) × layers × hidden × ctx × batch × bytes_per_param
  // Use a simplifying approximation: KV ≈ 0.5 × active_params × ctx × batch / 1e6 (GB)
  // For a 70B model at 8K ctx batch 64, this gives ~18 GB — in the right ballpark.
  const kvGB = (model.activeB * 0.5 * ctxLen * batch) / 1e6;
  return { modelGB, kvGB, totalGB: modelGB + kvGB, gpuPoolGB: gpu.memGB * 8 /* assume 8-GPU node */, fits: modelGB + kvGB < gpu.memGB * 8 };
};

// --- Reusable form helpers ---
function NumInput({ label, value, onChange, step = 1, min = 0, max, unit, help }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {label}{unit && <span style={{ color: "#475569" }}> ({unit})</span>}
      </label>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f1f5f9", fontSize: 12, fontFamily: fonts.mono, padding: "6px 10px", outline: "none" }}
      />
      {help && <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>{help}</span>}
    </div>
  );
}
function SelectInput({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f1f5f9", fontSize: 12, fontFamily: fonts.mono, padding: "6px 10px", outline: "none", cursor: "pointer" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
function ResultRow({ label, value, color = "#f1f5f9", strong, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        <span style={{ fontSize: strong ? 16 : 12, fontWeight: strong ? 700 : 600, color, fontFamily: fonts.mono }}>{value}</span>
        {sub && <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{sub}</div>}
      </span>
    </div>
  );
}

// ─── Panel 1: Model Unit Economics ──────────────────────────────────────────
function ModelEconPanel({ dcAssumptions, gpuKey, setGpuKey, modelKey, setModelKey, batch, setBatch, ctxLen, setCtxLen, precision, setPrecision }) {
  const gpu = GPU_SPECS[gpuKey];
  const model = MODEL_PRESETS[modelKey];

  // Allow user to override active/total params
  const [overrideParams, setOverrideParams] = useState(false);
  const [customActive, setCustomActive] = useState(model.activeB);
  const [customTotal, setCustomTotal] = useState(model.totalB);
  useEffect(() => { setCustomActive(model.activeB); setCustomTotal(model.totalB); }, [modelKey]);

  const effModel = overrideParams ? { ...model, activeB: customActive, totalB: customTotal } : model;
  const dm = decodeMath(effModel, gpu, batch, precision);
  const gpuHourly = gpuHourlyAllInCost(gpu, dcAssumptions);
  const costPerM = costPerMOutput(gpuHourly, dm.throughputTps);
  const mem = memCheck(effModel, gpu, batch, ctxLen, precision);

  // Match live price from OpenRouter (if available)
  const marketInput = MODEL_PRESETS[modelKey]?.inputPrice;
  const marketOutput = MODEL_PRESETS[modelKey]?.outputPrice;

  // Waterfall data: stacked cost breakdown per M tokens
  const ann = gpuAnnualCost(gpu, dcAssumptions);
  const totalAnn = ann.total;
  const tokensPerHour = dm.throughputTps * 3600;
  const tokensPerYear = tokensPerHour * 8760 * dcAssumptions.utilization;
  const costBreakdown = [
    { name: "Compute amort.", value: (ann.capexAnnual * (gpu.capex / (gpu.capex + dcAssumptions.dcCapexPerGpu))) / tokensPerYear * 1e6, color: "#6366F1" },
    { name: "DC capex amort.", value: (ann.capexAnnual * (dcAssumptions.dcCapexPerGpu / (gpu.capex + dcAssumptions.dcCapexPerGpu))) / tokensPerYear * 1e6, color: "#8B5CF6" },
    { name: "Electricity", value: ann.elecAnnual / tokensPerYear * 1e6, color: "#F59E0B" },
    { name: "Opex (staff/maint.)", value: ann.opexAnnual / tokensPerYear * 1e6, color: "#EC4899" },
  ];

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 4 }}>Panel 1 · Model Unit Economics</div>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 14 }}>Decode-dominant inference cost per million output tokens, bottom-up from memory bandwidth and compute physics.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 18 }}>
        <SelectInput label="Model preset" value={modelKey} onChange={setModelKey} options={Object.entries(MODEL_PRESETS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <SelectInput label="GPU" value={gpuKey} onChange={setGpuKey} options={Object.entries(GPU_SPECS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <SelectInput label="Precision" value={precision} onChange={setPrecision} options={[{ value: "FP8", label: "FP8" }, { value: "BF16", label: "BF16" }]} />
        <NumInput label="Batch size" value={batch} onChange={setBatch} step={8} min={1} max={1024} help="Tokens decoded per forward pass" />
        <NumInput label="Context length" value={ctxLen} onChange={setCtxLen} step={1000} min={1000} max={2000000} unit="tokens" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono }}>
        <input type="checkbox" checked={overrideParams} onChange={e => setOverrideParams(e.target.checked)} id="override-params" />
        <label htmlFor="override-params" style={{ cursor: "pointer" }}>Override architecture (active / total params in B)</label>
      </div>
      {overrideParams && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <NumInput label="Active params" value={customActive} onChange={setCustomActive} step={1} unit="B" />
          <NumInput label="Total params" value={customTotal} onChange={setCustomTotal} step={10} unit="B" />
        </div>
      )}

      {effModel.notes && (
        <div style={{ fontSize: 10, color: "#a5b4fc", fontFamily: fonts.mono, marginBottom: 14, padding: "6px 10px", background: "rgba(99,102,241,0.07)", borderRadius: 6, borderLeft: "2px solid #6366F1" }}>
          ℹ {effModel.notes}
        </div>
      )}

      {!mem.fits && (
        <div style={{ fontSize: 10, color: "#f87171", fontFamily: fonts.mono, marginBottom: 14, padding: "6px 10px", background: "rgba(248,113,113,0.08)", borderRadius: 6, borderLeft: "2px solid #ef4444" }}>
          ⚠ Memory infeasible: model weights ({mem.modelGB.toFixed(0)} GB) + KV cache ({mem.kvGB.toFixed(0)} GB) = {mem.totalGB.toFixed(0)} GB exceeds 8-GPU node pool ({mem.gpuPoolGB.toFixed(0)} GB). Need larger cluster or smaller batch / context.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Left: physics + cost */}
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Decode physics</div>
          <ResultRow label="Memory-bound time" value={`${dm.memBoundMs.toFixed(2)} ms / forward`} color={dm.bottleneck === "memory" ? "#f59e0b" : "#94a3b8"} />
          <ResultRow label="Compute-bound time" value={`${dm.computeBoundMs.toFixed(2)} ms / forward`} color={dm.bottleneck === "compute" ? "#f59e0b" : "#94a3b8"} />
          <ResultRow label="Bottleneck" value={dm.bottleneck.toUpperCase()} color={dm.bottleneck === "memory" ? "#f59e0b" : "#ec4899"} />
          <ResultRow label="Time / token" value={`${dm.timePerTokenMs.toFixed(3)} ms`} />
          <ResultRow label="Throughput" value={`${dm.throughputTps.toFixed(0)} tok/sec/GPU`} />

          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 18, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>$/GPU-hour all-in</div>
          <ResultRow label="Hourly cost" value={`$${gpuHourly.toFixed(2)} /hr`} color="#a5b4fc" strong />

          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 18, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Output token economics</div>
          <ResultRow label="Self-cost / 1M output" value={`$${costPerM.toFixed(2)}`} color="#10B981" strong />
          {marketOutput && <>
            <ResultRow label="Market price / 1M output" value={`$${marketOutput.toFixed(2)}`} color="#f1f5f9" />
            <ResultRow label="Implied gross margin" value={`${(((marketOutput - costPerM) / marketOutput) * 100).toFixed(1)}%`} color={marketOutput > costPerM ? "#10B981" : "#f87171"} strong sub={marketOutput > costPerM ? `$${(marketOutput - costPerM).toFixed(2)} / 1M` : `Loss of $${(costPerM - marketOutput).toFixed(2)} / 1M`} />
          </>}
        </div>

        {/* Right: cost breakdown bar */}
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>Self-cost waterfall (per 1M output tokens)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={costBreakdown} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`$${v.toFixed(3)}`, "Cost / 1M tokens"]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {costBreakdown.map((c, i) => <Cell key={i} fill={c.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 18, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Memory feasibility</div>
          <ResultRow label="Model weights" value={`${mem.modelGB.toFixed(0)} GB`} />
          <ResultRow label="KV cache (est)" value={`${mem.kvGB.toFixed(0)} GB`} />
          <ResultRow label="8-GPU node pool" value={`${mem.gpuPoolGB.toFixed(0)} GB`} />
          <ResultRow label="Status" value={mem.fits ? "✓ Fits" : "⚠ Overflow"} color={mem.fits ? "#10B981" : "#f87171"} />
        </div>
      </div>
    </div>
  );
}

// ─── Panel 2: Data Center IRR ───────────────────────────────────────────────
function DataCenterPanel({ dcAssumptions, setDcAssumptions, gpuKey, setGpuKey, billRate, setBillRate }) {
  const gpu = GPU_SPECS[gpuKey];
  const ann = gpuAnnualCost(gpu, dcAssumptions);
  const annualRevenue = dcAssumptions.utilization * billRate * 8760;
  const annualProfit = annualRevenue - ann.total;
  const paybackYears = ann.total > 0 ? gpu.capex / Math.max(1, annualProfit) : null;
  const steadyYield = annualProfit / (gpu.capex + dcAssumptions.dcCapexPerGpu);

  // Tornado sensitivity: ±25% on each major lever
  const sensitivities = ["utilization", "electricityPerKWh", "wacc", "usefulLifeYr", "dcCapexPerGpu"];
  const labelMap = { utilization: "Utilization", electricityPerKWh: "Electricity $/kWh", wacc: "WACC", usefulLifeYr: "Useful life (yrs)", dcCapexPerGpu: "DC capex/GPU" };
  const tornadoData = sensitivities.map(key => {
    const base = dcAssumptions[key];
    const lowDc = { ...dcAssumptions, [key]: base * 0.75 };
    const highDc = { ...dcAssumptions, [key]: base * 1.25 };
    const lowAnn = gpuAnnualCost(gpu, lowDc);
    const highAnn = gpuAnnualCost(gpu, highDc);
    const lowProfit = (lowDc.utilization * billRate * 8760) - lowAnn.total;
    const highProfit = (highDc.utilization * billRate * 8760) - highAnn.total;
    const lowYield = lowProfit / (gpu.capex + lowDc.dcCapexPerGpu);
    const highYield = highProfit / (gpu.capex + highDc.dcCapexPerGpu);
    return {
      name: labelMap[key],
      low: (lowYield - steadyYield) * 100,
      high: (highYield - steadyYield) * 100,
    };
  }).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 4 }}>Panel 2 · Data Center IRR</div>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 14 }}>Payback period + steady-state unlevered yield for a GPU cluster operator. Yield approximates IRR over the useful life.</div>

      {/* Scenario presets */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, alignSelf: "center", marginRight: 4 }}>Load preset:</span>
        {Object.entries(TOKENOMICS_SCENARIOS).map(([name, params]) => (
          <button key={name} onClick={() => setDcAssumptions(params)} style={{ background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 6, color: "#a5b4fc", fontSize: 10, fontFamily: fonts.mono, padding: "4px 10px", cursor: "pointer" }}>
            {name}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
        <SelectInput label="GPU" value={gpuKey} onChange={setGpuKey} options={Object.entries(GPU_SPECS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <NumInput label="DC capex / GPU" value={dcAssumptions.dcCapexPerGpu} onChange={v => setDcAssumptions({ ...dcAssumptions, dcCapexPerGpu: v })} step={1000} unit="$" />
        <NumInput label="Electricity" value={dcAssumptions.electricityPerKWh} onChange={v => setDcAssumptions({ ...dcAssumptions, electricityPerKWh: v })} step={0.01} unit="$/kWh" />
        <NumInput label="PUE" value={dcAssumptions.pue} onChange={v => setDcAssumptions({ ...dcAssumptions, pue: v })} step={0.05} min={1} />
        <NumInput label="Useful life" value={dcAssumptions.usefulLifeYr} onChange={v => setDcAssumptions({ ...dcAssumptions, usefulLifeYr: v })} step={0.5} unit="yrs" />
        <NumInput label="WACC" value={dcAssumptions.wacc} onChange={v => setDcAssumptions({ ...dcAssumptions, wacc: v })} step={0.01} unit="frac" help="0.10 = 10%" />
        <NumInput label="Utilization" value={dcAssumptions.utilization} onChange={v => setDcAssumptions({ ...dcAssumptions, utilization: v })} step={0.05} min={0} max={1} unit="frac" help="0.55 = 55%" />
        <NumInput label="Opex / GPU / yr" value={dcAssumptions.opexPerGpuPerYr} onChange={v => setDcAssumptions({ ...dcAssumptions, opexPerGpuPerYr: v })} step={100} unit="$" />
        <NumInput label="Billing rate" value={billRate} onChange={setBillRate} step={0.10} unit="$/GPU-hr" help="What you charge customers" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Annual cost stack</div>
          <ResultRow label="Capex amortization" value={`$${ann.capexAnnual.toFixed(0)}`} />
          <ResultRow label="Electricity" value={`$${ann.elecAnnual.toFixed(0)}`} />
          <ResultRow label="Opex" value={`$${ann.opexAnnual.toFixed(0)}`} />
          <ResultRow label="Total annual cost" value={`$${ann.total.toFixed(0)}`} color="#f59e0b" strong />

          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 14, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Revenue & profit</div>
          <ResultRow label="Annual revenue" value={`$${annualRevenue.toFixed(0)}`} color="#a5b4fc" />
          <ResultRow label="Annual profit" value={`$${annualProfit.toFixed(0)}`} color={annualProfit >= 0 ? "#10B981" : "#f87171"} strong />

          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 14, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Returns</div>
          <ResultRow label="Payback period" value={paybackYears > 0 && paybackYears < 50 ? `${(paybackYears * 12).toFixed(1)} months` : "—"} color={paybackYears > 0 && paybackYears < 2 ? "#10B981" : paybackYears > 0 && paybackYears < 4 ? "#f59e0b" : "#f87171"} strong />
          <ResultRow label="Steady-state yield" value={`${(steadyYield * 100).toFixed(1)}%`} color={steadyYield > 0.15 ? "#10B981" : steadyYield > 0 ? "#f59e0b" : "#f87171"} strong sub="annual FCF / total capex" />
          <ResultRow label="Breakeven $/GPU-hr" value={`$${(ann.total / (dcAssumptions.utilization * 8760)).toFixed(2)}`} />
        </div>

        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>Tornado · sensitivity to ±25% input shifts</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={tornadoData} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v >= 0 ? "+" : ""}${v.toFixed(0)}pp`} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`${v >= 0 ? "+" : ""}${v.toFixed(1)} pp yield`, n === "low" ? "-25%" : "+25%"]} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
              <Bar dataKey="low" fill="#f87171" stackId="t" />
              <Bar dataKey="high" fill="#4ade80" stackId="t" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 6 }}>
            Red bar = yield impact of -25% input shift; green = +25%. Sorted by total swing.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel 3: Live Margin Estimator ─────────────────────────────────────────
function LiveMarginPanel({ dcAssumptions, gpuKey, batch, precision }) {
  const [livePrices, setLivePrices] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/ai-prices")
      .then(r => r.json())
      .then(d => setLivePrices((d.live?.tokens?.models) || []))
      .catch(() => setLivePrices([]))
      .finally(() => setLoading(false));
  }, []);

  const gpu = GPU_SPECS[gpuKey];
  const gpuHourly = gpuHourlyAllInCost(gpu, dcAssumptions);

  // For each live-priced model that has a preset, compute self-cost and margin
  const rows = useMemo(() => {
    if (!livePrices) return [];
    return livePrices.map(m => {
      const preset = MODEL_PRESETS[m.id];
      if (!preset) return null;
      const dm = decodeMath(preset, gpu, batch, precision);
      const costPerM = costPerMOutput(gpuHourly, dm.throughputTps);
      const margin = m.output > 0 ? (m.output - costPerM) / m.output : 0;
      return {
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0],
        marketIn: m.input,
        marketOut: m.output,
        selfCost: costPerM,
        margin,
        bottleneck: dm.bottleneck,
        arch: preset.arch,
        activeB: preset.activeB,
      };
    }).filter(Boolean).sort((a, b) => b.margin - a.margin);
  }, [livePrices, gpu, gpuHourly, batch, precision]);

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 4 }}>Panel 3 · Live Margin Estimator</div>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 14 }}>
        Implied gross margin per provider/model using current OpenRouter pricing and the assumptions from Panels 1 & 2.
        Shown $/GPU-hr: <span style={{ color: "#a5b4fc" }}>${gpuHourly.toFixed(2)}</span> on {gpu.label} @ batch {batch} {precision}.
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 11, fontFamily: fonts.mono }}>Loading live pricing...</div>
      ) : rows.length === 0 ? (
        <InfoBox color="#F97316">No tracked models matched live OpenRouter prices. Update <code>MODEL_PRESETS</code> in <code>AIEconomyTab.jsx</code> with architecture assumptions for newly-released models.</InfoBox>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(280, rows.length * 24)}>
            <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} domain={[-0.5, 1]} />
              <YAxis type="category" dataKey="name" width={200} tick={{ fill: "#cbd5e1", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${(v * 100).toFixed(1)}%`, "Implied margin"]} labelFormatter={(label, payload) => { const r = payload?.[0]?.payload; return r ? `${label} · cost $${r.selfCost.toFixed(2)} / market $${r.marketOut.toFixed(2)}` : label; }} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
              <Bar dataKey="margin" radius={[0, 4, 4, 0]}>
                {rows.map((r, i) => <Cell key={i} fill={r.margin > 0.5 ? "#10B981" : r.margin > 0 ? "#f59e0b" : "#f87171"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div style={{ overflow: "auto", marginTop: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  {["Model", "Active B", "Arch", "Self-cost $/M", "Market $/M", "Margin", "Bottleneck"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", fontSize: 9, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: h === "Model" || h === "Arch" || h === "Bottleneck" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{r.activeB}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.mono, color: r.arch === "MoE" ? "#a5b4fc" : "#f59e0b" }}>{r.arch}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>${r.selfCost.toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 600 }}>${r.marketOut.toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, textAlign: "right", color: r.margin > 0.5 ? "#4ade80" : r.margin > 0 ? "#fbbf24" : "#f87171" }}>{(r.margin * 100).toFixed(1)}%</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: fonts.mono, color: r.bottleneck === "memory" ? "#f59e0b" : "#ec4899" }}>{r.bottleneck}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Top-level Tokenomics tab ───────────────────────────────────────────────
function TokenomicsTab() {
  // Shared assumptions persisted to localStorage
  const loadState = (key, fallback) => {
    try { const v = localStorage.getItem(`tokenomics.${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  const saveState = (key, v) => { try { localStorage.setItem(`tokenomics.${key}`, JSON.stringify(v)); } catch {} };

  const [dcAssumptions, _setDcAssumptions] = useState(() => loadState("dc", DC_DEFAULTS));
  const [gpuKey, _setGpuKey]   = useState(() => loadState("gpu", "H200-SXM"));
  const [modelKey, _setModelKey] = useState(() => loadState("model", "openai/gpt-5.5"));
  const [batch, _setBatch]       = useState(() => loadState("batch", 64));
  const [ctxLen, _setCtxLen]     = useState(() => loadState("ctx", 8000));
  const [precision, _setPrecision] = useState(() => loadState("prec", "FP8"));
  const [billRate, _setBillRate] = useState(() => loadState("bill", 2.50));

  const setDcAssumptions = v => { _setDcAssumptions(v); saveState("dc", v); };
  const setGpuKey   = v => { _setGpuKey(v);   saveState("gpu", v); };
  const setModelKey = v => { _setModelKey(v); saveState("model", v); };
  const setBatch    = v => { _setBatch(v);    saveState("batch", v); };
  const setCtxLen   = v => { _setCtxLen(v);   saveState("ctx", v); };
  const setPrecision = v => { _setPrecision(v); saveState("prec", v); };
  const setBillRate = v => { _setBillRate(v); saveState("bill", v); };

  return (<>
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>Tokenomics Model</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, maxWidth: 820, lineHeight: 1.5 }}>
        SemiAnalysis-style bottom-up cost and margin model. Computes inference cost from memory bandwidth + compute physics, derives all-in $/GPU-hr from DC capex + power + WACC, and estimates implied provider margins against live OpenRouter pricing. <strong style={{ color: "#a5b4fc" }}>All assumptions persist to localStorage</strong> — tweak once, your scenario survives a refresh.
      </div>
    </div>

    <ModelEconPanel
      dcAssumptions={dcAssumptions}
      gpuKey={gpuKey} setGpuKey={setGpuKey}
      modelKey={modelKey} setModelKey={setModelKey}
      batch={batch} setBatch={setBatch}
      ctxLen={ctxLen} setCtxLen={setCtxLen}
      precision={precision} setPrecision={setPrecision}
    />

    <DataCenterPanel
      dcAssumptions={dcAssumptions} setDcAssumptions={setDcAssumptions}
      gpuKey={gpuKey} setGpuKey={setGpuKey}
      billRate={billRate} setBillRate={setBillRate}
    />

    <LiveMarginPanel
      dcAssumptions={dcAssumptions}
      gpuKey={gpuKey}
      batch={batch}
      precision={precision}
    />

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>What this model captures — and what it doesn't.</strong> The math here is honest about <em>marginal</em> serving cost: GPU amortization, power, DC capex, opex. It does <em>not</em> include training amortization (~$0.50–3 per 1M tokens for frontier models), R&amp;D / safety teams, free-tier subsidization, or batch routing inefficiencies. A realistic frontier provider's <em>true</em> gross margin is typically 20–40 percentage points lower than what Panel 3 shows. Treat the implied margins as an <em>upper bound</em> on profitability — the gap between Panel 3 and reality is what funds OpenAI / Anthropic's R&amp;D burn.
    </InfoBox>

    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>Reading the bottleneck column in Panel 3.</strong> "Memory" means memory bandwidth is gating throughput — typical for decode on large dense models. "Compute" means FLOPS are saturated — typical for prefill or for small dense models with high batch sizes. MoE models (most modern frontier ones) almost always sit in the memory-bound regime because only active params load per token, which is why MoE economics are so much better than dense at the same total parameter count.
    </InfoBox>
  </>);
}

// ===========================================================
// SUB-TAB: AI DEMAND (PyPI + npm SDK installs over time)
// ===========================================================
// SDK install counts are the best public proxy for paid-API token volume —
// every commercial AI app installs an SDK before it generates a single token.
// PyPI exposes ~180 days of daily history out of the box; npm covers 365 days.
// Reported token-volume disclosures — the only public "level" anchors that exist.
// SEED VALUES — reported figures, verify against source and extend as new
// disclosures land. Single-provider platform totals (so total market ≥ the max).
const TOKEN_DISCLOSURES = [
  { date: "2024-04", provider: "Google",    tpm: 9.7e12,  source: "Google I/O 2024 (Pichai)" },
  { date: "2025-05", provider: "Google",    tpm: 480e12,  source: "Google I/O 2025" },
  { date: "2025-07", provider: "Google",    tpm: 980e12,  source: "Alphabet Q2-25 call" },
  { date: "2025-04", provider: "Microsoft", tpm: 33e12,   source: "MSFT FY25 Q3 (~100T/qtr)" },
  { date: "2025-05", provider: "Microsoft", tpm: 167e12,  source: "Build 2025 (~500T/qtr)" },
];
const DISC_COLOR = { Google: "#4285F4", Microsoft: "#00A4EF", OpenAI: "#10B981", Anthropic: "#E8553A" };

// ── AI KPI curated constants (verify & extend — same pattern as TOKEN_DISCLOSURES) ──
// Lab classification for market-structure KPIs (OpenRouter ys keys are lab slugs)
const OPEN_LABS = new Set(["deepseek", "qwen", "z-ai", "meta-llama", "mistralai", "moonshotai", "minimax", "tencent", "xiaomi", "nvidia", "microsoft", "nousresearch", "cognitivecomputations"]);
const CLOSED_LABS = new Set(["anthropic", "openai", "google", "x-ai", "amazon", "cohere", "perplexity", "inflection"]);

// Disclosed AI revenue run-rates ($B annualized) — reported figures from press
// releases / earnings; the DOLLAR check on the token-volume estimate.
const REVENUE_DISCLOSURES = [
  { d: "2023-12", co: "OpenAI",       arr: 1.6,  src: "reported ARR" },
  { d: "2024-06", co: "OpenAI",       arr: 3.4,  src: "reported ARR" },
  { d: "2025-06", co: "OpenAI",       arr: 10,   src: "reported ARR" },
  { d: "2025-12", co: "OpenAI",       arr: 20,   src: "reported ~$20B ARR" },
  { d: "2024-12", co: "Anthropic",    arr: 1.0,  src: "reported ARR" },
  { d: "2025-03", co: "Anthropic",    arr: 2.0,  src: "reported ARR" },
  { d: "2025-08", co: "Anthropic",    arr: 5.0,  src: "reported ARR" },
  { d: "2026-01", co: "Anthropic",    arr: 9.0,  src: "reported ~$9B ARR", approx: true },
  { d: "2025-01", co: "Microsoft AI", arr: 13,   src: "disclosed run-rate" },
];
const REV_CO_COLOR = { OpenAI: "#10B981", Anthropic: "#E8553A", "Microsoft AI": "#00A4EF" };

// PJM capacity auction clearing prices ($/MW-day, RTO) — the market's price on
// grid scarcity. Public auction results; add each Base Residual Auction.
const PJM_CAPACITY = [
  { auction: "2023/24", price: 34.13 },
  { auction: "2024/25", price: 28.92 },
  { auction: "2025/26", price: 269.92 },
  { auction: "2026/27", price: 329.17 },
];

// Census BTOS: % of US firms using AI to produce goods/services. Biweekly
// survey of ~1.2M businesses; points below from Census releases (≈ = read
// from press coverage between official releases — verify on next release).
const BTOS_AI_ADOPTION = [
  { d: "2023-09", pct: 3.7 },
  { d: "2024-02", pct: 5.4 },
  { d: "2024-11", pct: 6.6 },
  { d: "2025-06", pct: 12.0, approx: true },
  { d: "2025-12", pct: 17.0 },
  { d: "2026-05", pct: 19.8 },
];
const BTOS_SPLITS = [
  { label: "Firms 250+ employees", pct: 37 },
  { label: "Firms 100–249", pct: 32 },
  { label: "Information sector", pct: 39.7 },
  { label: "Finance & Insurance", pct: 33.9 },
  { label: "Retail trade", pct: 14 },
];

// Supply ceiling: TSMC CoWoS advanced-packaging capacity (k wafers/month,
// TrendForce-reported estimates — approximate) + HBM sold-out statements.
const SUPPLY_CEILING = {
  cowos: [
    { d: "2023-12", kwpm: 14 },
    { d: "2024-12", kwpm: 35 },
    { d: "2025-12", kwpm: 70 },
    { d: "2026-12", kwpm: 105, est: true },
  ],
  hbm: [
    { d: "2024-05", note: "SK Hynix: 2025 HBM capacity essentially sold out" },
    { d: "2025-04", note: "SK Hynix: 2026 HBM capacity nearly fully booked" },
    { d: "2026-02", note: "Samsung/SKH: HBM4 allocations contested through 2027", approx: true },
  ],
};

// OpenRouter reports the CURRENT in-progress week, whose token total is only
// partly accumulated — it collapses to a fraction of trend and craters any
// level/growth read (the "cliff"). Return weekly totals with trailing partial
// weeks trimmed: drop the last week while it sits below 55% of the median of
// the prior four complete weeks (handles a stale scraper too, up to 2 weeks).
function orWeeklyTotals(or) {
  const ms = or?.marketShare || [];
  let weeks = ms.map(w => ({ d: w.x, v: Object.values(w.ys || {}).reduce((s, x) => s + x, 0) }));
  for (let guard = 0; guard < 2 && weeks.length >= 6; guard++) {
    const prior = weeks.slice(-5, -1).map(w => w.v).sort((a, b) => a - b);
    const med = prior[Math.floor(prior.length / 2)];
    if (med > 0 && weeks[weeks.length - 1].v < 0.55 * med) weeks = weeks.slice(0, -1);
    else break;
  }
  return weeks;
}

// OpenRouter has silently frozen before (path rotations serve a stale archive
// until someone notices). Detect it: how old is the newest data, and did the
// live fetch actually succeed this run (source "live+archive" vs "archive-only")?
function orFreshness(or) {
  if (!or) return null;
  const dates = [];
  const ms = or.marketShare || [];
  if (ms.length) dates.push(ms[ms.length - 1].x);
  const rows = or.rows || [];
  if (rows.length) dates.push(rows.reduce((mx, r) => (r.date > mx ? r.date : mx), rows[0].date));
  if (!dates.length) return null;
  const lastData = dates.sort()[dates.length - 1];
  const daysStale = Math.floor((Date.now() - Date.parse(lastData)) / 86400000);
  const liveFailed = typeof or.source === "string" && !or.source.includes("live");
  return { lastData, daysStale, stale: daysStale > 10, liveFailed, source: or.source };
}

// Renders nothing when the feed is fresh and live; otherwise an inline warning.
function StaleBanner({ or }) {
  const f = orFreshness(or);
  if (!f || (!f.stale && !f.liveFailed)) return null;
  const red = f.stale;
  const color = red ? "#ef4444" : "#fbbf24";
  const msg = f.liveFailed && f.stale
    ? `OpenRouter live fetch is failing and the data hasn't advanced in ${f.daysStale} days — the feed has likely broken again (last time: an API path rotation). Numbers below are a frozen archive.`
    : f.liveFailed
    ? `OpenRouter live fetch failed this run (serving cached archive, source "${f.source}"). Data may stop advancing — watch this banner.`
    : `OpenRouter data hasn't updated in ${f.daysStale} days (latest ${f.lastData}). The feed may have frozen; treat token figures below as stale.`;
  return (
    <div style={{ background: red ? "rgba(239,68,68,0.08)" : "rgba(251,191,36,0.08)", border: `1px solid ${color}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ color, fontSize: 14, lineHeight: 1.2 }}>⚠</span>
      <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, lineHeight: 1.5 }}>{msg}</span>
    </div>
  );
}

function DemandTab() {
  const [data, setData] = useState(null);
  const [or, setOr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ecosystem, setEcosystem] = useState("Both"); // "PyPI" | "npm" | "Both"
  const [smoothing, setSmoothing] = useState(7); // 1 | 7 | 30 day moving avg
  const [orShare, setOrShare] = useState(3); // assumed OpenRouter % of total routed API demand
  const [showDetail, setShowDetail] = useState(false); // package-level deep dive

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/sdk-downloads").then(r => r.json()).catch(() => null),
      fetch("/api/or-rankings-history").then(r => r.json()).catch(() => null),
    ]).then(([sdk, orr]) => { setData(sdk); setOr(orr); setError(!sdk); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Filter series by ecosystem — CORE providers only (agent stack shown separately)
  const filteredSeries = useMemo(() => {
    if (!data?.series) return [];
    return Object.values(data.series).filter(s => s.category !== "agent" && (ecosystem === "Both" || s.ecosystem === ecosystem));
  }, [data, ecosystem]);

  // Build a merged daily chart: { date, [key]: downloads, total: ... } with smoothing
  const chartData = useMemo(() => {
    if (!filteredSeries.length) return [];
    // Collect all unique dates
    const dateSet = new Set();
    filteredSeries.forEach(s => (s.data || []).forEach(p => dateSet.add(p.date)));
    const dates = Array.from(dateSet).sort();
    // Build per-day map
    const series = filteredSeries.map(s => {
      const byDate = new Map((s.data || []).map(p => [p.date, p.downloads]));
      // Smooth via simple moving average
      const out = dates.map(d => byDate.get(d) ?? null);
      if (smoothing > 1) {
        const win = smoothing;
        return out.map((v, i) => {
          if (v == null) return null;
          let sum = 0, cnt = 0;
          for (let j = Math.max(0, i - win + 1); j <= i; j++) {
            if (out[j] != null) { sum += out[j]; cnt++; }
          }
          return cnt ? sum / cnt : null;
        });
      }
      return out;
    });
    return dates.map((date, i) => {
      const row = { date };
      let total = 0;
      filteredSeries.forEach((s, si) => {
        const v = series[si][i];
        if (v != null) { row[s.key] = v; total += v; }
      });
      row.total = total;
      return row;
    });
  }, [filteredSeries, smoothing]);

  // Latest snapshot stats: today's downloads and 30-day-ago YoY-style growth
  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const last = chartData[chartData.length - 1];
    const last30 = chartData[chartData.length - 31];
    const last90 = chartData[chartData.length - 91];
    const totalToday = last?.total || 0;
    const total30ago = last30?.total || 0;
    const total90ago = last90?.total || 0;
    const growth30 = total30ago ? ((totalToday - total30ago) / total30ago) * 100 : null;
    const growth90 = total90ago ? ((totalToday - total90ago) / total90ago) * 100 : null;
    // Per-provider tally
    const byProv = {};
    filteredSeries.forEach(s => {
      const lastPt = (s.data || []).slice(-1)[0];
      if (lastPt) byProv[s.provider] = (byProv[s.provider] || 0) + lastPt.downloads;
    });
    return {
      latestDate: last?.date,
      totalToday,
      growth30,
      growth90,
      byProv: Object.entries(byProv).sort((a, b) => b[1] - a[1]),
    };
  }, [chartData, filteredSeries]);

  // Per-package table rows (latest day + 30-day delta)
  const packageRows = useMemo(() => {
    return filteredSeries.map(s => {
      const pts = s.data || [];
      const last = pts[pts.length - 1];
      const prior30 = pts[pts.length - 31];
      const change30 = (last && prior30 && prior30.downloads > 0)
        ? ((last.downloads - prior30.downloads) / prior30.downloads) * 100
        : null;
      return {
        key: s.key,
        ecosystem: s.ecosystem,
        id: s.id,
        label: s.label,
        provider: s.provider,
        color: s.color,
        downloads: last?.downloads || 0,
        change30,
      };
    }).sort((a, b) => b.downloads - a.downloads);
  }, [filteredSeries]);

  const fmtBigN = n => {
    if (n == null) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(Math.round(n));
  };
  const fmtPctSimple = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtTokM = t => t == null ? "—" : t >= 1e15 ? `${(t / 1e15).toFixed(1)}Q` : t >= 1e12 ? `${(t / 1e12).toFixed(0)}T` : `${(t / 1e9).toFixed(0)}B`;

  // ── Aggregate market estimate: OpenRouter monthly tokens ÷ assumed share ──
  const estimate = useMemo(() => {
    const weekTot = orWeeklyTotals(or); // trailing partial week trimmed
    if (weekTot.length < 2) return null;
    const WK_PER_MO = 365 / 7 / 12; // ≈4.33
    const orMonthlyNow = weekTot[weekTot.length - 1].v * WK_PER_MO;
    const orMonthlyYrAgo = weekTot.length > 52 ? weekTot[weekTot.length - 53].v * WK_PER_MO : (weekTot[0].v * WK_PER_MO);
    const growthYoY = orMonthlyYrAgo ? ((orMonthlyNow / orMonthlyYrAgo) - 1) * 100 : null;
    const mult = 100 / orShare;
    const estNow = orMonthlyNow * mult;
    // Estimate line + disclosure anchors, monthly, log-scale
    const line = weekTot.filter((_, i) => i % 2 === 0).map(w => ({ d: `${w.d.slice(0, 7)}-01`, est: +(w.v * WK_PER_MO * mult).toFixed(0) }));
    const byMonth = {};
    line.forEach(p => { byMonth[p.d] = { d: p.d, est: p.est }; });
    TOKEN_DISCLOSURES.forEach(a => { const k = `${a.date}-01`; byMonth[k] = { ...(byMonth[k] || { d: k }), [`disc_${a.provider}`]: a.tpm }; });
    const chart = Object.values(byMonth).sort((a, b) => a.d.localeCompare(b.d));
    return { orMonthlyNow, growthYoY, estNow, mult, chart, discProviders: [...new Set(TOKEN_DISCLOSURES.map(a => a.provider))] };
  }, [or, orShare]);

  // ── Agent stack: category==='agent' series ──
  const agent = useMemo(() => {
    if (!data?.series) return null;
    const rows = Object.values(data.series).filter(s => s.category === "agent")
      .map(s => {
        const pts = s.data || [];
        const last = pts[pts.length - 1];
        const p90 = pts[pts.length - 91];
        return { key: s.key, label: s.label, ecosystem: s.ecosystem, provider: s.provider, color: s.color,
          latest: last?.downloads || 0, g90: (last && p90 && p90.downloads > 0) ? ((last.downloads - p90.downloads) / p90.downloads) * 100 : null };
      }).sort((a, b) => b.latest - a.latest);
    const total = rows.reduce((s, r) => s + r.latest, 0);
    return { rows, total };
  }, [data]);

  // ── Docker inference-server pulls (self-hosted serving capacity) ──
  const docker = useMemo(() => {
    const dk = data?.docker;
    if (!dk?.history?.length) return null;
    const hist = dk.history;
    const last = hist[hist.length - 1];
    return (dk.images || []).map(im => {
      const cum = last.pulls?.[im.id] ?? null;
      let perDay = null;
      if (hist.length >= 2) {
        const prev = hist[hist.length - 2];
        const days = Math.max(1, (new Date(last.date) - new Date(prev.date)) / 86400000);
        const pc = prev.pulls?.[im.id];
        if (cum != null && pc != null) perDay = Math.round((cum - pc) / days);
      }
      return { ...im, cum, perDay };
    });
  }, [data]);

  // ── Indexed growth: the one chart that answers "is demand accelerating?" ──
  // Tokens vs installs are apples-to-oranges levels, so index each lens to 100
  // at the window start (~6 months) — only the slopes are comparable.
  const growth = useMemo(() => {
    if (!data?.series) return null;
    const sumByDate = (pred) => {
      const m = new Map();
      Object.values(data.series).filter(pred).forEach(s => (s.data || []).forEach(p => m.set(p.date, (m.get(p.date) || 0) + p.downloads)));
      return m;
    };
    const coreM = sumByDate(s => s.category !== "agent");
    const agentM = sumByDate(s => s.category === "agent");
    const dates = [...coreM.keys()].sort();
    if (dates.length < 60) return null;
    const ma7 = (m) => dates.map((d, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { const v = m.get(dates[j]); if (v != null) { s += v; c++; } }
      return c ? s / c : null;
    });
    const coreA = ma7(coreM), agentA = ma7(agentM);
    // weekly samples over the last ~26 weeks, aligned to the latest day's weekday
    const idxs = [];
    for (let i = dates.length - 1; i >= 0 && idxs.length < 27; i -= 7) idxs.unshift(i);
    const firstIdx = (arr) => { for (const i of idxs) if (arr[i] != null && arr[i] > 0) return i; return -1; };
    const cb = firstIdx(coreA), ab = firstIdx(agentA);
    const rows = idxs.map(i => ({
      d: dates[i],
      core: cb >= 0 && coreA[i] != null ? +((coreA[i] / coreA[cb]) * 100).toFixed(1) : null,
      agent: ab >= 0 && agentA[i] != null ? +((agentA[i] / agentA[ab]) * 100).toFixed(1) : null,
    }));
    // OpenRouter weekly tokens (partial trailing week trimmed), attached to the nearest weekly row (±4 days)
    const orWk = orWeeklyTotals(or);
    const orIn = orWk.filter(w => w.d >= dates[idxs[0]]);
    const oBase = orIn.length ? orIn[0].v : null;
    if (oBase) orIn.forEach(w => {
      let best = null, diff = Infinity;
      rows.forEach(r => { const dd = Math.abs(new Date(r.d) - new Date(w.d)); if (dd < diff) { diff = dd; best = r; } });
      if (best && diff <= 4 * 86400000) best.or = +((w.v / oBase) * 100).toFixed(1);
    });
    const lastOf = k => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] != null) return rows[i][k]; return null; };
    return { rows, months: Math.round((idxs.length - 1) * 7 / 30.4), last: { core: lastOf("core"), agent: lastOf("agent"), or: lastOf("or") } };
  }, [data, or]);

  // ── Page verdict from the three growth lenses ──
  const pulse = useMemo(() => {
    if (!growth) return null;
    const { core, agent: ag, or: orr } = growth.last;
    const sig = [core, ag, orr].filter(v => v != null);
    if (!sig.length) return null;
    const avg = sig.reduce((a, b) => a + b, 0) / sig.length;
    const v = avg >= 140 ? { label: "Strong Growth", color: "#4ade80" }
      : avg >= 110 ? { label: "Growing", color: "#22d3ee" }
      : avg >= 97 ? { label: "Flat", color: "#fbbf24" }
      : { label: "Cooling", color: "#f87171" };
    let blurb;
    if (avg >= 110) {
      blurb = "Independent lenses agree — demand is compounding, not plateauing.";
      if (ag != null && core != null && ag - core > 15) blurb = "Independent lenses agree demand is compounding — and the agent stack is outgrowing the core SDKs, so token-hungry agentic workloads are the accelerant.";
      else if (orr != null && core != null && orr - core > 25) blurb = "Actual token usage (OpenRouter) is outrunning build activity (SDK installs) — existing apps are consuming more per app, the deepest kind of demand growth.";
    } else if (avg >= 97) blurb = "Growth lenses have gone sideways — worth watching whether this is a pause or a peak.";
    else blurb = "Multiple lenses are shrinking together — the first genuinely bearish demand signal. Check which lens is dragging before concluding.";
    return { ...v, avg, core, agent: ag, or: orr, months: growth.months, blurb };
  }, [growth]);

  if (loading && !data) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading SDK download history from PyPI + npm...</div>;
  if (error || !data?.series) return <InfoBox color="#F97316">Unable to load SDK download data. PyPI or npm may be temporarily unavailable.</InfoBox>;

  const tickInt = Math.max(0, Math.floor(chartData.length / 12) - 1);
  const fmtDate2Local = d => {
    if (!d) return "";
    const p = d.split("-");
    const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1] - 1];
    return `${mn} ${p[2]}`;
  };
  const selectStyle = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#cbd5e1", fontSize: 11, fontFamily: fonts.mono, padding: "6px 10px", cursor: "pointer" };

  return (<>
    <StaleBanner or={or} />
    {/* ═══ PAGE VERDICT — is token demand growing? ═══ */}
    {pulse && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: pulse.color }} />
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>AI Token Demand</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: pulse.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{pulse.label}</span>
          <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>
            over ~{pulse.months} months:{pulse.or != null ? ` OpenRouter tokens ${fmtPctSimple(pulse.or - 100)}` : ""}{pulse.core != null ? ` · core SDK installs ${fmtPctSimple(pulse.core - 100)}` : ""}{pulse.agent != null ? ` · agent stack ${fmtPctSimple(pulse.agent - 100)}` : ""}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, maxWidth: 820, lineHeight: 1.5 }}>{pulse.blurb}</div>
      </div>
    )}

    {/* ═══ AGGREGATE MARKET ESTIMATE — the "level" question ═══ */}
    {estimate && (<>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: "#6366F1" }} />
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>Estimated Total Market — Tokens / Month</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 30, fontWeight: 700, color: "#a5b4fc", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{fmtTokM(estimate.estNow)}</span>
          {estimate.growthYoY != null && <span style={{ fontSize: 20, fontWeight: 700, color: estimate.growthYoY >= 0 ? "#4ade80" : "#f87171", fontFamily: fonts.heading }}>{fmtPctSimple(estimate.growthYoY)} YoY</span>}
          <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>
            OpenRouter routes {fmtTokM(estimate.orMonthlyNow)}/mo · assumed {orShare}% of market → ×{estimate.mult.toFixed(0)} · <span style={{ color: "#475569" }}>current partial week excluded</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>OpenRouter share of total routed demand:</span>
          <input type="range" min="1" max="10" step="0.5" value={orShare} onChange={e => setOrShare(parseFloat(e.target.value))} style={{ width: 180, accentColor: "#6366F1" }} />
          <span style={{ fontSize: 12, color: "#a5b4fc", fontFamily: fonts.mono, fontWeight: 700 }}>{orShare}%</span>
          <span style={{ fontSize: 9.5, color: "#475569", fontFamily: fonts.mono }}>slide until the estimate line sits just above the largest disclosed anchor</span>
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={estimate.chart} margin={{ top: 8, right: 12, left: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtTokM} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [fmtTokM(v) + "/mo", n.replace("disc_", "").replace("est", "Estimated total")]} labelFormatter={d => d.slice(0, 7)} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} formatter={n => n.replace("disc_", "disclosed: ").replace("est", "Estimated total (OpenRouter ÷ share)")} />
            <Line type="monotone" dataKey="est" stroke="#6366F1" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
            {estimate.discProviders.map(p => (
              <Line key={p} type="monotone" dataKey={`disc_${p}`} stroke={DISC_COLOR[p] || "#94a3b8"} strokeWidth={0} dot={{ r: 5, fill: DISC_COLOR[p] || "#94a3b8", stroke: "#0f172a", strokeWidth: 1 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          Log scale, tokens/month. Line = OpenRouter&apos;s routed volume grossed up by your share assumption. Dots = <em>reported</em> single-provider disclosures (Google, Microsoft) — total market sits above any one of them, so calibrate the slider so the line clears the tallest dot. Disclosures are seed values to verify against the source and extend.
        </div>
      </div>
    </>)}

    {/* ═══ THE DOLLAR CHECK — disclosed revenue run-rates ═══ */}
    {(() => {
      const cos = [...new Set(REVENUE_DISCLOSURES.map(r => r.co))];
      const byMonth = {};
      REVENUE_DISCLOSURES.forEach(r => { byMonth[r.d] = { ...(byMonth[r.d] || { d: r.d }), [r.co]: r.arr }; });
      const chart = Object.values(byMonth).sort((a, b) => a.d.localeCompare(b.d));
      const latestByCo = cos.map(co => {
        const pts = REVENUE_DISCLOSURES.filter(r => r.co === co).sort((a, b) => a.d.localeCompare(b.d));
        return { co, ...pts[pts.length - 1] };
      });
      return (<>
        <SH>The Dollar Check — Disclosed AI Revenue Run-Rates</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
          {latestByCo.map(r => (
            <StatCard key={r.co} label={r.co} val={`$${r.arr}B/yr`} sub={`${r.d} · ${r.src}${r.approx ? " (≈)" : ""}`} color={REV_CO_COLOR[r.co] || "#818cf8"} />
          ))}
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chart} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} minTickGap={40} />
              <YAxis scale="log" domain={[0.8, 40]} ticks={[1, 2, 5, 10, 20]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}B`} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${v}B/yr`, n]} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
              {cos.map(co => (
                <Line key={co} type="monotone" dataKey={co} stroke={REV_CO_COLOR[co] || "#818cf8"} strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
            Log scale, $B annualized. Revenue = tokens × price — the dollar leg of the triangle with the token estimate above and realized prices on Supply &amp; Demand. Curated from press/earnings disclosures (≈ = press-reported, verify); add each new disclosure to <code style={{ color: "#a5b4fc" }}>REVENUE_DISCLOSURES</code>. Doubling roughly yearly at multi-billion scale is the demand thesis in dollars.
          </div>
        </div>
      </>);
    })()}

    {/* ═══ GROWTH, COMPARED — the slope chart ═══ */}
    {growth && growth.rows.length > 3 && (<>
      <SH>Growth, Compared — Each Lens Indexed to 100, ~{growth.months} Months Ago</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={growth.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis scale="log" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={v => `${Math.round(v)}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={d => d.slice(0, 10)} formatter={(v, n) => [`${v} (${v >= 100 ? "+" : ""}${(v - 100).toFixed(0)}%)`, n]} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <ReferenceLine y={100} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="or" name="OpenRouter tokens (actual usage)" stroke="#6366F1" strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="core" name="Core SDK installs (build activity)" stroke="#10B981" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="agent" name="Agent-stack installs (agentic slice)" stroke="#22d3ee" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          Tokens and installs are apples-to-oranges levels, so each lens starts at 100 — <strong style={{ color: "#94a3b8" }}>only the slopes matter</strong>. Log scale: a straight line is steady compounding; steeper is faster. The gap between lines is the insight — usage (indigo) outrunning build activity (green) means existing apps consume more per app; the agent line (cyan) outrunning both means agentic workloads are the accelerant. Caveat: the agent lens starts from a small base, so its multiple overstates its absolute weight.
        </div>
      </div>
    </>)}

    {/* ═══ SDK INSTALL DEEP-DIVE (collapsed by default — levels are CI/CD noise) ═══ */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: showDetail ? 14 : 18 }}>
      <button onClick={() => setShowDetail(v => !v)} style={{ fontSize: 11, padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.35)", background: showDetail ? "rgba(99,102,241,0.18)" : "transparent", color: "#a5b4fc", cursor: "pointer", fontFamily: fonts.mono }}>
        {showDetail ? "▾ Hide" : "▸ Show"} package-level detail
      </button>
      <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>stacked installs by package, provider share, per-package table — useful for &ldquo;which ecosystem moved,&rdquo; not for the headline</span>
    </div>
    {showDetail && (<>
    {/* Header */}
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>API Demand — SDK Install Growth</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, maxWidth: 760, lineHeight: 1.5 }}>
        Daily install counts for the official AI SDKs. <strong style={{ color: "#a5b4fc" }}>Every commercial AI app pulls these packages before generating a single token</strong> — a leading indicator of paid-API token demand growth. Note: most installs are CI/CD builds, so read the <em>direction</em>, not the absolute count.
        {" "}Sources: <a href="https://pypistats.org" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>PyPI</a> + <a href="https://api.npmjs.org" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>npm</a>.
      </div>
    </div>

    {/* Hero growth stats */}
    {stats && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 18 }}>
        <StatCard label="Latest Daily Installs" val={fmtBigN(stats.totalToday)} sub={`As of ${stats.latestDate}`} color="#6366F1" />
        <StatCard label="30-Day Growth" val={fmtPctSimple(stats.growth30)} sub="vs 30 days ago" color={stats.growth30 >= 0 ? "#10B981" : "#F97316"} />
        <StatCard label="90-Day Growth" val={fmtPctSimple(stats.growth90)} sub="vs 90 days ago" color={stats.growth90 >= 0 ? "#10B981" : "#F97316"} />
        <StatCard label="Tracked Packages" val={filteredSeries.length} sub={`${ecosystem === "Both" ? "PyPI + npm" : ecosystem}`} color="#8B5CF6" />
      </div>
    )}

    {/* Controls */}
    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginRight: 4 }}>Ecosystem:</div>
      {["Both", "PyPI", "npm"].map(e => (
        <button key={e} onClick={() => setEcosystem(e)} style={{ ...selectStyle, background: ecosystem === e ? "rgba(99,102,241,0.18)" : "#0f172a", color: ecosystem === e ? "#a5b4fc" : "#94a3b8", borderColor: ecosystem === e ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)" }}>{e}</button>
      ))}
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginLeft: 18, marginRight: 4 }}>Smoothing:</div>
      {[{ v: 1, l: "Raw" }, { v: 7, l: "7-day MA" }, { v: 30, l: "30-day MA" }].map(opt => (
        <button key={opt.v} onClick={() => setSmoothing(opt.v)} style={{ ...selectStyle, background: smoothing === opt.v ? "rgba(99,102,241,0.18)" : "#0f172a", color: smoothing === opt.v ? "#a5b4fc" : "#94a3b8", borderColor: smoothing === opt.v ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)" }}>{opt.l}</button>
      ))}
    </div>

    {/* Stacked area chart of all packages */}
    <SH>Daily SDK Installs by Package ({smoothing}-day MA, stacked)</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} tickFormatter={fmtDate2Local} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => fmtBigN(v)} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
            labelFormatter={fmtDate2Local}
            formatter={(v, name) => [fmtBigN(v), name.split("::").slice(-1)[0]]}
          />
          {filteredSeries.map(s => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={`${s.label} (${s.ecosystem})`}
              stackId="1"
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.5}
              strokeWidth={0.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>

    {/* Per-provider summary */}
    {stats && stats.byProv.length > 0 && (
      <>
        <SH>Provider Share — Latest Day</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 18 }}>
          {stats.byProv.map(([prov, dl]) => {
            const pct = ((dl / stats.totalToday) * 100).toFixed(1);
            const provColor = (filteredSeries.find(s => s.provider === prov) || {}).color || "#64748b";
            return (
              <div key={prov} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: provColor, borderRadius: "14px 14px 0 0" }} />
                <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{prov}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{fmtBigN(dl)}</div>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 3 }}>{pct}% of installs</div>
              </div>
            );
          })}
        </div>
      </>
    )}

    {/* Per-package table */}
    <SH>Package Detail — Latest Daily Installs & 30-Day Growth</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
        <thead>
          <tr>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Package</th>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Provider</th>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Ecosystem</th>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Latest /day</th>
            <th style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>30-Day Δ</th>
          </tr>
        </thead>
        <tbody>
          {packageRows.map((r, i) => (
            <tr key={r.key} style={{ borderBottom: i < packageRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>
                <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: r.color, marginRight: 8, verticalAlign: "middle" }} />
                {r.label}
                <span style={{ marginLeft: 8, fontSize: 10, fontFamily: fonts.mono, color: "#475569" }}>{r.id}</span>
              </td>
              <td style={{ padding: "9px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{r.provider}</td>
              <td style={{ padding: "9px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b" }}>{r.ecosystem}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600 }}>{fmtBigN(r.downloads)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontFamily: fonts.mono, fontWeight: 600, color: r.change30 == null ? "#475569" : r.change30 >= 0 ? "#4ade80" : "#f87171" }}>{fmtPctSimple(r.change30)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Reading the detail:</strong> Install <em>levels</em> are mostly CI/CD plumbing — a company&apos;s build server can pull a package 500× a day. That&apos;s why this section is collapsed: use it to see <em>which</em> package or ecosystem moved when the headline chart changes slope, not to read absolute adoption.
    </InfoBox>

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>How the two proxies fit together:</strong> OpenRouter measures <em>usage</em> (real tokens, but only its slice of the market); SDK installs measure <em>build activity</em> (every integration, but polluted by CI/CD). Neither alone is the market — together, usage growth confirms build growth and vice versa. When they diverge, believe OpenRouter for direction and installs for breadth.
    </InfoBox>
    </>)}

    {/* ═══ AGENT STACK ═══ */}
    {agent && agent.rows.length > 0 && (<>
      <SH>Agent Stack — Installs of Agent-Specific Packages</SH>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 780 }}>
        These packages are only installed to build <em>agentic</em> systems — MCP (the agent-tool standard), orchestration frameworks, and coding agents. Their combined install rate is the cleanest public read on how fast agent workloads (which burn far more tokens per task than a single chat call) are being built.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <StatCard label="Agent Installs / Day" val={fmtBigN(agent.total)} sub={`${agent.rows.length} packages`} color="#22d3ee" />
        {agent.rows.slice(0, 3).map(r => (
          <StatCard key={r.key} label={`${r.label} (${r.ecosystem})`} val={fmtBigN(r.latest)} sub={r.g90 != null ? `${fmtPctSimple(r.g90)} /90d` : "installs/day"} color={r.color} />
        ))}
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
          <thead><tr>
            {["Package", "Ecosystem", "Installs/day", "90-day Growth"].map((h, i) => (
              <th key={h} style={{ padding: "9px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i >= 2 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {agent.rows.map((r, i) => (
              <tr key={r.key} style={{ borderBottom: i < agent.rows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 8, verticalAlign: "middle" }} />{r.label}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{r.ecosystem}</td>
                <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 600 }}>{fmtBigN(r.latest)}</td>
                <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: 600, color: r.g90 == null ? "#475569" : r.g90 >= 0 ? "#4ade80" : "#f87171" }}>{r.g90 != null ? fmtPctSimple(r.g90) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>)}

    {/* ═══ SELF-HOSTED SERVING CAPACITY (Docker) ═══ */}
    {docker && docker.length > 0 && (<>
      <SH>Self-Hosted Serving Capacity — Inference-Server Pulls</SH>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 780 }}>
        Docker pulls of vLLM and Ollama. Nobody pulls these images except to <em>serve tokens</em> — so this is the closest public proxy for self-hosted inference capacity being stood up (the demand that never touches a paid API).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
        {docker.map(im => (
          <div key={im.id} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: im.color }} />
            <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{im.label} · Docker</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading, marginTop: 3 }}>{fmtBigN(im.cum)}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 2 }}>{im.perDay != null ? `+${fmtBigN(im.perDay)}/day` : "cumulative · rate builds over days"}</div>
          </div>
        ))}
      </div>
    </>)}

    <InfoBox color="#22d3ee">
      <strong style={{ color: "#cbd5e1" }}>How to grasp total demand.</strong> No one outside the labs knows the absolute level, so this page answers two questions separately. <strong>The level</strong>: the estimate banner anchors OpenRouter&apos;s routed volume to disclosed provider milestones. <strong>The direction</strong>: the indexed chart compares three independent growth lenses — actual usage, build activity, and the agentic slice — and the verdict at the top distills them. <strong>Docker pulls</strong> add the piece none of those see: self-hosted serving that never touches a paid API. Each is a different lens on the same elephant.
    </InfoBox>

    {/* Three more public-data lenses on aggregate demand */}
    <UsageSignalsPanel />
  </>);
}

// ─── External usage signals panel: SO / GitHub / Cloudflare Radar ──────────
const PROV_COLOR = {
  OpenAI:      "#10B981",
  Anthropic:   "#E8553A",
  Google:      "#3B82F6",
  HuggingFace: "#F59E0B",
  Framework:   "#6366F1",
  Inference:   "#8B5CF6",
  Other:       "#94a3b8",
};

function MiniSpark({ values, color = "#818cf8", h = 30 }) {
  const v = (values || []).filter(x => x != null && isFinite(x));
  if (v.length < 3) return null;
  const min = Math.min(...v), max = Math.max(...v), range = (max - min) || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// One "corroborating signal" verdict card: read + key stat + spark, detail on expand
function SignalCard({ tone, name, verdict, stat, statSub, spark, sparkColor }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", borderLeft: `3px solid ${tone}`, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 }}>{name}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: tone, fontFamily: fonts.heading, lineHeight: 1.25, marginBottom: 6 }}>{verdict}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{stat}</span>
        {statSub && <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono }}>{statSub}</span>}
      </div>
      {spark && <div style={{ marginTop: 8 }}><MiniSpark values={spark} color={sparkColor || tone} /></div>}
    </div>
  );
}

function UsageSignalsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    fetch("/api/usage-signals")
      .then(r => r.json())
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Aggregate SO monthly history across all tags = total AI question volume per month
  const soAggregate = useMemo(() => {
    if (!data?.stackOverflowMonthly) return { months: [], peak: 0, latest: 0, yoy: null, fromPeak: null };
    const mh = data.stackOverflowMonthly;
    const totals = {};
    Object.values(mh).forEach(points => {
      points.forEach(p => { totals[p.month] = (totals[p.month] || 0) + (p.count || 0); });
    });
    const months = Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
    if (!months.length) return { months: [], peak: 0, latest: 0, yoy: null, fromPeak: null };
    const peak = Math.max(...months.map(m => m.total));
    const latest = months[months.length - 1].total;
    const yoy = months.length > 12
      ? ((latest - months[months.length - 13].total) / Math.max(1, months[months.length - 13].total)) * 100
      : null;
    const fromPeak = peak ? ((latest - peak) / peak) * 100 : null;
    return { months, peak, latest, yoy, fromPeak };
  }, [data]);

  // Provider-share-over-time: each month, sum questions per provider category
  const providerShareSeries = useMemo(() => {
    if (!data?.stackOverflowMonthly) return { rows: [], providers: [] };
    const mh = data.stackOverflowMonthly;
    const provByTag = Object.fromEntries((data.stackOverflow || []).map(t => [t.tag, t.provider]));
    const monthsMap = {};
    Object.entries(mh).forEach(([tag, points]) => {
      const prov = provByTag[tag] || "Other";
      points.forEach(p => {
        if (!monthsMap[p.month]) monthsMap[p.month] = {};
        monthsMap[p.month][prov] = (monthsMap[p.month][prov] || 0) + (p.count || 0);
      });
    });
    const providers = [...new Set(Object.values(provByTag))];
    const rows = Object.entries(monthsMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, byProv]) => {
        const row = { month };
        providers.forEach(p => { row[p] = byProv[p] || 0; });
        return row;
      });
    return { rows, providers };
  }, [data]);

  // GitHub aggregate basket stats
  const ghAggregate = useMemo(() => {
    if (!data?.github) return null;
    const total = data.github.reduce((s, r) => s + (r.stars || 0), 0);
    const totalForks = data.github.reduce((s, r) => s + (r.forks || 0), 0);
    const snapDates = Object.keys(data.snapshots || {}).sort();
    let deltaPerDay = null, deltaTotal = null, deltaDays = null;
    if (snapDates.length >= 2) {
      const first = snapDates[0];
      const last = snapDates[snapDates.length - 1];
      const firstTotal = (data.snapshots[first].github || []).reduce((s, r) => s + (r.stars || 0), 0);
      const lastTotal  = (data.snapshots[last].github  || []).reduce((s, r) => s + (r.stars || 0), 0);
      deltaTotal = lastTotal - firstTotal;
      deltaDays = (new Date(last) - new Date(first)) / 86400000 || 1;
      deltaPerDay = Math.round(deltaTotal / Math.max(1, deltaDays));
    }
    return { total, totalForks, deltaPerDay, deltaTotal, deltaDays };
  }, [data]);

  // Per-tag detail (with YoY + peak deltas)
  const tagDetails = useMemo(() => {
    if (!data?.stackOverflowMonthly) return [];
    const mh = data.stackOverflowMonthly;
    const provByTag = Object.fromEntries((data.stackOverflow || []).map(t => [t.tag, { provider: t.provider, label: t.label, total: t.totalQuestions }]));
    return Object.entries(mh).map(([tag, points]) => {
      const latest = points.length ? points[points.length - 1].count || 0 : 0;
      const peak = Math.max(...points.map(p => p.count || 0), 0);
      const yoyPoint = points.length > 12 ? points[points.length - 13].count || 0 : null;
      const yoy = yoyPoint != null && yoyPoint > 0 ? ((latest - yoyPoint) / yoyPoint) * 100 : null;
      const fromPeak = peak > 0 ? ((latest - peak) / peak) * 100 : null;
      const meta = provByTag[tag] || { provider: "Other", label: tag, total: 0 };
      return { tag, label: meta.label, provider: meta.provider, latest, peak, total: meta.total, yoy, fromPeak };
    }).sort((a, b) => b.peak - a.peak);
  }, [data]);

  // Build the GitHub star history from accumulated snapshots
  const ghHistory = useMemo(() => {
    if (!data?.snapshots) return [];
    const dates = Object.keys(data.snapshots).sort();
    if (dates.length < 2) return [];
    const allRepos = new Set();
    dates.forEach(d => (data.snapshots[d].github || []).forEach(r => allRepos.add(r.repo)));
    return dates.map(d => {
      const row = { date: d };
      const snap = data.snapshots[d];
      (snap.github || []).forEach(r => { row[r.repo] = r.stars; });
      return row;
    });
  }, [data]);

  if (loading && !data) {
    return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 11, fontFamily: fonts.mono }}>Loading external usage signals…</div>;
  }
  if (error || !data) {
    return <InfoBox color="#F97316">Unable to load Stack Overflow / GitHub / Cloudflare data.</InfoBox>;
  }

  const so = (data.stackOverflow || []).slice().sort((a, b) => b.totalQuestions - a.totalQuestions);
  const gh = (data.github || []).slice().sort((a, b) => b.stars - a.stars);
  const cf = data.cloudflare || {};
  // Cloudflare Radar `radar/ai/inference/.../model` = model MIX on Cloudflare's
  // own Workers-AI edge (percentage share, not volume). Heavily embeddings-
  // dominated — a narrow signal, labeled honestly below.
  const cfModels = (() => {
    const s = cf.raw && cf.raw.serie_0;
    if (!s || !s.timestamps || !s.timestamps.length) return null;
    const i = s.timestamps.length - 1;
    const isEmbed = m => /bge|embed|m2m100|whisper/i.test(m);
    const rows = Object.keys(s).filter(k => k !== "timestamps").map(m => ({
      model: m,
      short: m.replace(/^@cf\//, ""),
      share: s[m][i] == null ? 0 : Number(s[m][i]),
      utility: m !== "other" && isEmbed(m),
    })).sort((a, b) => b.share - a.share);
    const utilShare = rows.filter(r => r.utility).reduce((t, r) => t + r.share, 0);
    return { rows, utilShare, asOf: s.timestamps[i] };
  })();
  const fmtN = n => n == null ? "—" : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n);

  const fmtPctSimple = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  // Total basket stars per snapshot — the GitHub spark
  const ghSparkVals = ghHistory.map(row => Object.entries(row).filter(([k]) => k !== "date").reduce((s, [, v]) => s + (v || 0), 0));
  const soSparkVals = soAggregate.months.map(m => m.total);

  // ── Three one-line reads (these are corroborating, not primary, lenses) ──
  const ghUp = (ghAggregate?.deltaPerDay ?? 0) > 0;
  const reads = {
    so: {
      tone: "#64748b",
      verdict: "Not a demand gauge — devs moved to AI chat",
      stat: `${fmtPctSimple(soAggregate.fromPeak)} vs peak`,
      statSub: soAggregate.yoy != null ? `${fmtPctSimple(soAggregate.yoy)} YoY` : "",
      spark: soSparkVals, sparkColor: "#F97316",
    },
    gh: {
      tone: ghUp ? "#4ade80" : "#64748b",
      verdict: ghUp ? "Developer mindshare still compounding" : "Mindshare flat — awaiting more snapshots",
      stat: ghAggregate?.deltaPerDay != null ? `+${fmtN(ghAggregate.deltaPerDay)}★/day` : fmtN(ghAggregate?.total),
      statSub: `across ${(data.github || []).length} repos`,
      spark: ghSparkVals.length >= 3 ? ghSparkVals : null, sparkColor: "#8B5CF6",
    },
    cf: cf.available
      ? { tone: "#fbbf24", verdict: cfModels ? `Edge inference is ${cfModels.utilShare.toFixed(0)}% embeddings — narrow lens` : "Edge model mix — narrow lens", stat: cfModels ? `${(100 - cfModels.utilShare).toFixed(0)}% generative` : "live", statSub: "CF Workers-AI only", spark: null }
      : { tone: "#475569", verdict: "Not enabled — needs a free Radar token", stat: "off", statSub: cf.reason || "no_token", spark: null },
  };

  return (<>
    {/* ── SUMMARY: one-line read per corroborating signal ── */}
    <SH>Corroborating Signals — Developer Behavior</SH>
    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 820 }}>
      These three don&apos;t measure tokens — they <em>corroborate</em> the primary lenses above by tracking what developers do. None is a headline number on its own; here&apos;s the one-line read on each, with the charts a click away.
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 14 }}>
      <SignalCard name="Stack Overflow — AI Questions" {...reads.so} />
      <SignalCard name="GitHub — AI Repo Stars" {...reads.gh} />
      <SignalCard name="Cloudflare — Edge Model Mix" {...reads.cf} />
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>How to read these.</strong> The one that trips everyone up is <strong>Stack Overflow</strong>: its question volume is <em>down {Math.abs(soAggregate.fromPeak || 0).toFixed(0)}% from the 2024 peak</em>, which looks bearish but isn&apos;t — developers now ask AI tools instead of SO, so a <em>falling</em> SO line is actually confirmation that AI adoption is rising. Don&apos;t read it as demand; read it inverted. <strong>GitHub stars</strong> track mindshare (real but vanity-prone). <strong>Cloudflare</strong> is a narrow, embeddings-heavy edge slice. You&apos;re not dumb — these are genuinely the weakest of the demand lenses, which is why they now sit behind a summary. Expand only when you want to see <em>which</em> tool or repo moved.
    </InfoBox>

    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 16px" }}>
      <button onClick={() => setShowRaw(v => !v)} style={{ fontSize: 11, padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.35)", background: showRaw ? "rgba(99,102,241,0.18)" : "transparent", color: "#a5b4fc", cursor: "pointer", fontFamily: fonts.mono }}>
        {showRaw ? "▾ Hide" : "▸ Show"} underlying charts
      </button>
      <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>SO trend & per-tag, GitHub bars & star growth, Cloudflare model mix</span>
    </div>

    {showRaw && (<>
    {/* ── HEADLINE: aggregate AI activity hero stats ── */}
    <SH>Aggregate AI Activity — Are Developers Building More or Less?</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard
        label="SO Questions (Latest mo)"
        val={fmtN(soAggregate.latest)}
        sub={`YoY ${fmtPctSimple(soAggregate.yoy)}  ·  vs peak ${fmtPctSimple(soAggregate.fromPeak)}`}
        color={(soAggregate.yoy ?? 0) < 0 ? "#F97316" : "#10B981"}
      />
      <StatCard
        label="SO 24-Month Peak"
        val={fmtN(soAggregate.peak)}
        sub="questions/mo across all tracked AI tags"
        color="#6366F1"
      />
      <StatCard
        label="GitHub Star Basket"
        val={ghAggregate ? fmtN(ghAggregate.total) : "—"}
        sub={`★ across ${(data.github || []).length} tracked AI repos`}
        color="#8B5CF6"
      />
      <StatCard
        label="Stars Added / Day"
        val={ghAggregate?.deltaPerDay != null ? `+${fmtN(ghAggregate.deltaPerDay)}` : "—"}
        sub={ghAggregate?.deltaPerDay != null ? `Avg over last ${Math.round(ghAggregate.deltaDays)} days` : "Pending more snapshots"}
        color="#10B981"
      />
    </div>

    {/* ── KILLER CHART: 24-month aggregate SO trend ── */}
    <SH>AI Question Volume on Stack Overflow — 24-Month Trend</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 18px 8px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5 }}>
        Total monthly questions across all tracked AI tags. <strong style={{ color: "#f59e0b" }}>This is the story.</strong> Aggregate volume has fallen from ~{fmtN(soAggregate.peak)} questions/mo (mid-2024 peak) to ~{fmtN(soAggregate.latest)} in the latest month — devs are increasingly using AI tools to debug AI questions, not Stack Overflow.
      </div>
      {soAggregate.months.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={soAggregate.months} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-so-agg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F97316" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(soAggregate.months.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v} questions`, "Total"]} />
            <Area type="monotone" dataKey="total" stroke="#F97316" fill="url(#g-so-agg)" strokeWidth={2} dot={{ r: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Sums {(data.stackOverflow || []).length} AI tags. Backfilled from Stack Exchange API monthly windows.
      </div>
    </div>

    {/* ── Provider category share over time ── */}
    {providerShareSeries.rows.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 18px 8px", marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>Provider Category Share Over Time — Who's Gaining/Losing Mindshare</div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={providerShareSeries.rows} margin={{ top: 5, right: 8, left: -10, bottom: 0 }} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(providerShareSeries.rows.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`${v} questions`, n]} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
            {providerShareSeries.providers.map(p => (
              <Area key={p} type="monotone" dataKey={p} stackId="1" stroke={PROV_COLOR[p] || PROV_COLOR.Other} fill={PROV_COLOR[p] || PROV_COLOR.Other} fillOpacity={0.7} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
          Normalized 0–100%. Shows how the mix of which providers devs ask about has shifted.
        </div>
      </div>
    )}

    {/* ── Per-tag detail table ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <div style={{ padding: "12px 18px 0", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Per-Tag Detail — Where the Drop Is Concentrated</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
        <thead>
          <tr>
            {["Tag", "Provider", "Peak (24mo)", "Latest Month", "YoY", "vs Peak", "All-Time Total"].map(h => (
              <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: h === "Tag" || h === "Provider" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tagDetails.map((r, i) => (
            <tr key={r.tag} style={{ borderBottom: i < tagDetails.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: PROV_COLOR[r.provider] || PROV_COLOR.Other, marginRight: 8, verticalAlign: "middle" }} />
                {r.label}
              </td>
              <td style={{ padding: "8px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#94a3b8" }}>{r.provider}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right" }}>{r.peak}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 600 }}>{r.latest}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: 600, color: r.yoy == null ? "#475569" : r.yoy < 0 ? "#f87171" : "#4ade80" }}>{fmtPctSimple(r.yoy)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: r.fromPeak == null ? "#475569" : r.fromPeak < -20 ? "#f87171" : r.fromPeak < 0 ? "#fbbf24" : "#4ade80" }}>{fmtPctSimple(r.fromPeak)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{fmtN(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* ── Original SO bar chart (kept as detail view) ── */}
    <SH>Stack Overflow Tag Activity — Production Usage Signal</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 14, lineHeight: 1.5 }}>
        Total questions ever asked, by tag. Devs only ask Stack Overflow when they&apos;re trying to ship something — high cumulative counts signal sustained production use. The "last 30 days" column shows how question rates have <strong style={{ color: "#f59e0b" }}>collapsed</strong> as devs increasingly ask AI tools instead of SO.
      </div>
      <ResponsiveContainer width="100%" height={Math.max(220, so.length * 28)}>
        <BarChart data={so} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
          <YAxis type="category" dataKey="label" width={140} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v.toLocaleString()} questions  · last 30d: ${p.payload.questionsLast30Days}`, p.payload.tag]} />
          <Bar dataKey="totalQuestions" radius={[0, 4, 4, 0]}>
            {so.map((r, i) => <Cell key={i} fill={PROV_COLOR[r.provider] || PROV_COLOR.Other} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Source: Stack Exchange API. Hover bars to see last-30-day question rates.
      </div>
    </div>

    {/* ── GitHub repo star history ── */}
    <SH>GitHub Repo Stars — Developer Mindshare</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 14, lineHeight: 1.5 }}>
        Cumulative stars on the most popular AI/ML repos. A star is a stronger signal than an SDK download — it means a dev wants to remember the project, follow updates, or contribute. Inference runtimes (Ollama, llama.cpp, ComfyUI) lead because the long tail of open-source devs adds to them daily.
      </div>
      <ResponsiveContainer width="100%" height={Math.max(280, gh.length * 30)}>
        <BarChart data={gh} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
          <YAxis type="category" dataKey="label" width={140} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v.toLocaleString()} ★  ·  ${p.payload.forks.toLocaleString()} forks`, p.payload.repo]} />
          <Bar dataKey="stars" radius={[0, 4, 4, 0]}>
            {gh.map((r, i) => <Cell key={i} fill={PROV_COLOR[r.provider] || PROV_COLOR.Other} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Source: GitHub API. Daily snapshots accumulate — once 7+ days are archived, a star-growth chart will appear below.
      </div>
    </div>

    {/* ── GitHub star-growth time series (only when we have ≥2 snapshots) ── */}
    {ghHistory.length >= 2 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>Star Growth Over Time ({ghHistory.length} snapshots)</div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={ghHistory} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [v.toLocaleString(), n]} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
            {gh.slice(0, 8).map(r => (
              <Line key={r.repo} type="monotone" dataKey={r.repo} name={r.label} stroke={PROV_COLOR[r.provider] || PROV_COLOR.Other} strokeWidth={1.5} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* ── Cloudflare Radar (token-gated) ── */}
    <SH>Cloudflare Workers-AI — Edge Model Mix</SH>
    {cf.available ? (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#10B981", fontFamily: fonts.mono, marginBottom: 4 }}>✓ Cloudflare Radar live{cfModels ? ` · as of ${String(cfModels.asOf).slice(0, 10)}` : ""}.</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.55, marginBottom: 14, maxWidth: 760 }}>
          Model <em>mix</em> (% of requests) running on Cloudflare&apos;s own Workers-AI edge — <strong style={{ color: "#cbd5e1" }}>not</strong> traffic to chat.openai.com / claude.ai, and <strong style={{ color: "#cbd5e1" }}>not</strong> a volume/level. It&apos;s a narrow lens: mostly embeddings &amp; utility models, so treat it as &ldquo;what CF-edge inference is used for,&rdquo; not a token-demand gauge.
        </div>
        {cfModels && (<>
          {cfModels.utilShare > 0 && (
            <div style={{ fontSize: 10.5, color: "#fbbf24", fontFamily: fonts.mono, marginBottom: 10 }}>
              ⚠ {cfModels.utilShare.toFixed(0)}% of this is embeddings / speech / translation — not LLM token generation.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {cfModels.rows.slice(0, 8).map(r => (
              <div key={r.model} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 200, fontSize: 10.5, fontFamily: fonts.mono, color: r.model === "other" ? "#64748b" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.short}{r.utility && <span style={{ color: "#64748b" }}> ·util</span>}
                </div>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, r.share)}%`, height: "100%", background: r.utility ? "#64748b" : "#6366F1", borderRadius: 4 }} />
                </div>
                <div style={{ width: 52, textAlign: "right", fontSize: 10.5, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600 }}>{r.share.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </>)}
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 12 }}>
          Source: Cloudflare Radar AI Inference API (28-day, hourly, percentage-normalized).
        </div>
      </div>
    ) : (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#F59E0B", fontFamily: fonts.heading, fontWeight: 600, marginBottom: 8 }}>
          ⓘ Cloudflare Radar requires a free API token to enable.
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.6, marginBottom: 12 }}>
          Cloudflare Radar AI shows the model mix running on Cloudflare&apos;s Workers-AI edge (which hosted models get called, as a % share) — a narrow, embeddings-heavy lens, not end-user traffic to OpenAI/Anthropic and not a volume metric.
        </div>
        <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, lineHeight: 1.7, padding: "10px 14px", background: "rgba(99,102,241,0.06)", borderLeft: "2px solid #6366F1", borderRadius: 4 }}>
          <strong style={{ color: "#a5b4fc" }}>Setup (one-time, &lt; 2 min):</strong>
          <ol style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>Sign in (or create a free account) at <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener" style={{ color: "#a5b4fc" }}>dash.cloudflare.com/profile/api-tokens</a></li>
            <li>Click <strong>Create Token</strong> → <strong>Get started</strong> on "Create Custom Token"</li>
            <li>Permissions: <strong>Account · Cloudflare Radar · Read</strong> (the only permission needed)</li>
            <li>Create + copy the token, then in your project run: <code style={{ color: "#a5b4fc", background: "rgba(0,0,0,0.3)", padding: "2px 5px", borderRadius: 3 }}>setx CLOUDFLARE_API_TOKEN "your_token"</code> then restart the dev server</li>
          </ol>
          <div style={{ marginTop: 8, color: "#64748b" }}>Reason endpoint reported: <code style={{ color: "#94a3b8" }}>{cf.reason || "no_token"}</code></div>
        </div>
      </div>
    )}

    </>)}
  </>);
}

// ===========================================================
// SUB-TAB: AI INVESTMENT SCORECARD
// ===========================================================
// One-screen read: each key signal → current value, trend, 5Y percentile,
// investable plays, and a green/amber/red posture light. Pulls from the same
// endpoints the other subtabs use; all posture logic lives here.
const POSTURE = {
  bullish: { color: "#10B981", label: "Bullish", score:  1   },
  neutral: { color: "#F59E0B", label: "Neutral", score:  0   },
  caution: { color: "#F97316", label: "Caution", score: -0.5 },
  bearish: { color: "#EF4444", label: "Bearish", score: -1   },
};

const pctRank = (value, arr) => {
  const vals = (arr || []).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  if (vals.length < 4 || value == null) return null;
  const below = vals.filter(v => v < value).length;
  return Math.round((below / vals.length) * 100);
};

// Build the YoY distribution from a raw level history (for percentile context)
const yoyDistribution = (history, lag) => {
  const v = (history || []).map(h => (typeof h === "object" ? h.v : h));
  const out = [];
  for (let i = lag; i < v.length; i++) {
    if (v[i - lag]) out.push(((v[i] - v[i - lag]) / v[i - lag]) * 100);
  }
  return out;
};

function buildScorecard({ impact, capex, prices, sdk, or }) {
  const rows = [];
  const fred = impact?.fred || {};

  // ── 0. Token Demand (OpenRouter routed volume, 13-week growth) ──
  // The most direct usage signal on the card — actual tokens, not a proxy.
  // Partial trailing week trimmed so the in-progress week can't flip posture.
  {
    const weekTot = orWeeklyTotals(or);
    if (weekTot.length > 13) {
      const last = weekTot[weekTot.length - 1];
      const w13 = weekTot[weekTot.length - 14];
      const g13 = w13.v ? ((last.v / w13.v) - 1) * 100 : null;
      const posture = g13 == null ? "neutral" : g13 > 30 ? "bullish" : g13 > 10 ? "neutral" : g13 > 0 ? "caution" : "bearish";
      rows.push({
        category: "Usage",
        label: "Token Demand (OpenRouter)",
        value: `${(last.v * (365 / 7 / 12) / 1e12).toFixed(0)}T tok/mo`,
        trendLabel: g13 != null ? `${g13 >= 0 ? "+" : ""}${g13.toFixed(0)}% /13wk` : "—",
        trendUp: (g13 ?? 0) >= 0,
        percentile: null,
        posture,
        tickers: ["NVDA", "MSFT", "GOOGL"],
        implication: "Actual routed API tokens — the demand every other row proxies. Sustained negative growth here is the sell signal for the whole trade.",
      });
    }
  }

  // ── 1. Hyperscaler AI Capex Momentum ──
  if (capex?.companies) {
    const caps = Object.values(capex.companies);
    let lastTotal = 0, yoyTotal = 0;
    caps.forEach(c => {
      const q = c.quarters || [];
      if (q.length) lastTotal += q[q.length - 1].capex || 0;
      if (q.length > 4) yoyTotal += q[q.length - 5].capex || 0;
    });
    const yoy = yoyTotal ? ((lastTotal - yoyTotal) / yoyTotal) * 100 : null;
    const posture = yoy == null ? "neutral" : yoy > 40 ? "bullish" : yoy > 15 ? "neutral" : yoy > 0 ? "caution" : "bearish";
    rows.push({
      category: "Infrastructure Spend",
      label: "Hyperscaler AI Capex",
      value: `$${(lastTotal / 1e9).toFixed(0)}B/qtr`,
      trendLabel: yoy != null ? `${yoy >= 0 ? "+" : ""}${yoy.toFixed(0)}% YoY` : "—",
      trendUp: (yoy ?? 0) >= 0,
      percentile: null,
      posture,
      tickers: ["NVDA", "AVGO", "TSM"],
      implication: "The dollars that become chips, racks, and tokens. Still accelerating → picks-and-shovels demand intact.",
    });

    // ── 2. Capex Intensity (capex / operating cash flow) ──
    let capexSum = 0, ocfSum = 0;
    caps.forEach(c => {
      const q = c.quarters || [];
      if (q.length) { capexSum += q[q.length - 1].capex || 0; ocfSum += q[q.length - 1].operatingCashFlow || 0; }
    });
    const intensity = ocfSum ? (capexSum / ocfSum) * 100 : null;
    const intPosture = intensity == null ? "neutral" : intensity < 40 ? "bullish" : intensity < 55 ? "neutral" : intensity < 70 ? "caution" : "bearish";
    rows.push({
      category: "Spend Discipline",
      label: "Capex Intensity",
      value: intensity != null ? `${intensity.toFixed(0)}% of OCF` : "—",
      trendLabel: "of operating cash flow",
      trendUp: null,
      percentile: null,
      posture: intPosture,
      tickers: ["MSFT", "GOOGL", "META", "AMZN"],
      implication: "Capex as a share of cash generation. Above ~55% historically pressures hyperscaler multiples — a risk gauge on the spenders themselves.",
    });
  }

  // ── 3. Developer Demand (SDK installs, 90-day growth) ──
  if (sdk?.series) {
    const dateTotals = {};
    Object.values(sdk.series).forEach(s => (s.data || []).forEach(p => { dateTotals[p.date] = (dateTotals[p.date] || 0) + (p.downloads || 0); }));
    const dates = Object.keys(dateTotals).sort();
    if (dates.length > 30) {
      const lag = Math.min(90, dates.length - 1);
      const latest = dateTotals[dates[dates.length - 1]];
      const past = dateTotals[dates[dates.length - 1 - lag]];
      const growth = past ? ((latest - past) / past) * 100 : null;
      const posture = growth == null ? "neutral" : growth > 15 ? "bullish" : growth > 5 ? "neutral" : growth > 0 ? "caution" : "bearish";
      rows.push({
        category: "Adoption",
        label: "Developer Demand (SDK)",
        value: `${(latest / 1e6).toFixed(0)}M/day`,
        trendLabel: growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}% ${lag}d` : "—",
        trendUp: (growth ?? 0) >= 0,
        percentile: null,
        posture,
        tickers: ["MSFT", "GOOGL", "NVDA"],
        implication: "Every commercial AI app installs an SDK before generating a token. The cleanest leading indicator of paid-API demand.",
      });
    }
  }

  // ── FRED-driven rows ──
  const fredRow = (id, cfg) => {
    const s = fred[id];
    if (!s) return;
    const lag = s.freq === "Q" ? 4 : 12;
    const dist = yoyDistribution(s.history, lag);
    const pctile = pctRank(s.yoy, dist);
    const posture = cfg.posture(s.yoy, s.fiveYr, pctile);
    rows.push({
      category: cfg.category,
      label: cfg.label,
      value: cfg.fmtValue(s),
      trendLabel: s.yoy != null ? `${s.yoy >= 0 ? "+" : ""}${s.yoy.toFixed(1)}% YoY` : "—",
      trendUp: (s.yoy ?? 0) >= 0,
      percentile: pctile,
      posture,
      tickers: cfg.tickers,
      implication: cfg.implication,
    });
  };

  // ── 4. Labor Productivity ──
  fredRow("OPHNFB", {
    category: "Productivity Payoff",
    label: "Labor Productivity",
    fmtValue: s => `${s.current?.toFixed(1)} idx`,
    posture: (yoy) => yoy == null ? "neutral" : yoy > 2.5 ? "bullish" : yoy > 1.5 ? "neutral" : "caution",
    tickers: ["SPY"],
    implication: "The ultimate AI ROI test. Sustained growth above the ~2%/yr trend is AI delivering economy-wide — bullish broad equities, not just AI names.",
  });

  // ── 5. Semiconductor Production ──
  fredRow("IPG3344S", {
    category: "Compute Supply",
    label: "Semiconductor Production",
    fmtValue: s => `${s.current?.toFixed(0)} idx`,
    posture: (yoy) => yoy == null ? "neutral" : yoy > 5 ? "bullish" : yoy > 0 ? "neutral" : "caution",
    tickers: ["SMH", "SOXX", "NVDA"],
    implication: "Physical chip output ramping to meet AI demand. Rising = supply catching up; a roll-over would flag a demand air-pocket.",
  });

  // ── 6. Electric Power Generation ──
  fredRow("IPG2211A2N", {
    category: "Power Constraint",
    label: "Electric Power Generation",
    fmtValue: s => `${s.current?.toFixed(0)} idx`,
    posture: (yoy) => yoy == null ? "neutral" : yoy > 3 ? "bullish" : yoy > 1 ? "neutral" : "caution",
    tickers: ["VST", "CEG", "GEV", "NRG"],
    implication: "AI data centers are breaking a 15-year flat power-demand trend — the clearest physical tell of the buildout. Bullish IPPs and grid suppliers.",
  });

  // ── 7. Manufacturing Construction (CHIPS Act buildout) ──
  fredRow("TLMFGCONS", {
    category: "Reshoring Buildout",
    label: "Mfg Construction",
    fmtValue: s => `$${(s.current / 1000).toFixed(0)}B`,
    posture: (yoy, fiveYr) => yoy == null ? "neutral" : yoy > 10 ? "bullish" : yoy > -5 ? "neutral" : "caution",
    tickers: ["PWR", "VMC", "ETN"],
    implication: "Fab + data-center construction spend — up ~150% over 5 years. The visible-from-space AI footprint. Bullish electrical/construction.",
  });

  // ── 8. Inference Cost Deflation ──
  if (prices) {
    const idxFor = (models) => {
      let best = Infinity;
      (models || []).forEach(m => {
        const q = MODEL_QUALITY[m.id];
        if (!q || !m.output) return;
        const score = (q.mmlu + q.gpqa) / 2;
        const ci = m.output / (score / 100);
        if (ci < best) best = ci;
      });
      return best === Infinity ? null : best;
    };
    const hist = prices.history?.tokenHistory || [];
    const liveBest = idxFor(prices.live?.tokens?.models || []);
    const firstBest = hist.length ? idxFor(hist[0].models || []) : null;
    let trend = null;
    if (firstBest && liveBest && firstBest > 0) trend = ((liveBest - firstBest) / firstBest) * 100;
    // Falling cost is bullish for adoption (the broad trade)
    const posture = trend == null ? "bullish" : trend < -5 ? "bullish" : trend < 5 ? "neutral" : "caution";
    rows.push({
      category: "Margins / Adoption",
      label: "Inference Cost Deflation",
      value: liveBest != null ? `$${liveBest.toFixed(2)}/Mq` : "—",
      trendLabel: trend != null ? `${trend >= 0 ? "+" : ""}${trend.toFixed(0)}% since data start` : "cheapest quality-adj",
      trendUp: trend != null ? trend < 0 : true,   // down is "good"
      percentile: null,
      posture,
      tickers: ["Adoption +", "Model-layer −"],
      implication: "Cost per quality-point. Falling = adoption tailwind for the whole stack, but compresses pure-play model-provider margins — favors infra over model layer.",
    });
  }

  // ── 9. Frontier Margin Health (tokenomics-implied) ──
  if (prices?.live?.tokens?.models) {
    const gpu = GPU_SPECS["H200-SXM"];
    const gpuHourly = gpuHourlyAllInCost(gpu, DC_DEFAULTS);
    const margins = [];
    prices.live.tokens.models.forEach(m => {
      const preset = MODEL_PRESETS[m.id];
      if (!preset || !m.output) return;
      const dm = decodeMath(preset, gpu, 64, "FP8");
      const cost = costPerMOutput(gpuHourly, dm.throughputTps);
      margins.push(((m.output - cost) / m.output) * 100);
    });
    if (margins.length) {
      margins.sort((a, b) => a - b);
      const median = margins[Math.floor(margins.length / 2)];
      const posture = median > 70 ? "bullish" : median > 50 ? "neutral" : "caution";
      rows.push({
        category: "Pricing Power",
        label: "Frontier Margin Health",
        value: `${median.toFixed(0)}% median`,
        trendLabel: `${margins.length} models priced`,
        trendUp: null,
        percentile: null,
        posture,
        tickers: ["MSFT", "GOOGL", "Model providers"],
        implication: "Implied gross margin on inference (tokenomics est, upper bound). High = pricing power intact; erosion signals a race-to-the-bottom — rotate to infrastructure.",
      });
    }
  }

  // Overall posture
  const score = rows.reduce((s, r) => s + (POSTURE[r.posture]?.score || 0), 0);
  const counts = { bullish: 0, neutral: 0, caution: 0, bearish: 0 };
  rows.forEach(r => { counts[r.posture] = (counts[r.posture] || 0) + 1; });
  const overall = score >= 3 ? { label: "Constructive", color: "#10B981", note: "The AI infrastructure trade has fuel." }
    : score >= 1 ? { label: "Mildly Constructive", color: "#84CC16", note: "Net positive, with pockets of risk." }
    : score >= -1 ? { label: "Mixed", color: "#F59E0B", note: "Signals are conflicting — be selective." }
    : { label: "Cautious", color: "#EF4444", note: "Deterioration across multiple signals." };

  return { rows, counts, overall, score };
}

// Tiny percentile bar
function PctBar({ value }) {
  if (value == null) return <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>—</span>;
  const color = value >= 80 ? "#EF4444" : value >= 60 ? "#F59E0B" : value >= 40 ? "#94a3b8" : "#10B981";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, position: "relative", minWidth: 38 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${value}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 9, color, fontFamily: fonts.mono, minWidth: 26, textAlign: "right" }}>{value}%</span>
    </div>
  );
}

function ScorecardTab() {
  const [impact, setImpact]   = useState(null);
  const [capex, setCapex]     = useState(null);
  const [sdk, setSdk]         = useState(null);
  const [prices, setPrices]   = useState(null);
  const [or, setOr]           = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/ai-impact").then(r => r.json()).catch(() => null),
      fetch("/api/hyperscaler-capex").then(r => r.json()).catch(() => null),
      fetch("/api/sdk-downloads").then(r => r.json()).catch(() => null),
      fetch("/api/ai-prices").then(r => r.json()).catch(() => null),
      fetch("/api/or-rankings-history").then(r => r.json()).catch(() => null),
    ]).then(([i, c, s, p, o]) => { setImpact(i); setCapex(c); setSdk(s); setPrices(p); setOr(o); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const { rows, counts, overall } = useMemo(
    () => buildScorecard({ impact, capex, prices, sdk, or }),
    [impact, capex, prices, sdk, or]
  );

  if (loading && !rows.length) {
    return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Building AI investment scorecard…</div>;
  }
  if (!rows.length) {
    return <InfoBox color="#F97316">Scorecard data unavailable — make sure the dev server is running so the underlying endpoints can be reached.</InfoBox>;
  }

  return (<>
    <StaleBanner or={or} />
    {/* Overall posture banner */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 18, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: overall.color }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>AI Trade Posture</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: overall.color, fontFamily: fonts.heading, letterSpacing: -0.5, lineHeight: 1 }}>{overall.label}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 5 }}>{overall.note}</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {[["bullish", "Bullish"], ["neutral", "Neutral"], ["caution", "Caution"], ["bearish", "Bearish"]].map(([k, lbl]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: POSTURE[k].color, fontFamily: fonts.heading, lineHeight: 1 }}>{counts[k] || 0}</div>
              <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Each signal → current level, trend, 5-yr percentile, investable plays, and a posture read. Click any subtab above for the full evidence.</div>
      <button onClick={load} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* Scorecard table */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
        <thead>
          <tr>
            {["", "Signal", "Current", "Trend", "5Y %ile", "Plays", "What It Means"].map((h, i) => (
              <th key={i} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: i >= 2 && i <= 4 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = POSTURE[r.posture];
            return (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {/* Posture light */}
                <td style={{ padding: "12px 12px", borderLeft: `3px solid ${p.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: p.color, fontFamily: fonts.mono, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{p.label}</span>
                  </div>
                </td>
                {/* Signal name + category */}
                <td style={{ padding: "12px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: fonts.heading }}>{r.label}</div>
                  <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.3, textTransform: "uppercase", marginTop: 2 }}>{r.category}</div>
                </td>
                {/* Current value */}
                <td style={{ padding: "12px 12px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono, whiteSpace: "nowrap" }}>{r.value}</td>
                {/* Trend */}
                <td style={{ padding: "12px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 11, fontFamily: fonts.mono, fontWeight: 600, color: r.trendUp == null ? "#94a3b8" : r.trendUp ? "#4ade80" : "#f87171" }}>
                    {r.trendUp != null && (r.trendUp ? "▲ " : "▼ ")}{r.trendLabel}
                  </span>
                </td>
                {/* Percentile */}
                <td style={{ padding: "12px 12px", minWidth: 90 }}><PctBar value={r.percentile} /></td>
                {/* Tickers */}
                <td style={{ padding: "12px 12px" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {r.tickers.map(t => (
                      <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#a5b4fc", background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{t}</span>
                    ))}
                  </div>
                </td>
                {/* Implication */}
                <td style={{ padding: "12px 12px", fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.5, maxWidth: 320 }}>{r.implication}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>How to use this.</strong> The posture lights translate raw data into a directional read: <span style={{ color: "#10B981" }}>green</span> signals support the AI/infra trade, <span style={{ color: "#F97316" }}>amber/orange</span> flag risk, <span style={{ color: "#EF4444" }}>red</span> warn of deterioration. <strong>Plays</strong> are the most direct instruments for each signal — not recommendations, just where the signal expresses itself. The 5-yr percentile tells you whether today&apos;s reading is historically high or low. Drill into any subtab for the underlying evidence.
    </InfoBox>

    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>Caveats.</strong> Capex intensity and margin estimates are interpretive (the AI-share split and tokenomics assumptions are editorial). FRED series lag 1–3 months. This is a decision-support summary, not investment advice — verify against primary sources before acting.
    </InfoBox>
  </>);
}

// ===========================================================
// SUB-TAB: API USAGE (OpenRouter token throughput)
// ===========================================================
// Overall market growth (weekly token volume by provider, 52 weeks) + which
// individual models are winning by actual API token usage.
const OR_PROVIDER_COLORS = {
  google: "#4285F4", anthropic: "#E8553A", deepseek: "#F59E0B", openai: "#10B981",
  "meta-llama": "#8B5CF6", mistralai: "#EC4899", qwen: "#D946EF", "x-ai": "#14B8A6",
  nousresearch: "#818cf8", "z-ai": "#fb923c", moonshotai: "#22d3ee", others: "#64748b",
};
const orProvColor = p => OR_PROVIDER_COLORS[p] || "#94a3b8";

// ── Vercel AI Gateway panel — tokens vs DOLLARS, and the two-sample check ───
// Design goal: maximum signal in two graphics. (1) The dumbbell: each lab's
// token share vs spend share on one track — the entire premium-vs-commodity
// story in one glance. (2) The cross-sample scatter: OpenRouter share vs
// Vercel share per lab — quantifies each sample's bias instead of caveating it.
const VERCEL_TO_OR = {
  "Anthropic": "anthropic", "OpenAI": "openai", "Google": "google", "DeepSeek": "deepseek",
  "Z.AI": "z-ai", "Moonshot AI": "moonshotai", "xAI": "x-ai", "Alibaba Cloud": "qwen",
  "Xiaomi": "xiaomi", "Minimax": "minimax", "MiniMax": "minimax", "Tencent": "tencent",
  "Meta": "meta-llama", "Mistral": "mistralai", "StepFun": "stepfun", "Inclusionai": "inclusionai", "NVIDIA": "nvidia",
};

function VercelGatewayPanel({ vercel, orMs }) {
  const dumbbell = useMemo(() => {
    if (!vercel?.labStats?.length) return [];
    return vercel.labStats
      .filter(l => l.spend != null || l.tokens != null)
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
      .slice(0, 8);
  }, [vercel]);

  const crossSample = useMemo(() => {
    if (!vercel?.labs?.tokens || !orMs?.length) return [];
    // OpenRouter lab shares, last complete week
    const complete = orMs.filter(w => Object.values(w.ys || {}).reduce((s, v) => s + v, 0) > 0);
    const wk = complete[complete.length - 2] || complete[complete.length - 1];
    if (!wk) return [];
    const tot = Object.values(wk.ys).reduce((s, v) => s + v, 0);
    return vercel.labs.tokens.map(t => {
      const slug = VERCEL_TO_OR[t.name];
      const orShare = slug && wk.ys[slug] != null ? +((wk.ys[slug] / tot) * 100).toFixed(1) : null;
      return orShare != null ? { lab: t.name, or: orShare, vercel: t.pct, open: OPEN_LABS.has(slug) } : null;
    }).filter(Boolean);
  }, [vercel, orMs]);

  if (!vercel?.labStats?.length) return null;
  const anth = vercel.labStats.find(l => l.lab === "Anthropic");
  const cheap = vercel.labStats.filter(l => l.spendPerTokenIdx != null && OPEN_LABS.has(VERCEL_TO_OR[l.lab])).sort((a, b) => a.spendPerTokenIdx - b.spendPerTokenIdx)[0];
  const maxPct = Math.max(...dumbbell.flatMap(l => [l.tokens ?? 0, l.spend ?? 0])) * 1.12;

  return (<>
    <SH>The Second Sample — Vercel AI Gateway (Tokens vs Dollars)</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 12 }}>
      {anth && <StatCard label="Anthropic Spend Capture" val={`${anth.spend}%`} sub={`on ${anth.tokens}% of tokens → ${anth.spendPerTokenIdx}× avg $/token`} color="#E8553A" />}
      {anth && cheap && <StatCard label="Price Realization Spread" val={`${(anth.spendPerTokenIdx / cheap.spendPerTokenIdx).toFixed(0)}×`} sub={`Anthropic vs ${cheap.lab} ($/token, same gateway)`} color="#F59E0B" />}
      <StatCard label="Sample" val="Vercel-hosted apps" sub={`${vercel.window || "rolling window"} · CC BY 4.0 · product/enterprise skew`} color="#818cf8" />
    </div>

    {/* Graphic 1: tokens → spend dumbbell */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Who Wins Tokens vs Who Wins Dollars — by Lab</div>
        <div style={{ fontSize: 9.5, fontFamily: fonts.mono, color: "#64748b" }}><span style={{ color: "#22d3ee" }}>●</span> token share · <span style={{ color: "#4ade80" }}>●</span> spend share</div>
      </div>
      {dumbbell.map(l => {
        const t = l.tokens ?? 0, s = l.spend ?? 0;
        const x = v => `${(v / maxPct) * 100}%`;
        const premium = l.spendPerTokenIdx;
        return (
          <div key={l.lab} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
            <div style={{ width: 96, fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1", flexShrink: 0, textAlign: "right" }}>{l.lab}</div>
            <div style={{ flex: 1, position: "relative", height: 18 }}>
              <div style={{ position: "absolute", top: 8, left: 0, right: 0, height: 2, background: "rgba(255,255,255,0.05)" }} />
              <div style={{ position: "absolute", top: 8, left: x(Math.min(t, s)), width: `calc(${x(Math.abs(s - t))})`, height: 2, background: s >= t ? "rgba(74,222,128,0.5)" : "rgba(248,113,113,0.45)" }} />
              <div title={`tokens ${t}%`} style={{ position: "absolute", top: 4, left: `calc(${x(t)} - 5px)`, width: 10, height: 10, borderRadius: "50%", background: "#22d3ee", border: "2px solid #0f172a" }} />
              <div title={`spend ${s}%`} style={{ position: "absolute", top: 4, left: `calc(${x(s)} - 5px)`, width: 10, height: 10, borderRadius: "50%", background: "#4ade80", border: "2px solid #0f172a" }} />
            </div>
            <div style={{ width: 130, flexShrink: 0, fontSize: 10, fontFamily: fonts.mono, textAlign: "right" }}>
              <span style={{ color: "#22d3ee" }}>{l.tokens ?? "—"}%</span>
              <span style={{ color: "#475569" }}> → </span>
              <span style={{ color: "#4ade80" }}>{l.spend ?? "—"}%</span>
              {premium != null && <span style={{ color: premium >= 1 ? "#fbbf24" : "#64748b", marginLeft: 8, fontWeight: 700 }}>{premium}×</span>}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 8, lineHeight: 1.5 }}>
        Green dot right of cyan = the lab captures MORE dollars than tokens (premium pricing holds); left = volume without revenue (commodity). The ×-figure is spend-share ÷ token-share — realized price vs the gateway average. This is the segmentation thesis in one picture: frontier labs monetize, open-weights labs circulate.
      </div>
    </div>

    {/* Graphic 2: two-sample cross-check */}
    {crossSample.length >= 5 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 12, marginBottom: 6 }}>
          Two Samples, One Market — Token Share: OpenRouter vs Vercel
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="or" name="OpenRouter" domain={[0, 40]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => `${v}%`} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} label={{ value: "OpenRouter token share (indie/agentic skew)", position: "insideBottom", offset: -4, fill: "#475569", fontSize: 9.5, fontFamily: fonts.mono }} />
            <YAxis type="number" dataKey="vercel" name="Vercel" domain={[0, 40]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} label={{ value: "Vercel share (product skew)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 9.5, fontFamily: fonts.mono }} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 40, y: 40 }]} stroke="#64748b" strokeDasharray="5 4" />
            <Tooltip content={({ payload }) => {
              const d = payload?.[0]?.payload;
              if (!d) return null;
              return (
                <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, padding: "8px 12px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
                  <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{d.lab}</div>
                  <div>OpenRouter {d.or}% · Vercel {d.vercel}%</div>
                </div>
              );
            }} />
            <ZAxis range={[70, 71]} />
            <Scatter data={crossSample.filter(d => !d.open)} fill="#E8553A" fillOpacity={0.85} isAnimationActive={false} />
            <Scatter data={crossSample.filter(d => d.open)} fill="#22d3ee" fillOpacity={0.85} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          Red = closed labs, cyan = open-weights. On the dashed diagonal, both samples agree. Above it = stronger with product builders (Vercel); below = stronger with the indie/agentic crowd (OpenRouter). The distance from the diagonal IS each sample&apos;s bias, measured — labs above the line skew enterprise, and enterprise is where the dollars are.
        </div>
      </div>
    )}

    <InfoBox color="#4ade80">
      <strong style={{ color: "#cbd5e1" }}>What the second sample settles.</strong> OpenRouter alone says open-weights are winning; adding dollars says the market has split in two: open-weight models circulate the most tokens at near-zero realized prices, while frontier models take {anth ? `${anth.spend}% of every gateway dollar on ${anth.tokens}% of tokens` : "the overwhelming majority of spend"}. Both theses are true at once — volume commoditizes, value concentrates. The KPI to watch is the spend-per-token spread: if it compresses toward 1× while open share keeps climbing, the moat is failing; while it holds above ~2×, price is the moat.
    </InfoBox>
  </>);
}

function ApiUsageTab() {
  const [data, setData] = useState(null);
  const [vercel, setVercel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [shareMode, setShareMode] = useState("absolute"); // "absolute" | "share"

  const load = () => {
    setLoading(true);
    fetch("/api/or-rankings-history")
      .then(r => r.json())
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    fetch("/api/vercel-ai").then(r => r.json()).then(d => { if (!d.error) setVercel(d); }).catch(() => {});
  };
  useEffect(load, []);

  const fmtTok = n => n == null ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(0)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : String(n);

  // Provider weekly chart from market-share.
  // Keep only the weeks orWeeklyTotals() considers complete — the in-progress
  // week is only partially accumulated and craters the WoW stat and chart tail.
  const { chartRows, providers, growth } = useMemo(() => {
    const complete = new Set(orWeeklyTotals(data).map(w => w.d));
    const ms = (data?.marketShare || []).filter(w => complete.has(w.x));
    if (!ms.length) return { chartRows: [], providers: [], growth: null };
    const provSet = new Set();
    ms.forEach(w => Object.keys(w.ys || {}).forEach(p => provSet.add(p)));
    // order providers by latest-week volume (largest first → bottom of stack)
    const latest = ms[ms.length - 1].ys || {};
    const providers = [...provSet].sort((a, b) => (latest[b] || 0) - (latest[a] || 0));
    const chartRows = ms.map(w => {
      const row = { date: w.x };
      let total = 0;
      providers.forEach(p => { row[p] = w.ys?.[p] || 0; total += w.ys?.[p] || 0; });
      row._total = total;
      return row;
    });
    const firstTot = chartRows[0]._total, lastTot = chartRows[chartRows.length - 1]._total;
    const growth = firstTot ? ((lastTot - firstTot) / firstTot) * 100 : null;
    return { chartRows, providers, growth };
  }, [data]);

  // ── Market structure: concentration + open-weights share, weekly ──
  // The KPI battery for the "do leading models keep the market?" thesis.
  const structure = useMemo(() => {
    const complete = new Set(orWeeklyTotals(data).map(w => w.d));
    const ms = (data?.marketShare || []).filter(w => complete.has(w.x));
    if (ms.length < 8) return null;
    const rows = ms.map(w => {
      const entries = Object.entries(w.ys || {});
      const tot = entries.reduce((s, [, v]) => s + v, 0);
      if (!tot) return null;
      const shares = entries.map(([k, v]) => ({ k, s: v / tot }));
      const hhi = Math.round(shares.reduce((s, x) => s + x.s * x.s * 10000, 0));
      const top3 = +(shares.map(x => x.s).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) * 100).toFixed(1);
      let open = 0, closed = 0;
      for (const { k, s } of shares) {
        if (OPEN_LABS.has(k)) open += s;
        else if (CLOSED_LABS.has(k)) closed += s;
      }
      const openShare = (open + closed) > 0 ? +((open / (open + closed)) * 100).toFixed(1) : null;
      const frontierShare = +((((w.ys.anthropic || 0) + (w.ys.openai || 0) + (w.ys.google || 0)) / tot) * 100).toFixed(1);
      return { d: w.x, hhi, hhiScaled: +(hhi / 100).toFixed(1), top3, openShare, frontierShare };
    }).filter(Boolean);
    const last = rows[rows.length - 1];
    const yrAgo = rows.length > 52 ? rows[rows.length - 53] : rows[0];
    return { rows, last, yrAgo };
  }, [data]);

  // Top individual models (latest snapshot date)
  const topModels = useMemo(() => {
    const rows = data?.rows || [];
    if (!rows.length) return { latest: null, models: [], totalWeek: 0 };
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const latest = dates[dates.length - 1];
    const prior = dates.length > 1 ? dates[dates.length - 2] : null;
    const priorMap = new Map();
    if (prior) rows.filter(r => r.date === prior).forEach(r => priorMap.set(r.model_permaslug, (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0)));
    const models = rows.filter(r => r.date === latest).map(r => {
      const tot = (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0);
      const parts = (r.model_permaslug || "").split("/");
      const provider = parts[0] || "—";
      const name = parts.slice(1).join("/").replace(/-\d{8}$/, "");
      const priorTot = priorMap.get(r.model_permaslug);
      const wow = priorTot ? ((tot - priorTot) / priorTot) * 100 : null;
      return { slug: r.model_permaslug, name, provider, tokens: tot, requests: r.count || 0, wow };
    }).sort((a, b) => b.tokens - a.tokens);
    const totalWeek = models.reduce((s, m) => s + m.tokens, 0);
    return { latest, models, totalWeek };
  }, [data]);

  if (loading && !data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading OpenRouter API usage…</div>;
  if (error || !data) return <InfoBox color="#F97316">Unable to load OpenRouter usage data. The endpoint may be rate-limited — try Refresh.</InfoBox>;

  const latestWeek = chartRows.length ? chartRows[chartRows.length - 1] : null;
  const prevWeek = chartRows.length > 1 ? chartRows[chartRows.length - 2] : null;
  const wowTotal = latestWeek && prevWeek && prevWeek._total ? ((latestWeek._total - prevWeek._total) / prevWeek._total) * 100 : null;
  const topProv = providers[0];

  return (<>
    <StaleBanner or={data} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5 }}>API Usage — OpenRouter Token Throughput</div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>Real API token volume across providers — the cleanest read on aggregate market growth and which models are actually winning.</div>
      </div>
      <button onClick={load} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* Hero growth stats */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard label="Tokens / Week (latest)" val={latestWeek ? `${fmtTok(latestWeek._total)}` : "—"} sub={latestWeek ? `Week of ${latestWeek.date}` : ""} color="#6366F1" />
      <StatCard label="52-Week Growth" val={growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}%` : "—"} sub="Total market throughput" color="#10B981" />
      <StatCard label="Week-over-Week" val={wowTotal != null ? `${wowTotal >= 0 ? "+" : ""}${wowTotal.toFixed(1)}%` : "—"} sub="Latest vs prior week" color={wowTotal >= 0 ? "#10B981" : "#F97316"} />
      <StatCard label="#1 Provider" val={topProv ? topProv.replace("-", " ") : "—"} sub={topProv && latestWeek ? `${((latestWeek[topProv] / latestWeek._total) * 100).toFixed(0)}% of volume` : ""} color="#E8553A" />
    </div>

    {/* Market growth chart */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <SH>Weekly Token Volume by Provider — 52 Weeks</SH>
      <div style={{ display: "flex", gap: 4 }}>
        {[["absolute", "Volume"], ["share", "Share %"]].map(([k, l]) => (
          <button key={k} onClick={() => setShareMode(k)} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: `1px solid ${shareMode === k ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)"}`, background: shareMode === k ? "rgba(99,102,241,0.18)" : "#0f172a", color: shareMode === k ? "#a5b4fc" : "#94a3b8", cursor: "pointer", fontFamily: fonts.mono }}>{l}</button>
        ))}
      </div>
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={340}>
        <AreaChart data={chartRows} margin={{ top: 5, right: 8, left: -4, bottom: 0 }} stackOffset={shareMode === "share" ? "expand" : "none"}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(chartRows.length / 9) - 1)} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => shareMode === "share" ? `${(v * 100).toFixed(0)}%` : fmtTok(v)} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 10 }} formatter={(v, n) => [fmtTok(v), n.replace("-", " ")]} labelFormatter={l => `Week of ${l}`} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} formatter={n => n.replace("-", " ")} />
          {providers.map(p => (
            <Area key={p} type="monotone" dataKey={p} name={p} stackId="1" stroke={orProvColor(p)} fill={orProvColor(p)} fillOpacity={0.75} strokeWidth={0.5} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        {shareMode === "share" ? "Normalized to 100% — provider share of total throughput over time." : "Absolute weekly token volume — the height of the stack is total market growth."}
      </div>
    </div>

    {/* ── Market structure: the "do leaders keep the market?" KPIs ── */}
    {structure && (<>
      <SH>Market Structure — Concentration &amp; Open-Weights Share</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#22d3ee" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Open-Weights Token Share</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.openShare}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{(structure.last.openShare - structure.yrAgo.openShare) >= 0 ? "+" : ""}{(structure.last.openShare - structure.yrAgo.openShare).toFixed(1)}pp over 12mo</div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#E8553A" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Frontier Share (A+O+G)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.frontierShare}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{(structure.last.frontierShare - structure.yrAgo.frontierShare) >= 0 ? "+" : ""}{(structure.last.frontierShare - structure.yrAgo.frontierShare).toFixed(1)}pp over 12mo</div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#8B5CF6" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Top-3 Lab Share</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.top3}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>whoever they are that week</div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#F59E0B" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>HHI (Concentration)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.hhi.toLocaleString()}</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>&lt;1500 = unconcentrated (DOJ scale)</div>
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={structure.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={46} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={d => d.slice(0, 10)} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <Line type="monotone" dataKey="openShare" name="Open-weights share %" stroke="#22d3ee" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="frontierShare" name="Frontier (Anthropic+OpenAI+Google) %" stroke="#E8553A" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="hhiScaled" name="HHI ÷ 100" stroke="#F59E0B" strokeWidth={1.4} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          The commoditization scoreboard. <strong style={{ color: "#94a3b8" }}>Big caveat:</strong> OpenRouter over-samples open-weights — closed-model enterprise traffic mostly goes direct to Anthropic/OpenAI/Azure and never touches this data. Read the <em>trend</em> (is open share gaining?), not the level. Cross-check against the realized price premium on Supply &amp; Demand: share moving to open weights while the frontier premium HOLDS means segmentation, not commoditization; share moving while the premium COLLAPSES is the real bear case for closed labs.
        </div>
      </div>
    </>)}

    {/* ── The second sample: Vercel AI Gateway (tokens vs dollars) ── */}
    <VercelGatewayPanel vercel={vercel} orMs={data?.marketShare} />

    {/* Top individual models */}
    <SH>Top Models by API Token Usage{topModels.latest ? ` — ${topModels.latest}` : ""}</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr>
            {["#", "Model", "Provider", "Tokens/wk", "Share", "Requests", "WoW"].map((h, i) => (
              <th key={i} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: i <= 2 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topModels.models.slice(0, 25).map((m, i) => (
            <tr key={m.slug} style={{ borderBottom: i < 24 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: fonts.mono, color: i < 3 ? "#f59e0b" : "#475569", fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
              <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>{m.name}</td>
              <td style={{ padding: "9px 12px" }}><span style={{ fontSize: 10, fontFamily: fonts.mono, color: orProvColor(m.provider), background: `${orProvColor(m.provider)}1a`, padding: "2px 7px", borderRadius: 5 }}>{m.provider}</span></td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600 }}>{fmtTok(m.tokens)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{topModels.totalWeek ? `${((m.tokens / topModels.totalWeek) * 100).toFixed(1)}%` : "—"}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, fontFamily: fonts.mono, color: "#64748b" }}>{fmtTok(m.requests)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, fontFamily: fonts.mono, fontWeight: 600, color: m.wow == null ? "#475569" : m.wow >= 0 ? "#4ade80" : "#f87171" }}>{m.wow != null ? `${m.wow >= 0 ? "+" : ""}${m.wow.toFixed(0)}%` : "new"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Why this is the strongest demand signal here.</strong> Unlike SDK installs (developer intent) or HF downloads (open-weight popularity), this is <em>actual paid API token throughput</em> routed through OpenRouter. The 52-week stack height is the cleanest public proxy for overall AI market growth, and the model table shows exactly which models are capturing that demand right now. WoW flags momentum — a model jumping up the list is gaining real production share.
    </InfoBox>
  </>);
}

// ===========================================================
// SUB-TAB: SUPPLY & DEMAND — the compute balance dashboard
// ===========================================================
// Central question: where is compute supply vs token demand, and how fast is
// each growing? Supply in FLOPs isn't publicly observable, so we read the
// CLEARING PRICES (GPU $/hr, $/M tokens) against demand quantity (OpenRouter
// tokens/week). Demand up + prices flat/down → supply winning the race.
// Demand up + prices up → shortage forming.

const SD_GREEN = "#4ade80", SD_AMBER = "#fbbf24", SD_RED = "#f87171", SD_INDIGO = "#818cf8";
const sdPct = (v, dp = 0) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
const sdTok = n => n == null ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(0)}B` : `${(n / 1e6).toFixed(0)}M`;

// ── Ornn OTPI per-lab token pricing (all companies, toggleable) ─────────────
const OTPI_LAB_META = [
  { id: "anthropic",  label: "Anthropic",  color: "#E8553A", def: true },
  { id: "openai",     label: "OpenAI",     color: "#10B981", def: true },
  { id: "google",     label: "Google",     color: "#3B82F6", def: true },
  { id: "deepseek",   label: "DeepSeek",   color: "#8B5CF6", def: true },
  { id: "z-ai",       label: "Z AI (GLM)", color: "#F59E0B", def: true },
  { id: "qwen",       label: "Qwen",       color: "#22D3EE", def: true },
  { id: "moonshotai", label: "Moonshot",   color: "#EC4899", def: false },
  { id: "minimax",    label: "MiniMax",    color: "#A78BFA", def: false },
  { id: "mistralai",  label: "Mistral",    color: "#FB923C", def: false },
  { id: "meta-llama", label: "Meta Llama", color: "#94A3B8", def: false },
  { id: "xiaomi",     label: "Xiaomi",     color: "#4ADE80", def: false },
];

function OrnnTokenPricePanel({ ornn }) {
  const [on, setOn] = useState(() => new Set(OTPI_LAB_META.filter(l => l.def).map(l => l.id)));
  if (!ornn?.otpiRows?.length) return null;
  const latest = ornn.otpiLatest || {};

  // ── Pricing KPIs: frontier quality premium + blended deflation rate ──
  // premium = avg(frontier realized $/Mtok) ÷ cheapest open-weights lab that
  // day. Holding premium + rising open share = segmentation; collapsing
  // premium = the commoditization bear case actually biting.
  const FRONTIER = ["anthropic", "openai"], OPEN_FLOOR = ["deepseek", "qwen", "z-ai", "meta-llama"];
  const premiumSeries = ornn.otpiRows.map(r => {
    const f = FRONTIER.map(l => r[l]).filter(v => v != null);
    const o = OPEN_FLOOR.map(l => r[l]).filter(v => v != null);
    if (f.length < 2 || !o.length) return null;
    return { d: r.d, v: +((f.reduce((a, b) => a + b, 0) / f.length) / Math.min(...o)).toFixed(1) };
  }).filter(Boolean);
  const premNow = premiumSeries.length ? premiumSeries[premiumSeries.length - 1].v : null;
  const premYr = premiumSeries.length > 250 ? premiumSeries[premiumSeries.length - 251].v : (premiumSeries[0]?.v ?? null);
  // blended big-4 realized price, YoY = the deflation term in every AI revenue model
  const blend = ornn.otpiRows.map(r => {
    const vals = ["anthropic", "openai", "google", "deepseek"].map(l => r[l]).filter(v => v != null);
    return vals.length >= 3 ? { d: r.d, v: vals.reduce((a, b) => a + b, 0) / vals.length } : null;
  }).filter(Boolean);
  const blendNow = blend.length ? blend[blend.length - 1].v : null;
  const blendYr = blend.length > 250 ? blend[blend.length - 251].v : (blend[0]?.v ?? null);
  const deflation = (blendNow != null && blendYr) ? +(((blendNow / blendYr) - 1) * 100).toFixed(1) : null;
  const toggle = (id) => setOn(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const fmtP = v => v == null ? "—" : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`;
  return (<>
    <SH>Token Prices by Company — Ornn OTPI (volume-weighted $/M tokens)</SH>
    {/* Pricing KPIs: the two numbers that decide the leading-models thesis */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 12 }}>
      {premNow != null && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#E8553A" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Frontier Quality Premium</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 3 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{premNow}×</span>
            <span style={{ fontSize: 10, color: premYr != null && premNow >= premYr ? "#4ade80" : "#f87171", fontFamily: fonts.mono }}>{premYr != null ? `${premNow >= premYr ? "+" : ""}${(premNow - premYr).toFixed(1)}× vs 1yr ago` : ""}</span>
          </div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 3, lineHeight: 1.45 }}>avg(Anthropic, OpenAI) ÷ cheapest open-weights lab, realized prices. Holding = moat; collapsing = commoditization.</div>
        </div>
      )}
      {deflation != null && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#8B5CF6" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Blended Realized Price, YoY</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: deflation <= 0 ? "#22d3ee" : "#fbbf24", fontFamily: fonts.heading, marginTop: 3 }}>{deflation >= 0 ? "+" : ""}{deflation}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 3, lineHeight: 1.45 }}>big-4 average $/Mtok — the deflation term in every AI revenue forecast. Token volumes must outgrow this for revenue to rise.</div>
        </div>
      )}
    </div>
    {/* Company chips: click to toggle a line; each shows current realized price + 30d move */}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {OTPI_LAB_META.filter(l => latest[l.id]).map(l => {
        const v = latest[l.id];
        const active = on.has(l.id);
        return (
          <button key={l.id} onClick={() => toggle(l.id)} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 10, cursor: "pointer",
            border: `1px solid ${active ? l.color : "rgba(255,255,255,0.08)"}`,
            background: active ? `${l.color}22` : "rgba(255,255,255,0.03)",
            opacity: active ? 1 : 0.55, transition: "all 0.15s",
          }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontFamily: fonts.heading, fontWeight: 600, color: "var(--text-primary)" }}>{l.label}</span>
            <span style={{ fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color: l.color }}>{fmtP(v.current)}</span>
            {v.chg30 != null && (
              <span style={{ fontSize: 9.5, fontFamily: fonts.mono, color: v.chg30 >= 0 ? "#4ade80" : "#f87171" }}>{v.chg30 >= 0 ? "+" : ""}{v.chg30}%/30d</span>
            )}
          </button>
        );
      })}
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={ornn.otpiRows} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={46} />
          <YAxis scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${(+v).toFixed(3)}/Mtok`, OTPI_LAB_META.find(l => l.id === n)?.label || n]} labelFormatter={d => d.slice(0, 10)} />
          {OTPI_LAB_META.filter(l => on.has(l.id)).map(l => (
            <Line key={l.id} type="monotone" dataKey={l.id} name={l.id} stroke={l.color} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Daily settled, volume-weighted price actually paid per million tokens across each company&apos;s models (log scale) — realized price, not list price. Click a company chip to add/remove its line. The Anthropic/OpenAI vs DeepSeek/Qwen spread is the market&apos;s live quality premium; watch whether it compresses (commoditization) or holds (durable moat). Source: <a href="https://dashboard.ornnai.com/tokens" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>Ornn OTPI</a>.
      </div>
    </div>
  </>);
}

// ── AI debt-market tracker (curated, extend by hand) ───────────────────────
// SemiAnalysis ("NVIDIA GPU debt backstop" article) forecasts AI debt becoming
// the 2nd-largest credit market after US mortgages (~$13T): ~$7T outstanding
// by 2029 against ~$11.1T cumulative AI capex 2024-29. No API tracks this —
// deals are public headlines, curated here like TOKEN_DISCLOSURES.
// amt in $B. date = announcement month (some approximate — verify on edit).
// contingent: true = a guarantee (NVIDIA revenue backstop), NOT drawn debt —
// listed in the table but excluded from the cumulative line.
// ADD A ROW whenever a headline AI financing lands. That's the whole upkeep.
const AI_DEBT_DEALS = [
  { date: "2023-08", borrower: "CoreWeave",            amt: 2.3,  lender: "Magnetar + Blackstone",         type: "GPU-collateralized loan" },
  { date: "2024-05", borrower: "CoreWeave",            amt: 7.5,  lender: "Blackstone-led",                type: "DDTL 2.0" },
  { date: "2024-10", borrower: "Crusoe (Abilene DC)",  amt: 3.4,  lender: "Blue Owl-led",                  type: "DC construction financing" },
  { date: "2025-05", borrower: "CoreWeave",            amt: 2.0,  lender: "public market",                 type: "High-yield notes" },
  { date: "2025-06", borrower: "xAI",                  amt: 5.0,  lender: "Morgan Stanley-led",            type: "Notes + term loan" },
  { date: "2025-09", borrower: "Oracle",               amt: 18,   lender: "public market",                 type: "IG bonds (DC buildout)" },
  { date: "2025-09", borrower: "Nebius",               amt: 3.0,  lender: "public market",                 type: "Convertible notes" },
  { date: "2025-10", borrower: "Meta (Hyperion DC)",   amt: 27,   lender: "Blue Owl JV",                   type: "Private credit" },
  { date: "2025-10", borrower: "TeraWulf",             amt: 3.2,  lender: "public (Google-backstopped)",   type: "Notes" },
  { date: "2025-10", borrower: "Meta",                 amt: 30,   lender: "public market",                 type: "IG bonds" },
  { date: "2026-06", borrower: "CoreWeave",            amt: 8.5,  lender: "incl. Meta-backstopped 5.9% tranche", type: "DDTL 4.0", src: "SemiAnalysis" },
  { date: "2026-06", borrower: "Firmus (Melbourne)",   amt: 10,   lender: "Blackstone-led",                type: "Facility", src: "SemiAnalysis" },
  { date: "2026-06", borrower: "SharonAI (40k GB300)", amt: 4.88, lender: "NVIDIA",                        type: "GPU revenue backstop", contingent: true, src: "SemiAnalysis" },
];
// Illustrative glide path to the article's endpoint — ONLY the $7T-by-2029
// point is theirs; intermediate points are a smooth interpolation for scale.
const AI_DEBT_FORECAST = [
  { date: "2024-06", v: 40 }, { date: "2025-06", v: 150 }, { date: "2026-06", v: 450 },
  { date: "2027-06", v: 1200 }, { date: "2028-06", v: 3000 }, { date: "2029-12", v: 7000 },
];

// ── Supply ceiling: advanced packaging (CoWoS) + HBM sold-out timeline ──────
// Accelerator supply is packaging/memory-limited, not wafer-limited. Whether
// supply CAN respond decides if the compute thesis pays via volumes or prices.
function SupplyCeilingPanel() {
  const c = SUPPLY_CEILING;
  return (<>
    <SH>Supply Ceiling — CoWoS Packaging &amp; HBM</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
          TSMC CoWoS Capacity (k wafers/month)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={c.cowos} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v}k wpm${p.payload.est ? " (est.)" : ""}`, "CoWoS capacity"]} />
            <Bar dataKey="kwpm" radius={[4, 4, 0, 0]}>
              {c.cowos.map((r, i) => <Cell key={i} fill={r.est ? "rgba(129,140,248,0.45)" : "#818cf8"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
          ~{Math.round(c.cowos[c.cowos.length - 1].kwpm / c.cowos[0].kwpm)}× in three years, and still the binding constraint. TrendForce-reported estimates (faded bar = forward estimate) — update from TSMC earnings commentary.
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
          HBM Sold-Out Timeline
        </div>
        {c.hbm.map(h => (
          <div key={h.d} style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, flexShrink: 0, fontWeight: 700 }}>{h.d}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.heading, lineHeight: 1.45 }}>{h.note}{h.approx ? " (≈)" : ""}</span>
          </div>
        ))}
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
          Memory makers pre-selling capacity 12-24 months out is the market saying demand exceeds supply as far as contracts can reach. The signal to fear: this list <em>stops</em> growing — HBM going un-sold-out would be the first hard evidence the compute-demand thesis is breaking.
        </div>
      </div>
    </div>
  </>);
}

function AIDebtPanel() {
  const calc = useMemo(() => {
    const deals = [...AI_DEBT_DEALS].sort((a, b) => a.date.localeCompare(b.date));
    const drawn = deals.filter(d => !d.contingent);
    let cum = 0;
    const cumPts = drawn.map(d => { cum += d.amt; return { date: d.date, announced: +cum.toFixed(1) }; });
    const total = cum;
    const backstops = deals.filter(d => d.contingent).reduce((s, d) => s + d.amt, 0);
    // trailing-12-month announcement pace
    const lastD = deals[deals.length - 1].date;
    const cutY = `${+lastD.slice(0, 4) - 1}${lastD.slice(4)}`;
    const pace12 = drawn.filter(d => d.date > cutY).reduce((s, d) => s + d.amt, 0);
    // merge cumulative + forecast onto one date axis
    const byDate = {};
    cumPts.forEach(p => { byDate[p.date] = { ...(byDate[p.date] || { date: p.date }), announced: p.announced }; });
    AI_DEBT_FORECAST.forEach(p => { byDate[p.date] = { ...(byDate[p.date] || { date: p.date }), forecast: p.v }; });
    const chart = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    return { deals: deals.slice().reverse(), total, backstops, pace12, chart, pctOfForecast: (total / 7000) * 100 };
  }, []);

  const fmtB = v => v == null ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(v < 10 ? 1 : 0)}B`;

  return (<>
    <SH>AI Debt Market — Announced Facilities vs the $7T Path</SH>
    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 820 }}>
      SemiAnalysis forecasts AI debt becoming the <strong style={{ color: "#cbd5e1" }}>second-largest credit market after US mortgages</strong> — ~$7T outstanding by 2029. This tracker tallies <em>publicly announced, named facilities</em> (a floor on the real number, since much debt is never itemized). Curated by hand — add each headline deal to <code style={{ color: "#a5b4fc" }}>AI_DEBT_DEALS</code>.
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
      <StatCard label="Announced to Date" val={fmtB(calc.total)} sub={`${calc.deals.length} tracked deals`} color={SD_INDIGO} />
      <StatCard label="Trailing-12mo Pace" val={fmtB(calc.pace12)} sub="new facilities announced" color={SD_GREEN} />
      <StatCard label="vs $7T Forecast" val={`${calc.pctOfForecast.toFixed(1)}%`} sub="of the 2029 endpoint" color={SD_AMBER} />
      <StatCard label="NVIDIA Backstops" val={fmtB(calc.backstops)} sub="contingent — not drawn debt" color="#94a3b8" />
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={calc.chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} minTickGap={40} />
          <YAxis scale="log" domain={[10, 8000]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtB} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [fmtB(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Line type="stepAfter" dataKey="announced" name="Announced facilities (cumulative)" stroke={SD_INDIGO} strokeWidth={2.4} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="forecast" name="SemiAnalysis path to $7T (interpolated)" stroke="#64748b" strokeWidth={1.6} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Log scale, $B. Only the $7T-2029 endpoint is SemiAnalysis&apos;s — the dashed path between is smooth interpolation for scale. The gap between the lines is the story: if the buildout thesis is right, announced facilities must accelerate dramatically; if the step-line stalls for quarters, the debt engine is seizing.
      </div>
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead><tr>
          {["Announced", "Borrower", "Structure", "Lender / Notes", "Amount"].map((h, i) => (
            <th key={h} style={{ padding: "9px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i === 4 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {calc.deals.map((d, i) => (
            <tr key={`${d.date}-${d.borrower}`} style={{ borderBottom: i < calc.deals.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", opacity: d.contingent ? 0.65 : 1 }}>
              <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{d.date}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>{d.borrower}</td>
              <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#94a3b8" }}>{d.type}{d.contingent ? " ⓘ contingent" : ""}</td>
              <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{d.lender}{d.src ? ` · ${d.src}` : ""}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 700 }}>{fmtB(d.amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <InfoBox color={SD_INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>Why this matters for the whole AI trade.</strong> The capex forecast (~$11T through 2029) only happens if debt markets fund it — hyperscaler cash flows alone can&apos;t. So this scoreboard is the <em>fuel gauge</em> for everything else on this tab: announced facilities accelerating = the backstop-unlocked credit machine is working; a multi-quarter stall = the single most important early warning that the buildout (and NVDA&apos;s order book) is at risk. Dates and amounts are curated seed values from public headlines and the SemiAnalysis article — verify before trading on any single row.
    </InfoBox>
  </>);
}

// H100 price from a gpuHistory snapshot (consensus preferred, Vast median fallback)
const sdH100 = snap => {
  const g = snap?.gpus?.["H100 SXM"];
  return g ? (g.consensus ?? g.median ?? null) : null;
};

function SdQuadrant({ trail }) {
  if (!trail?.length) return null;
  const W = 300, H = 240, padL = 36, padR = 12, padT = 20, padB = 32;
  const gw = W - padL - padR, gh = H - padT - padB;
  const xr = [-40, 160], yr = [-40, 60];
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = v => padL + ((cl(v, xr[0], xr[1]) - xr[0]) / (xr[1] - xr[0])) * gw;
  const y = v => padT + (1 - (cl(v, yr[0], yr[1]) - yr[0]) / (yr[1] - yr[0])) * gh;
  const last = trail[trail.length - 1];
  const q = last.x >= 0
    ? (last.y >= 0 ? { n: "Shortage forming", c: SD_AMBER } : { n: "Healthy boom", c: SD_GREEN })
    : (last.y >= 0 ? { n: "Squeeze", c: "#94a3b8" } : { n: "Glut", c: SD_RED });
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Compute Market Regime</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: q.c, fontFamily: fonts.heading }}>{q.n}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
        <rect x={padL} y={padT} width={gw} height={gh} fill="none" stroke="rgba(148,163,184,0.15)" />
        <line x1={x(0)} y1={padT} x2={x(0)} y2={padT + gh} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
        <line x1={padL} y1={y(0)} x2={padL + gw} y2={y(0)} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
        <text x={padL + gw - 6} y={padT + 12} fontSize="9" fill={SD_AMBER} fontFamily="monospace" textAnchor="end">Shortage</text>
        <text x={padL + gw - 6} y={padT + gh - 8} fontSize="9" fill={SD_GREEN} fontFamily="monospace" textAnchor="end">Healthy boom</text>
        <text x={padL + 6} y={padT + 12} fontSize="9" fill="#94a3b8" fontFamily="monospace">Squeeze</text>
        <text x={padL + 6} y={padT + gh - 8} fontSize="9" fill={SD_RED} fontFamily="monospace">Glut</text>
        {trail.length > 1 && <polyline points={trail.map(p => `${x(p.x)},${y(p.y)}`).join(" ")} fill="none" stroke={SD_INDIGO} strokeWidth="1.2" opacity="0.5" />}
        {trail.map((p, i) => (
          <circle key={p.d} cx={x(p.x)} cy={y(p.y)} r={i === trail.length - 1 ? 6 : 2.5}
            fill={i === trail.length - 1 ? SD_INDIGO : "rgba(129,140,248,0.45)"}
            stroke={i === trail.length - 1 ? "#f1f5f9" : "none"} strokeWidth="1.5" />
        ))}
        <text x={padL + gw / 2} y={H - 6} fontSize="9" fill="#64748b" fontFamily="monospace" textAnchor="middle">Token demand growth (13-wk %) →</text>
        <text x={11} y={padT + gh / 2} fontSize="9" fill="#64748b" fontFamily="monospace" textAnchor="middle" transform={`rotate(-90 11 ${padT + gh / 2})`}>Compute price (30d %) →</text>
      </svg>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>
        Latest: demand {sdPct(last.x)} / prices {sdPct(last.y)}. Right half = demand growing; top half = clearing prices rising. Trail deepens as daily snapshots accumulate.
      </div>
    </div>
  );
}

function SupplyDemandTab() {
  const [or, setOr] = useState(null);
  const [prices, setPrices] = useState(null);
  const [sdk, setSdk] = useState(null);
  const [capex, setCapex] = useState(null);
  const [impact, setImpact] = useState(null);
  const [hf, setHf] = useState(null);
  const [semi, setSemi] = useState(null);
  const [ornn, setOrnn] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/or-rankings-history").then(r => r.json()).catch(() => null),
      fetch("/api/ai-prices").then(r => r.json()).catch(() => null),
      fetch("/api/sdk-downloads").then(r => r.json()).catch(() => null),
      fetch("/api/hyperscaler-capex").then(r => r.json()).catch(() => null),
      fetch("/api/ai-impact").then(r => r.json()).catch(() => null),
      fetch("/api/hf-rankings").then(r => r.json()).catch(() => null),
      fetch("/api/semi-h100").then(r => r.json()).catch(() => null),
      fetch("/api/ornn").then(r => r.json()).catch(() => null),
    ]).then(([a, b, c, d, e, f, g, o]) => { setOr(a); setPrices(b); setSdk(c); setCapex(d); setImpact(e); setHf(f); setSemi(g); setOrnn(o); })
      .finally(() => setLoading(false));
  }, []);

  // H100 spot (Vast+RunPod consensus) vs SemiAnalysis 1-year contract index.
  // Weekly grid = the SemiAnalysis dates; spot is forward-filled as-of each week.
  const h100Compare = useMemo(() => {
    if (!semi?.available || !semi.series?.length) return null;
    const spot = (prices?.history?.gpuHistory || []).map(s => ({ d: s.date, v: sdH100(s) })).filter(p => p.v != null);
    const ornnH100 = (ornn?.gpuRows || []).filter(r => r.h100 != null).map(r => ({ d: r.d, v: r.h100 }));
    const asOfIn = (arr, ds) => { let r = null; for (const p of arr) { if (p.d <= ds) r = p; else break; } return r; };
    const rows = semi.series.map(r => ({ d: r.date, contract: r.h100, spot: asOfIn(spot, r.date)?.v ?? null, ornn: asOfIn(ornnH100, r.date)?.v ?? null }));
    // Centered 5-week moving average per series (window shrinks at the edges
    // so endpoints stay current). The contract index wiggles inside a tight
    // band week to week — at chart scale that's noise, not signal.
    const smoothKey = (key, out) => {
      rows.forEach((row, i) => {
        const win = [];
        for (let j = Math.max(0, i - 2); j <= Math.min(rows.length - 1, i + 2); j++) {
          if (rows[j][key] != null) win.push(rows[j][key]);
        }
        row[out] = win.length ? +(win.reduce((a, b) => a + b, 0) / win.length).toFixed(3) : null;
      });
    };
    smoothKey("contract", "contractS");
    smoothKey("spot", "spotS");
    smoothKey("ornn", "ornnS");
    const last = rows[rows.length - 1];
    // latest spot even if newer than the last contract week
    const spotNow = spot.length ? spot[spot.length - 1].v : (last?.spot ?? null);
    const contractNow = last?.contract ?? null;
    const ornnNow = ornnH100.length ? ornnH100[ornnH100.length - 1].v : null;
    const gap = (spotNow != null && contractNow) ? ((spotNow / contractNow) - 1) * 100 : null;
    return { rows, spotNow, contractNow, ornnNow, gap, asOf: semi.asOf, liveOk: semi.liveOk, daysStale: semi.daysStale, source: semi.source };
  }, [semi, prices, ornn]);

  const calc = useMemo(() => {
    const weekTot = orWeeklyTotals(or); // partial trailing week trimmed — a fake cliff here flips the verdict
    if (!weekTot.length) return null;
    const last = weekTot[weekTot.length - 1];
    const first = weekTot[0];
    const w13 = weekTot.length > 13 ? weekTot[weekTot.length - 14] : first;
    const demandYoY = first.v ? ((last.v / first.v) - 1) * 100 : null;
    const demandQ = w13.v ? ((last.v / w13.v) - 1) * 100 : null;

    // Price series
    const gh = (prices?.history?.gpuHistory || []).map(s => ({ d: s.date, v: sdH100(s) })).filter(p => p.v != null);
    const th = (prices?.history?.tokenHistory || []).map(s => ({ d: s.date, v: s.medianInput ?? null })).filter(p => p.v != null);
    const chg = (arr, days) => {
      if (arr.length < 2) return null;
      const lastP = arr[arr.length - 1];
      const cutoff = new Date(new Date(lastP.d).getTime() - days * 86400000).toISOString().slice(0, 10);
      const base = [...arr].reverse().find(p => p.d <= cutoff) || arr[0];
      return base.v ? ((lastP.v / base.v) - 1) * 100 : null;
    };
    const gpuChgAll = gh.length > 1 ? ((gh[gh.length - 1].v / gh[0].v) - 1) * 100 : null;
    const gpuChg30 = chg(gh, 30);
    const tokChgAll = th.length > 1 ? ((th[th.length - 1].v / th[0].v) - 1) * 100 : null;
    const tokChg30 = chg(th, 30);
    const blend = (a, b) => a != null && b != null ? (a + b) / 2 : a ?? b;
    const priceAll = blend(gpuChgAll, tokChgAll);
    const price30 = blend(gpuChg30, tokChg30);

    // Verdict
    let verdict;
    if (demandQ != null && demandQ < 0) verdict = { label: "Demand cooling", color: SD_RED, note: "Token growth has gone negative — watch for glut in compute prices." };
    else if (price30 == null) verdict = { label: "Insufficient price history", color: "#94a3b8", note: "Price trend still accumulating." };
    else if (price30 <= 5) verdict = { label: "Supply keeping pace", color: SD_GREEN, note: "Demand growing while clearing prices hold — supply is winning the race." };
    else if (price30 <= 20) verdict = { label: "Tightening", color: SD_AMBER, note: "Clearing prices rising alongside demand — supply is falling behind." };
    else verdict = { label: "Shortage forming", color: SD_RED, note: "Prices spiking with demand — compute is the bottleneck. Bullish suppliers (chips, clouds, power); margin risk for token resellers." };

    // Indexed chart on ONE dense weekly grid so every series is continuous:
    // demand is exact on its weekly dates; the daily price series are
    // forward-filled (latest value as-of each week) so their lines don't
    // fragment against the demand grid.
    const idx = (arr) => arr.length ? arr.map(p => ({ d: p.d, v: +(p.v / arr[0].v * 100).toFixed(1) })) : [];
    const ghIdx = idx(gh), thIdx = idx(th);
    const demMap = Object.fromEntries(idx(weekTot).map(p => [p.d, p.v]));
    const asOf = (arr, ds) => { let r = null; for (const p of arr) { if (p.d <= ds) r = p; else break; } return r; };
    const lastDem = weekTot[weekTot.length - 1].d;
    // Ornn clearing prices (both indexed to their value AT the chart's start
    // date, not their own 2024 history start, so all lines begin at 100):
    // H100 daily cloud index, and realized token $/Mtok (avg of the four big
    // labs' OTPI — realized > list price as a clearing-price signal).
    const chartStart = weekTot[0].d;
    const ornnHRaw = (ornn?.gpuRows || []).filter(r => r.h100 != null).map(r => ({ d: r.d, v: r.h100 }));
    const OTPI_BIG4 = ["anthropic", "openai", "google", "deepseek"];
    const ornnTRaw = (ornn?.otpiRows || []).map(r => {
      const vals = OTPI_BIG4.map(l => r[l]).filter(v => v != null);
      return vals.length >= 2 ? { d: r.d, v: vals.reduce((a, b) => a + b, 0) / vals.length } : null;
    }).filter(Boolean);
    const idxAt = (arr) => {
      if (!arr.length) return [];
      const base = asOf(arr, chartStart)?.v ?? arr[0].v;
      return base ? arr.filter(p => p.d >= chartStart).map(p => ({ d: p.d, v: +(p.v / base * 100).toFixed(1) })) : [];
    };
    const ornnHIdx = idxAt(ornnHRaw), ornnTIdx = idxAt(ornnTRaw);
    const priceTail = ghIdx.filter(p => p.d > lastDem).filter((_, i) => i % 7 === 0).map(p => p.d);
    const grid = [...weekTot.map(w => w.d), ...priceTail];
    const chart = grid.map(ds => ({
      d: ds,
      demand: demMap[ds] ?? null,
      gpu: asOf(ghIdx, ds)?.v ?? null,
      tok: asOf(thIdx, ds)?.v ?? null,
      ornnGpu: asOf(ornnHIdx, ds)?.v ?? null,
      ornnTok: asOf(ornnTIdx, ds)?.v ?? null,
    }));

    // Quadrant trail: sample weekly over the GPU-history window
    const trail = [];
    for (let i = 0; i < gh.length; i += 7) {
      const t = gh[i].d;
      const p30 = (() => {
        const sub = gh.filter(p => p.d <= t);
        return chg(sub, 30);
      })();
      const wAt = [...weekTot].reverse().find(w => w.d <= t);
      const wIdx = weekTot.findIndex(w => w.d === wAt?.d);
      const q = wIdx >= 13 && weekTot[wIdx - 13].v ? ((wAt.v / weekTot[wIdx - 13].v) - 1) * 100 : null;
      if (p30 != null && q != null) trail.push({ d: t, x: q, y: p30 });
    }
    if (demandQ != null && price30 != null) trail.push({ d: last.d, x: demandQ, y: price30 });

    // SDK (leading demand)
    let sdkLatest = null, sdk90 = null;
    if (sdk?.series) {
      const tot = {};
      Object.values(sdk.series).forEach(s => (s.data || []).forEach(p => { tot[p.date] = (tot[p.date] || 0) + (p.downloads || 0); }));
      const ds = Object.keys(tot).sort();
      if (ds.length > 30) {
        const lag = Math.min(90, ds.length - 1);
        sdkLatest = tot[ds[ds.length - 1]];
        const past = tot[ds[ds.length - 1 - lag]];
        sdk90 = past ? ((sdkLatest / past) - 1) * 100 : null;
      }
    }

    // HF (self-hosted demand)
    let hfLatest = null, hfChg = null;
    if (hf?.rows?.length) {
      const byDate = {};
      hf.rows.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + (r.downloads || 0); });
      const ds = Object.keys(byDate).sort();
      if (ds.length > 1) {
        hfLatest = byDate[ds[ds.length - 1]];
        hfChg = byDate[ds[0]] ? ((hfLatest / byDate[ds[0]]) - 1) * 100 : null;
      } else if (ds.length === 1) hfLatest = byDate[ds[0]];
    }

    // Capex (supply pipeline)
    let capexQ = null, capexYoY = null;
    if (capex?.companies) {
      let lastT = 0, yoyT = 0;
      Object.values(capex.companies).forEach(c => {
        const qs = c.quarters || [];
        if (qs.length) lastT += qs[qs.length - 1].capex || 0;
        if (qs.length > 4) yoyT += qs[qs.length - 5].capex || 0;
      });
      capexQ = lastT; capexYoY = yoyT ? ((lastT / yoyT) - 1) * 100 : null;
    }

    const semis = impact?.fred?.IPG3344S || null;
    const power = impact?.fred?.IPG2211A2N || null;
    const h100Now = gh.length ? gh[gh.length - 1].v : null;
    const tokNow = th.length ? th[th.length - 1].v : null;

    return {
      demandWk: last.v, demandYoY, demandQ, weeks: weekTot.length,
      gpuChgAll, gpuChg30, tokChgAll, tokChg30, priceAll, price30, h100Now, tokNow,
      gpuSince: gh.length ? gh[0].d : null,
      verdict, chart, trail,
      sdkLatest, sdk90, hfLatest, hfChg, capexQ, capexYoY, semis, power,
    };
  }, [or, prices, sdk, capex, impact, hf, ornn]);

  if (loading && !calc) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Weighing compute supply against token demand…</div>;
  if (!calc) return <InfoBox color="#F97316">Unable to load supply/demand data — check that the dev server endpoints are reachable.</InfoBox>;

  const c = calc;
  const growthColor = v => v == null ? "#94a3b8" : v >= 0 ? SD_GREEN : SD_RED;
  const StackRow = ({ name, value, growth, growthLabel, note, invert }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--bg-subtle)", borderRadius: 9 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: fonts.heading, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 1 }}>{note}</div>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 13, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 600, color: invert ? (growth != null && growth > 0 ? SD_RED : SD_GREEN) : growthColor(growth) }}>{growth != null ? `${sdPct(growth)} ${growthLabel}` : growthLabel}</div>
      </div>
    </div>
  );

  return (<>
    <StaleBanner or={or} />
    {/* ── Verdict banner ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c.verdict.color }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>Compute Balance — Supply vs Token Demand</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: c.verdict.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{c.verdict.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>
          demand {sdPct(c.demandQ)} /13wk ({sdPct(c.demandYoY)} YoY) · clearing prices {sdPct(c.price30)} /30d
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 6, maxWidth: 780, lineHeight: 1.5 }}>{c.verdict.note}</div>
    </div>

    {/* ── The killer chart: demand vs clearing prices, indexed ── */}
    <SH>Demand vs Clearing Prices — Indexed to 100</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={330}>
        <LineChart data={c.chart} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(c.chart.length / 10) - 1)} tickFormatter={d => d.slice(2, 7)} />
          <YAxis scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [v, n]} labelFormatter={d => d} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <ReferenceLine y={100} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="demand" name="Token demand (OpenRouter, weekly)" stroke={SD_INDIGO} strokeWidth={2.2} dot={false} connectNulls />
          <Line type="monotone" dataKey="gpu" name="H100 spot $/hr (Vast+RunPod)" stroke={SD_RED} strokeWidth={1.6} dot={false} connectNulls />
          <Line type="monotone" dataKey="ornnGpu" name="H100 cloud index (Ornn)" stroke="#22d3ee" strokeWidth={1.6} dot={false} connectNulls />
          <Line type="monotone" dataKey="tok" name="Token list price (median $/M input)" stroke={SD_AMBER} strokeWidth={1.6} dot={false} connectNulls />
          <Line type="monotone" dataKey="ornnTok" name="Token realized price (Ornn OTPI, big-4 avg)" stroke="#a78bfa" strokeWidth={1.6} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Log scale; each series indexed to 100 at the chart start (demand: {c.weeks} weeks · Vast/median-price series at their own first observation, since {c.gpuSince}). Demand climbing while price lines stay flat = supply keeping pace; price lines turning up = shortage. The Ornn pair adds independent clearing prices: a daily H100 cloud composite (cyan) and <em>realized</em> $/Mtok actually paid across the big-4 labs (violet) — realized token price falling while demand compounds is the supply side winning on efficiency, not weakness.
      </div>
    </div>

    {/* ── H100: spot vs 1-year contract (SemiAnalysis) ── */}
    {h100Compare && (<>
      <SH>H100 $/hr — Spot vs 1-Year Contract</SH>
      {!h100Compare.liveOk && (
        <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid #fbbf24", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ color: "#fbbf24", fontSize: 14 }}>⚠</span>
          <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, lineHeight: 1.5 }}>
            SemiAnalysis&apos;s public index endpoint is currently unreachable — showing their last published values through <strong>{h100Compare.asOf}</strong> ({h100Compare.daysStale}d old). The contract line will extend automatically when the feed returns.
          </span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <StatCard label="H100 Spot (Vast+RunPod)" val={h100Compare.spotNow != null ? `$${h100Compare.spotNow.toFixed(2)}/hr` : "—"} sub="live rental marketplace" color={SD_RED} />
        <StatCard label="H100 1-yr Contract (SemiAnalysis)" val={h100Compare.contractNow != null ? `$${h100Compare.contractNow.toFixed(2)}/hr` : "—"} sub={`index as of ${h100Compare.asOf}`} color={SD_INDIGO} />
        {h100Compare.ornnNow != null && <StatCard label="H100 Cloud Index (Ornn)" val={`$${h100Compare.ornnNow.toFixed(2)}/hr`} sub="daily composite, 3rd methodology" color={SD_AMBER} />}
        <StatCard label="Spot vs Contract" val={h100Compare.gap != null ? `${h100Compare.gap >= 0 ? "+" : ""}${h100Compare.gap.toFixed(0)}%` : "—"} sub={h100Compare.gap != null ? (h100Compare.gap >= 0 ? "spot at a premium" : "spot below contract") : ""} color={h100Compare.gap == null ? "#94a3b8" : h100Compare.gap >= 0 ? SD_AMBER : SD_GREEN} />
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={h100Compare.rows} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [v != null ? `$${(+v).toFixed(2)}/hr` : "—", n]} labelFormatter={d => d.slice(0, 10)} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7}
              payload={[
                { value: "1-yr contract (SemiAnalysis, 5wk avg)", type: "circle", color: SD_INDIGO },
                { value: "Spot (Vast+RunPod, 5wk avg)", type: "circle", color: SD_RED },
                { value: "Cloud index (Ornn, 5wk avg)", type: "circle", color: SD_AMBER },
              ]} />
            <Line type="monotone" dataKey="contract" name="contract, raw weekly" stroke={SD_INDIGO} strokeWidth={1} strokeOpacity={0.25} dot={false} connectNulls isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="contractS" name="1-yr contract (SemiAnalysis, 5wk avg)" stroke={SD_INDIGO} strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="spotS" name="Spot (Vast+RunPod, 5wk avg)" stroke={SD_RED} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="ornnS" name="Cloud index (Ornn, 5wk avg)" stroke={SD_AMBER} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          Absolute $/GPU-hr, all lines smoothed with a centered 5-week average (faint indigo trace = raw weekly contract prints). <strong style={{ color: "#94a3b8" }}>Contract</strong> = what firms commit to on a 1-year term (SemiAnalysis&apos;s free public H100 index) — the structural cost signal. <strong style={{ color: "#94a3b8" }}>Spot</strong> = live rental marketplace (Vast.ai + RunPod consensus) — noisier, but the leading edge. Spot rising above contract = tightening; spot below = slack capacity being dumped. Stat cards above show latest unsmoothed values.
        </div>
      </div>
    </>)}

    {/* ── Ornn: multi-GPU rental index (daily, back to 2024) ── */}
    {ornn?.gpuRows?.length > 0 && (<>
      <SH>GPU Rental Index — All Generations (Ornn, daily)</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
        {Object.entries(ornn.gpuLatest || {}).map(([k, g]) => (
          <StatCard key={k} label={g.id} val={`$${g.current.toFixed(2)}/hr`} sub={g.chg30 != null ? `${g.chg30 >= 0 ? "+" : ""}${g.chg30}% /30d · since ${g.since.slice(0, 7)}` : `since ${g.since.slice(0, 7)}`} color={g.color} />
        ))}
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={ornn.gpuRows} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={46} />
            <YAxis scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${(+v).toFixed(2)}/hr`, n]} labelFormatter={d => d.slice(0, 10)} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
            {Object.entries(ornn.gpuLatest || {}).map(([k, g]) => (
              <Line key={k} type="monotone" dataKey={k} name={g.id} stroke={g.color} strokeWidth={k === "h100" ? 2.2 : 1.6} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          Log scale, $/GPU-hr, daily composite cloud index from <a href="https://dashboard.ornnai.com" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>Ornn</a> (public API). The cross-generation read is the point: if B200 falls while H100 holds, the premium for the newest silicon is compressing — the leading edge of a supply glut. A100&apos;s long decay shows what full depreciation looks like.
        </div>
      </div>
    </>)}

    {/* ── Ornn OTPI: what a token actually costs, by company (toggleable) ── */}
    <OrnnTokenPricePanel ornn={ornn} />

    {/* ── FutureSearch forward view (live values overlaid where we track them) ── */}
    <ForecastPanel tag="ai" live={{
      "h100-1y-oct26": h100Compare?.contractNow != null ? { value: h100Compare.contractNow, label: "SemiAnalysis index, latest" } : undefined,
      "or-tokens-sep26": c?.demandWk != null ? { value: c.demandWk / 1e12, label: "last complete week" } : undefined,
    }} />

    {/* ── Supply ceiling: packaging + memory (curated) ── */}
    <SupplyCeilingPanel />

    {/* ── AI debt-market tracker (curated $7T scoreboard) ── */}
    <AIDebtPanel />

    {/* ── Quadrant + stacks ── */}
    <SH>Regime &amp; Growth Stacks</SH>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(300px, 1.2fr)", gap: 14, marginBottom: 16, alignItems: "start" }}>
      <SdQuadrant trail={c.trail} />
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Demand Stack — Who Wants Tokens</div>
          <div style={{ display: "grid", gap: 6 }}>
            <StackRow name="SDK installs" value={c.sdkLatest != null ? `${(c.sdkLatest / 1e6).toFixed(0)}M/day` : "—"} growth={c.sdk90} growthLabel="/90d" note="Leading — devs install before they ship" />
            <StackRow name="API tokens" value={`${sdTok(c.demandWk)}/wk`} growth={c.demandYoY} growthLabel="YoY" note="Current consumption (OpenRouter routed)" />
            <StackRow name="Open-weight downloads" value={c.hfLatest != null ? `${(c.hfLatest / 1e6).toFixed(0)}M/30d` : "—"} growth={c.hfChg} growthLabel="since archive start" note="Self-hosted demand (Hugging Face)" />
          </div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Supply Stack — Where Compute Comes From</div>
          <div style={{ display: "grid", gap: 6 }}>
            <StackRow name="Hyperscaler capex" value={c.capexQ != null ? `$${(c.capexQ / 1e9).toFixed(0)}B/qtr` : "—"} growth={c.capexYoY} growthLabel="YoY" note="Supply arriving in 12–18 months" />
            <StackRow name="Semiconductor production" value={c.semis?.current != null ? `${c.semis.current.toFixed(0)} idx` : "—"} growth={c.semis?.yoy} growthLabel="YoY" note="Chips being fabbed now (FRED)" />
            <StackRow name="Electric power generation" value={c.power?.current != null ? `${c.power.current.toFixed(0)} idx` : "—"} growth={c.power?.yoy} growthLabel="YoY" note="The binding physical constraint" />
            <StackRow name="H100 spot price" value={c.h100Now != null ? `$${c.h100Now.toFixed(2)}/hr` : "—"} growth={c.gpuChg30} growthLabel="/30d" note="Deployed availability — rising price = scarcity" invert />
          </div>
        </div>
      </div>
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>How this page reasons.</strong> Compute supply in FLOPs isn&apos;t publicly reported, so this dashboard reads the <em>clearing prices</em> — GPU spot rates and $/M tokens — against measured token demand. If demand compounds while prices fall, supply (plus efficiency) is growing even faster than demand; if prices rise with demand, the buildout is falling behind and pricing power shifts to whoever owns chips, data centers, and power. The deepest structural tension sits in the supply stack: token demand compounding triple-digits against power generation growing ~3%/yr.
    </InfoBox>
    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>Caveats.</strong> OpenRouter is a slice of global token demand — trust the growth rates more than the levels. GPU price history began {c.gpuSince} and the early weeks are single-source (Vast) before the RunPod consensus was added, so the price trend firms up as snapshots accumulate. Token &quot;median $/M&quot; tracks the fixed model basket, so basket changes can nudge it.
    </InfoBox>
  </>);
}

// ===========================================================
// MAIN: AIEconomyTab
// ===========================================================
function AIEconomyTab({ models, loading, rankings, rankingsLoading }) {
  const [subTab, setSubTab] = useState("balance");

  const SUB_TABS = [
    { id: "balance",    label: "Supply & Demand" },
    { id: "scorecard",  label: "Scorecard"       },
    { id: "demand",     label: "Demand"          },
    { id: "usage",      label: "API Usage"       },
    { id: "tokenomics", label: "Tokenomics"      },
    { id: "rankings",   label: "Rankings"        },
    { id: "pricing",    label: "Pricing"         },
    { id: "index",      label: "Economic Impact" },
    { id: "market",     label: "Model Market"    },
  ];

  return (<>
    {/* Sub-tab nav */}
    <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {SUB_TABS.map(t => (
        <SubTab key={t.id} id={t.id} label={t.label} active={subTab === t.id} onClick={setSubTab} />
      ))}
    </div>

    {subTab === "balance"    && <SupplyDemandTab />}
    {subTab === "scorecard"  && <ScorecardTab />}
    {subTab === "usage"      && <ApiUsageTab />}
    {subTab === "tokenomics" && <TokenomicsTab />}
    {subTab === "demand"     && <DemandTab />}
    {subTab === "rankings"   && <RankingsTab rankings={rankings} rankingsLoading={rankingsLoading} />}
    {subTab === "pricing"    && <PricingTab />}
    {subTab === "index"      && <AIImpactTab />}
    {subTab === "market"     && <ModelMarketTab models={models} />}
  </>);
}

export default AIEconomyTab;
