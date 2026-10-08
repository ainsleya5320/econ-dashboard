// ============================================================================
// SIN MONITOR: Stocks → Sin & Folly, the route. Serves the committed seed
// (data/seeds/sin-monitor.json, built by server/sinMonitorSeed.js) and keeps
// its tail fresh: once a copy is a week old, the last five calendar years of
// XBRL frames (companies keep filing 10-Ks through the spring) and the last
// two quarters of full-text counts are rebuilt in the background, ~500 SEC
// requests. A request never waits on SEC; it gets the newest copy on hand.
// Route: /api/sin-monitor (cache: sin-monitor.json at the root, ignored)
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { buildSinMonitor, SEED_NAME } from './sinMonitorSeed.js'

const WEEK = 7 * 864e5

export function createSinMonitor({ UA, dir }) {
  const CACHE = path.join(dir, 'sin-monitor.json'), SEED = path.join(dir, 'data', 'seeds', SEED_NAME)
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
  let mem = null, running = null, lastError = null
  function current() {
    if (mem) return mem
    const c = read(CACHE), s = read(SEED)
    mem = c && (!s || Date.parse(c.built) >= Date.parse(s.built)) ? c : s
    return mem
  }
  function refresh() {
    if (running) return
    running = buildSinMonitor({ UA, prev: current(), recentOnly: true, log: m => console.log(m) })
      .then(d => { mem = d; lastError = null; try { fs.writeFileSync(CACHE, JSON.stringify(d)) } catch (e) { console.error('sin-monitor save:', e.message) } })
      .catch(e => { lastError = e.message; console.error('sin-monitor refresh:', e.message) })
      .finally(() => { running = null })
  }
  async function get() {
    const d = current()
    if (!d) throw new Error(`data/seeds/${SEED_NAME} is missing; run: node scripts/refresh-seeds.mjs sin`)
    if (Date.now() - Date.parse(d.built) > WEEK) refresh()
    return { ...d, refreshing: !!running, refreshError: lastError }
  }
  return { get }
}
