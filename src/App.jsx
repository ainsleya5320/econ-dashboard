import React, { useState, useEffect, useCallback, useRef } from "react";
import { fonts, cardBg, cardBorder } from "./lib/styles.js";
import { FRED_BASE, FMP_BASE, US_MORTGAGE_SERIES, GLOBAL_RATE_SERIES, TREASURY_SERIES, CPI_SERIES, CPI_COMPONENTS, PCE_COMPONENTS, HOUSING_SERIES, CONSUMER_SERIES, CHOROPLETH_METRICS, CHOROPLETH_SNAPSHOT, ALL_STATES } from "./lib/constants.js";
import FB from "./lib/fallbackData.js";
import { fetchFred, fetchFMP, fetchFMPTreasuryRates, fetchFMPMortgageRates, fetchOpenRouterModels, fetchOpenRouterRankings, fetchFMPNews, fetchZillowData } from "./lib/api.js";
import { fmtDate } from "./components/shared.jsx";
import NewsTicker from "./components/NewsTicker.jsx";
import USEconomyTab from "./tabs/USEconomyTab.jsx";
import InternationalTab from "./tabs/InternationalTab.jsx";
import StocksTab from "./tabs/StocksTab.jsx";
import HistoricalReturnsTab from "./tabs/HistoricalReturnsTab.jsx";
import AIEconomyTab from "./tabs/AIEconomyTab.jsx";

export default function Dashboard() {
  const [fredKey, setFredKey] = useState("242945c79ff76bec9082797eb56dea77"); const [fmpKey, setFmpKey] = useState("3ccQfvWcHnuzsOVTKL2YHYxWAdpu91HP");
  const [fredStatus, setFredStatus] = useState("idle"); const [isLive, setIsLive] = useState(false);
  const [tab, setTab] = useState("economy");
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
            const obs = await fetchFred(metric.series(st), fredKey, 1);
            if (obs.length) results[st] = { v: obs[obs.length - 1].v, d: obs[obs.length - 1].d };
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
        const nObs = await fetchFred(metric.national, fredKey, 1);
        if (nObs.length) results._national = { v: nObs[nObs.length - 1].v, d: nObs[nObs.length - 1].d };
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

  // Fetch FMP news on mount and refresh every 30 minutes
  useEffect(() => {
    if (!fmpKey) return;
    const load = () => {
      setNewsLoading(true);
      fetchFMPNews(fmpKey).then(setNewsItems).catch(e => console.error("News fetch error:", e)).finally(() => setNewsLoading(false));
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
      // Fetch CPI & PCE component breakdowns (all monthly index → YoY %)
      const compSeries = { ...CPI_COMPONENTS, ...PCE_COMPONENTS };
      for (const [id] of Object.entries(compSeries)) {
        try {
          const o = await fetchFred(id, fredKey, 24);
          if (o.length >= 13) { const h = []; for (let i = 12; i < o.length; i++) h.push({ d: o[i].d, v: parseFloat((((o[i].v - o[i-12].v) / o[i-12].v) * 100).toFixed(1)) }); cr[id] = { yoy: h[h.length-1]?.v, lastDate: h[h.length-1]?.d, history: h }; }
        } catch {}
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
      const [fmpTreasury, fmpMortgage, fmpFedFunds] = await Promise.all([
        fetchFMPTreasuryRates(fmpKey, 180).catch(() => null),
        fetchFMPMortgageRates(fmpKey).catch(() => null),
        fetchFMP(`/economic-indicators?name=federalFunds&from=${new Date(Date.now()-90*86400000).toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`, fmpKey).catch(() => null),
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
    } catch (e) { console.error("FMP rate fetch error:", e); }
  }, [fmpKey]);

  // Auto-fetch FMP rates on mount and refresh every 15 minutes
  useEffect(() => {
    if (!fmpKey) return;
    fetchFMPRates();
    const interval = setInterval(fetchFMPRates, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fmpKey, fetchFMPRates]);

  const tabs = [
    { id: "economy", label: "U.S. Economy", icon: <img src="https://flagcdn.com/w40/us.png" alt="US" style={{ width: 18, height: 13, verticalAlign: "middle" }} /> },
    { id: "intl", label: "International", icon: "🌍" },
    { id: "stocks", label: "Stocks", icon: "🏛" },
    { id: "ai", label: "AI Economy", icon: "🤖" },
    { id: "history", label: "Historical", icon: "📜" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0c0f1a", color: "#e2e8f0", fontFamily: fonts.heading, padding: "20px 16px 60px" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 3 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -1, margin: 0, background: "linear-gradient(135deg, #f1f5f9, #94a3b8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Economic Dashboard</h1>
          <span style={{ fontSize: 9, color: isLive ? "#10B981" : "#F59E0B", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 1, background: isLive ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", padding: "2px 7px", borderRadius: 4, border: `1px solid ${isLive ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}` }}>{isLive ? "● Live" : "Sample"}</span>
        </div>
        <p style={{ color: "#64748b", fontSize: 12, margin: "3px 0 16px", fontFamily: fonts.mono }}>Rates, inflation, housing, stock fundamentals, and historical returns</p>

        {/* API Status Bar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <span style={{ fontSize: 10, color: fredStatus === "connected" ? "#10B981" : fredStatus === "loading" ? "#F59E0B" : "#64748b", fontFamily: fonts.mono }}>
              {fredStatus === "connected" ? "● FRED Connected" : fredStatus === "loading" ? "● FRED Loading..." : "○ FRED"}
            </span>
            <span style={{ fontSize: 10, color: "#10B981", fontFamily: fonts.mono }}>● FMP Connected</span>
            <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>Auto-refresh: FRED 30min · FMP 15min</span>
            <button onClick={() => { fetchFredData(); fetchFMPRates(); }} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 10px", fontSize: 10, color: "#94a3b8", cursor: "pointer", fontFamily: fonts.mono }}>Refresh Now</button>
          </div>
        </div>

        {/* News Ticker */}
        <NewsTicker items={newsItems} loading={newsLoading} />

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 4, marginBottom: 20 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "10px 12px", border: "none", borderRadius: 10,
              background: tab === t.id ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
              color: tab === t.id ? "#f1f5f9" : "#64748b", fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
              fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.2s",
              boxShadow: tab === t.id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
            }}><span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}</button>
          ))}
        </div>

        {tab === "economy" && <USEconomyTab md={md} td={td} gd={gd} cd={cd} csm={csm} hd={hd} zillowData={zillowData} fredKey={fredKey} fmpKey={fmpKey} choroplethCache={choroplethCache} choroplethMetric={choroplethMetric} setChoroplethMetric={setChoroplethMetric} fetchChoroplethData={fetchChoroplethData} choroplethLoading={choroplethLoading} choroplethProgress={choroplethProgress} />}
        {tab === "intl" && <InternationalTab fmpKey={fmpKey} />}
        {tab === "stocks" && <StocksTab fmpKey={fmpKey} />}
        {tab === "ai" && <AIEconomyTab models={aiModels} loading={aiLoading} rankings={rankingsData} rankingsLoading={rankingsLoading} />}
        {tab === "history" && <HistoricalReturnsTab />}

        {/* Footer */}
        <div style={{ marginTop: 28, padding: "14px 0", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>Data: FRED (St. Louis Fed) + Financial Modeling Prep</span>
          <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>{isLive ? "FRED: Live" : "FRED: Sample data"}</span>
        </div>
      </div>
    </div>
  );
}
