// FutureSearch forecast snapshots — run via the FutureSearch MCP, curated in.
// Same pattern as GDPVAL_AA_DATA / METR_DATA: real results, dated, refreshed
// by re-running the battery (each run bills FutureSearch credits, so this is
// deliberately a snapshot, not a live fetch). Session: "econ-dashboard
// forecasts 2026-07". To refresh: re-run the same questions, replace entries,
// bump asOf. p-values are FutureSearch's percentile estimates; binary entries
// carry a single probability (0-100).
export const FORECASTS_ASOF = "2026-07-13";

export const FORECASTS = [
  {
    id: "h100-1y-oct26",
    tags: ["ai"],
    title: "H100 1-yr Contract Index",
    question: "SemiAnalysis H100 1-yr contract index, week nearest Oct 1, 2026",
    type: "numeric",
    unit: "$/hr",
    fmt: v => `$${v.toFixed(2)}`,
    p10: 2.57, p25: 2.71, p50: 2.86, p75: 3.02, p90: 3.20,
    resolveBy: "2026-10-01",
    takeaway: "Flat-to-firm: 1-yr contracts are sticky and capacity is booked through September; the Blackwell ramp is the bear case, spot weakness bleeds in only slowly.",
  },
  {
    id: "h100-below-250",
    tags: ["ai"],
    title: "H100 Index < $2.50 by Year-End",
    question: "Will the H100 1-yr index print below $2.50/hr any week before Dec 31, 2026?",
    type: "binary",
    probability: 24,
    resolveBy: "2026-12-31",
    takeaway: "The GPU-glut scenario is real but a minority case — the correction window is compressed into Q4 when Blackwell supply lands and old reservations roll off.",
  },
  {
    id: "or-tokens-sep26",
    tags: ["ai"],
    title: "OpenRouter Weekly Tokens",
    question: "Total OpenRouter tokens routed, week of Sep 21, 2026",
    type: "numeric",
    unit: "T/wk",
    fmt: v => `${v.toFixed(0)}T`,
    p10: 50.3, p25: 60.7, p50: 76.0, p75: 96.7, p90: 124.0,
    resolveBy: "2026-09-28",
    takeaway: "Median implies +63% in 3 months. Even the p10 (50T) means growth continues — the late-June plateau is read as a pause, not a peak. Upside tail is agentic workloads.",
  },
  {
    id: "ddr5-spot-oct26",
    tags: ["ai"],
    title: "DDR5 16Gb Spot Price",
    question: "DDR5 16Gb DRAM spot price (TrendForce), ~Oct 1, 2026",
    type: "numeric",
    unit: "$/chip",
    fmt: v => `$${v.toFixed(0)}`,
    p10: 37.5, p25: 45.5, p50: 54.0, p75: 64.5, p90: 77.0,
    resolveBy: "2026-10-01",
    takeaway: "The AI memory squeeze continues but decelerates (~$48 now → $54 median; Q2's ~60% QoQ growth is over). p10 reflects real spot-correction risk — DDR4 is already rolling over.",
  },
  {
    id: "nvda-dc-q3fy27",
    tags: ["ai"],
    title: "NVDA Data-Center Revenue",
    question: "NVIDIA Data Center revenue, quarter reported Nov 2026 (FY27 Q3)",
    type: "numeric",
    unit: "$B",
    fmt: v => `$${v.toFixed(0)}B`,
    p10: 87, p25: 92.3, p50: 97.8, p75: 104.3, p90: 112,
    resolveBy: "2026-11-30",
    takeaway: "Median sits ~$2B above street consensus (~$96B) — a routine beat is the base case. Fat right tail on the Rubin ramp; left tail is transition air-pockets or export controls.",
  },
];
