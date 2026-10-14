import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoBox } from "../components/shared.jsx";
import { fetchOptionsChain, fetchFMP } from "../lib/api.js";
import CSPScreener from "./stocks/CSPScreener.jsx";
import { VolSurface } from "./StocksTab.jsx";
import MarketView from "./options/MarketView.jsx";
import StrategiesView from "./options/StrategiesView.jsx";
import SymbolNav from "./options/SymbolNav.jsx";
import MiniFans from "./options/MiniFans.jsx";
import { useOptionsMarket } from "./options/marketData.js";
import ExpectationsView from "./options/ExpectationsView.jsx";
import IncomeView from "./options/IncomeView.jsx";
import WatchlistLadder from "./options/WatchlistLadder.jsx";
import DecisionWorkbench, {modelInputs} from "./options/DecisionWorkbench.jsx";
import VolatilityHistory, {saveVolSnapshot} from "./options/VolatilityHistory.jsx";
import {quoteQuality, dateOnly, daysBetween, todayNY} from "../lib/optionsAnalysis.js";
import "./options/OptionsResearch.css";

// Options: the market's temperature (Market, the landing view), single-name research that steps
// through your watchlist or the S&P 500 with ‹ › / ← → (chains for the neighbours are prefetched),
// and the Strategies library, builder and screener.

const DEFAULT_SYMBOL = "SPY";
const VIEWS = [["market", "Market"], ["expect", "Implied ranges"], ["strategies", "Strategies"], ["decision", "Valuation & payoffs"], ["income", "Premium & strikes"], ["history", "Events & history"], ["surface", "Volatility detail"], ["watchlist", "Watchlist"]];
const SINGLE = new Set(["expect", "strategies", "decision", "income", "history", "surface"]);
const TTL = { chain: 5 * 60e3, ctx: 30 * 60e3, closes: 60 * 60e3, target: 60 * 60e3 };
const CACHE_MAX = 28;
const noContext = { events: [], status: { earnings: "unavailable", dividends: "unavailable", rates: "unavailable" }, partial: true };

function OptionsTab({ fmpKey }) {
  const [view, setView] = useState("market");
  const [refresh,setRefresh]=useState(0);
  const [theses,setTheses]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem('ledger-option-theses')||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{return {};}});
  useEffect(()=>{try{localStorage.setItem('ledger-option-theses',JSON.stringify(theses));}catch{}},[theses]);
  const { data: market } = useOptionsMarket();

  // the symbol shared by the single-name views (persisted)
  const [symbol, setSymbol] = useState(() => {
    try { return localStorage.getItem("opt-vol-symbol") || DEFAULT_SYMBOL; } catch { return DEFAULT_SYMBOL; }
  });
  useEffect(() => { try { localStorage.setItem("opt-vol-symbol", symbol); } catch {} }, [symbol]);

  // per-symbol cache of chains, event context, closes and targets: stepping back to a name is instant,
  // and the neighbours' chains are fetched ahead (FMP calls are not prefetched)
  const cache = useRef(new Map());
  const cached = useCallback((kind, sym, fetcher) => {
    const k = `${kind}:${sym}`, hit = cache.current.get(k);
    if (hit && Date.now() - hit.at < TTL[kind]) { cache.current.delete(k); cache.current.set(k, hit); return hit; }
    const entry = { at: Date.now(), value: undefined };
    entry.promise = fetcher(sym).then(v => { entry.value = v; return v; });
    entry.promise.catch(() => cache.current.delete(k));
    cache.current.set(k, entry);
    while (cache.current.size > CACHE_MAX) cache.current.delete(cache.current.keys().next().value);
    return entry;
  }, []);
  const getContext = useCallback(sym => fetch(`/api/options-context?symbol=${encodeURIComponent(sym)}`).then(r => (r.ok ? r.json() : Promise.reject(new Error("context")))), []);
  const prefetch = useCallback(syms => { for (const s of syms) { cached("chain", s, fetchOptionsChain).promise.catch(() => {}); cached("ctx", s, getContext).promise.catch(() => {}); } }, [cached, getContext]);

  const [chain, setChain] = useState(null);
  useEffect(()=>{if(chain?.symbol===symbol)saveVolSnapshot(symbol,chain);},[chain,symbol]);
  const [chainErr, setChainErr] = useState(null);
  const [context,setContext]=useState(null);
  const [closes, setCloses] = useState(null);
  const [target, setTarget] = useState(null);
  useEffect(() => {
    let alive = true;
    const take = (kind, fetcher, set, onErr) => {
      const e = cached(kind, symbol, fetcher);
      set(e.value === undefined ? null : e.value);
      if (e.value === undefined) e.promise.then(v => { if (alive) set(v); }).catch(err => { if (alive) onErr(err); });
    };
    setChainErr(null);
    take("chain", fetchOptionsChain, setChain, err => setChainErr(err?.message || "chain unavailable"));
    take("ctx", getContext, setContext, () => setContext(noContext));
    if (fmpKey) {
      take("closes", s => fetchFMP(`/historical-price-eod/full?symbol=${s}`, fmpKey).then(d => {
        const rows = Array.isArray(d) ? d : (d?.historical || []);
        return [...rows].filter(r => r.close != null).sort((a, b) => (a.date || "").localeCompare(b.date || "")).slice(-800).map(r => ({ date: r.date, close: r.adjClose ?? r.close }));
      }), setCloses, () => setCloses([]));
      take("target", s => fetchFMP(`/price-target-consensus?symbol=${s}`, fmpKey).then(d => (Array.isArray(d) && d.length ? d[0] : null)), setTarget, () => setTarget(null));
    } else { setCloses(null); setTarget(null); }
    return () => { alive = false; };
  }, [symbol, fmpKey, refresh, cached, getContext]);
  const reload = () => { for (const k of ["chain", "ctx"]) cache.current.delete(`${k}:${symbol}`); setRefresh(v => v + 1); };

  // the watchlist is shared with Stocks (via /api/tickers, mirrored to localStorage); the S&P 500 list feeds the cycler
  const [tickers, setTickers] = useState([]);
  const [tickerInput, setTickerInput] = useState("");
  const [showGrid, setShowGrid] = useState(false);
  const [sp500, setSp500] = useState([]);
  const fromServer = useRef(false);
  useEffect(() => {
    fetch("/api/tickers")
      .then(r => r.json())
      .then(saved => { fromServer.current = true; if (Array.isArray(saved) && saved.length) setTickers(saved); })
      .catch(() => { try { const saved = localStorage.getItem("econ-dash-tickers"); if (saved) setTickers(JSON.parse(saved)); } catch {} });
    fetch("/api/sp500-screener").then(r => r.json()).then(j => setSp500((j.stocks || []).map(s => ({ symbol: s.symbol, name: s.name, sector: s.sector, mktCap: s.mktCap })))).catch(() => {});
  }, []);
  const editTickers = next => {
    setTickers(next);
    try { localStorage.setItem("econ-dash-tickers", JSON.stringify(next)); } catch {}
    if (fromServer.current) fetch("/api/tickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
  };
  const addTicker = () => { const t = tickerInput.trim().toUpperCase(); if (t && !tickers.includes(t)) { editTickers([...tickers, t]); setTickerInput(""); } };
  const removeTicker = t => editTickers(tickers.filter(x => x !== t));

  // the list the cycler is stepping through, for the ranges-at-a-glance grid
  const [navList, setNavList] = useState({ list: "watchlist", members: [] });
  const onMembers = useCallback((list, members) => setNavList(o => (o.list === list && o.members === members ? o : { list, members })), []);
  const fanRows = useMemo(() => {
    const rows = market?.scan?.rows || [], by = new Map(rows.map(r => [r.symbol, r]));
    return navList.members.map(s => by.get(s)).filter(Boolean);
  }, [market, navList]);
  const listName = navList.list === "watchlist" ? "your watchlist" : navList.list === "etf" ? "the index and sector ETFs" : navList.list === "sp500" ? "the S&P 500" : `S&P 500 ${navList.list.slice(7)}`;

  const inspect = s => { setSymbol(s); setView("expect"); };
  const thesis=theses[symbol]||{};
  const model=modelInputs(context,chain?.spot);
  const usable=chain?.options.filter(o=>quoteQuality(o).usable).length||0;
  const tradeDate=dateOnly(chain?.underlyingLastTrade),oldTrade=tradeDate&&daysBetween(tradeDate,todayNY())>0;
  const status = chainErr ? `No listed options found for ${symbol}.`
    : !chain ? `Loading the ${symbol} chain (Cboe, delayed)…`
    : `Cboe delayed snapshot · feed ${chain.sourceTimestamp || "time not supplied"} · ${usable.toLocaleString()} of ${chain.options.length.toLocaleString()} contracts pass the quote checks (spread ≤35% of midpoint, open interest ≥50)${oldTrade ? ` · last trade ${tradeDate}: the market may be closed, so check a live quote` : ""}. Bids are indications, not guaranteed fills.`;
  const noOptions = <InfoBox color="#d95926"><strong style={{ color: "var(--text-primary)" }}>No listed options for {symbol}.</strong> Cboe returned no option chain. Shares that trade over the counter (five-letter tickers ending in F or Y, such as foreign ordinary shares), most micro-caps and very recent listings have no U.S.-listed options; for a foreign company, look for its ADR or home-market listing. Press › to step to the next name. {chainErr && <span style={{ color: "var(--text-muted)" }}>({chainErr})</span>}</InfoBox>;
  const chainState = chainErr ? noOptions
    : !chain ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-number)", fontSize: 12 }}>Loading {symbol} options chain (Cboe)…</div>
    : !(chain.spot>0)||!chain.options.length ? noOptions : null;

  return (<div className="options-research">
    <nav className="opt-tabs" aria-label="Options research">
      {VIEWS.map(([id, text]) => (
        <button key={id} onClick={() => setView(id)} aria-pressed={view===id}>{text}</button>
      ))}
    </nav>
    {SINGLE.has(view) && <SymbolNav symbol={symbol} onSymbol={setSymbol} watchlist={tickers} sp500={sp500} onPrefetch={prefetch} onMembers={onMembers} onRefresh={reload} status={status} />}

    {view === "market" && <MarketView onInspect={inspect} />}

    {view === "expect" && (<>
      <MiniFans rows={fanRows} selected={symbol} onPick={setSymbol} title={`Ranges at a glance · ${listName}`}
        empty={market?.scan ? `None of ${listName} is in the market scan (index and sector ETFs, the 15 largest S&P 500 companies and your watchlist). Step through the list with ‹ › to see each name's full charts below.` : "Waiting for the market scan; the first build takes a minute."} />
      {chainState || <ExpectationsView symbol={symbol} chain={chain} closes={closes} target={target} model={model} context={context} thesis={thesis} />}
    </>)}

    {view === "strategies" && <StrategiesView symbol={symbol} chain={chain} context={context} chainState={chainState} market={market} onSymbol={setSymbol} />}

    {view==='decision'&&(chainState||<DecisionWorkbench key={symbol} symbol={symbol} chain={chain} context={context} thesis={thesis} onThesisChange={t=>setTheses(old=>({...old,[symbol]:t}))}/>)}
    {view==='history'&&(chainState||<VolatilityHistory key={symbol} symbol={symbol} chain={chain} context={context} closes={closes}/>)}

    {view === "income" && (<>
      {chainState || <IncomeView symbol={symbol} fmpKey={fmpKey} chain={chain} closes={closes} context={context} />}
    </>)}

    {view === "watchlist" && (<>
      <div className="ocard" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <span className="ocard-eyebrow">Watchlist</span>
          <input className="oinput" value={tickerInput} onChange={e => setTickerInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="Add ticker (e.g. COST)" aria-label="Add ticker" style={{ width: 170 }} />
          <button type="button" className="obtn" onClick={addTicker}>Add</button>
          <span className="onote" style={{ margin: "0 0 0 auto" }}>shared with Stocks → Watchlist and the Cockpit rail</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tickers.map(t => (
            <span key={t} className="owatch-chip">{t}<button type="button" onClick={() => removeTicker(t)} aria-label={`Remove ${t}`}>×</button></span>
          ))}
          {tickers.length === 0 && <span className="onote" style={{ margin: 0 }}>No tickers yet: add one above to build the ladder.</span>}
        </div>
      </div>
      <WatchlistLadder tickers={tickers} theses={theses} onInspect={s=>{setSymbol(s);setView('decision');}} />
      <button type="button" onClick={() => setShowGrid(s => !s)} className="ochip" aria-expanded={showGrid} style={{ margin: "4px 0 10px" }}>
        {showGrid ? "▾" : "▸"} ATM put premiums by maturity
      </button>
      {showGrid && <CSPScreener tickers={tickers} />}
    </>)}

    {view === "surface" && (<>
      {chainState || <VolSurface symbol={symbol} spot={null} chain={chain} />}
      <InfoBox color="#3987e5">
        <strong style={{ color: "var(--text-primary)" }}>Volatility detail.</strong> The heatmap and surface compare quoted implied volatility across strikes and expiries. Greeks describe price sensitivity; open interest describes outstanding contracts. Implied ranges presents an approximate pricing distribution using the same snapshot.
      </InfoBox>
    </>)}
  </div>);
}

export default OptionsTab;
