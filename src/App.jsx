import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { fonts, cardBg, cardBorder } from "./lib/styles.js";
import { US_MORTGAGE_SERIES, GLOBAL_RATE_SERIES, TREASURY_SERIES, CPI_SERIES, CPI_COMPONENTS, PCE_COMPONENTS, HOUSING_SERIES, CONSUMER_SERIES, CHOROPLETH_METRICS, CHOROPLETH_SNAPSHOT, ALL_STATES } from "./lib/constants.js";
import FB from "./lib/fallbackData.js";
import { fetchFred, fetchFMP, fetchFMPTreasuryRates, fetchFMPMortgageRates, fetchFMPCPI, fetchOpenRouterModels, fetchOpenRouterRankings, fetchFMPPremiumNews, fetchZillowData } from "./lib/api.js";
import NewsTicker from "./components/NewsTicker.jsx";
import TickerSearch from "./components/TickerSearch.jsx";
import USEconomyTab from "./tabs/USEconomyTab.jsx";
import InternationalTab from "./tabs/InternationalTab.jsx";
import StocksTab from "./tabs/StocksTab.jsx";
import RealEstateTab from "./tabs/RealEstateTab.jsx";
import OptionsTab from "./tabs/OptionsTab.jsx";
import OverviewTab from "./tabs/OverviewTab.jsx";
import HistoricalReturnsTab from "./tabs/HistoricalReturnsTab.jsx";
import ForecastsTab from "./tabs/ForecastsTab.jsx";
import AIEconomyTab from "./tabs/AIEconomyTab.jsx";
import CommoditiesTab from "./tabs/CommoditiesTab.jsx";
import ChatDrawer from "./components/ChatDrawer.jsx";
import DataHealthPanel from "./components/DataHealthPanel.jsx";
import { collectLatestDate, sourceStatus } from "./lib/dataHealth.js";

export default function Dashboard() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("econ-dash-theme") !== "light"; } catch { return true; }
  });

  // Apply CSS variables to :root whenever darkMode changes - runs before paint to avoid flash
  useLayoutEffect(() => {
    const r = document.documentElement;
    if (darkMode) {
      r.style.setProperty("--page-bg",          "#0c0f1a");
      r.style.setProperty("--card-bg",           "linear-gradient(145deg, #1a1a2e 0%, #16213e 100%)");
      r.style.setProperty("--card-border",       "1px solid rgba(255,255,255,0.06)");
      r.style.setProperty("--text-primary",      "#f1f5f9");
      r.style.setProperty("--text-secondary",    "#94a3b8");
      r.style.setProperty("--text-muted",        "#64748b");
      r.style.setProperty("--border-subtle",     "rgba(255,255,255,0.06)");
      r.style.setProperty("--bg-subtle",         "rgba(255,255,255,0.03)");
      r.style.setProperty("--tab-active-bg",     "linear-gradient(135deg, #1e293b, #1a1a2e)");
      r.style.setProperty("--tab-active-color",  "#f1f5f9");
      r.style.setProperty("--tab-inactive-color","#64748b");
      r.style.setProperty("--toggle-bg",         "rgba(255,255,255,0.07)");
      r.style.setProperty("--toggle-border",     "rgba(255,255,255,0.14)");
      r.style.setProperty("--toggle-color",      "#94a3b8");
      r.style.setProperty("--status-input-bg",   "rgba(255,255,255,0.05)");
      r.style.setProperty("--status-input-border","rgba(255,255,255,0.1)");
      r.style.setProperty("--tooltip-bg",        "#0f172a");
    } else {
      r.style.setProperty("--page-bg",          "#f0f4f8");
      r.style.setProperty("--card-bg",           "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)");
      r.style.setProperty("--card-border",       "1px solid rgba(0,0,0,0.09)");
      r.style.setProperty("--text-primary",      "#0f172a");
      r.style.setProperty("--text-secondary",    "#1e293b");
      r.style.setProperty("--text-muted",        "#334155");
      r.style.setProperty("--border-subtle",     "rgba(0,0,0,0.10)");
      r.style.setProperty("--bg-subtle",         "rgba(0,0,0,0.04)");
      r.style.setProperty("--tab-active-bg",     "linear-gradient(135deg, #e8edf5, #ffffff)");
      r.style.setProperty("--tab-active-color",  "#0f172a");
      r.style.setProperty("--tab-inactive-color","#334155");
      r.style.setProperty("--toggle-bg",         "rgba(0,0,0,0.06)");
      r.style.setProperty("--toggle-border",     "rgba(0,0,0,0.13)");
      r.style.setProperty("--toggle-color",      "#334155");
      r.style.setProperty("--status-input-bg",   "rgba(0,0,0,0.05)");
      r.style.setProperty("--status-input-border","rgba(0,0,0,0.1)");
      r.style.setProperty("--tooltip-bg",        "#ffffff");
    }
    try { localStorage.setItem("econ-dash-theme", darkMode ? "dark" : "light"); } catch {}
  }, [darkMode]);

  const [fredKey, setFredKey] = useState(import.meta.env.VITE_FRED_KEY || ""); const [fmpKey, setFmpKey] = useState(import.meta.env.VITE_FMP_KEY || "");
  const [fredStatus, setFredStatus] = useState("idle"); const [isLive, setIsLive] = useState(false);
  const [tab, setTab] = useState("overview");
  const [marketStrip, setMarketStrip] = useState(null);   // SPY / 10Y / VIX for the persistent top strip
  const [pendingTicker, setPendingTicker] = useState(null); // global ticker search → opens in Stocks

  // Persistent market strip: SPY / 10Y / VIX, refreshed every 60s
  useEffect(() => {
    let alive = true;
    const pull = () => fetch("/api/dashboard-summary").then(r => r.ok ? r.json() : null).then(d => {
      if (!alive || !d) return;
      const idx = d.indexes || [], rt = d.rates || [];
      const spy = idx.find(x => x.symbol === "SPY");
      const vix = idx.find(x => x.symbol === "^VIX" || x.symbol === "VIX");
      const y10 = rt.find(x => x.id === "DGS10");
      setMarketStrip({ spy, vix, tenYear: y10?.value });
    }).catch(() => {});
    pull();
    const t = setInterval(pull, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const goTicker = (sym) => {
    const s = (sym || "").trim().toUpperCase();
    if (!s) return;
    setTab("stocks");
    setPendingTicker(s);
  };
  const [md, setMd] = useState(FB.mortgage); const [gd, setGd] = useState(FB.global);
  const [td, setTd] = useState(FB.treasury); const [cd, setCd] = useState(FB.cpi); const [hd, setHd] = useState(FB.housing);
  const [csm, setCsm] = useState(FB.consumer);
  const [aiModels, setAiModels] = useState([]); const [aiLoading, setAiLoading] = useState(false);
  const [rankingsData, setRankingsData] = useState([]); const [rankingsLoading, setRankingsLoading] = useState(false);
  const [newsItems, setNewsItems] = useState([]); const [newsLoading, setNewsLoading] = useState(false);
  const [zillowData, setZillowData] = useState(null);
  const [choroplethMetric, setChoroplethMetric] = useState("unemployment");
  const [choroplethCache, setChoroplethCache] = useState(() => {
    // Start with bundled snapshot, overlay any fresher localStorage data
    const base = { ...CHOROPLETH_SNAPSHOT };
    try {
      const s = localStorage.getItem("choroplethCache_v2");
      if (s) {
        const parsed = JSON.parse(s);
        for (const [k, v] of Object.entries(parsed)) {
          if (Object.keys(v).filter(sk => sk !== "_national").length >= 40) base[k] = v;
        }
      }
    } catch {}
    return base;
  });
  const [choroplethLoading, setChoroplethLoading] = useState(false);
  const [choroplethProgress, setChoroplethProgress] = useState("");

  const choroplethCacheRef = useRef((() => {
    const base = { ...CHOROPLETH_SNAPSHOT };
    try {
      const s = localStorage.getItem("choroplethCache_v2");
      if (s) {
        const parsed = JSON.parse(s);
        for (const [k, v] of Object.entries(parsed)) {
          if (Object.keys(v).filter(sk => sk !== "_national").length >= 40) base[k] = v;
        }
      }
    } catch {}
    return base;
  })());
  const fredReadyRef = useRef(null); // resolves when main FRED fetch is done
  const freshlyFetchedRef = useRef({}); // tracks which metrics have been fetched live from API this session
  const fetchChoroplethData = useCallback(async (metricKey, { background = false } = {}) => {
    if (!fredKey) return;
    // Wait for main FRED data to finish loading first to avoid rate limits
    if (fredReadyRef.current) await fredReadyRef.current;
    // Skip if already fetched live from API this session
    if (freshlyFetchedRef.current[metricKey]) return;
    // Skip if we have good cached/localStorage data and this isn't a background refresh
    if (!background) {
      const cached = choroplethCacheRef.current[metricKey];
      if (cached && Object.keys(cached).filter(k => k !== "_national").length >= 40) return;
    }
    const metric = CHOROPLETH_METRICS.find(m => m.key === metricKey);
    if (!metric) return;
    // Zillow-sourced metrics are populated via CSV fetch, not FRED API
    if (metric.source === "zillow") return;
    if (!background) { setChoroplethLoading(true); setChoroplethProgress("Loading 0/" + ALL_STATES.length); }
    const results = {};
    let done = 0;
    // Fetch helper for a list of states in batches
    const BATCH = 5, DELAY = 1200;
    const fetchBatch = async (states) => {
      for (let i = 0; i < states.length; i += BATCH) {
        const batch = states.slice(i, i + BATCH);
        await Promise.all(batch.map(async (st) => {
          try {
            const obs = await fetchFred(metric.series(st), fredKey, metric.limit || 1);
            const v = metric.transform ? metric.transform(obs) : (obs.length ? obs[obs.length - 1].v : null);
            if (v != null && isFinite(v)) results[st] = { v, d: obs[obs.length - 1].d };
          } catch (e) { console.warn(`Choropleth fetch failed for ${st}:`, e.message); }
        }));
        done += batch.length;
        if (!background) setChoroplethProgress(`Loading ${done}/${ALL_STATES.length}`);
        if (i + BATCH < states.length) await new Promise(r => setTimeout(r, DELAY));
      }
    };
    // First pass
    await fetchBatch(ALL_STATES);
    // Retry pass for any states that failed
    const failed = ALL_STATES.filter(st => !results[st]);
    if (failed.length > 0 && failed.length < ALL_STATES.length) {
      console.log(`Retrying ${failed.length} failed states: ${failed.join(",")}`);
      if (!background) setChoroplethProgress(`Retrying ${failed.length} states...`);
      await new Promise(r => setTimeout(r, 2000)); // extra cooldown before retry
      done = ALL_STATES.length - failed.length;
      await fetchBatch(failed);
    }
    // Fetch national benchmark
    if (metric.national) {
      try {
        const nObs = await fetchFred(metric.national, fredKey, metric.limit || 1);
        const nv = metric.transform ? metric.transform(nObs) : (nObs.length ? nObs[nObs.length - 1].v : null);
        if (nv != null && isFinite(nv)) results._national = { v: nv, d: nObs[nObs.length - 1].d };
      } catch {}
    }
    freshlyFetchedRef.current[metricKey] = true;
    choroplethCacheRef.current[metricKey] = results;
    setChoroplethCache(prev => {
      const next = { ...prev, [metricKey]: results };
      try { localStorage.setItem("choroplethCache_v2", JSON.stringify(next)); } catch {}
      return next;
    });
    setChoroplethLoading(false);
    setChoroplethProgress("");
  }, [fredKey]);

  // Auto-fetch OpenRouter models + rankings on mount
  useEffect(() => {
    setAiLoading(true);
    fetchOpenRouterModels().then(setAiModels).catch(e => console.error("OpenRouter fetch error:", e)).finally(() => setAiLoading(false));
    setRankingsLoading(true);
    fetchOpenRouterRankings().then(setRankingsData).catch(e => console.error("OpenRouter rankings error:", e)).finally(() => setRankingsLoading(false));
  }, []);

  // Fetch premium news (WSJ/CNBC/Reuters/… via FMP) on mount, refresh every 30 min
  useEffect(() => {
    if (!fmpKey) return;
    const load = () => {
      setNewsLoading(true);
      fetchFMPPremiumNews(fmpKey).then(setNewsItems).catch(e => console.error("News fetch error:", e)).finally(() => setNewsLoading(false));
    };
    load();
    const interval = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fmpKey]);

  // Fetch Zillow CSV data on mount and populate choropleth cache
  useEffect(() => {
    fetchZillowData().then(zd => {
      setZillowData(zd);
      // Populate choropleth cache with Zillow state-level data
      if (zd.states?.zhvi) {
        const zhviResults = {};
        for (const [st, data] of Object.entries(zd.states.zhvi)) {
          zhviResults[st] = { v: data.v, d: data.d };
        }
        // Add national benchmark from metro data
        if (zd.national?.zhvi) zhviResults._national = { v: zd.national.zhvi.current, d: zd.national.zhvi.lastDate };
        choroplethCacheRef.current.zillowHomeValue = zhviResults;
        freshlyFetchedRef.current.zillowHomeValue = true;
        setChoroplethCache(prev => {
          const next = { ...prev, zillowHomeValue: zhviResults };
          try { localStorage.setItem("choroplethCache_v2", JSON.stringify(next)); } catch {}
          return next;
        });
      }
      if (zd.states?.inventory) {
        const invResults = {};
        for (const [st, data] of Object.entries(zd.states.inventory)) {
          invResults[st] = { v: data.v, d: data.d };
        }
        if (zd.national?.inventory) invResults._national = { v: zd.national.inventory.current, d: zd.national.inventory.lastDate };
        choroplethCacheRef.current.zillowInventory = invResults;
        freshlyFetchedRef.current.zillowInventory = true;
        setChoroplethCache(prev => {
          const next = { ...prev, zillowInventory: invResults };
          try { localStorage.setItem("choroplethCache_v2", JSON.stringify(next)); } catch {}
          return next;
        });
      }
    }).catch(e => console.error("Zillow fetch error:", e));
  }, []);

  const fetchFredData = useCallback(async () => {
    if (!fredKey) return; setFredStatus("loading");
    try {
      const fb = async (map, set, gv, lim = 10) => { const r = {}; for (const id of Object.keys(map)) { try { const o = await fetchFred(id, fredKey, lim); if (o.length) r[id] = gv(o); } catch {} } if (Object.keys(r).length) set(p => ({ ...p, ...r })); };
      await fb(US_MORTGAGE_SERIES, setMd, o => ({ current: o[o.length-1].v, lastDate: o[o.length-1].d, history: o }), 52);
      await fb(GLOBAL_RATE_SERIES, setGd, o => ({ current: o[o.length-1].v, lastDate: o[o.length-1].d }), 30);
      await fb(TREASURY_SERIES, setTd, o => ({ current: o[o.length-1].v, lastDate: o[o.length-1].d, history: o }), 120);
      const cr = {};
      for (const [id, m] of Object.entries(CPI_SERIES)) {
        try {
          const o = await fetchFred(id, fredKey, m.isIndex ? 24 : 10);
          if (m.isIndex && o.length >= 13) { const h = []; for (let i = 12; i < o.length; i++) h.push({ d: o[i].d, v: parseFloat((((o[i].v - o[i-12].v) / o[i-12].v) * 100).toFixed(1)) }); cr[id] = { yoy: h[h.length-1]?.v, lastDate: h[h.length-1]?.d, history: h }; }
          else if (!m.isIndex && o.length) cr[id] = { current: o[o.length-1].v, lastDate: o[o.length-1].d, history: o };
        } catch {}
      }
      // Fetch CPI & PCE component breakdowns (monthly + quarterly index -> YoY %)
      const compSeries = { ...CPI_COMPONENTS, ...PCE_COMPONENTS };
      const compEntries = Object.entries(compSeries);
      const COMP_BATCH = 5;
      for (let b = 0; b < compEntries.length; b += COMP_BATCH) {
        const batch = compEntries.slice(b, b + COMP_BATCH);
        const results = await Promise.all(batch.map(async ([id, meta]) => {
          try {
            const isQ = meta.freq === "Q";
            const o = await fetchFred(id, fredKey, isQ ? 12 : 24);
            const lookback = isQ ? 4 : 12;
            const minLen = lookback + 1;
            if (o.length >= minLen) { const h = []; for (let i = lookback; i < o.length; i++) h.push({ d: o[i].d, v: parseFloat((((o[i].v - o[i-lookback].v) / o[i-lookback].v) * 100).toFixed(1)) }); return [id, { yoy: h[h.length-1]?.v, lastDate: h[h.length-1]?.d, history: h, freq: meta.freq }]; }
          } catch {}
          return null;
        }));
        results.forEach(r => { if (r) cr[r[0]] = r[1]; });
        if (b + COMP_BATCH < compEntries.length) await new Promise(r => setTimeout(r, 300));
      }
      if (Object.keys(cr).length) setCd(p => ({ ...p, ...cr }));
      await fb(HOUSING_SERIES, setHd, o => ({ current: o[o.length-1].v, lastDate: o[o.length-1].d, history: o }));
      await fb(CONSUMER_SERIES, setCsm, o => ({ current: o[o.length-1].v, lastDate: o[o.length-1].d, history: o }));
      setFredStatus("connected"); setIsLive(true);
    } catch { setFredStatus("error"); }
  }, [fredKey]);

  // Auto-fetch FRED data on mount, then pre-fetch all choropleth metrics
  useEffect(() => {
    if (!fredKey) return;
    let resolve;
    fredReadyRef.current = new Promise(r => { resolve = r; });
    fetchFredData().finally(() => {
      resolve(); fredReadyRef.current = null;
      // Background refresh all 6 choropleth metrics with fresh FRED data
      (async () => {
        for (let i = 0; i < CHOROPLETH_METRICS.length; i++) {
          await fetchChoroplethData(CHOROPLETH_METRICS[i].key, { background: true });
          if (i < CHOROPLETH_METRICS.length - 1) await new Promise(r => setTimeout(r, 3000));
        }
      })();
    });
    const interval = setInterval(fetchFredData, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fredKey, fetchFredData, fetchChoroplethData]);

  // FMP rates overlay (more current than FRED for treasuries, mortgages, fed funds)
  const fetchFMPRates = useCallback(async () => {
    if (!fmpKey) return;
    try {
      const [fmpTreasury, fmpMortgage, fmpFedFunds, fmpCPI] = await Promise.all([
        fetchFMPTreasuryRates(fmpKey, 180).catch(() => null),
        fetchFMPMortgageRates(fmpKey).catch(() => null),
        fetchFMP(`/economic-indicators?name=federalFunds&from=${new Date(Date.now()-90*86400000).toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`, fmpKey).catch(() => null),
        fetchFMPCPI(fmpKey).catch(() => null),
      ]);
      if (fmpTreasury) setTd(prev => {
        const merged = { ...prev };
        for (const [id, data] of Object.entries(fmpTreasury)) {
          if (!merged[id]?.lastDate || data.lastDate > merged[id].lastDate) merged[id] = data;
        }
        return merged;
      });
      if (fmpMortgage) setMd(prev => {
        const merged = { ...prev };
        for (const [id, data] of Object.entries(fmpMortgage)) {
          if (!merged[id]?.lastDate || data.lastDate > merged[id].lastDate) merged[id] = data;
        }
        return merged;
      });
      if (Array.isArray(fmpFedFunds) && fmpFedFunds.length) {
        const sorted = [...fmpFedFunds].sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1];
        if (last?.value != null) {
          setGd(prev => {
            const newDate = last.date;
            if (!prev.DFF?.lastDate || newDate > prev.DFF.lastDate) {
              return { ...prev, DFF: { current: parseFloat(last.value), lastDate: newDate } };
            }
            return prev;
          });
        }
      }
      // Overlay FMP CPI data if more current than FRED/fallback
      if (fmpCPI) {
        setCd(prev => {
          const merged = { ...prev };
          for (const [id, data] of Object.entries(fmpCPI)) {
            if (!merged[id]?.lastDate || data.lastDate > merged[id].lastDate) merged[id] = data;
          }
          return merged;
        });
      }
    } catch (e) { console.error("FMP rate fetch error:", e); }
  }, [fmpKey]);

  // Auto-fetch FMP rates on mount and refresh every 15 minutes
  useEffect(() => {
    if (!fmpKey) return;
    fetchFMPRates();
    const interval = setInterval(fetchFMPRates, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fmpKey, fetchFMPRates]);

  const dataSources = useMemo(() => [
    sourceStatus({ label: "FRED macro", date: collectLatestDate({ md, gd, td, cd, hd, csm }), loading: fredStatus === "loading", error: fredStatus === "error", live: isLive, staleDays: 60 }),
    sourceStatus({ label: "FMP market data", date: collectLatestDate({ md, gd, td, cd }), live: !!fmpKey, staleDays: 14 }),
    sourceStatus({ label: "Zillow housing", date: collectLatestDate(zillowData), loading: !zillowData, live: !!zillowData, staleDays: 90 }),
    sourceStatus({ label: "OpenRouter (pricing) + HF (rankings)", date: rankingsData?.[rankingsData.length - 1]?.date, loading: aiLoading || rankingsLoading, live: aiModels.length > 0 || rankingsData.length > 0, staleDays: 14 }),
    sourceStatus({ label: "News", date: newsItems?.[0]?.publishedDate, loading: newsLoading, live: newsItems.length > 0, staleDays: 3 }),
  ], [md, gd, td, cd, hd, csm, fredStatus, isLive, fmpKey, zillowData, rankingsData, aiLoading, rankingsLoading, aiModels.length, newsItems, newsLoading]);

  // Navigation grouped by the investing question each area answers
  const NAV_GROUPS = [
    { label: "Today",     items: [{ id: "overview", label: "Cockpit" }] },
    { label: "Valuation", items: [{ id: "stocks", label: "Stocks" }, { id: "realestate", label: "Real Estate" }] },
    { label: "Income",    items: [{ id: "options", label: "Options" }] },
    { label: "Macro",     items: [{ id: "economy", label: "U.S. Economy" }, { id: "intl", label: "International" }, { id: "commodities", label: "Commodities" }] },
    { label: "Themes",    items: [{ id: "ai", label: "AI Economy" }, { id: "forecasts", label: "Forecasts" }, { id: "history", label: "Historical" }] },
  ];
  const stripPct = (v) => v == null ? "" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--page-bg)", color: "var(--text-primary)", fontFamily: fonts.heading, padding: "20px 16px 60px", transition: "background 0.25s, color 0.25s" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* ── Left sidebar ── */}
        <aside style={{ width: 176, flexShrink: 0, position: "sticky", top: 20, alignSelf: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px 14px" }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5, fontFamily: fonts.heading, color: "var(--text-primary)" }}>Ledger</span>
            <span style={{ fontSize: 8, color: isLive ? "#10B981" : "#F59E0B", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 1, background: isLive ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", padding: "2px 6px", borderRadius: 4 }}>{isLive ? "Live" : "Sample"}</span>
          </div>
          {NAV_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", padding: "4px 10px 3px" }}>{group.label}</div>
              {group.items.map(it => {
                const active = tab === it.id;
                return (
                  <button key={it.id} onClick={() => setTab(it.id)} style={{
                    display: "block", width: "100%", textAlign: "left", border: "none",
                    padding: "6px 10px", borderRadius: 8, marginBottom: 1, cursor: "pointer",
                    fontSize: 12.5, fontFamily: fonts.heading, fontWeight: active ? 600 : 400,
                    background: active ? "var(--tab-active-bg)" : "transparent",
                    color: active ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
                    transition: "all 0.12s",
                  }}>{it.label}</button>
                );
              })}
            </div>
          ))}
          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            style={{ marginTop: 6, background: "var(--toggle-bg)", border: "1px solid var(--toggle-border)", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", color: "var(--toggle-color)", fontFamily: fonts.mono, width: "100%" }}
          >{darkMode ? "Light mode" : "Dark mode"}</button>
        </aside>

        {/* ── Main column ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top bar: ticker search + persistent market strip */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <TickerSearch
              fmpKey={fmpKey}
              onSelect={goTicker}
              placeholder="Search any ticker or company name…"
              boxStyle={{ background: cardBg, border: cardBorder, borderRadius: 9, padding: "6px 11px", flex: "1 1 220px", minWidth: 180 }}
            />
            {marketStrip && (
              <div style={{ display: "flex", gap: 14, fontFamily: fonts.mono, fontSize: 11, flexWrap: "wrap" }}>
                {marketStrip.spy && (
                  <span style={{ color: "var(--text-secondary)" }}>SPY <span style={{ color: "var(--text-primary)" }}>{marketStrip.spy.price?.toFixed(2)}</span> <span style={{ color: marketStrip.spy.changePct >= 0 ? "#4ade80" : "#f87171" }}>{stripPct(marketStrip.spy.changePct)}</span></span>
                )}
                {marketStrip.tenYear != null && (
                  <span style={{ color: "var(--text-secondary)" }}>10Y <span style={{ color: "var(--text-primary)" }}>{marketStrip.tenYear.toFixed(2)}%</span></span>
                )}
                {marketStrip.vix && (
                  <span style={{ color: "var(--text-secondary)" }}>VIX <span style={{ color: "var(--text-primary)" }}>{marketStrip.vix.price?.toFixed(1)}</span> <span style={{ color: marketStrip.vix.changePct >= 0 ? "#f87171" : "#4ade80" }}>{stripPct(marketStrip.vix.changePct)}</span></span>
                )}
              </div>
            )}
            <button onClick={() => { fetchFredData(); fetchFMPRates(); }} style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "5px 10px", fontSize: 10, color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono, marginLeft: "auto" }}>Refresh</button>
          </div>

          <DataHealthPanel sources={dataSources} />
          <NewsTicker items={newsItems} loading={newsLoading} />

          <div style={{ marginTop: 4 }}>
            {tab === "overview" && <OverviewTab fmpKey={fmpKey} onNavigate={setTab} onTicker={goTicker} />}
            {tab === "economy" && <USEconomyTab md={md} td={td} gd={gd} cd={cd} csm={csm} hd={hd} zillowData={zillowData} fredKey={fredKey} fmpKey={fmpKey} choroplethCache={choroplethCache} choroplethMetric={choroplethMetric} setChoroplethMetric={setChoroplethMetric} fetchChoroplethData={fetchChoroplethData} choroplethLoading={choroplethLoading} choroplethProgress={choroplethProgress} />}
            {tab === "intl" && <InternationalTab fmpKey={fmpKey} fredKey={fredKey} gd={gd} />}
            {tab === "stocks" && <StocksTab fmpKey={fmpKey} openTicker={pendingTicker} onTickerOpened={() => setPendingTicker(null)} />}
            {tab === "realestate" && <RealEstateTab hd={hd} md={md} zillowData={zillowData} fmpKey={fmpKey} choroplethCache={choroplethCache} choroplethMetric={choroplethMetric} setChoroplethMetric={setChoroplethMetric} fetchChoroplethData={fetchChoroplethData} choroplethLoading={choroplethLoading} choroplethProgress={choroplethProgress} />}
            {tab === "options" && <OptionsTab fmpKey={fmpKey} />}
            {tab === "commodities" && <CommoditiesTab fredKey={fredKey} />}
            {tab === "ai" && <AIEconomyTab models={aiModels} loading={aiLoading} rankings={rankingsData} rankingsLoading={rankingsLoading} />}
            {tab === "forecasts" && <ForecastsTab />}
            {tab === "history" && <HistoricalReturnsTab />}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 28, padding: "14px 0", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>Data: FRED (St. Louis Fed) + BLS + Financial Modeling Prep</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>{isLive ? "FRED: Live" : "FRED: Sample data"}</span>
          </div>
        </div>
      </div>
      <ChatDrawer tab={tab} md={md} td={td} gd={gd} cd={cd} csm={csm} hd={hd} aiModels={aiModels} zillowData={zillowData} />
    </div>
  );
}
