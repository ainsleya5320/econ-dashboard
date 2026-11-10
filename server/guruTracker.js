// ============================================================================
// GURU TRACKER — what well-known managers hold, build and hedge, from their 13Fs
//   The tracker itself lives in the Research Database (github.com/ainsleya5320/
//   Research-Database: scripts/gurus.py reads EDGAR every Monday and writes
//   data/generated/gurus.json plus, under data/generated/gurus/, one file per
//   manager and holdings.json, every security with its holders). This module
//   only reads those files, so the numbers keep one home; the Gurus tab draws
//   them and links each name to the full story workbench in the Research
//   Database app.
//   get()          the summary: /api/gurus
//   manager(slug)  one manager's book: positions (named from holdings.json),
//                  options, twelve quarters of history, filings: /api/gurus/manager?slug=
//   held()         the most widely held names across every manager, from
//                  holdings.json: /api/gurus/held
// Where the files come from (a local checkout, or GitHub with a token) and the
// link to the Research Database app are server/researchDb.js's business.
// ============================================================================
import { createResearchDb, findCheckout } from './researchDb.js'

export { findCheckout }

const FILE = ['data', 'generated', 'gurus.json']
const HOLDINGS = ['data', 'generated', 'gurus', 'holdings.json']
const managerFile = slug => ['data', 'generated', 'gurus', 'managers', `${slug}.json`]
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/

// The most widely held names: every security at least `min` managers hold, with the holders' combined
// value, average and largest weights, this quarter's buyers and sellers and who holds the most.
export function widelyHeld(holdings, { limit = 60, min = 5 } = {}) {
  const rows = []
  for (const [k, t] of Object.entries(holdings?.tickers || {})) {
    const holders = (t.holders || []).filter(h => h.v > 0 || h.w > 0)
    if (holders.length < min) continue
    const value = holders.reduce((s, h) => s + (h.v || 0), 0)
    const top = [...holders].sort((a, b) => (b.w || 0) - (a.w || 0)).slice(0, 3).map(h => [h.m, h.w, h.act])
    rows.push({ k, name: t.name, type: t.type, sic: t.sicDescription, n: holders.length, value,
      avgW: holders.length ? t.wsum / holders.length : null, maxW: t.wmax, new: t.new, add: t.add, trim: t.trim, exit: t.exit,
      buyers: t.buyers, sellers: t.sellers, pts: t.pts, last: t.last, basis: t.basis, vsBasis: t.vsBasis, themes: t.themes, top })
  }
  return rows.sort((a, b) => b.n - a.n || b.value - a.value).slice(0, limit)
}

export function createGuruTracker({ dir, env = {}, UA = 'econ-dashboard', research = createResearchDb({ dir, env, UA }) }) {
  const { read, researchUrl } = research
  const missing = () => research.missing('guru summary', FILE)
  let heldCache = { key: null, rows: null }

  async function get() {
    const found = await read(FILE)
    if (!found?.data) return missing()
    return { available: true, source: found.source, where: found.where, researchUrl, ...found.data }
  }

  // One manager: the summary's row plus the per-manager file, each position named (and given its sector
  // and last price) from holdings.json. Unknown slugs answer available:false with the reason.
  async function manager(slug) {
    if (!SLUG.test(slug || '')) return { available: false, researchUrl, reason: 'Which manager? Pass ?slug=<slug> from the managers list.' }
    const summary = await read(FILE)
    if (!summary?.data) return missing()
    const row = (summary.data.managers || []).find(m => m.slug === slug)
    if (!row) return { available: false, researchUrl, reason: `No manager "${slug}" in the tracker.` }
    const [detail, holdings] = await Promise.all([read(managerFile(slug)), read(HOLDINGS)])
    if (!detail?.data) return { available: false, researchUrl, reason: `The tracker has no book file for ${row.firm} yet (data/generated/gurus/managers/${slug}.json).` }
    const tickers = holdings?.data?.tickers || {}
    const named = p => {
      const t = tickers[p.k] || {}
      return { ...p, name: t.name || null, sic: t.sicDescription || null, type: t.type || null, last: t.last ?? null, lastDate: t.lastDate || null, holders: t.n ?? null, themes: t.themes || [] }
    }
    const d = detail.data
    return { available: true, source: detail.source, where: detail.where, researchUrl, period: summary.data.period, styles: summary.data.styles || {},
      ...row, detail: { ...d, positions: (d.positions || []).map(named), options: (d.options || []).map(named) } }
  }

  async function held() {
    const summary = await read(FILE)
    if (!summary?.data) return missing()
    const holdings = await read(HOLDINGS)
    if (!holdings?.data) return { available: false, researchUrl, reason: 'The tracker has not written data/generated/gurus/holdings.json yet.' }
    const key = `${holdings.source}:${holdings.mtime}`
    // at least five holders, or a tenth of the filers when the universe is smaller than fifty
    const participants = summary.data.counts?.participants ?? 0
    if (heldCache.key !== key) heldCache = { key, rows: widelyHeld(holdings.data, { min: Math.max(1, Math.min(5, Math.floor(participants / 10))) }) }
    return { available: true, source: holdings.source, where: holdings.where, researchUrl, period: holdings.data.period, prevPeriod: holdings.data.prevPeriod,
      participants, rows: heldCache.rows }
  }

  return { get, manager, held }
}
