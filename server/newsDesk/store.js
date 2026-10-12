// ============================================================================
// NEWS DESK STORE: every news item and filing the desk has seen, with the
// model's triage and analysis attached, in one JSON file at the repo root
// (news-desk.json, gitignored: it names the watchlist).
//
//   createStore({ dir }) → {
//     all()              items, newest first (do not mutate; use update)
//     get(id)            one item or null
//     upsert(items)      merge feed items in → { added: ids, updated: ids, skipped }
//                        never drops existing triage, analysis or text; a clip
//                        stays a clip when the same article arrives from a feed
//     update(id, patch)  shallow patch (an object, or a function of the item
//                        returning one); a key set to undefined is removed
//     prune(days = 30)   drop items older than that, except clips and items
//                        with an approved proposal → number removed
//     save()             atomic write now → true, or false with stats().lastError
//     stats()            counts and file state
//   }
//
// Safety rules:
//   - Writes go to a temp file that is then renamed over news-desk.json, so a
//     crash mid-write never leaves half a file. Renames are retried, because
//     OneDrive and antivirus scanners briefly lock files on Windows.
//   - The store starts empty ONLY when the file does not exist. A file that
//     cannot be parsed is renamed aside (news-desk.corrupt-<ts>.json) and
//     logged. Any other read error (a lock, a permission) leaves the store
//     unloaded: it keeps working in memory, retries the read, and refuses to
//     save until the read succeeds, so it never overwrites what it could not read.
//   - Before each write the file is checked for changes made by another writer
//     (Vite restarts the server in-process, so an old instance can still be
//     finishing a request); such changes are merged in, not overwritten.
//   - Mutations also schedule a save 1.5 s later, so a forgotten save() loses
//     nothing; explicit save() calls stay cheap.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

export const TEXT_CAP = 40_000
// The least text that counts as a full read: a clip needs this much, and a
// deep read uses an item's text (basis 'full-text') from this length on.
// The clip route, the clip window, the bookmarklet, the paste form (through
// the payload's limits) and analyzer.js all use this one number.
export const FULL_TEXT_MIN = 200
const FILE_NAME = 'news-desk.json'
const VERSION = 1
const AUTOSAVE_MS = 1500
const RETRY_LOAD_MS = 2000

const sleepSync = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* no SAB: skip the pause */ } }
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

// Write JSON so the target is either the old file or the complete new one.
// Shared with profile.js (news-profile.json). Throws on final failure. The
// temp file is <name>.tmp-<pid>-<rand>.json, so the gitignore pattern that
// covers <name>*.json covers it too.
export function writeJsonAtomic(file, data, { pretty = false } = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, pretty ? 2 : 0)
  const tmp = `${file.replace(/\.json$/i, '')}.tmp-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.json`
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  let err = null
  for (let a = 0; a < 7; a++) {
    try { fs.renameSync(tmp, file); return body.length } catch (e) {
      err = e
      if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(e.code)) break
      sleepSync(25 * 2 ** a)
    }
  }
  try { fs.unlinkSync(tmp) } catch { /* already gone */ }
  throw err
}

// Read a JSON file without ever mistaking "unreadable" for "empty".
//   { state: 'missing' }            the file does not exist
//   { state: 'ok', data, stat }     parsed
//   { state: 'corrupt', error }     exists but is not valid JSON
//   { state: 'error', error }       could not be read (lock, permission ...)
export function readJsonSafe(file) {
  let raw, stat
  try { stat = fs.statSync(file); raw = fs.readFileSync(file, 'utf8') } catch (e) {
    if (e.code === 'ENOENT') return { state: 'missing' }
    return { state: 'error', error: e.code && !String(e.message).startsWith(e.code) ? `${e.code}: ${e.message}` : String(e.message || 'read failed') }
  }
  try { return { state: 'ok', data: JSON.parse(raw.replace(/^﻿/, '')), stat } } catch (e) {
    return { state: 'corrupt', error: e.message }
  }
}

// Move an unparseable file out of the way so nothing overwrites it.
export function setAside(file) {
  const dir = path.dirname(file), base = path.basename(file).replace(/\.json$/, '')
  const dest = path.join(dir, `${base}.corrupt-${stamp()}.json`)
  fs.renameSync(file, dest)
  return dest
}

const filled = v => v !== undefined && v !== null && v !== ''
const atOf = x => (x && Date.parse(x.at)) || 0
const capText = t => (typeof t === 'string' && t.length > TEXT_CAP ? t.slice(0, TEXT_CAP) : t)
const timeOf = it => Date.parse(it.published) || Date.parse(it.fetched) || 0
const isClip = it => it && (it.kind === 'clip' || it.source === 'clip')
const hasApproved = it => (it?.analysis?.proposals || []).some(p => p && p.status === 'approved')

// Merge an incoming copy of an item into the stored one. Incoming metadata
// wins when it has a value (headlines get rewritten); nothing the desk has
// paid for or the user has supplied is lost.
export function mergeItem(old, inc) {
  if (!old) {
    const fresh = { ...inc, text: capText(inc.text) }
    if (fresh.textPartial === false) delete fresh.textPartial
    return fresh
  }
  const out = { ...old }
  for (const [k, v] of Object.entries(inc)) if (filled(v)) out[k] = v
  out.id = old.id
  // a filing read in full on a later run is no longer partial (feeds.js sends false)
  if (out.textPartial === false) delete out.textPartial
  // the first time the desk saw a story stays its time; fetched moves forward
  if (filled(old.published)) out.published = old.published
  if (filled(old.fetched) && filled(inc.fetched)) out.fetched = Date.parse(inc.fetched) >= Date.parse(old.fetched) ? inc.fetched : old.fetched
  // a clip (full text from the user's own browser) is never demoted by a feed copy
  if (isClip(old) && !isClip(inc)) { out.kind = old.kind; out.source = old.source; out.outlet = old.outlet }
  out.tickers = [...new Set([...(old.tickers || []), ...(inc.tickers || [])])]
  out.paywalled = Boolean(old.paywalled || inc.paywalled)
  // text: incoming only when it brings some (and the longer of two copies,
  // unless it is a clip or the complete read of a filing stored in part)
  const ot = typeof old.text === 'string' ? old.text : '', it = typeof inc.text === 'string' ? inc.text : ''
  if (ot || it) out.text = capText(it.length >= ot.length || (it && (isClip(inc) || (old.textPartial && inc.textPartial === false))) ? it : ot)
  // triage and analysis: keep the newer of the two, never drop one
  for (const k of ['triage', 'analysis']) {
    if (old[k] && inc[k]) out[k] = atOf(inc[k]) >= atOf(old[k]) ? inc[k] : old[k]
    else out[k] = inc[k] || old[k]
    if (!out[k]) delete out[k]
  }
  if ('error' in inc && !filled(inc.error)) delete out.error
  return out
}

export function createStore({ dir }) {
  const FILE = path.join(dir, FILE_NAME)
  const items = new Map()
  const removed = new Set()          // pruned since the last save, so a merge does not resurrect them
  let loaded = false, loadError = null, lastLoadTry = 0
  let diskSig = null                 // { mtimeMs, size } of the file as we last read or wrote it
  let dirty = false, savedAt = null, lastError = null, bytes = 0, sorted = null, timer = null, corrupt = null

  const sig = st => (st ? { mtimeMs: st.mtimeMs, size: st.size } : null)
  const sameSig = (a, b) => (!a && !b) || (a && b && a.mtimeMs === b.mtimeMs && a.size === b.size)

  function rowsOf(data) {
    if (Array.isArray(data)) return data
    if (data && Array.isArray(data.items)) return data.items
    if (data && data.items && typeof data.items === 'object') return Object.values(data.items)
    return null
  }

  // Bring the disk copy in under what is in memory.
  function absorb(rows) {
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || removed.has(r.id)) continue
      const mem = items.get(r.id)
      items.set(r.id, mem ? mergeItem(r, mem) : r)
    }
    sorted = null
  }

  function load() {
    lastLoadTry = Date.now()
    const res = readJsonSafe(FILE)
    if (res.state === 'missing') { loaded = true; loadError = null; diskSig = null; return }
    if (res.state === 'error') { loadError = res.error; console.warn(`News desk store: cannot read ${FILE_NAME} (${res.error}); working in memory, will retry before saving`); return }
    const rows = res.state === 'ok' ? rowsOf(res.data) : null
    if (!rows) {
      const why = res.state === 'corrupt' ? res.error : 'unexpected shape (no items array)'
      try {
        const dest = setAside(FILE)
        corrupt = { at: new Date().toISOString(), file: path.basename(dest), error: why }
        console.error(`News desk store: ${FILE_NAME} could not be parsed (${why}); moved it to ${path.basename(dest)} and started a new one`)
        loaded = true; loadError = null; diskSig = null; dirty = items.size > 0
      } catch (e) {
        loadError = `unparseable and could not be moved aside: ${e.message}`
        console.error(`News desk store: ${loadError}`)
      }
      return
    }
    absorb(rows)
    loaded = true; loadError = null; diskSig = sig(res.stat); bytes = res.stat.size
  }
  const ensure = () => { if (!loaded && Date.now() - lastLoadTry > RETRY_LOAD_MS) load() }
  load()

  function touch() {
    dirty = true; sorted = null
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (dirty) save() }, AUTOSAVE_MS)
    timer.unref?.()
  }

  function all() {
    ensure()
    if (!sorted) sorted = [...items.values()].sort((a, b) => timeOf(b) - timeOf(a) || String(a.id).localeCompare(String(b.id)))
    return sorted
  }

  function get(id) { ensure(); return items.get(id) || null }

  function upsert(list) {
    ensure()
    const added = [], updated = []
    let skipped = 0
    for (const inc of list || []) {
      if (!inc || typeof inc.id !== 'string' || !inc.id || (!inc.url && !inc.title)) { skipped++; continue }
      const old = items.get(inc.id)
      const next = mergeItem(old, inc)
      if (!next.tickers) next.tickers = []
      items.set(inc.id, next)
      removed.delete(inc.id)
      ;(old ? updated : added).push(inc.id)
    }
    if (added.length || updated.length) touch()
    return { added, updated, skipped }
  }

  function update(id, patch) {
    ensure()
    const cur = items.get(id)
    if (!cur) return null
    const p = typeof patch === 'function' ? patch(cur) : patch
    if (!p || typeof p !== 'object') return cur
    const next = { ...cur }
    for (const [k, v] of Object.entries(p)) {
      if (k === 'id') continue
      if (v === undefined) delete next[k]
      else next[k] = k === 'text' ? capText(v) : v
    }
    items.set(id, next)
    touch()
    return next
  }

  function prune(days = 30) {
    ensure()
    const cutoff = Date.now() - days * 864e5
    let n = 0
    for (const [id, it] of items) {
      if (isClip(it) || hasApproved(it)) continue
      const t = timeOf(it)
      if (t && t < cutoff) { items.delete(id); removed.add(id); n++ }
    }
    if (n) touch()
    return n
  }

  function save() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!loaded) load()
    if (!loaded) { lastError = `not saved: ${FILE_NAME} could not be read (${loadError})`; return false }
    try {
      // another writer touched the file since we last read or wrote it: merge first
      const now = readJsonSafe(FILE)
      if (now.state === 'ok' && !sameSig(sig(now.stat), diskSig)) { const rows = rowsOf(now.data); if (rows) absorb(rows) }
      else if (now.state === 'corrupt') {
        // something else wrote a broken file since our last write: keep it for inspection
        const dest = setAside(FILE)
        corrupt = { at: new Date().toISOString(), file: path.basename(dest), error: now.error }
        console.error(`News desk store: ${FILE_NAME} was replaced by an unparseable file; moved it to ${path.basename(dest)}`)
      } else if (now.state === 'error') { lastError = `not saved: ${now.error}`; dirty = true; return false }
      const list = all()
      const body = JSON.stringify({ version: VERSION, saved: new Date().toISOString(), count: list.length, items: list })
      bytes = writeJsonAtomic(FILE, body)
      diskSig = sig(fs.statSync(FILE))
      removed.clear()
      dirty = false; savedAt = new Date().toISOString(); lastError = null
      return true
    } catch (e) {
      lastError = `save failed: ${e.code || ''} ${e.message}`.trim()
      dirty = true
      console.error(`News desk store: ${lastError}`)
      return false
    }
  }

  function stats() {
    const list = all()
    const by = key => list.reduce((m, it) => { const k = it[key] || 'unknown'; m[k] = (m[k] || 0) + 1; return m }, {})
    const times = list.map(timeOf).filter(Boolean)
    let pending = 0
    for (const it of list) for (const p of it.analysis?.proposals || []) if (p?.status === 'pending') pending++
    return {
      file: FILE_NAME,
      items: list.length,
      byKind: by('kind'),
      bySource: by('source'),
      triaged: list.filter(it => it.triage).length,
      analysed: list.filter(it => it.analysis).length,
      fullText: list.filter(it => it.analysis?.basis === 'full-text').length,
      withText: list.filter(it => typeof it.text === 'string' && it.text.length).length,
      clips: list.filter(isClip).length,
      errors: list.filter(it => it.error).length,
      pendingProposals: pending,
      newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
      oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
      bytes, savedAt, dirty, loaded,
      loadError, lastError, corrupt,
    }
  }

  return { all, get, upsert, update, prune, save, stats }
}
