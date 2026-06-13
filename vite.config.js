import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TICKERS_FILE = path.join(__dirname, 'tickers.json')
const env = loadEnv('', __dirname, '')

const FMP_KEY = env.VITE_FMP_KEY || ''
const FRED_KEY = env.VITE_FRED_KEY || ''
const BLS_KEY = env.BLS_KEY || ''
const BEA_KEY = env.BEA_KEY || ''
const GEMINI_KEY = env.GEMINI_API_KEY || ''

/* ── BEA PCE Price Index (monthly index levels, compute YoY) ── */
let beaPceCache = { data: null, ts: 0 }
const BEA_PCE_TTL = 4 * 60 * 60 * 1000

async function fetchBeaPCE() {
  if (beaPceCache.data && Date.now() - beaPceCache.ts < BEA_PCE_TTL) return beaPceCache.data

  // Fetch monthly price index levels (Table 2.8.4) for last 3 years
  const years = []
  const now = new Date()
  for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) years.push(y)
  const yearStr = years.join(',')

  const url = `https://apps.bea.gov/api/data/?&UserID=${BEA_KEY}&method=GetData&DataSetName=NIPA&TableName=T20804&Frequency=M&Year=${yearStr}&ResultFormat=JSON`
  console.log('BEA PCE: fetching monthly price index data...')
  const resp = await fetch(url, { headers: { 'User-Agent': UA } })
  const json = await resp.json()
  const rows = json?.BEAAPI?.Results?.Data
  if (!rows || !Array.isArray(rows)) {
    console.warn('BEA PCE: unexpected response', JSON.stringify(json).slice(0, 200))
    return null
  }

  // Line 1 = headline PCE, Line 13 = PCE ex food & energy (core)
  // Parse TimePeriod format: "2024M01" → "2024-01"
  const parseTP = (tp) => {
    const m = tp.match(/^(\d{4})M(\d{2})$/)
    return m ? `${m[1]}-${m[2]}` : null
  }

  // Extract index levels for headline and core
  const headline = []  // {d, v}
  const core = []

  for (const row of rows) {
    const d = parseTP(row.TimePeriod)
    const v = parseFloat(String(row.DataValue).replace(/,/g, ''))
    if (!d || isNaN(v)) continue

    if (row.LineNumber === '1') headline.push({ d, v })
    else if (row.LineNumber === '13') core.push({ d, v })
  }

  // Sort by date
  headline.sort((a, b) => a.d.localeCompare(b.d))
  core.sort((a, b) => a.d.localeCompare(b.d))

  // Compute YoY % change (need 12-month lag)
  const computeYoY = (arr) => {
    const history = []
    for (let i = 12; i < arr.length; i++) {
      const yoy = ((arr[i].v - arr[i - 12].v) / arr[i - 12].v) * 100
      history.push({ d: arr[i].d, v: parseFloat(yoy.toFixed(2)) })
    }
    const latest = history.length ? history[history.length - 1] : null
    return { yoy: latest?.v ?? null, lastDate: latest?.d ?? null, history }
  }

  const result = {
    PCEPI: computeYoY(headline),
    PCEPILFE: computeYoY(core),
    source: 'BEA',
  }

  console.log(`BEA PCE: headline=${result.PCEPI.yoy}% (${result.PCEPI.lastDate}), core=${result.PCEPILFE.yoy}% (${result.PCEPILFE.lastDate})`)
  beaPceCache = { data: result, ts: Date.now() }
  return result
}

/* ── Fear & Greed Composite (5 sub-components, 15-min cache) ── */
let fearGreedCache = { data: null, ts: 0 }
const FEAR_GREED_TTL = 15 * 60 * 1000

// Map a value in [min, max] to a 0–100 score, optionally inverted
const scoreLinear = (v, min, max, invert = false) => {
  if (v == null || isNaN(v)) return null
  const clamped = Math.max(min, Math.min(max, v))
  const pct = ((clamped - min) / (max - min)) * 100
  return invert ? 100 - pct : pct
}

async function fetchFearGreed() {
  if (fearGreedCache.data && Date.now() - fearGreedCache.ts < FEAR_GREED_TTL) return fearGreedCache.data

  const results = {}

  // 1. VIX — fear gauge (low VIX = greed, high VIX = fear)
  //    Extreme Greed: VIX < 12, Neutral: ~18, Extreme Fear: VIX > 35
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=%5EVIX&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const vix = data?.[0]?.price
    if (vix != null) {
      results.vix = {
        raw: vix,
        score: scoreLinear(vix, 12, 35, true), // invert: high VIX = low score (fear)
        label: 'Volatility (VIX)',
        detail: `VIX at ${vix.toFixed(2)}`,
      }
    }
  } catch (e) { console.warn('Fear&Greed VIX error:', e.message) }

  // 2. Market Momentum — S&P 500 vs 125-day SMA
  //    Far above = greed, far below = fear
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=SPY&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const hist = (data?.historical || data || []).slice(0, 130)
    if (hist.length >= 125) {
      const current = hist[0].close
      const sma125 = hist.slice(0, 125).reduce((s, d) => s + d.close, 0) / 125
      const pctDiff = ((current - sma125) / sma125) * 100
      results.momentum = {
        raw: pctDiff,
        score: scoreLinear(pctDiff, -10, 10), // -10% below SMA = extreme fear, +10% = extreme greed
        label: 'Momentum (SPY vs 125d MA)',
        detail: `${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(2)}% vs 125-day avg`,
      }
    }
  } catch (e) { console.warn('Fear&Greed Momentum error:', e.message) }

  // 3. Safe Haven Demand — SPY 20-day return vs TLT 20-day return
  //    Stocks winning = greed, bonds winning = fear
  try {
    const [spyResp, tltResp] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=SPY&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } }),
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=TLT&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } }),
    ])
    const spyData = (await spyResp.json())
    const tltData = (await tltResp.json())
    const spyHist = (spyData?.historical || spyData || []).slice(0, 22)
    const tltHist = (tltData?.historical || tltData || []).slice(0, 22)
    if (spyHist.length >= 20 && tltHist.length >= 20) {
      const spyRet = ((spyHist[0].close - spyHist[19].close) / spyHist[19].close) * 100
      const tltRet = ((tltHist[0].close - tltHist[19].close) / tltHist[19].close) * 100
      const diff = spyRet - tltRet
      results.safeHaven = {
        raw: diff,
        score: scoreLinear(diff, -8, 8), // SPY 8% below TLT = extreme fear
        label: 'Safe Haven Demand',
        detail: `SPY ${spyRet > 0 ? '+' : ''}${spyRet.toFixed(1)}% vs TLT ${tltRet > 0 ? '+' : ''}${tltRet.toFixed(1)}% (20d)`,
      }
    }
  } catch (e) { console.warn('Fear&Greed SafeHaven error:', e.message) }

  // 4. Junk Bond Demand — ICE BofA US High Yield OAS (FRED: BAMLH0A0HYM2)
  //    Low spreads = greed, high spreads = fear
  try {
    const resp = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=BAMLH0A0HYM2&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=1`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const obs = data?.observations?.[0]
    const spread = obs?.value ? parseFloat(obs.value) : null
    if (spread != null && !isNaN(spread)) {
      results.junkBond = {
        raw: spread,
        score: scoreLinear(spread, 3, 9, true), // 3% spread = greed, 9%+ = fear
        label: 'Junk Bond Demand',
        detail: `HY OAS at ${spread.toFixed(2)}%`,
      }
    }
  } catch (e) { console.warn('Fear&Greed JunkBond error:', e.message) }

  // 5. Market Breadth — % of S&P 500 stocks above their 50-day MA
  //    Use our own sp500-data.json (proxy: use % with positive changePct as a quick proxy if DMA not available)
  //    Better: fetch a few days of SPY and NYSE highs-lows, but keep simple
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=SPY&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const hist = (data?.historical || data || []).slice(0, 60)
    if (hist.length >= 50) {
      const current = hist[0].close
      const sma50 = hist.slice(0, 50).reduce((s, d) => s + d.close, 0) / 50
      const pctDiff = ((current - sma50) / sma50) * 100
      // As a breadth proxy: how far SPY is above/below its own 50-day MA
      results.breadth = {
        raw: pctDiff,
        score: scoreLinear(pctDiff, -7, 7),
        label: 'Breadth (SPY vs 50d MA)',
        detail: `${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(2)}% vs 50-day avg`,
      }
    }
  } catch (e) { console.warn('Fear&Greed Breadth error:', e.message) }

  // Composite: equal-weighted average of all available scores
  const validScores = Object.values(results).map(r => r.score).filter(s => s != null)
  const composite = validScores.length
    ? validScores.reduce((a, b) => a + b, 0) / validScores.length
    : null

  let classification = '—'
  if (composite != null) {
    if (composite < 25) classification = 'Extreme Fear'
    else if (composite < 45) classification = 'Fear'
    else if (composite < 55) classification = 'Neutral'
    else if (composite < 75) classification = 'Greed'
    else classification = 'Extreme Greed'
  }

  const result = {
    composite: composite != null ? Math.round(composite) : null,
    classification,
    components: results,
    updated: Date.now(),
  }
  console.log(`Fear&Greed: composite=${result.composite} (${result.classification}) from ${validScores.length}/5 components`)
  fearGreedCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI Economic Impact (stocks, productivity, employment, software capex) ── */
let aiImpactCache = { data: null, ts: 0 }
const AI_IMPACT_TTL = 4 * 60 * 60 * 1000

// FRED series relevant to AI's impact on the REAL ECONOMY
// Grouped into: Productivity, Capital Formation, Physical Buildout, Employment, Power Demand
const AI_FRED_SERIES = {
  // --- Productivity (the ultimate test) ---
  OPHNFB:         { label: 'Nonfarm Labor Productivity',    group: 'productivity', freq: 'Q', limit: 80,  color: '#10B981', unit: 'index' },
  MPU4910063:     { label: 'Info Sector Labor Productivity',group: 'productivity', freq: 'Q', limit: 80,  color: '#14B8A6', unit: 'index' },

  // --- Capital formation: where is the money actually flowing? ---
  Y694RX1Q020SBEA:{ label: 'Real Software Investment',      group: 'capex',        freq: 'Q', limit: 80,  color: '#6366F1', unit: 'billions' },
  A679RC1Q027SBEA:{ label: 'Real IP Products Investment',   group: 'capex',        freq: 'Q', limit: 80,  color: '#8B5CF6', unit: 'billions' },
  Y033RC1Q027SBEA:{ label: 'Real Info-Processing Equipment',group: 'capex',        freq: 'Q', limit: 80,  color: '#A855F7', unit: 'billions' },

  // --- Physical buildout (chips + data centers) ---
  IPG3344S:       { label: 'Semiconductor Production',      group: 'buildout',     freq: 'M', limit: 240, color: '#F59E0B', unit: 'index' },
  TLMFGCONS:      { label: 'Manufacturing Construction ($M)',group: 'buildout',    freq: 'M', limit: 240, color: '#EF4444', unit: 'dollars_m' },

  // --- Employment in AI-adjacent sectors ---
  CES6054150001:  { label: 'Computer Systems Design Jobs',  group: 'employment',   freq: 'M', limit: 240, color: '#3B82F6', unit: 'thousands' },
  USINFO:         { label: 'Information Sector Jobs',       group: 'employment',   freq: 'M', limit: 240, color: '#60A5FA', unit: 'thousands' },

  // --- Power: AI's physical footprint ---
  IPG2211A2N:     { label: 'Electric Power Generation',     group: 'power',        freq: 'M', limit: 240, color: '#EAB308', unit: 'index' },
}

async function fetchFredSeries(id, limit) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&limit=${limit}&sort_order=desc&file_type=json`
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) {
      console.warn(`FRED ${id}: HTTP ${resp.status}`)
      return []
    }
    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      console.warn(`FRED ${id}: expected JSON, received ${contentType || 'unknown content type'}`)
      return []
    }
    const json = await resp.json()
    return (json.observations || [])
      .filter(o => o.value !== '.')
      .map(o => ({ d: o.date, v: parseFloat(o.value) }))
      .reverse()
  } catch (e) {
    console.warn(`FRED ${id}: ${e.message}`)
    return []
  }
}

async function fetchFMPProfile(symbol) {
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const p = data?.[0]
    if (!p) return null
    return {
      symbol,
      name: p.companyName,
      price: p.price,
      change: p.change,
      changePct: p.changePercentage,
      mktCap: p.marketCap,
      sector: p.sector,
      industry: p.industry,
    }
  } catch { return null }
}

async function fetchFMPHistorical(symbol, years = 5) {
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${symbol}&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const hist = data?.historical || data || []
    if (!Array.isArray(hist)) return []
    // Limit to `years` of data, weekly sampled for chart lightness
    const cutoff = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const filtered = hist.filter(d => d.date >= cutoff).reverse()
    const weekly = []
    for (let i = 0; i < filtered.length; i += 5) weekly.push({ d: filtered[i].date, v: filtered[i].close })
    return weekly
  } catch { return [] }
}

async function fetchAIImpact() {
  if (aiImpactCache.data && Date.now() - aiImpactCache.ts < AI_IMPACT_TTL) return aiImpactCache.data

  console.log('AI Impact: fetching fresh real-economy data...')

  // Fetch all FRED series in parallel
  const fredData = {}
  await Promise.all(Object.entries(AI_FRED_SERIES).map(async ([id, meta]) => {
    try {
      const obs = await fetchFredSeries(id, meta.limit)
      if (!obs.length) return
      const latest = obs[obs.length - 1]
      const yoyLag = meta.freq === 'Q' ? 4 : 12
      const prior = obs.length > yoyLag ? obs[obs.length - 1 - yoyLag] : null
      const yoy = prior ? ((latest.v - prior.v) / prior.v) * 100 : null
      // 5-yr change (AI boom era roughly 2022→)
      const fiveYrLag = meta.freq === 'Q' ? 20 : 60
      const fiveYrPrior = obs.length > fiveYrLag ? obs[obs.length - 1 - fiveYrLag] : null
      const fiveYr = fiveYrPrior ? ((latest.v - fiveYrPrior.v) / fiveYrPrior.v) * 100 : null
      fredData[id] = {
        id,
        label: meta.label,
        group: meta.group,
        color: meta.color,
        freq: meta.freq,
        unit: meta.unit,
        current: latest.v,
        lastDate: latest.d,
        yoy,
        fiveYr,
        history: obs,
      }
    } catch (e) { console.warn(`AI Impact FRED ${id}:`, e.message) }
  }))

  const result = {
    fred: fredData,
    updated: Date.now(),
  }

  console.log(`AI Impact: ${Object.keys(fredData).length}/${Object.keys(AI_FRED_SERIES).length} FRED series loaded`)
  aiImpactCache = { data: result, ts: Date.now() }
  return result
}

/* ── Central Bank Rates (FMP calendar + FRED supplements, 4-hour cache) ── */
let cbRatesCache = { data: null, ts: 0 }
const CB_RATES_TTL = 4 * 60 * 60 * 1000

// Maps FMP country codes → event name patterns for rate decisions
const CB_EVENTS = [
  { id: 'US', pattern: /fed interest rate|fomc/i },
  { id: 'EU', pattern: /ecb (interest rate|deposit|refinanc)/i, anyCountry: true },
  { id: 'GB', pattern: /(boe|mpc) interest rate/i },
  { id: 'JP', pattern: /boj interest rate/i },
  { id: 'CA', pattern: /boc interest rate/i },
  { id: 'CH', pattern: /snb interest rate/i },
  { id: 'AU', pattern: /rba interest rate/i },
  { id: 'KR', pattern: /(bok|bank of korea) interest rate/i },
  { id: 'MX', pattern: /banxico|mexico.*interest rate/i },
  { id: 'BR', pattern: /copom|bcb.*interest rate/i },
]

// FRED series that are reliably/frequently updated (override FMP for these)
const CB_FRED_SUPPLEMENTS = [
  { id: 'US', series: 'DFF' },            // Federal Funds Rate (daily)
  { id: 'EU', series: 'ECBDFR' },         // ECB Deposit Facility Rate (daily)
  { id: 'GB', series: 'IUDSOIA' },        // UK SONIA → BoE base rate (daily)
  { id: 'KR', series: 'INTDSRKRM193N' },  // South Korea (IMF, monthly, current)
  { id: 'BR', series: 'INTDSRBRM193N' },  // Brazil (IMF, monthly, current)
]

async function fetchCbRates() {
  if (cbRatesCache.data && Date.now() - cbRatesCache.ts < CB_RATES_TTL) return cbRatesCache.data
  const result = {}

  // Step 1: FMP economic calendar → parse most recent rate decisions
  try {
    const calResp = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?apikey=${FMP_KEY}`, {
      headers: { 'User-Agent': UA }
    })
    if (calResp.ok) {
      const calendar = await calResp.json()
      if (Array.isArray(calendar)) {
        for (const cb of CB_EVENTS) {
          const events = calendar
            .filter(e => e.actual != null && (cb.anyCountry || e.country === cb.id) && cb.pattern.test(e.event))
            .sort((a, b) => b.date.localeCompare(a.date))
          if (events.length > 0) {
            result[cb.id] = { rate: events[0].actual, date: events[0].date.slice(0, 10), source: 'FMP' }
          }
        }
      }
    }
  } catch (e) { console.warn('CB rates FMP error:', e.message) }

  // Step 2: FRED direct fetches override FMP for countries with live series
  for (const f of CB_FRED_SUPPLEMENTS) {
    try {
      const r = await fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=${f.series}&api_key=${FRED_KEY}&limit=1&sort_order=desc&file_type=json`,
        { headers: { 'User-Agent': UA } }
      )
      const json = await r.json()
      const obs = json?.observations?.[0]
      if (obs && obs.value !== '.') {
        result[f.id] = { rate: parseFloat(obs.value), date: obs.date, source: 'FRED' }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 300)) // stagger to avoid FRED rate limits
  }

  if (Object.keys(result).length > 0) cbRatesCache = { data: result, ts: Date.now() }
  return result
}

/* ── Index PE via Yahoo Finance (15-min cache) ──────────────── */
let peCache = { data: null, ts: 0 }
let yfAuth = { crumb: null, cookie: null, ts: 0 }
const PE_TTL = 15 * 60 * 1000
const AUTH_TTL = 30 * 60 * 1000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const INDEX_ETFS = [
  { symbol: "SPY", name: "S&P 500",     flag: "🇺🇸" },
  { symbol: "DIA", name: "Dow Jones",    flag: "🏛" },
  { symbol: "QQQ", name: "Nasdaq 100",   flag: "💻" },
  { symbol: "IWM", name: "Russell 2000", flag: "📊" },
]

async function getYFAuth() {
  if (yfAuth.crumb && Date.now() - yfAuth.ts < AUTH_TTL) return yfAuth
  // Step 1: hit fc.yahoo.com to get cookies
  const initResp = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA }, redirect: 'manual'
  })
  const cookies = initResp.headers.getSetCookie?.() || []
  const cookieStr = cookies.map(c => c.split(';')[0]).join('; ')
  // Step 2: get crumb
  const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr }
  })
  const crumb = await crumbResp.text()
  yfAuth = { crumb, cookie: cookieStr, ts: Date.now() }
  return yfAuth
}

async function fetchIndexPE() {
  if (peCache.data && Date.now() - peCache.ts < PE_TTL) return peCache.data
  const auth = await getYFAuth()
  const results = await Promise.all(INDEX_ETFS.map(async (etf) => {
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${etf.symbol}?modules=summaryDetail,price&crumb=${encodeURIComponent(auth.crumb)}`
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': auth.cookie }
      })
      const json = await resp.json()
      const result = json?.quoteSummary?.result?.[0]
      const detail = result?.summaryDetail
      const priceData = result?.price
      const pe = detail?.trailingPE?.raw ?? null
      const earningsYield = pe && pe > 0 ? (1 / pe) * 100 : null
      const changePct = priceData?.regularMarketChangePercent?.raw ?? null
      const price = priceData?.regularMarketPrice?.raw ?? null
      return { ...etf, pe, earningsYield, changePct, price }
    } catch {
      return { ...etf, pe: null, earningsYield: null }
    }
  }))
  peCache = { data: results, ts: Date.now() }
  return results
}

/* ── Commodity spot prices via Yahoo Finance (15-min cache) ──── */
let commodCache = { data: null, ts: 0 }
const COMMODITY_SYMBOLS = [
  // Precious metals
  { symbol: "GC=F",  name: "Gold",     unit: "$/oz",    icon: "🥇", group: "metals",     color: "#F59E0B" },
  { symbol: "SI=F",  name: "Silver",   unit: "$/oz",    icon: "🥈", group: "metals",     color: "#94a3b8" },
  { symbol: "PL=F",  name: "Platinum", unit: "$/oz",    icon: "⚪", group: "metals",     color: "#a78bfa" },
  { symbol: "PA=F",  name: "Palladium",unit: "$/oz",    icon: "🟣", group: "metals",     color: "#c084fc" },
  // Energy
  { symbol: "CL=F",  name: "WTI Crude",    unit: "$/bbl",  icon: "🛢️", group: "energy",     color: "#E8553A" },
  { symbol: "BZ=F",  name: "Brent Crude",  unit: "$/bbl",  icon: "🛢️", group: "energy",     color: "#F97316" },
  { symbol: "NG=F",  name: "Natural Gas",  unit: "$/MMBtu",icon: "🔥", group: "energy",     color: "#3B82F6" },
  // Industrial
  { symbol: "HG=F",  name: "Copper",       unit: "$/lb",   icon: "🟠", group: "industrial", color: "#F97316" },
  // Agriculture
  { symbol: "ZC=F",  name: "Corn",         unit: "¢/bu",   icon: "🌽", group: "agriculture", color: "#F59E0B" },
  { symbol: "ZW=F",  name: "Wheat",        unit: "¢/bu",   icon: "🌾", group: "agriculture", color: "#D97706" },
  { symbol: "ZS=F",  name: "Soybeans",     unit: "¢/bu",   icon: "🫘", group: "agriculture", color: "#10B981" },
  { symbol: "CT=F",  name: "Cotton",       unit: "¢/lb",   icon: "🧵", group: "agriculture", color: "#EC4899" },
  // Softs
  { symbol: "KC=F",  name: "Coffee",       unit: "¢/lb",   icon: "☕", group: "softs",      color: "#92400E" },
  { symbol: "CC=F",  name: "Cocoa",        unit: "$/mt",   icon: "🍫", group: "softs",      color: "#78350F" },
  { symbol: "SB=F",  name: "Sugar",        unit: "¢/lb",   icon: "🧂", group: "softs",      color: "#FBBF24" },
]

// Fetch a single Yahoo quote using the chart API (most reliable, no crumb needed for 1d)
async function fetchYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return null
    const json = await resp.json()
    const m = json?.chart?.result?.[0]?.meta
    if (!m || m.regularMarketPrice == null) return null
    const prev = m.chartPreviousClose ?? m.previousClose ?? null
    const price = m.regularMarketPrice
    const change = prev != null ? price - prev : null
    const changePct = prev != null && prev !== 0 ? (price - prev) / prev : null
    return {
      price,
      change,
      changePct,
      prevClose: prev,
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      timestamp: m.regularMarketTime ?? null,
    }
  } catch { return null }
}

// Fetch ~30 daily closes for sparklines. Returns array of {ts, v} (ms epoch + close).
async function fetchYahooSparkline(symbol, range = '1mo', interval = '1d') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    const r = json?.chart?.result?.[0]
    const ts = r?.timestamp || []
    const closes = (r?.indicators?.quote?.[0]?.close) || []
    return ts.map((t, i) => ({ ts: t * 1000, v: closes[i] })).filter(p => p.v != null)
  } catch { return [] }
}

/* ── Dashboard Summary — landing-page hero data ──────────────────────────
   Batches indexes, commodities, crypto, and macro rates into a single
   endpoint so the landing page is one fetch. Cached 1 min. */
const DASHBOARD_SUMMARY_TTL = 60 * 1000
let dashboardSummaryCache = { data: null, ts: 0 }

const SUMMARY_INDEXES = [
  { symbol: 'SPY',  name: 'S&P 500'      },
  { symbol: 'QQQ',  name: 'Nasdaq 100'   },
  { symbol: 'IWM',  name: 'Russell 2000' },
  { symbol: 'DIA',  name: 'Dow Jones'    },
  { symbol: '^VIX', name: 'VIX'          },
]
const SUMMARY_COMMODITIES = [
  { symbol: 'CL=F', name: 'Oil (WTI)'    },
  { symbol: 'GC=F', name: 'Gold'         },
  { symbol: 'SI=F', name: 'Silver'       },
  { symbol: 'NG=F', name: 'Nat Gas'      },
  { symbol: 'HG=F', name: 'Copper'       },
]
const SUMMARY_CRYPTO = [
  { symbol: 'BTC-USD', display: 'BTC',  name: 'Bitcoin'  },
  { symbol: 'ETH-USD', display: 'ETH',  name: 'Ethereum' },
  { symbol: 'SOL-USD', display: 'SOL',  name: 'Solana'   },
]
const SUMMARY_RATES = [
  { id: 'DFF',          name: 'Fed Funds',      unit: '%'  },
  { id: 'DGS2',         name: '2Y Treasury',    unit: '%'  },
  { id: 'DGS10',        name: '10Y Treasury',   unit: '%'  },
  { id: 'DGS30',        name: '30Y Treasury',   unit: '%'  },
  { id: 'MORTGAGE30US', name: '30Y Mortgage',   unit: '%'  },
]

async function fetchDashboardSummary() {
  if (dashboardSummaryCache.data && Date.now() - dashboardSummaryCache.ts < DASHBOARD_SUMMARY_TTL) return dashboardSummaryCache.data

  // Quote + sparkline batched per asset class
  const fetchAsset = async (a) => {
    const [q, spark] = await Promise.all([
      fetchYahooQuote(a.symbol),
      fetchYahooSparkline(a.symbol, '1mo', '1d'),
    ])
    if (!q) return null
    return {
      symbol: a.display || a.symbol,
      yahooSymbol: a.symbol,
      name: a.name,
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      prevClose: q.prevClose,
      spark: spark.slice(-22).map(p => p.v),  // ~22 trading days
    }
  }

  // All asset classes in parallel — Yahoo handles this well
  const [indexes, commodities, crypto] = await Promise.all([
    Promise.all(SUMMARY_INDEXES.map(fetchAsset)),
    Promise.all(SUMMARY_COMMODITIES.map(fetchAsset)),
    Promise.all(SUMMARY_CRYPTO.map(fetchAsset)),
  ])

  // Rates from FRED in parallel (need latest observation)
  const rates = await Promise.all(SUMMARY_RATES.map(async r => {
    const obs = await fetchFredSeries(r.id, 60)  // recent window
    if (!obs.length) return null
    const latest = obs[obs.length - 1]
    const prior = obs.length > 5 ? obs[obs.length - 6] : null   // ~5 obs ago
    return {
      id: r.id,
      name: r.name,
      unit: r.unit,
      value: latest.v,
      lastDate: latest.d,
      change: prior ? latest.v - prior.v : null,
      spark: obs.slice(-30).map(o => o.v),
    }
  }))
  const rateMap = Object.fromEntries(rates.filter(Boolean).map(r => [r.id, r]))

  // Compute 2s10s spread (basis points) as a synthetic row
  if (rateMap.DGS2 && rateMap.DGS10) {
    rateMap.spread2s10s = {
      id: 'spread2s10s',
      name: '2s10s Spread',
      unit: 'bp',
      value: (rateMap.DGS10.value - rateMap.DGS2.value) * 100,
      lastDate: rateMap.DGS10.lastDate,
      change: null,
      synthetic: true,
    }
  }

  const result = {
    asOf: Date.now(),
    indexes: indexes.filter(Boolean),
    commodities: commodities.filter(Boolean),
    crypto: crypto.filter(Boolean),
    rates: Object.values(rateMap),
  }
  dashboardSummaryCache = { data: result, ts: Date.now() }
  console.log(`Dashboard summary: ${result.indexes.length} indexes, ${result.commodities.length} commodities, ${result.crypto.length} crypto, ${result.rates.length} rates`)
  return result
}

async function fetchCommoditySpot() {
  if (commodCache.data && Date.now() - commodCache.ts < PE_TTL) return commodCache.data
  // Run in small batches to be polite to Yahoo
  const results = []
  const BATCH = 5
  for (let i = 0; i < COMMODITY_SYMBOLS.length; i += BATCH) {
    const batch = COMMODITY_SYMBOLS.slice(i, i + BATCH)
    const batchRes = await Promise.all(batch.map(async (c) => {
      const q = await fetchYahooQuote(c.symbol)
      return { ...c, ...(q || { price: null, change: null, changePct: null, prevClose: null, dayHigh: null, dayLow: null }) }
    }))
    results.push(...batchRes)
    if (i + BATCH < COMMODITY_SYMBOLS.length) await new Promise(r => setTimeout(r, 150))
  }
  const successCount = results.filter(r => r.price != null).length
  console.log(`Commodity spot: ${successCount}/${COMMODITY_SYMBOLS.length} symbols fetched`)
  commodCache = { data: results, ts: Date.now() }
  return results
}

/* ── Commodity historical (Yahoo Finance, 1-hour cache, all symbols) ── */
let metalHistCache = { data: null, ts: 0 }

async function fetchMetalHistory() {
  if (metalHistCache.data && Date.now() - metalHistCache.ts < 60 * 60 * 1000) return metalHistCache.data
  const results = []
  const BATCH = 5
  for (let i = 0; i < COMMODITY_SYMBOLS.length; i += BATCH) {
    const batch = COMMODITY_SYMBOLS.slice(i, i + BATCH)
    const batchRes = await Promise.all(batch.map(async (c) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(c.symbol)}?range=10y&interval=1wk`
        const resp = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!resp.ok) return { symbol: c.symbol, name: c.name, group: c.group, color: c.color, history: [] }
        const json = await resp.json()
        const result = json.chart?.result?.[0]
        const ts = result?.timestamp || []
        const closes = result?.indicators?.quote?.[0]?.close || []
        const history = []
        for (let j = 0; j < ts.length; j++) {
          if (closes[j] != null) {
            history.push({ d: new Date(ts[j] * 1000).toISOString().slice(0, 10), v: closes[j] })
          }
        }
        return { symbol: c.symbol, name: c.name, group: c.group, color: c.color, history }
      } catch { return { symbol: c.symbol, name: c.name, group: c.group, color: c.color, history: [] } }
    }))
    results.push(...batchRes)
    if (i + BATCH < COMMODITY_SYMBOLS.length) await new Promise(r => setTimeout(r, 200))
  }
  const withData = results.filter(r => r.history.length).length
  console.log(`Commodity history: ${withData}/${COMMODITY_SYMBOLS.length} symbols have history`)
  metalHistCache = { data: results, ts: Date.now() }
  return results
}

/* ── BLS CPI Category Data (1-hour cache) ────────────────────── */
let blsCache = { data: null, ts: 0 }
const BLS_TTL = 60 * 60 * 1000

// BLS series IDs for CPI categories (seasonally adjusted, CPI-U, US city avg)
const BLS_CPI_SERIES = {
  CUSR0000SA0:      { label: "CPI All Items",      color: "#E8553A", icon: "📈" },
  CUSR0000SA0L1E:   { label: "Core CPI",           color: "#3B82F6", icon: "🎯" },
  CUSR0000SAF1:     { label: "Food",               color: "#F97316", icon: "🍕" },
  CUSR0000SA0E:     { label: "Energy",             color: "#FBBF24", icon: "⚡" },
  CUSR0000SAH1:     { label: "Shelter",            color: "#60A5FA", icon: "🏠" },
  CUSR0000SAM:      { label: "Medical Care",       color: "#EC4899", icon: "🏥" },
  CUSR0000SAT:      { label: "Transportation",     color: "#10B981", icon: "🚗" },
  CUSR0000SAA:      { label: "Apparel",            color: "#8B5CF6", icon: "👔" },
  CUSR0000SAR:      { label: "Recreation",         color: "#14B8A6", icon: "🎮" },
  CUSR0000SAE:      { label: "Education & Comm",   color: "#6366F1", icon: "📚" },
  CUSR0000SETA02:   { label: "Used Cars & Trucks", color: "#34D399", icon: "🚙" },
  CUSR0000SETA01:   { label: "New Vehicles",       color: "#4ADE80", icon: "🚘" },
}

async function fetchBLSCPI() {
  if (blsCache.data && Date.now() - blsCache.ts < BLS_TTL) return blsCache.data

  const seriesIds = Object.keys(BLS_CPI_SERIES)
  const currentYear = new Date().getFullYear()

  try {
    const postBody = {
      seriesid: seriesIds,
      startyear: String(currentYear - 2),
      endyear: String(currentYear),
    }
    if (BLS_KEY) postBody.registrationkey = BLS_KEY

    const resp = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(postBody)
    })
    const json = await resp.json()
    if (json.status !== 'REQUEST_SUCCEEDED') {
      console.warn('BLS API error:', json.status, json.message)
      if (json.message?.some(m => m.includes('threshold'))) {
        console.warn('BLS daily request limit reached. Register for a free key at https://data.bls.gov/registrationEngine/')
      }
      return null
    }
    console.log(`BLS CPI: fetched ${json.Results?.series?.length || 0} series successfully`)

    const result = {}
    for (const series of (json.Results?.series || [])) {
      const meta = BLS_CPI_SERIES[series.seriesID]
      if (!meta) continue

      // Data comes newest-first, reverse for chronological order
      const points = [...series.data]
        .filter(d => d.value !== '-' && d.period !== 'M13') // skip annual avg & missing
        .reverse()
        .map(d => ({
          date: `${d.year}-${d.period.replace('M', '').padStart(2, '0')}`,
          value: parseFloat(d.value)
        }))

      // Compute YoY % change from index values
      const history = []
      for (let i = 12; i < points.length; i++) {
        const prev = points[i - 12].value
        if (prev > 0) {
          const yoy = parseFloat((((points[i].value - prev) / prev) * 100).toFixed(2))
          history.push({ d: points[i].date, v: yoy })
        }
      }

      const latest = history[history.length - 1]
      result[series.seriesID] = {
        ...meta,
        yoy: latest?.v ?? null,
        lastDate: latest?.d ?? null,
        latestIndex: points[points.length - 1]?.value ?? null,
        history,
      }
    }

    if (Object.keys(result).length > 0) {
      blsCache = { data: result, ts: Date.now() }
    }
    return result
  } catch (e) {
    console.error('BLS CPI fetch error:', e.message)
    return null
  }
}

/* ── S&P 500 Screener (FMP profile + metrics, 6-hour cache) ──── */
const SP500_DATA_FILE = path.join(__dirname, 'sp500-data.json')
const SP500_TTL = 6 * 60 * 60 * 1000
let sp500Cache = { data: null, ts: 0 }
let sp500Refreshing = false  // stale-while-revalidate flag

const SP500_TICKERS = [
  "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB","AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL",
  "GOOG","MO","AMZN","AMCR","AEE","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN","APH","ADI","AON","APA","APO","AAPL","AMAT",
  "APP","APTV","ACGL","ADM","ARES","ANET","AJG","AIZ","T","ATO","ADSK","ADP","AZO","AVB","AVY","AXON","BKR","BALL","BAC","BAX",
  "BDX","BRK.B","BBY","TECH","BIIB","BLK","BX","XYZ","BK","BA","BKNG","BSX","BMY","AVGO","BR","BRO","BF.B","BLDR","BG","BXP",
  "CHRW","CDNS","CPT","CPB","COF","CAH","CCL","CARR","CVNA","CAT","CBOE","CBRE","CDW","COR","CNC","CNP","CF","CRL","SCHW","CHTR",
  "CVX","CMG","CB","CHD","CIEN","CI","CINF","CTAS","CSCO","C","CFG","CLX","CME","CMS","KO","CTSH","COIN","CL","CMCSA","FIX",
  "CAG","COP","ED","STZ","CEG","COO","CPRT","GLW","CPAY","CTVA","CSGP","COST","CTRA","CRH","CRWD","CCI","CSX","CMI","CVS","DHR",
  "DRI","DDOG","DVA","DECK","DE","DELL","DAL","DVN","DXCM","FANG","DLR","DG","DLTR","D","DPZ","DASH","DOV","DOW","DHI","DTE",
  "DUK","DD","ETN","EBAY","ECL","EIX","EW","EA","ELV","EME","EMR","ETR","EOG","EPAM","EQT","EFX","EQIX","EQR","ERIE","ESS",
  "EL","EG","EVRG","ES","EXC","EXE","EXPE","EXPD","EXR","XOM","FFIV","FDS","FICO","FAST","FRT","FDX","FIS","FITB","FSLR","FE",
  "FISV","F","FTNT","FTV","FOXA","FOX","BEN","FCX","GRMN","IT","GE","GEHC","GEV","GEN","GNRC","GD","GIS","GM","GPC","GILD",
  "GPN","GL","GDDY","GS","HAL","HIG","HAS","HCA","DOC","HSIC","HSY","HPE","HLT","HOLX","HD","HON","HRL","HST","HWM","HPQ",
  "HUBB","HUM","HBAN","HII","IBM","IEX","IDXX","ITW","INCY","IR","PODD","INTC","IBKR","ICE","IFF","IP","INTU","ISRG","IVZ","INVH",
  "IQV","IRM","JBHT","JBL","JKHY","J","JNJ","JCI","JPM","KVUE","KDP","KEY","KEYS","KMB","KIM","KMI","KKR","KLAC","KHC","KR",
  "LHX","LH","LRCX","LW","LVS","LDOS","LEN","LII","LLY","LIN","LYV","LMT","L","LOW","LULU","LYB","MTB","MPC","MAR","MRSH",
  "MLM","MAS","MA","MTCH","MKC","MCD","MCK","MDT","MRK","META","MET","MTD","MGM","MCHP","MU","MSFT","MAA","MRNA","MOH","TAP",
  "MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSCI","NDAQ","NTAP","NFLX","NEM","NWSA","NWS","NEE","NKE","NI","NDSN","NSC","NTRS",
  "NOC","NCLH","NRG","NUE","NVDA","NVR","NXPI","ORLY","OXY","ODFL","OMC","ON","OKE","ORCL","OTIS","PCAR","PKG","PLTR","PANW","PSKY",
  "PH","PAYX","PAYC","PYPL","PNR","PEP","PFE","PCG","PM","PSX","PNW","PNC","POOL","PPG","PPL","PFG","PG","PGR","PLD","PRU",
  "PEG","PTC","PSA","PHM","PWR","QCOM","DGX","Q","RL","RJF","RTX","O","REG","REGN","RF","RSG","RMD","RVTY","HOOD","ROK",
  "ROL","ROP","ROST","RCL","SPGI","CRM","SNDK","SBAC","SLB","STX","SRE","NOW","SHW","SPG","SWKS","SJM","SW","SNA","SOLV","SO",
  "LUV","SWK","SBUX","STT","STLD","STE","SYK","SMCI","SYF","SNPS","SYY","TMUS","TROW","TTWO","TPR","TRGP","TGT","TEL","TDY","TER",
  "TSLA","TXN","TPL","TXT","TMO","TJX","TKO","TTD","TSCO","TT","TDG","TRV","TRMB","TFC","TYL","TSN","USB","UBER","UDR","ULTA",
  "UNP","UAL","UPS","URI","UNH","UHS","VLO","VTR","VLTO","VRSN","VRSK","VZ","VRTX","VTRS","VICI","V","VST","VMC","WRB","GWW",
  "WAB","WMT","DIS","WBD","WM","WAT","WEC","WFC","WELL","WST","WDC","WY","WSM","WMB","WTW","WDAY","WYNN","XEL","XYL","YUM",
  "ZBRA","ZBH","ZTS"
]

// Background refresh — fires-and-forgets the heavy 503-ticker fetch so the
// foreground request can return stale-but-usable data immediately.
async function refreshSP500InBackground(existing) {
  try {
    const data = await fetchSP500Tickers(existing, [...SP500_TICKERS], 'background')
    sp500Cache = { data, ts: Date.now() }
    console.log(`S&P 500 background refresh: complete, ${data.length} tickers updated`)
  } catch (e) {
    console.error('S&P 500 background refresh failed:', e.message)
  }
}

// Core fetch loop — pulled out so both synchronous and background paths can use it
async function fetchSP500Tickers(existing, needsFetch, label = 'sync') {
  const existingMap = new Map(existing.map(s => [s.symbol, s]))
  const BATCH = 5
  const DELAY = 3500
  let rateLimited = false

  const fetchJSON = async (url) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      const data = await resp.json()
      if (data && data['Error Message'] && /limit/i.test(data['Error Message'])) {
        rateLimited = true
        return null
      }
      return Array.isArray(data) ? data[0] : null
    } catch { return null }
    finally { clearTimeout(timer) }
  }

  for (let i = 0; i < needsFetch.length; i += BATCH) {
    if (rateLimited) {
      console.log(`S&P 500 (${label}): rate limited at ${i}/${needsFetch.length}, saving partial progress`)
      break
    }
    const batch = needsFetch.slice(i, i + BATCH)
    await Promise.all(batch.map(async (ticker) => {
      try {
        const fmpTicker = ticker.replace('.', '-')
        const [profile, metrics, ratios] = await Promise.all([
          fetchJSON(`https://financialmodelingprep.com/stable/profile?symbol=${fmpTicker}&apikey=${FMP_KEY}`),
          fetchJSON(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${fmpTicker}&apikey=${FMP_KEY}`),
          fetchJSON(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${fmpTicker}&apikey=${FMP_KEY}`),
        ])
        if (rateLimited) return
        // If profile failed but we had old data, KEEP the old data (don't blank fields)
        if (!profile && existingMap.has(ticker)) return
        const p = profile || {}, m = metrics || {}, r = ratios || {}
        existingMap.set(ticker, {
          symbol: ticker,
          name: p.companyName ?? existingMap.get(ticker)?.name ?? null,
          sector: p.sector ?? existingMap.get(ticker)?.sector ?? null,
          industry: p.industry ?? existingMap.get(ticker)?.industry ?? null,
          mktCap: p.marketCap ?? existingMap.get(ticker)?.mktCap ?? null,
          price: p.price ?? null,
          changePct: p.changePercentage ?? null,
          beta: p.beta ?? existingMap.get(ticker)?.beta ?? null,
          pe: r.priceToEarningsRatioTTM ?? null,
          peg: r.priceToEarningsGrowthRatioTTM ?? null,
          earningsYield: m.earningsYieldTTM ?? null,
          fcfYield: m.freeCashFlowYieldTTM ?? null,
          roe: m.returnOnEquityTTM ?? null,
          roic: m.returnOnInvestedCapitalTTM ?? null,
          evEbitda: m.evToEBITDATTM ?? null,
          netDebtEbitda: m.netDebtToEBITDATTM ?? null,
          currentRatio: m.currentRatioTTM ?? null,
          grossMargin: r.grossProfitMarginTTM ?? null,
          opMargin: r.operatingProfitMarginTTM ?? null,
          netMargin: r.netProfitMarginTTM ?? null,
          divYield: r.dividendYieldTTM ?? null,
        })
      } catch (e) {
        console.warn(`S&P 500 (${label}): error fetching ${ticker}:`, e.message)
      }
    }))
    if ((i + BATCH) % 50 < BATCH) {
      console.log(`S&P 500 (${label}): progress ${Math.min(i + BATCH, needsFetch.length)}/${needsFetch.length}`)
    }
    if (i + BATCH < needsFetch.length) await new Promise(r => setTimeout(r, DELAY))
  }

  const results = SP500_TICKERS.map(t => existingMap.get(t)).filter(Boolean)
  const complete = results.filter(s => s.name && s.mktCap).length
  console.log(`S&P 500 (${label}): done — ${complete}/${results.length} complete${rateLimited ? ' (rate-limited)' : ''}`)
  const now = Date.now()
  try { fs.writeFileSync(SP500_DATA_FILE, JSON.stringify({ ts: now, data: results }, null, 2)) } catch (e) { console.error('Failed to save S&P 500 data:', e.message) }
  return results
}

async function fetchSP500Screener() {
  // Check memory cache
  if (sp500Cache.data && Date.now() - sp500Cache.ts < SP500_TTL) return sp500Cache.data

  // Check disk cache
  let existing = []
  let diskTs = 0
  try {
    if (fs.existsSync(SP500_DATA_FILE)) {
      const disk = JSON.parse(fs.readFileSync(SP500_DATA_FILE, 'utf8'))
      if (disk.ts && Date.now() - disk.ts < SP500_TTL) {
        sp500Cache = { data: disk.data, ts: disk.ts }
        return disk.data
      }
      // Stale-but-present: serve immediately, refresh in background
      if (disk.data) { existing = disk.data; diskTs = disk.ts || 0 }
    }
  } catch {}

  // Stale-while-revalidate: if we have ANY existing data (even old), return it
  // immediately and kick off the slow refresh in the background. This keeps the
  // page responsive — refreshing 503 tickers takes ~6 min and would otherwise
  // block the first request after the TTL expires.
  if (existing.length > 0 && !sp500Refreshing) {
    sp500Refreshing = true
    // Background refresh — won't be awaited
    refreshSP500InBackground(existing).finally(() => { sp500Refreshing = false })
    // Update in-memory cache ts so subsequent requests in the next 6h serve
    // this stale data without re-triggering refresh
    sp500Cache = { data: existing, ts: Date.now() }
    console.log(`S&P 500 screener: serving ${existing.length} stale tickers (last refresh ${diskTs ? new Date(diskTs).toISOString() : 'unknown'}), refreshing in background...`)
    return existing
  }
  // No data at all — caller will block on the synchronous fetch below

  // Cold start (no disk cache, no in-memory cache): block on the synchronous
  // fetch. This is rare — only happens on a brand-new install.
  console.log(`S&P 500 screener: cold start — blocking fetch of all ${SP500_TICKERS.length} tickers...`)
  const results = await fetchSP500Tickers([], [...SP500_TICKERS], 'sync')
  sp500Cache = { data: results, ts: Date.now() }
  return results
}

/* ── OpenRouter Rankings — persisted history (fixes 7-day window) ──── */
const OR_RANKINGS_FILE = path.join(__dirname, 'rankings-history.json')
let orRankingsCache = { data: null, ts: 0 }
const OR_RANKINGS_TTL = 15 * 60 * 1000 // 15-min live cache

function loadRankingsHistory() {
  try {
    if (fs.existsSync(OR_RANKINGS_FILE)) return JSON.parse(fs.readFileSync(OR_RANKINGS_FILE, 'utf8'))
  } catch {}
  return { rows: [] }
}
function saveRankingsHistory(data) {
  try { fs.writeFileSync(OR_RANKINGS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save rankings history:', e.message) }
}

// Fetch fresh rankings from OpenRouter's RSC endpoint (server-side, no CORS issues)
// OpenRouter restored a clean public GET endpoint for rankings (their old RSC
// POST trick broke). /rankings/models is the per-model token-usage snapshot.
async function fetchOpenRouterRankingsFresh() {
  const resp = await fetch('https://openrouter.ai/api/frontend/rankings/models', { headers: { 'User-Agent': UA } })
  if (!resp.ok) throw new Error(`OpenRouter rankings HTTP ${resp.status}`)
  const json = await resp.json()
  if (!Array.isArray(json.data)) throw new Error('OpenRouter rankings: unexpected shape')
  return json.data
}

// Provider-level weekly token volume — 52 weeks of history. The key signal for
// "overall market growth" and how provider share shifts over time.
// Shape: [{ x: "2025-06-16", ys: { google: tokens, anthropic: tokens, ... } }]
async function fetchOpenRouterMarketShare() {
  try {
    const resp = await fetch('https://openrouter.ai/api/frontend/rankings/market-share', { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    return Array.isArray(json.data) ? json.data : []
  } catch (e) {
    console.warn('OpenRouter market-share:', e.message)
    return []
  }
}

// Normalize date to YYYY-MM-DD (OpenRouter returns "2026-04-22 00:00:00")
const normDate = d => (d || '').slice(0, 10)

// Today in server-local YYYY-MM-DD
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

async function getRankingsWithHistory() {
  if (orRankingsCache.data && Date.now() - orRankingsCache.ts < OR_RANKINGS_TTL) return orRankingsCache.data

  // Fetch fresh model rows + 52-week market-share history in parallel
  let fresh = [], marketShare = []
  try {
    [fresh, marketShare] = await Promise.all([
      fetchOpenRouterRankingsFresh(),
      fetchOpenRouterMarketShare(),
    ])
  } catch (e) {
    console.warn('OpenRouter rankings fetch failed:', e.message)
    // Fall back to archive only
    const archive = loadRankingsHistory()
    const result = { rows: archive.rows, marketShare: archive.marketShare || [], source: 'archive-only', updated: Date.now() }
    orRankingsCache = { data: result, ts: Date.now() }
    return result
  }

  // Load archive and merge
  const archive = loadRankingsHistory()
  // Key: `${date}|${model_permaslug}` → row
  const merged = new Map()
  for (const row of archive.rows || []) {
    const d = normDate(row.date)
    if (!d || !row.model_permaslug) continue
    merged.set(`${d}|${row.model_permaslug}`, { ...row, date: d })
  }
  const today = todayStr()
  let added = 0, updatedToday = 0
  for (const row of fresh) {
    const d = normDate(row.date)
    if (!d || !row.model_permaslug) continue
    const key = `${d}|${row.model_permaslug}`
    const existed = merged.has(key)
    // For past dates: only insert if not already archived (archive is authoritative for "closed" days).
    // For today: always overwrite (latest snapshot for today-so-far).
    if (d === today || !existed) {
      merged.set(key, { ...row, date: d })
      if (existed) updatedToday++
      else added++
    }
  }

  const rows = Array.from(merged.values())
  // Sort by date ascending
  rows.sort((a, b) => a.date.localeCompare(b.date))

  // Persist (non-blocking best-effort) — include market-share so the archive
  // retains it if a later live fetch fails
  saveRankingsHistory({ rows, marketShare, lastUpdated: Date.now() })

  const uniqueDates = new Set(rows.map(r => r.date)).size
  console.log(`OpenRouter rankings: +${added} new, ~${updatedToday} today updated, ${rows.length} total archived across ${uniqueDates} dates · ${marketShare.length} weeks market-share`)

  const result = { rows, marketShare, source: 'live+archive', updated: Date.now(), dates: uniqueDates }
  orRankingsCache = { data: result, ts: Date.now() }
  return result
}

/* ── Global Liquidity & Debt (FRED + FX conversion) ──────────────────────
   One endpoint for the "how much cash is in the world, where is it, and who
   owes what to whom" page. Everything normalized to billions of USD.
   Net Liquidity = Fed balance sheet − reverse repo − Treasury General Account
   (the metric traders watch: dollars actually available to markets). */
let liquidityCache = { data: null, ts: 0 }
const LIQUIDITY_TTL = 4 * 60 * 60 * 1000

// scale → multiply raw FRED value by this to get billions USD (fx applied separately)
const LIQ_SERIES = {
  WALCL:           { label: 'Fed Balance Sheet',            scale: 1e-3, limit: 530,  freq: 'W' },
  RRPONTSYD:       { label: 'Reverse Repo (RRP)',           scale: 1,    limit: 1300, freq: 'D' },
  WTREGEN:         { label: 'Treasury General Account',     scale: 1e-3, limit: 530,  freq: 'W' },
  WRESBAL:         { label: 'Bank Reserves',                scale: 1e-3, limit: 530,  freq: 'W' },
  M2SL:            { label: 'M2 Money Supply',              scale: 1,    limit: 400,  freq: 'M' },
  CURRCIR:         { label: 'Currency in Circulation',      scale: 1,    limit: 400,  freq: 'M' },
  ECBASSETSW:      { label: 'ECB Balance Sheet',            scale: 1e-3, limit: 530,  freq: 'W', fx: 'EUR' },
  JPNASSETS:       { label: 'BOJ Balance Sheet',            scale: 0.1,  limit: 400,  freq: 'M', fx: 'JPY' },
  DTWEXBGS:        { label: 'Broad Dollar Index',           scale: 1,    limit: 1300, freq: 'D' },
  GFDEBTN:         { label: 'Federal Debt Total',           scale: 1e-3, limit: 220,  freq: 'Q' },
  GFDEGDQ188S:     { label: 'Federal Debt to GDP',          scale: 1,    limit: 220,  freq: 'Q' },
  A091RC1Q027SBEA: { label: 'Federal Interest Payments',    scale: 1,    limit: 220,  freq: 'Q' },
  FDHBFIN:         { label: 'Debt Held by Foreigners',      scale: 1,    limit: 220,  freq: 'Q' },
  FDHBFRBN:        { label: 'Debt Held by Federal Reserve', scale: 1,    limit: 220,  freq: 'Q' },
  FDHBATN:         { label: 'Debt Held by Agencies/Trusts', scale: 1e-3, limit: 220,  freq: 'Q' },
  CMDEBT:          { label: 'Household Debt',               scale: 1e-3, limit: 220,  freq: 'Q' },
  BCNSDODNS:       { label: 'Corporate Debt (Nonfin)',      scale: 1e-3, limit: 220,  freq: 'Q' },
}

async function fetchGlobalLiquidity() {
  if (liquidityCache.data && Date.now() - liquidityCache.ts < LIQUIDITY_TTL) return liquidityCache.data
  console.log('Global liquidity: fetching FRED series + FX...')

  // FX for converting ECB (EUR) and BOJ (JPY) balance sheets to USD
  const [eurQ, jpyQ] = await Promise.all([
    fetchYahooQuote('EURUSD=X'),
    fetchYahooQuote('JPY=X'),       // USDJPY
  ])
  const eurUsd = eurQ?.price || 1.08
  const usdJpy = jpyQ?.price || 150

  const series = {}
  await Promise.all(Object.entries(LIQ_SERIES).map(async ([id, meta]) => {
    try {
      const obs = await fetchFredSeries(id, meta.limit)
      if (!obs.length) return
      const fxMult = meta.fx === 'EUR' ? eurUsd : meta.fx === 'JPY' ? (1 / usdJpy) : 1
      const hist = obs.map(o => ({ d: o.d, v: +(o.v * meta.scale * fxMult).toFixed(2) }))
      const latest = hist[hist.length - 1]
      const yoyLag = meta.freq === 'Q' ? 4 : meta.freq === 'M' ? 12 : meta.freq === 'W' ? 52 : 260
      const prior = hist.length > yoyLag ? hist[hist.length - 1 - yoyLag] : null
      series[id] = {
        id, label: meta.label, freq: meta.freq,
        current: latest.v, lastDate: latest.d,
        yoy: prior && prior.v ? +(((latest.v - prior.v) / Math.abs(prior.v)) * 100).toFixed(2) : null,
        history: hist,
      }
    } catch (e) { console.warn(`Liquidity FRED ${id}:`, e.message) }
  }))

  // Net Liquidity = WALCL − RRP − TGA, computed on WALCL's weekly dates with
  // nearest-prior matching for the daily RRP series.
  let netLiquidity = []
  if (series.WALCL && series.WTREGEN && series.RRPONTSYD) {
    const tgaMap = new Map(series.WTREGEN.history.map(p => [p.d, p.v]))
    const rrp = series.RRPONTSYD.history
    let ri = 0
    netLiquidity = series.WALCL.history.map(p => {
      while (ri + 1 < rrp.length && rrp[ri + 1].d <= p.d) ri++
      const rrpV = rrp[ri] && rrp[ri].d <= p.d ? rrp[ri].v : 0
      const tgaV = tgaMap.get(p.d)
      if (tgaV == null) return null
      return { d: p.d, v: +(p.v - rrpV - tgaV).toFixed(2) }
    }).filter(Boolean)
  }

  // Debt holders breakdown (latest common data)
  let holders = null
  if (series.GFDEBTN && series.FDHBFIN && series.FDHBFRBN && series.FDHBATN) {
    const total = series.GFDEBTN.current
    const foreign = series.FDHBFIN.current
    const fed = series.FDHBFRBN.current
    const intragov = series.FDHBATN.current
    holders = {
      total,
      asOf: series.GFDEBTN.lastDate,
      breakdown: [
        { name: 'Foreign Investors',        value: foreign,                                  color: '#3B82F6' },
        { name: 'Federal Reserve',          value: fed,                                      color: '#E8553A' },
        { name: 'US Gov Trust Funds',       value: intragov,                                 color: '#8B5CF6' },
        { name: 'US Private (banks, funds, households)', value: +(total - foreign - fed - intragov).toFixed(0), color: '#10B981' },
      ],
    }
  }

  const result = {
    series, netLiquidity, holders,
    fx: { eurUsd, usdJpy },
    updated: Date.now(),
  }
  console.log(`Global liquidity: ${Object.keys(series).length}/${Object.keys(LIQ_SERIES).length} series, netLiq points: ${netLiquidity.length}`)
  liquidityCache = { data: result, ts: Date.now() }
  return result
}

/* ── Hyperscaler AI capex tracker (FMP quarterly cash flow) ──────────────
   Pulls quarterly capex for the major hyperscaler builders. We apply a
   per-company "AI share %" assumption (configurable client-side) to estimate
   AI-specific capex — the closest you can get without earnings-call NLP. The
   raw company numbers are exact; the AI carve-out is an interpretation. */
const HYPERSCALER_CAPEX_FILE = path.join(__dirname, 'hyperscaler-capex.json')
let hyperscalerCapexCache = { data: null, ts: 0 }
const HYPERSCALER_CAPEX_TTL = 12 * 60 * 60 * 1000 // 12-hour cache (quarterly data changes slowly)

const HYPERSCALERS = [
  { symbol: 'MSFT',  name: 'Microsoft', color: '#00A4EF' },
  { symbol: 'GOOGL', name: 'Alphabet',  color: '#4285F4' },
  { symbol: 'META',  name: 'Meta',      color: '#1877F2' },
  { symbol: 'AMZN',  name: 'Amazon',    color: '#FF9900' },
  { symbol: 'ORCL',  name: 'Oracle',    color: '#F80000' },
]

function loadHyperscalerCapex() {
  try {
    if (fs.existsSync(HYPERSCALER_CAPEX_FILE)) return JSON.parse(fs.readFileSync(HYPERSCALER_CAPEX_FILE, 'utf8'))
  } catch {}
  return { companies: {}, updated: 0 }
}
function saveHyperscalerCapex(data) {
  try { fs.writeFileSync(HYPERSCALER_CAPEX_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save hyperscaler capex:', e.message) }
}

async function fetchHyperscalerQuarterly(symbol, limit = 20) {
  try {
    const resp = await fetch(
      `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${symbol}&period=quarter&limit=${limit}&apikey=${FMP_KEY}`,
      { headers: { 'User-Agent': UA } }
    )
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map(q => ({
      date: q.date,                                                    // "2026-03-31"
      fiscalYear: q.fiscalYear,
      period: q.period,                                                // "Q3"
      // FMP returns negative numbers for cash outflows; take absolute
      capex: Math.abs(q.capitalExpenditure || q.investmentsInPropertyPlantAndEquipment || 0),
      operatingCashFlow: q.netCashProvidedByOperatingActivities || 0,
    })).sort((a, b) => a.date.localeCompare(b.date))
  } catch (e) {
    console.warn(`Hyperscaler ${symbol}:`, e.message)
    return []
  }
}

async function getHyperscalerCapex() {
  if (hyperscalerCapexCache.data && Date.now() - hyperscalerCapexCache.ts < HYPERSCALER_CAPEX_TTL) return hyperscalerCapexCache.data

  console.log('Hyperscaler capex: fetching quarterly cash flows...')
  const companies = {}
  // Sequential to avoid hammering FMP
  for (const hs of HYPERSCALERS) {
    const quarters = await fetchHyperscalerQuarterly(hs.symbol, 20)
    if (quarters.length) {
      companies[hs.symbol] = {
        symbol: hs.symbol,
        name: hs.name,
        color: hs.color,
        quarters,
      }
    }
  }

  // If FMP completely failed, fall back to last archive
  if (Object.keys(companies).length === 0) {
    console.warn('Hyperscaler capex: FMP returned no data — serving archive')
    const archive = loadHyperscalerCapex()
    if (archive.companies && Object.keys(archive.companies).length) {
      const result = { ...archive, source: 'archive-only', updated: Date.now() }
      hyperscalerCapexCache = { data: result, ts: Date.now() }
      return result
    }
  }

  const result = { companies, source: 'live', updated: Date.now() }
  saveHyperscalerCapex(result)
  const totalQuarters = Object.values(companies).reduce((s, c) => s + c.quarters.length, 0)
  console.log(`Hyperscaler capex: ${Object.keys(companies).length} companies, ${totalQuarters} total quarters`)
  hyperscalerCapexCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI SDK Downloads (PyPI + npm) — best proxy for paid-API token demand ──
   Every commercial AI app installs an SDK before it generates a single token.
   So SDK install counts are a leading indicator of paid-API token volume across
   the major providers. PyPI exposes ~6 months of daily history out of the box;
   npm exposes 30 days per call but we accumulate longer windows via daily
   snapshots to disk. */
const SDK_DOWNLOADS_FILE = path.join(__dirname, 'sdk-downloads.json')
let sdkDownloadsCache = { data: null, ts: 0 }
const SDK_DOWNLOADS_TTL = 6 * 60 * 60 * 1000 // 6 hours

const PYPI_PACKAGES = [
  { id: 'openai',              label: 'OpenAI',           provider: 'OpenAI',    color: '#10B981' },
  { id: 'anthropic',           label: 'Anthropic',        provider: 'Anthropic', color: '#E8553A' },
  { id: 'google-genai',        label: 'Google (new)',     provider: 'Google',    color: '#3B82F6' },
  { id: 'google-generativeai', label: 'Google (legacy)',  provider: 'Google',    color: '#60a5fa' },
  { id: 'cohere',              label: 'Cohere',           provider: 'Cohere',    color: '#EC4899' },
  { id: 'mistralai',           label: 'Mistral',          provider: 'Mistral',   color: '#F59E0B' },
  { id: 'groq',                label: 'Groq',             provider: 'Groq',      color: '#F97316' },
  { id: 'together',            label: 'Together AI',      provider: 'Together',  color: '#8B5CF6' },
  { id: 'langchain',           label: 'LangChain',        provider: 'Framework', color: '#6366F1' },
  { id: 'litellm',             label: 'LiteLLM',          provider: 'Framework', color: '#a78bfa' },
  { id: 'llama-index',         label: 'LlamaIndex',       provider: 'Framework', color: '#818cf8' },
]
const NPM_PACKAGES = [
  { id: 'openai',                label: 'OpenAI',         provider: 'OpenAI',    color: '#10B981' },
  { id: '@anthropic-ai/sdk',     label: 'Anthropic',      provider: 'Anthropic', color: '#E8553A' },
  { id: '@google/genai',         label: 'Google (new)',   provider: 'Google',    color: '#3B82F6' },
  { id: '@google/generative-ai', label: 'Google (legacy)',provider: 'Google',    color: '#60a5fa' },
  { id: 'cohere-ai',             label: 'Cohere',         provider: 'Cohere',    color: '#EC4899' },
  { id: '@mistralai/mistralai',  label: 'Mistral',        provider: 'Mistral',   color: '#F59E0B' },
  { id: 'groq-sdk',              label: 'Groq',           provider: 'Groq',      color: '#F97316' },
  { id: 'langchain',             label: 'LangChain',      provider: 'Framework', color: '#6366F1' },
  { id: 'ai',                    label: 'Vercel AI SDK',  provider: 'Framework', color: '#a78bfa' },
  { id: 'llamaindex',            label: 'LlamaIndex',     provider: 'Framework', color: '#818cf8' },
]

function loadSdkDownloads() {
  try {
    if (fs.existsSync(SDK_DOWNLOADS_FILE)) return JSON.parse(fs.readFileSync(SDK_DOWNLOADS_FILE, 'utf8'))
  } catch {}
  return { series: {} }
}
function saveSdkDownloads(data) {
  try { fs.writeFileSync(SDK_DOWNLOADS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save SDK downloads:', e.message) }
}

// PyPI: returns daily downloads (without_mirrors) for ~last 180 days
async function fetchPyPiDownloads(pkg) {
  try {
    const resp = await fetch(`https://pypistats.org/api/packages/${pkg}/overall`, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    return (json.data || [])
      .filter(d => d.category === 'without_mirrors')
      .map(d => ({ date: d.date, downloads: d.downloads || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (e) {
    console.warn(`PyPI ${pkg}:`, e.message)
    return []
  }
}

// npm: returns daily downloads for any date range. We fetch a wide window.
// Note: npm's API reports today and sometimes yesterday with downloads=0 until
// the tally finishes processing. Drop trailing zeros so the chart doesn't dip.
async function fetchNpmDownloads(pkg, days = 365) {
  try {
    const end = new Date()
    const start = new Date(end.getTime() - days * 86400000)
    const fmt = d => d.toISOString().slice(0, 10)
    // npm caps single request to 540 days; chunk if needed
    const url = `https://api.npmjs.org/downloads/range/${fmt(start)}:${fmt(end)}/${encodeURIComponent(pkg)}`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    const rows = (json.downloads || [])
      .map(d => ({ date: d.day, downloads: d.downloads || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date))
    // Trim trailing zero days (npm hasn't finished tallying yet)
    while (rows.length && rows[rows.length - 1].downloads === 0) rows.pop()
    return rows
  } catch (e) {
    console.warn(`npm ${pkg}:`, e.message)
    return []
  }
}

// Merge a fresh series into the archive, preferring the more-complete (longer)
// run for any given date. Both sources give "complete" daily numbers once the
// day is closed, so this is mostly a union — but if we ever extend history
// later, we don't want a shorter fresh fetch to truncate the archive.
function mergeSeries(archive, fresh) {
  const byDate = new Map()
  for (const p of archive || []) byDate.set(p.date, p.downloads)
  for (const p of fresh || [])   byDate.set(p.date, p.downloads)  // fresh wins on conflict
  const merged = Array.from(byDate.entries()).map(([date, downloads]) => ({ date, downloads }))
  merged.sort((a, b) => a.date.localeCompare(b.date))
  return merged
}

async function getSdkDownloads() {
  if (sdkDownloadsCache.data && Date.now() - sdkDownloadsCache.ts < SDK_DOWNLOADS_TTL) return sdkDownloadsCache.data

  console.log('SDK downloads: fetching PyPI + npm in parallel...')
  const archive = loadSdkDownloads()
  const series = { ...archive.series }

  // Fetch in parallel, but in chunks to be polite to upstream
  const all = [
    ...PYPI_PACKAGES.map(p => ({ ...p, ecosystem: 'PyPI', fetch: () => fetchPyPiDownloads(p.id) })),
    ...NPM_PACKAGES.map(p => ({ ...p, ecosystem: 'npm', fetch: () => fetchNpmDownloads(p.id, 365) })),
  ]
  const BATCH = 6
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    await Promise.all(batch.map(async meta => {
      const key = `${meta.ecosystem}::${meta.id}`
      const data = await meta.fetch()
      if (!data.length) return
      series[key] = {
        key,
        ecosystem: meta.ecosystem,
        id: meta.id,
        label: meta.label,
        provider: meta.provider,
        color: meta.color,
        data: mergeSeries(series[key]?.data, data),
      }
    }))
    if (i + BATCH < all.length) await new Promise(r => setTimeout(r, 250))
  }

  const result = { series, updated: Date.now() }
  saveSdkDownloads(result)

  const total = Object.values(series).length
  const totalPoints = Object.values(series).reduce((s, x) => s + (x.data?.length || 0), 0)
  console.log(`SDK downloads: ${total} packages tracked, ${totalPoints} total data points`)
  sdkDownloadsCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI Usage Signals: Stack Overflow + GitHub + Cloudflare Radar ────────
   Three complementary lenses on aggregate AI demand:
     1. Stack Overflow tag activity → PRODUCTION usage (devs only ask when shipping)
     2. GitHub repo stars             → DEVELOPER MINDSHARE (commitment > install)
     3. Cloudflare Radar AI traffic   → ACTUAL END-USER consumption (needs token)
   All three snapshotted daily into a single file so trend lines accumulate. */
const USAGE_SIGNALS_FILE = path.join(__dirname, 'usage-signals-history.json')
let usageSignalsCache = { data: null, ts: 0 }
const USAGE_SIGNALS_TTL = 6 * 60 * 60 * 1000   // 6-hour live cache
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '' // optional

const SO_TAGS = [
  { tag: 'openai-api',              label: 'OpenAI API',           provider: 'OpenAI'    },
  { tag: 'chatgpt-api',             label: 'ChatGPT API',          provider: 'OpenAI'    },
  { tag: 'langchain',               label: 'LangChain',            provider: 'Framework' },
  { tag: 'huggingface-transformers',label: 'HF Transformers',      provider: 'HuggingFace'},
  { tag: 'huggingface',             label: 'Hugging Face',         provider: 'HuggingFace'},
  { tag: 'llama-index',             label: 'LlamaIndex',           provider: 'Framework' },
  { tag: 'ollama',                  label: 'Ollama',               provider: 'Framework' },
  { tag: 'google-gemini',           label: 'Google Gemini',        provider: 'Google'    },
  { tag: 'anthropic',               label: 'Anthropic',            provider: 'Anthropic' },
]

const GITHUB_REPOS = [
  { repo: 'langchain-ai/langchain',           label: 'LangChain',     provider: 'Framework' },
  { repo: 'openai/openai-python',             label: 'OpenAI Py SDK', provider: 'OpenAI'    },
  { repo: 'anthropics/anthropic-sdk-python',  label: 'Anthropic Py',  provider: 'Anthropic' },
  { repo: 'vercel/ai',                        label: 'Vercel AI SDK', provider: 'Framework' },
  { repo: 'ggml-org/llama.cpp',               label: 'llama.cpp',     provider: 'Inference' },
  { repo: 'huggingface/transformers',         label: 'HF Transformers', provider: 'HuggingFace' },
  { repo: 'ollama/ollama',                    label: 'Ollama',        provider: 'Inference' },
  { repo: 'run-llama/llama_index',            label: 'LlamaIndex',    provider: 'Framework' },
  { repo: 'BerriAI/litellm',                  label: 'LiteLLM',       provider: 'Framework' },
  { repo: 'comfyanonymous/ComfyUI',           label: 'ComfyUI',       provider: 'Inference' },
]

function loadUsageSignals() {
  try {
    if (fs.existsSync(USAGE_SIGNALS_FILE)) return JSON.parse(fs.readFileSync(USAGE_SIGNALS_FILE, 'utf8'))
  } catch {}
  return { snapshots: {} }   // keyed by ISO date → snapshot
}
function saveUsageSignals(data) {
  try { fs.writeFileSync(USAGE_SIGNALS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save usage signals:', e.message) }
}

// Stack Exchange API — total question count + monthly new questions for a tag
async function fetchStackOverflowTag(tag) {
  try {
    // Get the all-time question count for the tag
    const infoUrl = `https://api.stackexchange.com/2.3/tags/${encodeURIComponent(tag)}/info?site=stackoverflow`
    const infoResp = await fetch(infoUrl, { headers: { 'User-Agent': UA } })
    const infoJson = await infoResp.json()
    const info = (infoJson.items || [])[0]
    if (!info) return null

    // Get question count in last 30 days
    const since = Math.floor(Date.now() / 1000) - 30 * 86400
    const recentUrl = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=${encodeURIComponent(tag)}&site=stackoverflow&fromdate=${since}&filter=total`
    const recentResp = await fetch(recentUrl, { headers: { 'User-Agent': UA } })
    const recentJson = await recentResp.json()

    return {
      tag,
      totalQuestions: info.count || 0,
      questionsLast30Days: recentJson.total || 0,
    }
  } catch (e) {
    console.warn(`SO ${tag}:`, e.message)
    return null
  }
}

// GitHub repo info (current star count + a few related metrics)
async function fetchGitHubRepo(repo) {
  try {
    const url = `https://api.github.com/repos/${repo}`
    const headers = { 'User-Agent': UA }
    // Use GH token if present (lifts rate limit to 5000/hr)
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
    const resp = await fetch(url, { headers })
    if (!resp.ok) return null
    const d = await resp.json()
    return {
      repo,
      stars: d.stargazers_count || 0,
      forks: d.forks_count || 0,
      openIssues: d.open_issues_count || 0,
      updatedAt: d.pushed_at,
    }
  } catch (e) {
    console.warn(`GH ${repo}:`, e.message)
    return null
  }
}

// Cloudflare Radar AI inference summary by model (last 28 days by default)
// Returns model share data. Requires CLOUDFLARE_API_TOKEN env var. The token
// needs the "Radar Read" permission — free Cloudflare account, no charges.
async function fetchCloudflareRadarAI() {
  if (!CLOUDFLARE_API_TOKEN) return { available: false, reason: 'no_token' }
  try {
    const url = 'https://api.cloudflare.com/client/v4/radar/ai/inference/timeseries_groups/model?dateRange=28d'
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
    })
    if (!resp.ok) return { available: false, reason: `http_${resp.status}` }
    const json = await resp.json()
    if (!json.success) return { available: false, reason: 'api_error', detail: json.errors }
    return { available: true, raw: json.result }
  } catch (e) {
    return { available: false, reason: 'fetch_error', detail: e.message }
  }
}

// ── SO monthly history backfill ──
// Historical month counts don't change after the month closes, so we only
// re-fetch the most-recent month on each call (caching everything else
// forever to disk).
const SO_MONTHLY_CACHE = path.join(__dirname, 'usage-signals-so-monthly.json')

function loadSoMonthlyCache() {
  try { if (fs.existsSync(SO_MONTHLY_CACHE)) return JSON.parse(fs.readFileSync(SO_MONTHLY_CACHE, 'utf8')) } catch {}
  return { byTag: {} }
}
function saveSoMonthlyCache(data) {
  try { fs.writeFileSync(SO_MONTHLY_CACHE, JSON.stringify(data, null, 2)) } catch (e) { console.error('SO monthly cache save:', e.message) }
}

function monthBuckets(n) {
  const buckets = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59))
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
    buckets.push({ month: label, fromdate: Math.floor(start.getTime() / 1000), todate: Math.floor(end.getTime() / 1000) })
  }
  return buckets
}

async function fetchSoCountInWindow(tag, fromdate, todate) {
  try {
    const url = `https://api.stackexchange.com/2.3/questions?tagged=${encodeURIComponent(tag)}&site=stackoverflow&fromdate=${fromdate}&todate=${todate}&filter=total`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    const json = await resp.json()
    return json.total || 0
  } catch { return null }
}

async function getSoMonthlyHistory(tag, months = 24) {
  const cache = loadSoMonthlyCache()
  const cached = cache.byTag[tag] || []
  const buckets = monthBuckets(months)
  const currentMonth = buckets[buckets.length - 1].month

  // If cache has full coverage, only refresh the current (in-progress) month
  const cachedByMonth = Object.fromEntries(cached.map(r => [r.month, r.count]))
  const covered = buckets.every(b => b.month !== currentMonth && cachedByMonth[b.month] != null)

  const out = []
  for (const b of buckets) {
    if (b.month === currentMonth || cachedByMonth[b.month] == null) {
      const c = await fetchSoCountInWindow(tag, b.fromdate, b.todate)
      out.push({ month: b.month, count: c ?? 0 })
      await new Promise(r => setTimeout(r, 40))  // be polite to SE
    } else {
      out.push({ month: b.month, count: cachedByMonth[b.month] })
    }
  }

  cache.byTag[tag] = out
  saveSoMonthlyCache(cache)
  return out
}

async function fetchUsageSignals() {
  if (usageSignalsCache.data && Date.now() - usageSignalsCache.ts < USAGE_SIGNALS_TTL) return usageSignalsCache.data

  console.log('Usage signals: fetching SO + GitHub + Cloudflare in parallel...')

  // Stack Overflow: throttled (SE has 30 req/sec but is sensitive to bursts)
  const soResults = []
  for (let i = 0; i < SO_TAGS.length; i += 3) {
    const batch = SO_TAGS.slice(i, i + 3)
    const batchRes = await Promise.all(batch.map(async meta => {
      const data = await fetchStackOverflowTag(meta.tag)
      if (!data) return null
      return { ...meta, ...data }
    }))
    soResults.push(...batchRes.filter(Boolean))
    if (i + 3 < SO_TAGS.length) await new Promise(r => setTimeout(r, 200))
  }

  // GitHub: more aggressive parallelism (rate limit is per-hour, not per-second)
  const ghResults = []
  for (let i = 0; i < GITHUB_REPOS.length; i += 5) {
    const batch = GITHUB_REPOS.slice(i, i + 5)
    const batchRes = await Promise.all(batch.map(async meta => {
      const data = await fetchGitHubRepo(meta.repo)
      if (!data) return null
      return { ...meta, ...data }
    }))
    ghResults.push(...batchRes.filter(Boolean))
    if (i + 5 < GITHUB_REPOS.length) await new Promise(r => setTimeout(r, 100))
  }

  // Backfill monthly SO history for each tag (cached aggressively to disk)
  const soMonthly = {}
  for (const meta of SO_TAGS) {
    soMonthly[meta.tag] = await getSoMonthlyHistory(meta.tag, 24)
  }

  // Cloudflare (optional)
  const cloudflare = await fetchCloudflareRadarAI()

  // Append today's snapshot to the persistent archive
  const today = todayStr()
  const archive = loadUsageSignals()
  const snapshots = { ...archive.snapshots }
  snapshots[today] = {
    date: today,
    stackOverflow: soResults.map(r => ({ tag: r.tag, totalQuestions: r.totalQuestions, questionsLast30Days: r.questionsLast30Days })),
    github: ghResults.map(r => ({ repo: r.repo, stars: r.stars, forks: r.forks })),
  }
  saveUsageSignals({ snapshots })

  const result = {
    asOf: Date.now(),
    stackOverflow: soResults,
    stackOverflowMonthly: soMonthly,   // { tag: [{month, count}] } back 24 months
    github: ghResults,
    cloudflare,
    snapshots,
  }
  console.log(`Usage signals: ${soResults.length} SO tags, ${ghResults.length} GH repos, CF: ${cloudflare.available ? 'live' : `unavailable (${cloudflare.reason})`}`)
  usageSignalsCache = { data: result, ts: Date.now() }
  return result
}

/* ── Hugging Face model rankings (replaces broken OpenRouter rankings) ──── */
// Snapshots top text-generation models by 30-day downloads daily. The data
// answers "what AI models are getting used" — downloads here are devs pulling
// open weights to run themselves, which complements / replaces OpenRouter's
// token-volume metric (paid-API usage). Same daily archive pattern as the
// OR rankings — file accumulates one row per (date, model) combo.
const HF_RANKINGS_FILE = path.join(__dirname, 'hf-rankings-history.json')
let hfRankingsCache = { data: null, ts: 0 }
const HF_RANKINGS_TTL = 60 * 60 * 1000 // 1-hour live cache (HF downloads are 30-day, change slowly)
const HF_TOP_N = 75

function loadHfRankings() {
  try {
    if (fs.existsSync(HF_RANKINGS_FILE)) return JSON.parse(fs.readFileSync(HF_RANKINGS_FILE, 'utf8'))
  } catch {}
  return { rows: [] }
}
function saveHfRankings(data) {
  try { fs.writeFileSync(HF_RANKINGS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save HF rankings:', e.message) }
}

async function fetchHfRankingsFresh() {
  // Top N text-generation models by past-30-day download count
  const url = `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${HF_TOP_N}&pipeline_tag=text-generation&full=false`
  const resp = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!resp.ok) throw new Error(`HF rankings HTTP ${resp.status}`)
  const arr = await resp.json()
  if (!Array.isArray(arr)) throw new Error('HF rankings: unexpected response shape')
  const today = todayStr()
  return arr.map((m, i) => ({
    date: today,
    rank: i + 1,
    id: m.id,                                  // "Qwen/Qwen3-0.6B"
    author: (m.id || '').split('/')[0] || '',  // "Qwen"
    downloads: m.downloads ?? 0,               // last 30 days
    likes: m.likes ?? 0,
    pipeline: m.pipeline_tag || null,
    library: m.library_name || null,
    lastModified: m.lastModified || null,
    createdAt: m.createdAt || null,
  }))
}

async function getHfRankingsWithHistory() {
  if (hfRankingsCache.data && Date.now() - hfRankingsCache.ts < HF_RANKINGS_TTL) return hfRankingsCache.data

  let fresh = []
  try {
    fresh = await fetchHfRankingsFresh()
  } catch (e) {
    console.warn('HF rankings fetch failed:', e.message)
    const archive = loadHfRankings()
    const result = { rows: archive.rows || [], source: 'archive-only', updated: Date.now() }
    hfRankingsCache = { data: result, ts: Date.now() }
    return result
  }

  const archive = loadHfRankings()
  const merged = new Map()
  for (const row of archive.rows || []) {
    if (!row.date || !row.id) continue
    merged.set(`${row.date}|${row.id}`, row)
  }
  const today = todayStr()
  let added = 0, updatedToday = 0
  for (const row of fresh) {
    const key = `${row.date}|${row.id}`
    const existed = merged.has(key)
    // Archive is authoritative for closed days; today is always overwritten with latest
    if (row.date === today || !existed) {
      merged.set(key, row)
      if (existed) updatedToday++
      else added++
    }
  }

  const rows = Array.from(merged.values())
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank)

  saveHfRankings({ rows, lastUpdated: Date.now() })

  const dates = new Set(rows.map(r => r.date)).size
  console.log(`HF rankings: +${added} new, ~${updatedToday} today updated, ${rows.length} total archived across ${dates} dates`)

  const result = { rows, source: 'live+archive', updated: Date.now(), dates }
  hfRankingsCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI Pricing Snapshots (token + GPU, persisted to disk) ──── */
const AI_PRICES_FILE = path.join(__dirname, 'ai-prices.json')
const AI_SNAP_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours
let aiPricesCache = { data: null, ts: 0 }
const AI_CACHE_TTL = 30 * 60 * 1000 // 30-min live cache

// Key models to track token pricing for. Refreshed 2026-Q2 — covers current
// frontier, mid, and budget tiers across major providers. When new models are
// released, append them here (verify against https://openrouter.ai/api/v1/models).
const TRACKED_MODELS = [
  // OpenAI — frontier
  'openai/gpt-5.5-pro',
  'openai/gpt-5.5',
  'openai/gpt-5.4',
  'openai/gpt-5.2-pro',
  'openai/gpt-5-codex',
  'openai/o3-pro',
  // OpenAI — mid / budget
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-oss-120b',

  // Anthropic — frontier
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.6',
  // Anthropic — mid / budget
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',

  // Google — frontier
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.5-flash',
  // Google — mid / budget
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',

  // xAI
  'x-ai/grok-4.3',
  'x-ai/grok-4.20',

  // DeepSeek
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v3.2',
  'deepseek/deepseek-r1',

  // Meta
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',
  'meta-llama/llama-3.3-70b-instruct',

  // Mistral
  'mistralai/mistral-large-2512',
  'mistralai/mistral-medium-3.1',

  // Qwen
  'qwen/qwen3.7-max',
  'qwen/qwen3.5-397b-a17b',
]

// GPU models to track on Vast.ai (use exact gpu_name values from their API)
const TRACKED_GPUS = ['H100 SXM', 'H100 NVL', 'H200', 'H200 NVL', 'A100 SXM4', 'A100 PCIE', 'L40S', 'RTX A6000', 'RTX 4090', 'RTX 5090', 'RTX 3090']

function loadAiPrices() {
  try {
    if (fs.existsSync(AI_PRICES_FILE)) return JSON.parse(fs.readFileSync(AI_PRICES_FILE, 'utf8'))
  } catch {}
  return { tokenHistory: [], gpuHistory: [] }
}
function saveAiPrices(data) {
  try { fs.writeFileSync(AI_PRICES_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save AI prices:', e.message) }
}

async function fetchTokenPrices() {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'User-Agent': UA } })
    const json = await resp.json()
    const models = json.data || []
    const tracked = TRACKED_MODELS.map(id => {
      const m = models.find(x => x.id === id)
      if (!m) return null
      return {
        id: m.id,
        name: m.name,
        input: parseFloat(m.pricing?.prompt || '0') * 1e6,
        output: parseFloat(m.pricing?.completion || '0') * 1e6,
        context: m.context_length,
      }
    }).filter(Boolean)
    // Compute market stats
    const allPaid = models.filter(m => parseFloat(m.pricing?.prompt || '0') > 0)
    const inputPrices = allPaid.map(m => parseFloat(m.pricing.prompt) * 1e6).sort((a, b) => a - b)
    const medianInput = inputPrices.length ? inputPrices[Math.floor(inputPrices.length / 2)] : 0
    const meanInput = inputPrices.length ? inputPrices.reduce((s, v) => s + v, 0) / inputPrices.length : 0
    return { models: tracked, totalModels: models.length, paidModels: allPaid.length, medianInput: +medianInput.toFixed(4), meanInput: +meanInput.toFixed(4) }
  } catch (e) { console.error('Token price fetch error:', e.message); return null }
}

// Maps our tracked GPU names (Vast naming) → RunPod displayName, so we can
// blend a second independent price source and reduce single-marketplace noise.
const RUNPOD_GPU_MAP = {
  'H100 SXM':  'H100 SXM',
  'H100 NVL':  'H100 NVL',
  'H200':      'H200 SXM',
  'H200 NVL':  'H200 NVL',
  'A100 SXM4': 'A100 SXM',
  'A100 PCIE': 'A100 PCIe',
  'L40S':      'L40S',
  'RTX A6000': 'RTX A6000',
  'RTX 4090':  'RTX 4090',
  'RTX 5090':  'RTX 5090',
  'RTX 3090':  'RTX 3090',
}

// RunPod public GraphQL — no auth. Returns curated per-GPU secure (datacenter)
// + community (peer-to-peer marketplace) on-demand prices.
async function fetchRunPodPrices() {
  try {
    const resp = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query: 'query { gpuTypes { displayName securePrice communityPrice } }' }),
    })
    const json = await resp.json()
    const types = json?.data?.gpuTypes || []
    const byDisplay = {}
    types.forEach(t => { byDisplay[t.displayName] = t })
    const out = {}
    for (const [tracked, rpName] of Object.entries(RUNPOD_GPU_MAP)) {
      const t = byDisplay[rpName]
      if (t) out[tracked] = { secure: t.securePrice || null, community: t.communityPrice || null }
    }
    return out
  } catch (e) { console.warn('RunPod GPU fetch:', e.message); return {} }
}

// Blend Vast median + RunPod community into a consensus price. Guards against
// RunPod's occasional bogus placeholder lows (community << secure tier).
function blendConsensus(vastMedian, rpCommunity, rpSecure) {
  const candidates = []
  if (vastMedian > 0) candidates.push(vastMedian)
  if (rpCommunity > 0 && (!rpSecure || rpCommunity >= rpSecure * 0.3)) candidates.push(rpCommunity)
  if (!candidates.length) return null
  return +(candidates.reduce((a, b) => a + b, 0) / candidates.length).toFixed(4)
}

async function fetchGpuPrices() {
  try {
    // Vast.ai public search — no auth needed for basic queries
    // Fetch offers sorted both ways to catch cheap consumer + expensive enterprise GPUs
    const allOffers = []
    for (const dir of ['asc', 'desc']) {
      try {
        const resp = await fetch('https://console.vast.ai/api/v0/bundles/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
          body: JSON.stringify({
            rentable: { eq: true }, rented: { eq: false },
            num_gpus: { eq: 1 }, type: 'on-demand',
            order: [['dph_total', dir]], limit: 500,
          })
        })
        const json = await resp.json()
        allOffers.push(...(json.offers || []))
      } catch {}
      await new Promise(r => setTimeout(r, 500))
    }
    // Deduplicate by machine_id
    const seen = new Set()
    const uniqueOffers = allOffers.filter(o => { if (seen.has(o.machine_id)) return false; seen.add(o.machine_id); return true })
    const results = {}
    const gpuSet = new Set(TRACKED_GPUS)
    for (const o of uniqueOffers) {
      const gpuName = o.gpu_name
      if (!gpuSet.has(gpuName)) continue
      if (!results[gpuName]) results[gpuName] = { name: gpuName, offers: [], vram: o.gpu_ram ? Math.round(o.gpu_ram / 1024) : null }
      if (o.dph_total > 0) results[gpuName].offers.push(o.dph_total)
    }
    for (const [key, g] of Object.entries(results)) {
      const prices = g.offers.sort((a, b) => a - b)
      if (prices.length === 0) { delete results[key]; continue }
      const mid = Math.floor(prices.length / 2)
      results[key] = {
        name: g.name,
        count: prices.length,
        min: +prices[0].toFixed(4),
        p25: +prices[Math.floor(prices.length * 0.25)].toFixed(4),
        median: +prices[mid].toFixed(4),
        p75: +prices[Math.floor(prices.length * 0.75)].toFixed(4),
        max: +prices[prices.length - 1].toFixed(4),
        vram: g.vram,
      }
    }

    // ── Second source: RunPod ── merge in + compute consensus per GPU
    const runpod = await fetchRunPodPrices()
    for (const [key, g] of Object.entries(results)) {
      const rp = runpod[key] || {}
      g.vastMedian = g.median                       // preserve Vast-only median
      g.runpodSecure = rp.secure ?? null
      g.runpodCommunity = rp.community ?? null
      g.consensus = blendConsensus(g.median, rp.community, rp.secure)
      // cross-source spread as % (how much the two sources disagree)
      g.sourceSpread = (g.median > 0 && rp.community > 0 && (!rp.secure || rp.community >= rp.secure * 0.3))
        ? +(Math.abs(g.median - rp.community) / ((g.median + rp.community) / 2) * 100).toFixed(0)
        : null
      g.sources = ['vast', ...(rp.community || rp.secure ? ['runpod'] : [])]
    }

    return Object.keys(results).length > 0 ? results : null
  } catch (e) { console.error('GPU price fetch error:', e.message); return null }
}

async function takeAiSnapshot() {
  const today = new Date().toISOString().slice(0, 10)
  const store = loadAiPrices()

  // Only one snapshot per day
  const lastToken = store.tokenHistory[store.tokenHistory.length - 1]
  const lastGpu = store.gpuHistory[store.gpuHistory.length - 1]
  const needToken = !lastToken || lastToken.date !== today
  const needGpu = !lastGpu || lastGpu.date !== today

  if (needToken) {
    const tokenData = await fetchTokenPrices()
    if (tokenData) {
      store.tokenHistory.push({ date: today, ...tokenData })
      // Keep max 365 days
      if (store.tokenHistory.length > 365) store.tokenHistory = store.tokenHistory.slice(-365)
    }
  }
  if (needGpu) {
    const gpuData = await fetchGpuPrices()
    if (gpuData) {
      store.gpuHistory.push({ date: today, gpus: gpuData })
      if (store.gpuHistory.length > 365) store.gpuHistory = store.gpuHistory.slice(-365)
    }
  }
  if (needToken || needGpu) saveAiPrices(store)
  return store
}

async function getAiPrices() {
  if (aiPricesCache.data && Date.now() - aiPricesCache.ts < AI_CACHE_TTL) return aiPricesCache.data
  const store = await takeAiSnapshot()
  // Also get live current data (may differ from today's snapshot if prices changed)
  const liveTokens = await fetchTokenPrices()
  const liveGpus = await fetchGpuPrices()
  const result = { history: store, live: { tokens: liveTokens, gpus: liveGpus } }
  aiPricesCache = { data: result, ts: Date.now() }
  return result
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'tickers-persist',
      configureServer(server) {
        // Central bank rates endpoint (FMP calendar + FRED live series)
        server.middlewares.use('/api/cb-rates', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchCbRates()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // AI pricing snapshot endpoint + auto-snapshot timer
        server.middlewares.use('/api/ai-prices', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            // ?refresh=1 busts the in-memory cache so the next call re-hits OpenRouter
            if ((req.url || '').includes('refresh=1')) {
              aiPricesCache = { data: null, ts: 0 }
              console.log('AI prices: cache busted by ?refresh=1')
            }
            const data = await getAiPrices()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Take initial snapshot on server start, then every 6 hours
        takeAiSnapshot().catch(e => console.error('Initial AI snapshot error:', e.message))
        setInterval(() => takeAiSnapshot().catch(e => console.error('AI snapshot error:', e.message)), AI_SNAP_INTERVAL)

        // AI Economic Impact endpoint
        server.middlewares.use('/api/ai-impact', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchAIImpact()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Global Liquidity & Debt — Fed/ECB/BOJ balance sheets, net liquidity,
        // money supply, US debt stack and who holds it. All in billions USD.
        server.middlewares.use('/api/global-liquidity', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              liquidityCache = { data: null, ts: 0 }
              console.log('Global liquidity: cache busted by ?refresh=1')
            }
            const data = await fetchGlobalLiquidity()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Hyperscaler quarterly AI capex (raw company capex; AI share %
        // applied client-side). Single most important demand-side signal.
        server.middlewares.use('/api/hyperscaler-capex', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              hyperscalerCapexCache = { data: null, ts: 0 }
              console.log('Hyperscaler capex: cache busted by ?refresh=1')
            }
            const data = await getHyperscalerCapex()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Dashboard summary — unified landing-page hero data (indexes,
        // commodities, crypto, rates). Single fetch for the Overview tab.
        server.middlewares.use('/api/dashboard-summary', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              dashboardSummaryCache = { data: null, ts: 0 }
              console.log('Dashboard summary: cache busted by ?refresh=1')
            }
            const data = await fetchDashboardSummary()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // AI Usage Signals — Stack Overflow tag activity + GitHub stars + (optional)
        // Cloudflare Radar AI traffic. Three complementary lenses on aggregate demand.
        server.middlewares.use('/api/usage-signals', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              usageSignalsCache = { data: null, ts: 0 }
              console.log('Usage signals: cache busted by ?refresh=1')
            }
            const data = await fetchUsageSignals()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // AI SDK Downloads — PyPI + npm install counts as a proxy for paid-API
        // token demand. Every commercial AI app installs an SDK first.
        server.middlewares.use('/api/sdk-downloads', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              sdkDownloadsCache = { data: null, ts: 0 }
              console.log('SDK downloads: cache busted by ?refresh=1')
            }
            const data = await getSdkDownloads()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Hugging Face rankings — replaces broken OpenRouter rankings.
        // Tracks top text-generation models by 30-day download count, persisted
        // daily so the trend chart accumulates real history over time.
        server.middlewares.use('/api/hf-rankings', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              hfRankingsCache = { data: null, ts: 0 }
              console.log('HF rankings: cache busted by ?refresh=1')
            }
            const data = await getHfRankingsWithHistory()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // OpenRouter rankings — persisted history (fixes hockey-stick chart)
        server.middlewares.use('/api/or-rankings-history', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            // ?refresh=1 busts the in-memory cache and forces a live OpenRouter pull
            if ((req.url || '').includes('refresh=1')) {
              orRankingsCache = { data: null, ts: 0 }
              console.log('OpenRouter rankings: cache busted by ?refresh=1')
            }
            const data = await getRankingsWithHistory()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Fear & Greed Composite endpoint
        server.middlewares.use('/api/fear-greed', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchFearGreed()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // BEA PCE Price Index endpoint
        server.middlewares.use('/api/bea-pce', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchBeaPCE()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // BLS CPI Category Data endpoint
        server.middlewares.use('/api/bls-cpi', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchBLSCPI()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // S&P 500 Screener endpoint
        server.middlewares.use('/api/sp500-screener', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchSP500Screener()
            res.end(JSON.stringify({ stocks: data, lastUpdated: sp500Cache.ts }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // S&P 500 screener: initial fetch on server start. With stale-while-
        // revalidate this returns instantly from disk cache (if any) and triggers
        // a background refresh — no blocking, no rate-limit storms even on Vite
        // hot-reloads.
        fetchSP500Screener().catch(e => console.error('Initial S&P 500 screener error:', e.message))

        // Precious metals historical chart endpoint
        server.middlewares.use('/api/metal-history', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchMetalHistory()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Commodity spot prices endpoint
        server.middlewares.use('/api/commodity-spot', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchCommoditySpot()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Index PE endpoint
        server.middlewares.use('/api/index-pe', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchIndexPE()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Gemini chat endpoint (keeps API key server-side)
        server.middlewares.use('/api/gemini-chat', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"POST only"}'); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', async () => {
            try {
              const { messages, context } = JSON.parse(body)
              if (!GEMINI_KEY) {
                res.statusCode = 503
                res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured.' }))
                return
              }
              const contents = messages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              }))
              const payload = {
                contents,
                systemInstruction: { parts: [{ text: context }] },
                generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
              }
              const apiResp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
              )
              const json = await apiResp.json()
              if (json.error) { res.statusCode = 400; res.end(JSON.stringify({ error: json.error.message })); return }
              const reply = json.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.'
              res.end(JSON.stringify({ reply }))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: e.message }))
            }
          })
        })

        // Tickers persistence endpoint
        server.middlewares.use('/api/tickers', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (req.method === 'GET') {
            try {
              const data = fs.existsSync(TICKERS_FILE)
                ? fs.readFileSync(TICKERS_FILE, 'utf8')
                : 'null'
              res.end(data)
            } catch { res.end('null') }
          } else if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', () => {
              try { fs.writeFileSync(TICKERS_FILE, body) } catch {}
              res.end('"ok"')
            })
          } else {
            res.statusCode = 405
            res.end()
          }
        })
      }
    }
  ],
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/cboe-api': {
        target: 'https://cdn.cboe.com/api/global/delayed_quotes/options',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cboe-api/, ''),
        secure: true,
      },
      '/fred-api': {
        target: 'https://api.stlouisfed.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/fred-api/, ''),
        secure: true,
      },
      '/or-rankings': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        rewrite: () => '/rankings',
        secure: true,
      },
      '/zillow-csv': {
        target: 'https://files.zillowstatic.com/research/public_csvs',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/zillow-csv/, ''),
        secure: true,
      },
      '/cftc-api': {
        target: 'https://publicreporting.cftc.gov/resource',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cftc-api/, ''),
        secure: true,
      }
    }
  }
})
