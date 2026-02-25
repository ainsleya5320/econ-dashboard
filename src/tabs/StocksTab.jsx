import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, BarChart, Bar, Cell, ReferenceLine, LineChart, Line, CartesianGrid } from "recharts";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fetchFMP, fetchOptionsChain } from "../lib/api.js";
import { fmtDate, fmtAxisDate, RateCard, SH, InfoBox } from "../components/shared.jsx";
import CSPScreener from "./stocks/CSPScreener.jsx";
import ProfitSankey from "./stocks/ProfitSankey.jsx";

const Plot = createPlotlyComponent(Plotly);

const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "BRK-B", "JPM", "V"];
const STOCK_COLS = [
  { key: "symbol", label: "Ticker", width: 70 },
  { key: "mktCap", label: "Mkt Cap", format: "bigdollar", width: 85 },
  { key: "totalAssets", label: "Assets", format: "bigdollar", width: 80 },
  { key: "equity", label: "Equity", format: "bigdollar", width: 80 },
  { key: "earningsYield", label: "Earn Yld", format: "pct", width: 72 },
  { key: "fcfYield", label: "FCF Yld", format: "pct", width: 70 },
  { key: "roe", label: "ROE", format: "pct", width: 62 },
  { key: "roe5y", label: "ROE 5Y", format: "pct", width: 68 },
  { key: "roic", label: "ROIC", format: "pct", width: 62 },
  { key: "roic5y", label: "ROIC 5Y", format: "pct", width: 70 },
  { key: "peg", label: "PEG", format: "num2", width: 55 },
  { key: "sbcPct", label: "SBC/Rev", format: "pct", width: 72 },
  { key: "cash", label: "Cash", format: "bigdollar", width: 75 },
  { key: "debt", label: "Debt", format: "bigdollar", width: 75 },
  { key: "taxPct", label: "Tax/Rev", format: "pct", width: 70 },
];

const DETAIL_SECTIONS = [
  { title: "Financials", rows: [
    { label: "Revenue", fmt: "bigdollar", get: (d, i) => d.inc[i]?.revenue },
    { label: "  ↳ Rev Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.revenue, prev = d.inc[i - 1]?.revenue; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "  Gross Profit", fmt: "bigdollar", get: (d, i) => d.inc[i]?.grossProfit },
    { label: "  Operating Income", fmt: "bigdollar", get: (d, i) => d.inc[i]?.operatingIncome },
    { label: "  ↳ Op Inc Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.operatingIncome, prev = d.inc[i - 1]?.operatingIncome; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "  Net Income", fmt: "bigdollar", get: (d, i) => d.inc[i]?.netIncome },
    { label: "  ↳ Net Inc Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.netIncome, prev = d.inc[i - 1]?.netIncome; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "EBITDA", fmt: "bigdollar", get: (d, i) => d.inc[i]?.ebitda },
    { label: "EPS (Diluted)", fmt: "num2", get: (d, i) => d.inc[i]?.epsDiluted },
    { label: "  ↳ EPS Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.epsDiluted, prev = d.inc[i - 1]?.epsDiluted; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "Dividends/Share", fmt: "num2", get: (d, i) => { const div = Math.abs(d.cf[i]?.netDividendsPaid || 0), sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? div / sh : null; } },
    { label: "Shares Out (Dil)", fmt: "bignum", get: (d, i) => d.inc[i]?.weightedAverageShsOutDil },
  ]},
  { title: "Profitability", rows: [
    { label: "Tax Rate %", fmt: "pct", get: (d, i) => d.inc[i]?.incomeTaxExpense != null && d.inc[i]?.incomeBeforeTax ? d.inc[i].incomeTaxExpense / d.inc[i].incomeBeforeTax : null },
    { label: "Gross Margin %", fmt: "pct", get: (d, i) => d.rat[i]?.grossProfitMargin ?? (d.inc[i]?.revenue ? d.inc[i].grossProfit / d.inc[i].revenue : null) },
    { label: "Operating Margin %", fmt: "pct", get: (d, i) => d.rat[i]?.operatingProfitMargin ?? (d.inc[i]?.revenue ? d.inc[i].operatingIncome / d.inc[i].revenue : null) },
    { label: "Net Margin %", fmt: "pct", get: (d, i) => d.rat[i]?.netProfitMargin ?? (d.inc[i]?.revenue ? d.inc[i].netIncome / d.inc[i].revenue : null) },
    { label: "FCF Margin %", fmt: "pct", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, rev = d.inc[i]?.revenue; return rev ? fcf / rev : null; } },
  ]},
  { title: "Profitability — Returns", rows: [
    { label: "Return on Assets %", fmt: "pct", get: (d, i) => { const ni = d.inc[i]?.netIncome, ta = d.bs[i]?.totalAssets; return ta ? ni / ta : null; } },
    { label: "Return on Equity %", fmt: "pct", get: (d, i) => { const ni = d.inc[i]?.netIncome, eq = d.bs[i]?.totalStockholdersEquity; return eq ? ni / eq : null; } },
    { label: "Return on Invested Capital %", fmt: "pct", get: (d, i) => { const ebit = d.inc[i]?.operatingIncome, ic = (d.bs[i]?.totalStockholdersEquity || 0) + (d.bs[i]?.totalDebt || 0) - (d.bs[i]?.cashAndCashEquivalents || 0); return ic > 0 && ebit ? ebit * 0.79 / ic : null; } },
    { label: "Asset Turnover", fmt: "num2", get: (d, i) => { const rev = d.inc[i]?.revenue, ta = d.bs[i]?.totalAssets; return ta ? rev / ta : null; } },
    { label: "Inventory Turnover", fmt: "num2", get: (d, i) => { const cogs = d.inc[i]?.costOfRevenue, inv = d.bs[i]?.inventory; return inv ? cogs / inv : null; } },
  ]},
  { title: "Cash Flow", rows: [
    { label: "Operating Cash Flow", fmt: "bigdollar", get: (d, i) => d.cf[i]?.operatingCashFlow },
    { label: "Capital Expenditure", fmt: "bigdollar", get: (d, i) => d.cf[i]?.capitalExpenditure },
    { label: "Free Cash Flow", fmt: "bigdollar", get: (d, i) => d.cf[i]?.freeCashFlow },
    { label: "  ↳ FCF Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.cf[i]?.freeCashFlow, prev = d.cf[i - 1]?.freeCashFlow; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "FCF/Share", fmt: "num2", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? fcf / sh : null; } },
    { label: "Dividends Paid", fmt: "bigdollar", get: (d, i) => d.cf[i]?.netDividendsPaid },
    { label: "Stock Buybacks", fmt: "bigdollar", get: (d, i) => d.cf[i]?.commonStockRepurchased },
    { label: "SBC", fmt: "bigdollar", get: (d, i) => d.cf[i]?.stockBasedCompensation },
    { label: "FCF/Net Income", fmt: "pct", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, ni = d.inc[i]?.netIncome; return ni ? fcf / ni : null; } },
    { label: "CapEx/Revenue", fmt: "pct", get: (d, i) => { const cap = Math.abs(d.cf[i]?.capitalExpenditure || 0), rev = d.inc[i]?.revenue; return rev ? cap / rev : null; } },
  ]},
  { title: "Financial Health", rows: [
    { label: "Cash & Equivalents", fmt: "bigdollar", get: (d, i) => d.bs[i]?.cashAndCashEquivalents },
    { label: "Short-Term Investments", fmt: "bigdollar", get: (d, i) => d.bs[i]?.shortTermInvestments },
    { label: "Total Current Assets", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalCurrentAssets },
    { label: "Total Assets", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalAssets },
    { label: "Total Current Liabilities", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalCurrentLiabilities },
    { label: "Total Debt", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalDebt },
    { label: "Total Liabilities", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalLiabilities },
    { label: "Shareholders' Equity", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalStockholdersEquity },
  ]},
  { title: "Financial Health — Ratios", rows: [
    { label: "Current Ratio", fmt: "num2", get: (d, i) => { const ca = d.bs[i]?.totalCurrentAssets, cl = d.bs[i]?.totalCurrentLiabilities; return cl ? ca / cl : null; } },
    { label: "Quick Ratio", fmt: "num2", get: (d, i) => { const ca = d.bs[i]?.totalCurrentAssets, inv = d.bs[i]?.inventory || 0, cl = d.bs[i]?.totalCurrentLiabilities; return cl ? (ca - inv) / cl : null; } },
    { label: "Debt/Equity", fmt: "num2", get: (d, i) => { const debt = d.bs[i]?.totalDebt, eq = d.bs[i]?.totalStockholdersEquity; return eq ? debt / eq : null; } },
    { label: "Debt/EBITDA", fmt: "num2", get: (d, i) => { const debt = d.bs[i]?.totalDebt, eb = d.inc[i]?.ebitda; return eb ? debt / eb : null; } },
    { label: "Interest Coverage", fmt: "num2", get: (d, i) => { const ebit = d.inc[i]?.operatingIncome, int_ = d.inc[i]?.interestExpense; return int_ ? ebit / int_ : null; } },
  ]},
  { title: "Per Share Data", rows: [
    { label: "Revenue/Share", fmt: "num2", get: (d, i) => { const rev = d.inc[i]?.revenue, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? rev / sh : null; } },
    { label: "Book Value/Share", fmt: "num2", get: (d, i) => { const eq = d.bs[i]?.totalStockholdersEquity, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? eq / sh : null; } },
    { label: "Tangible BV/Share", fmt: "num2", get: (d, i) => { const eq = d.bs[i]?.totalStockholdersEquity, gw = d.bs[i]?.goodwillAndIntangibleAssets || 0, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? (eq - gw) / sh : null; } },
    { label: "FCF/Share", fmt: "num2", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? fcf / sh : null; } },
    { label: "Operating CF/Share", fmt: "num2", get: (d, i) => { const ocf = d.cf[i]?.operatingCashFlow, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? ocf / sh : null; } },
  ]},
];

function fmtVal(v, fmt) {
  if (v == null || isNaN(v)) return "—";
  if (fmt === "bigdollar") {
    const a = Math.abs(v);
    if (a >= 1e12) return `$${(v/1e12).toFixed(1)}T`;
    if (a >= 1e9) return `$${(v/1e9).toFixed(1)}B`;
    if (a >= 1e6) return `$${(v/1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  }
  if (fmt === "bignum") {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v/1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v/1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${(v/1e3).toFixed(0)}K`;
    return v.toLocaleString();
  }
  if (fmt === "pct") return `${(v * 100).toFixed(1)}%`;
  if (fmt === "num2") return v.toFixed(2);
  return String(v);
}

function avg(arr) { if (!arr.length) return null; return arr.reduce((s, v) => s + v, 0) / arr.length; }

async function fetchStockData(symbol, fmpKey) {
  const [incArr, bsArr, cfArr, ratArr, kmArr, profile] = await Promise.all([
    fetchFMP(`/income-statement?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/balance-sheet-statement?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/cash-flow-statement?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/ratios?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/key-metrics?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/profile?symbol=${symbol}`, fmpKey),
  ]);
  const inc = incArr?.[0]; const bs = bsArr?.[0]; const cf = cfArr?.[0]; const rat = ratArr?.[0]; const km = kmArr?.[0]; const prof = profile?.[0];
  if (!inc || !bs) return null;
  const mktCap = prof?.mktCap || km?.marketCap;
  const rev = inc.revenue || 1;
  const equity = bs.totalStockholdersEquity; const totalAssets = bs.totalAssets;
  const cash = bs.cashAndShortTermInvestments || bs.cashAndCashEquivalents;
  const debt = bs.totalDebt;
  const tax = inc.incomeTaxExpense;
  // Use FMP's pre-computed metrics (no hardcoded tax rates)
  const earningsYield = km?.earningsYield ?? null;
  const fcfYield = km?.freeCashFlowYield ?? null;
  const roe = km?.returnOnEquity ?? null;
  const roic = km?.returnOnInvestedCapital ?? null;
  // 5Y averages from key-metrics
  const roes = kmArr?.slice(0, 5).map(r => r.returnOnEquity).filter(v => v != null) || [];
  const roics = kmArr?.slice(0, 5).map(r => r.returnOnInvestedCapital).filter(v => v != null) || [];
  const peg = rat?.priceToEarningsGrowthRatio;
  const sbcPct = km?.stockBasedCompensationToRevenue ?? null;
  return {
    symbol, mktCap, totalAssets, equity, earningsYield, fcfYield, roe,
    roe5y: avg(roes), roic, roic5y: avg(roics),
    peg: peg != null && isFinite(peg) ? peg : null,
    sbcPct,
    cash, debt,
    taxPct: tax != null ? tax / rev : null,
  };
}

async function fetchStockDetail(symbol, fmpKey) {
  const [incArr, bsArr, cfArr, ratArr, kmArr, profile, fullQuote, priceHist] = await Promise.all([
    fetchFMP(`/income-statement?symbol=${symbol}&limit=20`, fmpKey),
    fetchFMP(`/balance-sheet-statement?symbol=${symbol}&limit=20`, fmpKey),
    fetchFMP(`/cash-flow-statement?symbol=${symbol}&limit=20`, fmpKey),
    fetchFMP(`/ratios?symbol=${symbol}&limit=20`, fmpKey),
    fetchFMP(`/key-metrics?symbol=${symbol}&limit=20`, fmpKey),
    fetchFMP(`/profile?symbol=${symbol}`, fmpKey),
    fetchFMP(`/quote?symbol=${symbol}`, fmpKey).catch(() => null),
    fetchFMP(`/historical-price-eod/full?symbol=${symbol}`, fmpKey).catch(() => null),
  ]);
  const prof = profile?.[0];
  const quote = Array.isArray(fullQuote) ? fullQuote[0] : fullQuote;
  const price = quote?.price || prof?.price || null;
  const hist = Array.isArray(priceHist) ? [...priceHist].reverse().slice(-90) : (priceHist?.historical ? [...priceHist.historical].reverse().slice(-90) : []);
  const years = (incArr || []).map(r => r.fiscalYear || r.date?.slice(0, 4)).reverse();
  return { symbol, price, quote, hist, years, inc: [...(incArr || [])].reverse(), bs: [...(bsArr || [])].reverse(), cf: [...(cfArr || [])].reverse(), rat: [...(ratArr || [])].reverse(), km: [...(kmArr || [])].reverse(), prof };
}

// ── Reverse DCF helpers ──
function dcfValue(fcf, growthRate, discountRate, termGrowth, years) {
  let total = 0;
  for (let t = 1; t <= years; t++) total += fcf * Math.pow(1 + growthRate, t) / Math.pow(1 + discountRate, t);
  const termFCF = fcf * Math.pow(1 + growthRate, years) * (1 + termGrowth);
  const termValue = termFCF / (discountRate - termGrowth);
  total += termValue / Math.pow(1 + discountRate, years);
  return total;
}

function solveImpliedGrowth(marketCap, fcf, discountRate, termGrowth, years) {
  if (!marketCap || !fcf || fcf <= 0) return null;
  let lo = -0.50, hi = 1.00;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const val = dcfValue(fcf, mid, discountRate, termGrowth, years);
    if (val < marketCap) lo = mid; else hi = mid;
    if (Math.abs(val - marketCap) / marketCap < 0.0001) break;
  }
  return (lo + hi) / 2;
}

function fcfCAGR(cfArr) {
  const valid = (cfArr || []).filter(c => c.freeCashFlow > 0);
  if (valid.length < 2) return null;
  const first = valid[0].freeCashFlow, last = valid[valid.length - 1].freeCashFlow;
  const n = valid.length - 1;
  return Math.pow(last / first, 1 / n) - 1;
}

function SliderInput({ label, value, onChange, min, max, step, fmt }) {
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 13, color: "#f1f5f9", fontFamily: fonts.mono, fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#818cf8", height: 4, cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>{fmt(min)}</span>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>{fmt(max)}</span>
      </div>
    </div>
  );
}

function ReverseDCF({ data }) {
  const [discRate, setDiscRate] = useState(0.10);
  const [termGrowth, setTermGrowth] = useState(0.03);
  const [projYears, setProjYears] = useState(10);

  const lastCF = data.cf[data.cf.length - 1];
  const lastInc = data.inc[data.inc.length - 1];
  const fcf = lastCF?.freeCashFlow || 0;
  const shares = lastInc?.weightedAverageShsOutDil || 0;
  const price = data.price;
  const mktCap = price && shares ? price * shares : data.prof?.mktCap || 0;
  const fcfPerShare = shares ? fcf / shares : 0;
  const histCAGR = fcfCAGR(data.cf);

  const implied = solveImpliedGrowth(mktCap, fcf, discRate, termGrowth, projYears);

  // Color coding
  const impliedColor = implied == null ? "#94a3b8" : histCAGR != null && implied < histCAGR * 0.8 ? "#4ade80" : histCAGR != null && implied > histCAGR * 1.3 ? "#f87171" : "#fbbf24";
  const verdict = implied == null ? "Insufficient data" : histCAGR != null && implied < histCAGR * 0.8 ? "Market pricing below historical growth — potentially undervalued" : histCAGR != null && implied > histCAGR * 1.3 ? "Market pricing aggressive growth — high expectations baked in" : "Market pricing roughly in line with historical growth";

  // Sensitivity table
  const discRates = [discRate - 0.02, discRate - 0.01, discRate, discRate + 0.01, discRate + 0.02];
  const termRates = [termGrowth - 0.01, termGrowth - 0.005, termGrowth, termGrowth + 0.005, termGrowth + 0.01];
  const sensData = discRates.map(dr => termRates.map(tr => {
    if (tr >= dr) return null;
    return solveImpliedGrowth(mktCap, fcf, dr, tr, projYears);
  }));

  // Projection table
  const projRows = [];
  if (implied != null) {
    for (let t = 1; t <= Math.min(projYears, 15); t++) {
      const projFCF = fcf * Math.pow(1 + implied, t);
      const discounted = projFCF / Math.pow(1 + discRate, t);
      projRows.push({ year: t, fcf: projFCF, pv: discounted });
    }
    const termFCF = fcf * Math.pow(1 + implied, projYears) * (1 + termGrowth);
    const termVal = termFCF / (discRate - termGrowth);
    const pvTerm = termVal / Math.pow(1 + discRate, projYears);
    projRows.push({ year: "Terminal", fcf: termVal, pv: pvTerm });
  }

  return (<>
    <SH>Financial Snapshot</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Stock Price" value={price} color="#818cf8" format="plain" subtitle={price ? `$${price.toFixed(2)}` : null} small />
      <RateCard label="Market Cap" value={mktCap} color="#3B82F6" format="bigdollar" small />
      <RateCard label="TTM Free Cash Flow" value={fcf} color="#10B981" format="bigdollar" small />
      <RateCard label="FCF / Share" value={fcfPerShare} color="#F59E0B" format="plain" subtitle={fcfPerShare ? `$${fcfPerShare.toFixed(2)}` : null} small />
      <RateCard label="Hist. FCF CAGR" value={histCAGR != null ? histCAGR * 100 : null} color="#8B5CF6" subtitle={histCAGR != null ? `${(histCAGR*100).toFixed(1)}% over ${data.cf.filter(c=>c.freeCashFlow>0).length-1}yr` : "N/A"} small />
    </div>

    <SH>Assumptions</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 24px", marginBottom: 14, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <SliderInput label="Discount Rate (WACC)" value={discRate} onChange={setDiscRate} min={0.06} max={0.15} step={0.005} fmt={v => `${(v*100).toFixed(1)}%`} />
      <SliderInput label="Terminal Growth Rate" value={termGrowth} onChange={setTermGrowth} min={0.01} max={0.05} step={0.005} fmt={v => `${(v*100).toFixed(1)}%`} />
      <SliderInput label="Projection Period" value={projYears} onChange={setProjYears} min={5} max={20} step={1} fmt={v => `${v} yrs`} />
    </div>

    <SH>Implied FCF Growth Rate</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "24px 28px", marginBottom: 14, textAlign: "center" }}>
      <div style={{ fontSize: 42, fontWeight: 700, color: impliedColor, fontFamily: fonts.heading, letterSpacing: -1 }}>
        {implied != null ? `${(implied * 100).toFixed(1)}%` : "—"}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6 }}>annual FCF growth rate implied by current market price</div>
      <div style={{ fontSize: 12, color: impliedColor, fontFamily: fonts.heading, marginTop: 10, fontWeight: 500 }}>{verdict}</div>
      {histCAGR != null && <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 6 }}>Historical FCF CAGR: {(histCAGR*100).toFixed(1)}% | Implied: {implied != null ? (implied*100).toFixed(1) : "—"}%</div>}
    </div>

    <SH>Sensitivity Analysis</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead>
          <tr>
            <th style={{ padding: "10px 12px", fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>WACC \ Term Growth</th>
            {termRates.map(tr => <th key={tr} style={{ padding: "10px 8px", fontSize: 9, color: tr === termGrowth ? "#818cf8" : "#94a3b8", fontFamily: fonts.mono, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", fontWeight: tr === termGrowth ? 700 : 400 }}>{(tr*100).toFixed(1)}%</th>)}
          </tr>
        </thead>
        <tbody>
          {sensData.map((row, ri) => (
            <tr key={ri}>
              <td style={{ padding: "8px 12px", fontSize: 11, color: discRates[ri] === discRate ? "#818cf8" : "#94a3b8", fontFamily: fonts.mono, fontWeight: discRates[ri] === discRate ? 700 : 400, borderBottom: ri < sensData.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>{(discRates[ri]*100).toFixed(1)}%</td>
              {row.map((val, ci) => {
                const isActive = discRates[ri] === discRate && termRates[ci] === termGrowth;
                return <td key={ci} style={{ padding: "8px 8px", fontSize: 11, fontFamily: fonts.mono, textAlign: "center", color: val == null ? "#334155" : val < 0 ? "#f87171" : "#cbd5e1", background: isActive ? "rgba(129,140,248,0.12)" : "transparent", fontWeight: isActive ? 700 : 400, borderBottom: ri < sensData.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", borderRadius: isActive ? 6 : 0 }}>{val != null ? `${(val*100).toFixed(1)}%` : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <SH>Projected FCF at Implied Growth</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Year", "Projected FCF", "Present Value"].map((h, i) => <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)", textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {projRows.map((row, i) => (
            <tr key={i} style={{ borderBottom: i < projRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "8px 12px", fontSize: 11, color: row.year === "Terminal" ? "#818cf8" : "#94a3b8", fontFamily: fonts.mono, fontWeight: row.year === "Terminal" ? 600 : 400 }}>{row.year === "Terminal" ? "Terminal Value" : `Year ${row.year}`}</td>
              <td style={{ padding: "8px 12px", fontSize: 12, color: "#cbd5e1", fontFamily: fonts.mono, textAlign: "right" }}>{fmtVal(row.fcf, "bigdollar")}</td>
              <td style={{ padding: "8px 12px", fontSize: 12, color: "#cbd5e1", fontFamily: fonts.mono, textAlign: "right" }}>{fmtVal(row.pv, "bigdollar")}</td>
            </tr>
          ))}
          {projRows.length > 0 && (
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "10px 12px", fontSize: 11, color: "#f1f5f9", fontFamily: fonts.mono, fontWeight: 700 }}>Total (= Mkt Cap)</td>
              <td />
              <td style={{ padding: "10px 12px", fontSize: 13, color: "#4ade80", fontFamily: fonts.mono, textAlign: "right", fontWeight: 700 }}>{fmtVal(projRows.reduce((s, r) => s + r.pv, 0), "bigdollar")}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>How to read this:</strong> The implied growth rate is the annual FCF growth the market is pricing into the current stock price, given your discount rate and terminal assumptions. If it's much higher than historical growth, the market has high expectations baked in. If lower, the stock may be undervalued — or the market sees risk to future cash flows.
    </InfoBox>
  </>);
}

// ── Vol Surface ──
function VolSurface({ symbol, spot: initialSpot }) {
  const [optData, setOptData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [optType, setOptType] = useState("C");
  const [surfaceView, setSurfaceView] = useState("heatmap");
  const [strikeRange, setStrikeRange] = useState(0.3);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [dteRange, setDteRange] = useState("all");
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    setLoading(true); setError(null);
    fetchOptionsChain(symbol)
      .then(d => { setOptData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [symbol]);

  const processed = useMemo(() => {
    if (!optData) return null;
    const spot = optData.spot || initialSpot || 100;
    const dteMax = dteRange === "30" ? 30 : dteRange === "90" ? 90 : dteRange === "180" ? 180 : dteRange === "365" ? 365 : dteRange === "leaps" ? 99999 : 99999;
    const dteMin = dteRange === "leaps" ? 365 : 0;
    const filtered = optData.options.filter(o => o.type === optType && Math.abs(o.strike - spot) / spot <= strikeRange && o.dte >= dteMin && o.dte <= dteMax);
    if (!filtered.length) return null;
    const expiries = [...new Set(filtered.map(o => o.dte))].sort((a, b) => a - b);
    const strikes = [...new Set(filtered.map(o => o.strike))].sort((a, b) => a - b);
    // Build IV grid
    const ivMap = {};
    filtered.forEach(o => { ivMap[`${o.dte}-${o.strike}`] = o.iv; });
    const ivGrid = expiries.map(dte => strikes.map(k => {
      const v = ivMap[`${dte}-${k}`];
      return v != null ? v * 100 : null;
    }));
    // ATM IV per expiry (term structure)
    const termStructure = expiries.map(dte => {
      const atm = filtered.filter(o => o.dte === dte).reduce((best, o) => !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best, null);
      return { dte, iv: atm ? atm.iv * 100 : null };
    }).filter(t => t.iv != null);
    // Smile for selected expiry
    const smileExpiry = selectedExpiry || (expiries.length > 2 ? expiries[Math.min(2, expiries.length - 1)] : expiries[0]);
    const smile = filtered.filter(o => o.dte === smileExpiry).sort((a, b) => a.strike - b.strike).map(o => ({ strike: o.strike, iv: o.iv * 100, oi: o.oi, moneyness: ((o.strike / spot - 1) * 100).toFixed(1) }));
    // Stats
    const allIVs = filtered.map(o => o.iv * 100).sort((a, b) => a - b);
    const atmIV = termStructure.length ? termStructure[0].iv : null;
    const totalOI = filtered.reduce((s, o) => s + (o.oi || 0), 0);
    const totalVol = filtered.reduce((s, o) => s + (o.vol || 0), 0);
    // IV Skew: compare OTM puts vs OTM calls
    const otmPuts = optData.options.filter(o => o.type === "P" && o.strike < spot * 0.95 && o.dte === smileExpiry);
    const otmCalls = optData.options.filter(o => o.type === "C" && o.strike > spot * 1.05 && o.dte === smileExpiry);
    const avgPutIV = otmPuts.length ? otmPuts.reduce((s, o) => s + o.iv, 0) / otmPuts.length * 100 : null;
    const avgCallIV = otmCalls.length ? otmCalls.reduce((s, o) => s + o.iv, 0) / otmCalls.length * 100 : null;
    const skew = avgPutIV != null && avgCallIV != null ? avgPutIV - avgCallIV : null;
    const ivMin = allIVs[0], ivMax = allIVs[allIVs.length - 1];
    return { spot, expiries, strikes, ivGrid, termStructure, smile, smileExpiry, atmIV, totalOI, totalVol, skew, ivMin, ivMax, filtered };
  }, [optData, optType, strikeRange, selectedExpiry, initialSpot, dteRange]);

  // Canvas heatmap drawing
  useEffect(() => {
    if (!processed || surfaceView !== "heatmap" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { strikes, expiries, ivGrid, ivMin, ivMax } = processed;
    const W = canvas.width = canvas.parentElement.clientWidth;
    const H = canvas.height = Math.max(300, expiries.length * 22 + 40);
    const padL = 70, padR = 60, padT = 10, padB = 30;
    const gW = W - padL - padR, gH = H - padT - padB;
    const cellW = gW / strikes.length, cellH = gH / expiries.length;
    ctx.fillStyle = "#141829"; ctx.fillRect(0, 0, W, H);
    // Draw cells
    for (let ei = 0; ei < expiries.length; ei++) {
      for (let si = 0; si < strikes.length; si++) {
        const iv = ivGrid[ei][si];
        if (iv == null) continue;
        const t = Math.min(1, Math.max(0, (iv - ivMin) / (ivMax - ivMin + 0.01)));
        const r = Math.round(30 + t * 225), g = Math.round(50 + (1 - Math.abs(t - 0.5) * 2) * 150), b = Math.round(255 - t * 200);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(padL + si * cellW, padT + ei * cellH, cellW - 1, cellH - 1);
      }
    }
    // X axis labels (strikes)
    ctx.fillStyle = "#64748b"; ctx.font = "9px JetBrains Mono, monospace"; ctx.textAlign = "center";
    const xStep = Math.max(1, Math.floor(strikes.length / 12));
    for (let i = 0; i < strikes.length; i += xStep) {
      ctx.fillText(`$${strikes[i]}`, padL + i * cellW + cellW / 2, H - 8);
    }
    // Y axis labels (DTE)
    ctx.textAlign = "right";
    for (let i = 0; i < expiries.length; i++) {
      ctx.fillText(`${expiries[i]}d`, padL - 6, padT + i * cellH + cellH / 2 + 3);
    }
    // Color legend
    const legX = W - padR + 10, legW = 12, legH = gH;
    for (let y = 0; y < legH; y++) {
      const t = 1 - y / legH;
      const r = Math.round(30 + t * 225), g = Math.round(50 + (1 - Math.abs(t - 0.5) * 2) * 150), b = Math.round(255 - t * 200);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(legX, padT + y, legW, 1);
    }
    ctx.fillStyle = "#94a3b8"; ctx.font = "8px JetBrains Mono, monospace"; ctx.textAlign = "left";
    ctx.fillText(`${ivMax?.toFixed(0)}%`, legX + legW + 4, padT + 8);
    ctx.fillText(`${ivMin?.toFixed(0)}%`, legX + legW + 4, padT + legH);
  }, [processed, surfaceView]);

  // Hover handler for canvas
  const handleCanvasMove = useCallback((e) => {
    if (!processed || !canvasRef.current || !tooltipRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const { strikes, expiries, ivGrid, spot } = processed;
    const padL = 70, padR = 60, padT = 10, padB = 30;
    const gW = canvas.width - padL - padR, gH = canvas.height - padT - padB;
    const si = Math.floor((x - padL) / (gW / strikes.length));
    const ei = Math.floor((y - padT) / (gH / expiries.length));
    const tip = tooltipRef.current;
    if (si >= 0 && si < strikes.length && ei >= 0 && ei < expiries.length && ivGrid[ei][si] != null) {
      tip.style.display = "block";
      tip.style.left = `${e.clientX - rect.left + 12}px`;
      tip.style.top = `${e.clientY - rect.top - 10}px`;
      const moneyness = ((strikes[si] / spot - 1) * 100).toFixed(1);
      tip.innerHTML = `<b>Strike:</b> $${strikes[si]} (${moneyness > 0 ? '+' : ''}${moneyness}%)<br/><b>DTE:</b> ${expiries[ei]} days<br/><b>IV:</b> ${ivGrid[ei][si].toFixed(1)}%`;
    } else { tip.style.display = "none"; }
  }, [processed]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading options chain for {symbol}...</div>;
  if (error) return <div style={{ textAlign: "center", padding: 40 }}><div style={{ color: "#f87171", marginBottom: 8 }}>Error: {error}</div><div style={{ color: "#64748b", fontSize: 11 }}>Options data unavailable for {symbol}. Try major tickers like SPY, AAPL, MSFT, QQQ, etc.</div></div>;
  if (!processed) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>No options data available for {symbol}.</div>;

  const { spot, expiries, strikes, ivGrid, termStructure, smile, smileExpiry, atmIV, totalOI, totalVol, skew, ivMin, ivMax } = processed;

  const smallBtnStyle = (active) => ({ background: active ? "#818cf8" : "rgba(255,255,255,0.05)", border: "1px solid " + (active ? "#818cf8" : "rgba(255,255,255,0.1)"), color: active ? "#0f172a" : "#94a3b8", padding: "4px 12px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, borderRadius: 6 });

  return (<>
    <SH>Options Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Spot Price" value={spot} color="#818cf8" format="plain" subtitle={`$${spot?.toFixed(2)}`} small />
      <RateCard label="ATM IV" value={atmIV} color="#3B82F6" subtitle={atmIV ? `${atmIV.toFixed(1)}%` : "—"} small />
      <RateCard label="IV Range" value={null} color="#10B981" format="plain" subtitle={ivMin != null ? `${ivMin.toFixed(0)}% – ${ivMax.toFixed(0)}%` : "—"} small />
      <RateCard label="Put/Call Skew" value={skew} color={skew > 0 ? "#F59E0B" : "#10B981"} subtitle={skew != null ? `${skew > 0 ? '+' : ''}${skew.toFixed(1)}pp` : "—"} small />
      <RateCard label="Total OI" value={totalOI} color="#8B5CF6" format="plain" subtitle={totalOI ? totalOI.toLocaleString() : "—"} small />
      <RateCard label="Expirations" value={expiries.length} color="#EC4899" format="plain" subtitle={expiries.length ? `${expiries[0]}d – ${expiries[expiries.length-1]}d` : "—"} small />
      <RateCard label="Total Volume" value={totalVol} color="#06B6D4" format="plain" subtitle={totalVol ? totalVol.toLocaleString() : "—"} small />
    </div>

    {/* Controls */}
    <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => setOptType("C")} style={smallBtnStyle(optType === "C")}>Calls</button>
        <button onClick={() => setOptType("P")} style={smallBtnStyle(optType === "P")}>Puts</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => setSurfaceView("heatmap")} style={smallBtnStyle(surfaceView === "heatmap")}>Heatmap</button>
        <button onClick={() => setSurfaceView("3d")} style={smallBtnStyle(surfaceView === "3d")}>3D Surface</button>
        <button onClick={() => setSurfaceView("chain")} style={smallBtnStyle(surfaceView === "chain")}>Options Chain</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Expiry:</span>
        {[["30", "≤30d"], ["90", "≤90d"], ["180", "≤6mo"], ["365", "≤1yr"], ["leaps", "LEAPS"], ["all", "All"]].map(([k, l]) => <button key={k} onClick={() => { setDteRange(k); setSelectedExpiry(null); }} style={smallBtnStyle(dteRange === k)}>{l}</button>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Strike Range:</span>
        {[0.15, 0.3, 0.5, 1.0].map(r => <button key={r} onClick={() => setStrikeRange(r)} style={smallBtnStyle(strikeRange === r)}>±{(r*100).toFixed(0)}%</button>)}
      </div>
    </div>

    <SH>Volatility Surface — {optType === "C" ? "Calls" : "Puts"}</SH>

    {surfaceView === "heatmap" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 16, marginBottom: 14, position: "relative" }}>
        <canvas ref={canvasRef} onMouseMove={handleCanvasMove} onMouseLeave={() => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; }} style={{ width: "100%", cursor: "crosshair" }} />
        <div ref={tooltipRef} style={{ display: "none", position: "absolute", background: "#0f172aee", border: "1px solid rgba(129,140,248,0.3)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, pointerEvents: "none", zIndex: 10, lineHeight: 1.6 }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "0 70px 0 0" }}>
          <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>Strike Price →</span>
          <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>← Days to Expiration (Y axis)</span>
        </div>
      </div>
    )}

    {surfaceView === "3d" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 8, marginBottom: 14 }}>
        <Plot
          data={[{
            type: "surface",
            x: strikes,
            y: expiries,
            z: ivGrid,
            colorscale: [[0, "#1e3a5f"], [0.25, "#2563eb"], [0.5, "#10b981"], [0.75, "#f59e0b"], [1, "#ef4444"]],
            hovertemplate: "Strike: $%{x}<br>DTE: %{y}d<br>IV: %{z:.1f}%<extra></extra>",
            contours: { z: { show: true, usecolormap: true, highlightcolor: "#fff", project: { z: true } } }
          }]}
          layout={{
            autosize: true, height: 450, margin: { l: 10, r: 10, t: 30, b: 10 },
            paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
            scene: {
              xaxis: { title: "Strike ($)", color: "#64748b", gridcolor: "rgba(255,255,255,0.06)", tickfont: { size: 9, color: "#64748b" } },
              yaxis: { title: "DTE", color: "#64748b", gridcolor: "rgba(255,255,255,0.06)", tickfont: { size: 9, color: "#64748b" } },
              zaxis: { title: "IV (%)", color: "#64748b", gridcolor: "rgba(255,255,255,0.06)", tickfont: { size: 9, color: "#64748b" } },
              bgcolor: "rgba(20,24,41,1)",
              camera: { eye: { x: 1.8, y: -1.5, z: 0.8 } }
            },
            font: { family: "JetBrains Mono, monospace", color: "#94a3b8" },
          }}
          config={{ responsive: true, displayModeBar: true, modeBarButtonsToRemove: ["toImage", "sendDataToCloud"], displaylogo: false }}
          style={{ width: "100%", height: 450 }}
        />
      </div>
    )}

    {/* Options chain table */}
    {surfaceView === "chain" && (() => {
      const chainExpiry = selectedExpiry || smileExpiry;
      const chainData = processed.filtered.filter(o => o.dte === chainExpiry).sort((a, b) => a.strike - b.strike);
      const cols = [
        { key: "strike", label: "Strike", fmt: v => `$${v}`, align: "left", highlight: true },
        { key: "lastPrice", label: "Last", fmt: v => v != null ? `$${v.toFixed(2)}` : "—" },
        { key: "bid", label: "Bid", fmt: v => v != null ? `$${v.toFixed(2)}` : "—" },
        { key: "ask", label: "Ask", fmt: v => v != null ? `$${v.toFixed(2)}` : "—" },
        { key: "iv", label: "IV", fmt: v => v != null ? `${(v * 100).toFixed(1)}%` : "—" },
        { key: "vol", label: "Volume", fmt: v => v != null ? v.toLocaleString() : "—" },
        { key: "oi", label: "Open Int", fmt: v => v != null ? v.toLocaleString() : "—" },
        { key: "delta", label: "Delta", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "gamma", label: "Gamma", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "theta", label: "Theta", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "vega", label: "Vega", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "rho", label: "Rho", fmt: v => v != null ? v.toFixed(4) : "—" },
      ];
      return (<>
        <SH>Options Chain — {chainExpiry} DTE ({optType === "C" ? "Calls" : "Puts"})</SH>
        <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
          {expiries.map(dte => {
            const d = new Date(Date.now() + dte * 86400000);
            const label = dte <= 7 ? `${dte}d` : `${(d.getMonth()+1)}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
            const isLeap = dte > 365;
            return <button key={dte} onClick={() => setSelectedExpiry(dte)} style={{ ...smallBtnStyle((selectedExpiry || smileExpiry) === dte), ...(isLeap ? { borderColor: "rgba(245,158,11,0.4)" } : {}) }}>{label}{isLeap ? " ★" : ""}</button>;
          })}
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>{cols.map(c => <th key={c.key} style={{ padding: "10px 8px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: c.align || "right", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {chainData.map(o => {
                const isATM = Math.abs(o.strike - spot) / spot < 0.01;
                return (
                  <tr key={o.sym} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: isATM ? "rgba(129,140,248,0.08)" : "transparent" }}>
                    {cols.map(c => <td key={c.key} style={{ padding: "7px 8px", fontSize: 11, color: c.highlight ? (isATM ? "#818cf8" : "#f1f5f9") : "#cbd5e1", fontFamily: fonts.mono, textAlign: c.align || "right", fontWeight: c.highlight ? 600 : 400, whiteSpace: "nowrap" }}>{c.fmt(o[c.key])}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {chainData.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 11 }}>No options at this expiration.</div>}
        </div>
      </>);
    })()}

    {/* Smile chart */}
    <SH>Volatility Smile — {smileExpiry} DTE</SH>
    <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
      {expiries.map(dte => {
        const d = new Date(Date.now() + dte * 86400000);
        const label = dte <= 7 ? `${dte}d` : `${(d.getMonth()+1)}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
        return <button key={dte} onClick={() => setSelectedExpiry(dte)} style={smallBtnStyle((selectedExpiry || smileExpiry) === dte)}>{label}</button>;
      })}
    </div>
    {smile.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={smile} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs><linearGradient id="g-smile" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} /><stop offset="95%" stopColor="#818cf8" stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="strike" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={v => `$${v}`} interval={Math.max(0, Math.floor(smile.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} formatter={(v, n) => [`${v.toFixed(1)}%`, "IV"]} labelFormatter={v => `Strike: $${v}`} />
            <ReferenceLine x={spot} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" label={{ value: "ATM", fill: "#64748b", fontSize: 9 }} />
            <Area type="monotone" dataKey="iv" stroke="#818cf8" fill="url(#g-smile)" strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Term structure */}
    <SH>Term Structure — ATM IV by Expiration</SH>
    {termStructure.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={termStructure} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs><linearGradient id="g-term" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="dte" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={v => `${v}d`} interval={Math.max(0, Math.floor(termStructure.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} formatter={(v) => [`${v.toFixed(1)}%`, "ATM IV"]} labelFormatter={v => `${v} DTE`} />
            <Area type="monotone" dataKey="iv" stroke="#10B981" fill="url(#g-term)" strokeWidth={2} dot={{ r: 3, fill: "#10B981", strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>Reading the Vol Surface:</strong> The <strong>smile</strong> (strike axis) shows IV is typically higher for OTM puts (crash protection premium). The <strong>term structure</strong> (time axis) normally slopes up — if it's inverted (near-term IV higher), expect an imminent catalyst like earnings or FOMC. <strong>Humps</strong> in the surface indicate where dealers are heavily hedging or where event risk is concentrated.
    </InfoBox>
  </>);
}

function StockDetailView({ data, onBack }) {
  const { symbol, years, prof } = data;
  const [viewMode, setViewMode] = useState("ratios");
  const [descExpanded, setDescExpanded] = useState(false);
  const toggleBtnStyle = (active) => ({ background: active ? "#818cf8" : "rgba(255,255,255,0.05)", border: "1px solid " + (active ? "#818cf8" : "rgba(255,255,255,0.1)"), color: active ? "#0f172a" : "#94a3b8", padding: "8px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, transition: "all 0.15s ease" });
  return (<>
    <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <button onClick={onBack} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 16px", color: "#818cf8", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, display: "flex", alignItems: "center", gap: 6 }}>
        ← Back to Screener
      </button>
      <div style={{ marginLeft: "auto", display: "flex", borderRadius: 8, overflow: "hidden" }}>
        <button onClick={() => setViewMode("ratios")} style={{ ...toggleBtnStyle(viewMode === "ratios"), borderRadius: "8px 0 0 8px" }}>Key Ratios</button>
        <button onClick={() => setViewMode("dcf")} style={{ ...toggleBtnStyle(viewMode === "dcf"), borderRadius: 0 }}>Reverse DCF</button>
        <button onClick={() => setViewMode("vol")} style={{ ...toggleBtnStyle(viewMode === "vol"), borderRadius: "0 8px 8px 0" }}>Vol Surface</button>
      </div>
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>
        {prof?.companyName || symbol}
        <span style={{ color: "#818cf8", fontSize: 14, fontWeight: 600, marginLeft: 10, fontFamily: fonts.mono }}>{symbol}</span>
      </div>
      {prof && <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 4 }}>{prof.sector}{prof.industry ? ` — ${prof.industry}` : ""}{prof.mktCap ? ` | Mkt Cap: ${fmtVal(prof.mktCap, "bigdollar")}` : ""}</div>}
      {prof?.description && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, maxHeight: descExpanded ? "none" : 60, overflow: "hidden", transition: "max-height 0.3s ease" }}>{prof.description}</div>
          <span onClick={() => setDescExpanded(p => !p)} style={{ fontSize: 10, color: "#818cf8", cursor: "pointer", fontFamily: fonts.mono, marginTop: 4, display: "inline-block" }}>{descExpanded ? "Show less ▲" : "Show more ▼"}</span>
        </div>
      )}
    </div>
    {/* Quote / Trading Info Panel */}
    {data.quote && (() => {
      const q = data.quote;
      const chg = q.change ?? 0;
      const chgPct = q.changePercentage ?? q.changesPercentage ?? 0;
      const isUp = chg >= 0;
      const chgColor = isUp ? "#4ade80" : "#f87171";
      const statCell = (label, val) => (
        <div key={label} style={{ padding: "8px 0" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12, color: "#cbd5e1", fontFamily: fonts.mono, fontWeight: 500 }}>{val}</div>
        </div>
      );
      const fmtNum = (n) => n != null && !isNaN(n) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
      const fmtBig = (n) => { if (n == null) return "—"; const a = Math.abs(n); if (a >= 1e12) return `$${(n/1e12).toFixed(2)}T`; if (a >= 1e9) return `$${(n/1e9).toFixed(2)}B`; if (a >= 1e6) return `$${(n/1e6).toFixed(2)}M`; return `$${fmtNum(n)}`; };
      const fmtVol = (n) => { if (n == null) return "—"; if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`; return n.toLocaleString(); };
      return (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
          {/* Price row */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono }}>${fmtNum(q.price)}</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: chgColor, fontFamily: fonts.mono }}>
              {isUp ? "+" : ""}{chg.toFixed(2)} ({isUp ? "+" : ""}{chgPct.toFixed(2)}%)
            </span>
            {q.timestamp && <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>{new Date(q.timestamp * 1000).toLocaleString()}</span>}
          </div>
          {/* Mini price chart */}
          {data.hist && data.hist.length > 1 && (
            <div style={{ margin: "16px 0 12px" }}>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={data.hist} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chgColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={chgColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={["dataMin", "dataMax"]} hide />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.mono }} labelStyle={{ color: "#94a3b8" }} formatter={(v) => [`$${Number(v).toFixed(2)}`, "Price"]} />
                  <Area type="monotone" dataKey="close" stroke={chgColor} fill="url(#priceGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 2 }}>
                <span>{data.hist[0]?.date}</span>
                <span style={{ color: "#64748b" }}>90-Day Price History</span>
                <span>{data.hist[data.hist.length - 1]?.date}</span>
              </div>
            </div>
          )}
          {/* Trading stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0 24px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, marginTop: 8 }}>
            {statCell("Open", `$${fmtNum(q.open)}`)}
            {statCell("Prev Close", `$${fmtNum(q.previousClose)}`)}
            {statCell("Day Range", `$${fmtNum(q.dayLow)} – $${fmtNum(q.dayHigh)}`)}
            {statCell("52-Wk Range", `$${fmtNum(q.yearLow)} – $${fmtNum(q.yearHigh)}`)}
            {statCell("Volume", fmtVol(q.volume))}
            {statCell("Avg Volume", fmtVol(q.avgVolume ?? prof?.volAvg))}
            {statCell("Market Cap", fmtBig(q.marketCap ?? prof?.mktCap))}
            {statCell("P/E", fmtNum(q.pe ?? data.rat?.[data.rat.length-1]?.priceToEarningsRatio))}
            {statCell("EPS", `$${fmtNum(q.eps ?? data.inc?.[data.inc.length-1]?.epsDiluted)}`)}
            {statCell("50-Day Avg", `$${fmtNum(q.priceAvg50 ?? prof?.priceAvg50)}`)}
            {statCell("200-Day Avg", `$${fmtNum(q.priceAvg200 ?? prof?.priceAvg200)}`)}
          </div>
        </div>
      );
    })()}
    {viewMode === "dcf" && <ReverseDCF data={data} />}
    {viewMode === "vol" && <VolSurface symbol={data.symbol} spot={data.price} />}
    {viewMode === "ratios" && (<>
      <ProfitSankey data={data} />
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
            <tr>
              <th style={{ padding: "10px 14px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: "left", borderBottom: "2px solid rgba(129,140,248,0.3)", background: "#0f1225", position: "sticky", left: 0, minWidth: 200, zIndex: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>Metric</th>
              {years.map(y => <th key={y} style={{ padding: "10px 8px", fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, textAlign: "right", borderBottom: "2px solid rgba(129,140,248,0.3)", background: "#0f1225", minWidth: 80, letterSpacing: 0.3 }}>{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {DETAIL_SECTIONS.map((section, si) => (<React.Fragment key={section.title}>
              {/* Section header row */}
              <tr>
                <td colSpan={years.length + 1} style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#818cf8", fontFamily: fonts.heading, background: "rgba(129,140,248,0.06)", borderTop: si > 0 ? "2px solid rgba(129,140,248,0.15)" : "none", borderBottom: "1px solid rgba(129,140,248,0.1)", letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {section.title}
                </td>
              </tr>
              {/* Data rows */}
              {section.rows.map((row, ri) => {
                const isIndented = row.label.startsWith("  ");
                const isGrowth = row.isGrowth;
                const label = isIndented ? row.label.trim() : row.label;
                return (
                  <tr key={`${section.title}-${ri}`} style={{ borderBottom: isGrowth ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(255,255,255,0.03)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: isGrowth ? "3px 14px 3px 38px" : isIndented ? "6px 14px 6px 28px" : "6px 14px", fontSize: isGrowth ? 10 : 11, color: isGrowth ? "#6366f1" : isIndented ? "#64748b" : "#94a3b8", fontFamily: isGrowth ? fonts.mono : fonts.heading, fontWeight: isGrowth ? 400 : isIndented ? 400 : 500, fontStyle: isGrowth ? "italic" : "normal", position: "sticky", left: 0, background: "#161a30", zIndex: 1, whiteSpace: "nowrap" }}>{label}</td>
                    {years.map((y, yi) => { const val = row.get(data, yi); return (
                      <td key={y} style={{ padding: isGrowth ? "3px 8px" : "6px 8px", fontSize: isGrowth ? 10 : 11, color: isGrowth ? (val != null && val < 0 ? "#f87171" : val != null && val > 0 ? "#4ade80" : "#475569") : (val != null && val < 0 ? "#f87171" : "#cbd5e1"), fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap" }}>{fmtVal(val, row.fmt)}</td>
                    ); })}
                  </tr>
                );
              })}
            </React.Fragment>))}
          </tbody>
        </table>
      </div>
    </>)}
  </>);
}

function StocksTab({ fmpKey }) {
  const [tickers, setTickers] = useState(() => {
    try { const saved = localStorage.getItem("econ-dash-tickers"); return saved ? JSON.parse(saved) : DEFAULT_TICKERS; } catch { return DEFAULT_TICKERS; }
  });
  const [input, setInput] = useState("");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stockView, setStockView] = useState("screener"); // "screener" | "csp"

  const loadData = useCallback(async () => {
    if (!fmpKey) { setError("Enter your FMP API key above to load stock data."); return; }
    setLoading(true); setError("");
    const results = [];
    for (const t of tickers) {
      try { const r = await fetchStockData(t, fmpKey); if (r) results.push(r); } catch (e) { console.error(`Error fetching ${t}:`, e); }
    }
    setData(results);
    setLoading(false);
    if (!results.length) setError("No data returned. Check your FMP key or ticker symbols.");
  }, [fmpKey, tickers]);

  // Persist tickers to localStorage
  useEffect(() => {
    try { localStorage.setItem("econ-dash-tickers", JSON.stringify(tickers)); } catch {}
  }, [tickers]);

  // Auto-load on mount
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (fmpKey && tickers.length && !hasLoaded.current) {
      hasLoaded.current = true;
      loadData();
    }
  }, [fmpKey, tickers, loadData]);

  const addTicker = () => {
    const t = input.trim().toUpperCase();
    if (t && !tickers.includes(t)) { setTickers(prev => [...prev, t]); setInput(""); }
  };

  const removeTicker = (t) => { setTickers(prev => prev.filter(x => x !== t)); setData(prev => prev.filter(x => x.symbol !== t)); };

  const sorted = [...data].sort((a, b) => {
    if (!sortCol) return 0;
    const av = a[sortCol], bv = b[sortCol];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return -1;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const toggleSort = (col) => {
    if (sortCol === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortCol(col); setSortDir("desc"); }
  };

  const openDetail = async (symbol) => {
    setDetailSymbol(symbol);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const d = await fetchStockDetail(symbol, fmpKey);
      setDetailData(d);
    } catch (e) { console.error("Detail fetch error:", e); }
    setDetailLoading(false);
  };

  const closeDetail = () => { setDetailSymbol(null); setDetailData(null); };

  if (detailSymbol) {
    return (<>
      {detailLoading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Loading {detailSymbol} details…</div>
          <div style={{ fontSize: 12, color: "#475569" }}>Fetching 20 years of financial data (8 API calls)</div>
        </div>
      ) : detailData ? (
        <StockDetailView data={detailData} onBack={closeDetail} />
      ) : (
        <div style={{ textAlign: "center", padding: 60, color: "#f87171", fontFamily: fonts.heading }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Failed to load data for {detailSymbol}</div>
          <button onClick={closeDetail} style={{ background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 12, cursor: "pointer", fontFamily: fonts.heading }}>← Back to Screener</button>
        </div>
      )}
    </>);
  }

  // View toggle
  const viewToggle = (
    <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", marginBottom: 16, background: "rgba(255,255,255,0.03)", padding: 3 }}>
      {[["screener", "📊 Stock Screener"], ["csp", "💰 Cash-Secured Puts"]].map(([id, label]) => (
        <button key={id} onClick={() => setStockView(id)} style={{
          flex: 1, padding: "10px 16px", border: "none", borderRadius: 8,
          background: stockView === id ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
          color: stockView === id ? "#f1f5f9" : "#64748b", fontSize: 12, fontWeight: stockView === id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.2s",
          boxShadow: stockView === id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
        }}>{label}</button>
      ))}
    </div>
  );

  // Shared ticker management (visible on both screener and CSP views)
  const tickerBar = (<>
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="Add ticker (e.g. COST)"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, outline: "none", width: 140 }} />
      <button onClick={addTicker} style={{ background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading }}>Add</button>
      {stockView === "screener" && (
        <button onClick={loadData} disabled={loading} style={{ background: "#E8553A", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: fonts.heading, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading..." : "Fetch Data"}
        </button>
      )}
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {tickers.map(t => (
        <span key={t} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#c7d2fe", display: "flex", alignItems: "center", gap: 6 }}>
          {t}
          <span onClick={() => removeTicker(t)} style={{ cursor: "pointer", color: "#f87171", fontWeight: 700, fontSize: 13 }}>×</span>
        </span>
      ))}
    </div>
  </>);

  if (stockView === "csp") {
    return (<>
      {viewToggle}
      {tickerBar}
      <CSPScreener tickers={tickers} />
    </>);
  }

  return (<>
    {viewToggle}
    {tickerBar}
    <SH>Stock Fundamentals Screener</SH>
    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Powered by Financial Modeling Prep.</strong> Screener uses ~6 calls per ticker. Detail view fetches 20 years of financials, price history, and full quote data (8 calls). Data auto-loads on page visit.
    </InfoBox>

    {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{error}</div>}

    {/* Data table */}
    {sorted.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              {STOCK_COLS.map(col => (
                <th key={col.key} onClick={() => col.key !== "symbol" && toggleSort(col.key)}
                  style={{ padding: "10px 8px", fontSize: 10, color: sortCol === col.key ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: col.key === "symbol" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: col.key !== "symbol" ? "pointer" : "default", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#141829", width: col.width }}>
                  {col.label}{sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr key={row.symbol} style={{ borderBottom: ri < sorted.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {STOCK_COLS.map(col => (
                  <td key={col.key} style={{ padding: "10px 8px", fontSize: 12, fontFamily: col.key === "symbol" ? fonts.mono : fonts.heading, color: col.key === "symbol" ? "#818cf8" : "#cbd5e1", textAlign: col.key === "symbol" ? "left" : "right", fontWeight: col.key === "symbol" ? 600 : 400, whiteSpace: "nowrap" }}>
                    {col.key === "symbol" ? (
                      <span onClick={() => openDetail(row.symbol)} style={{ cursor: "pointer", borderBottom: "1px dashed rgba(129,140,248,0.4)", paddingBottom: 1 }}
                        onMouseEnter={e => e.target.style.color = "#a5b4fc"} onMouseLeave={e => e.target.style.color = "#818cf8"}>
                        {row.symbol}
                      </span>
                    ) : fmtVal(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {sorted.length > 0 && (
      <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 10 }}>
        Click column headers to sort. ROIC uses NOPAT (operating income × 0.79) / invested capital. SBC/Rev = stock-based compensation as % of revenue.
      </div>
    )}
  </>);
}


export default StocksTab;
