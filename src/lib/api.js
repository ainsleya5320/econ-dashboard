import { FRED_BASE, FMP_BASE } from './constants.js';

async function fetchFred(id, key, limit = 12, _retries = 3) {
  const r = await fetch(`${FRED_BASE}?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`);
  if (r.status === 429 && _retries > 0) {
    await new Promise(res => setTimeout(res, 2000));
    return fetchFred(id, key, limit, _retries - 1);
  }
  if (!r.ok) throw new Error(`FRED ${r.status} for ${id}`);
  const d = await r.json();
  return d.observations.filter(o => o.value !== ".").map(o => ({ d: o.date, v: parseFloat(o.value) })).reverse();
}

async function fetchFMP(endpoint, fmpKey) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const r = await fetch(`${FMP_BASE}${endpoint}${sep}apikey=${fmpKey}`);
  if (!r.ok) throw new Error("FMP error");
  return r.json();
}

// FMP-based rate fetches (more current than FRED)
async function fetchFMPTreasuryRates(fmpKey, days = 180) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const data = await fetchFMP(`/treasury-rates?from=${from}&to=${to}`, fmpKey);
  if (!Array.isArray(data) || !data.length) return null;
  // FMP returns newest-first, fields like: date, month1, month2, month3, month6, year1, year2, year3, year5, year7, year10, year20, year30
  const sorted = [...data].reverse();
  const mapKey = { DGS2: "year2", DGS5: "year5", DGS10: "year10", DGS30: "year30" };
  const result = {};
  for (const [fredId, fmpField] of Object.entries(mapKey)) {
    const history = sorted.filter(r => r[fmpField] != null).map(r => ({ d: r.date, v: parseFloat(r[fmpField]) }));
    if (history.length) result[fredId] = { current: history[history.length - 1].v, lastDate: history[history.length - 1].d, history };
  }
  return result;
}

async function fetchFMPMortgageRates(fmpKey) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const names = { MORTGAGE30US: "30YearFixedRateMortgageAverage", MORTGAGE15US: "15YearFixedRateMortgageAverage" };
  const result = {};
  for (const [id, name] of Object.entries(names)) {
    try {
      const data = await fetchFMP(`/economic-indicators?name=${name}&from=${from}&to=${to}`, fmpKey);
      if (Array.isArray(data) && data.length) {
        const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
        const history = sorted.filter(r => r.value != null).map(r => ({ d: r.date, v: parseFloat(r.value) }));
        if (history.length) result[id] = { current: history[history.length - 1].v, lastDate: history[history.length - 1].d, history };
      }
    } catch {}
  }
  return result;
}

async function fetchOptionsChain(ticker) {
  const r = await fetch(`/cboe-api/${ticker}.json`);
  if (!r.ok) throw new Error("CBOE options error");
  const j = await r.json();
  const raw = j.data?.options || [];
  const spot = j.data?.current_price || null;
  const parsed = raw.map(o => {
    const sym = o.option || "";
    // Parse option symbol: e.g., AAPL250221C00230000
    // Format: TICKER + YYMMDD + C/P + strike*1000 (8 digits)
    const match = sym.match(/(\d{6})([CP])(\d{8})$/);
    if (!match) return null;
    const [, dateStr, type, strikeStr] = match;
    const yr = 2000 + parseInt(dateStr.slice(0, 2));
    const mn = parseInt(dateStr.slice(2, 4)) - 1;
    const dy = parseInt(dateStr.slice(4, 6));
    const expiry = new Date(yr, mn, dy);
    const dte = Math.max(0, Math.round((expiry - new Date()) / 86400000));
    return { sym, strike: o.strike || parseFloat(strikeStr) / 1000, expiry, dte, type, iv: o.iv, bid: o.bid, ask: o.ask, oi: o.open_interest, vol: o.volume, delta: o.delta, gamma: o.gamma, vega: o.vega, theta: o.theta, rho: o.rho, theo: o.theo, lastPrice: o.last_trade_price, lastTime: o.last_trade_time, prevClose: o.prev_day_close, change: o.change, pctChange: o.percent_change };
  }).filter(o => o && o.iv > 0 && o.dte > 0);
  return { options: parsed, spot };
}

async function fetchOpenRouterModels() {
  const r = await fetch("https://openrouter.ai/api/v1/models");
  if (!r.ok) throw new Error("OpenRouter error");
  const j = await r.json();
  return j.data || [];
}

export { fetchFred, fetchFMP, fetchFMPTreasuryRates, fetchFMPMortgageRates, fetchOptionsChain, fetchOpenRouterModels };
