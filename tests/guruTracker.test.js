import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGuruTracker, findCheckout } from '../server/guruTracker.js'

// A parent folder holding the dashboard and, beside it, a Research Database with a guru summary.
function layout(summary = { period: '2026-06-30', counts: { managers: 2 } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gurus-'))
  const dash = path.join(root, 'econ-dashboard'), db = path.join(root, 'Research-Database')
  fs.mkdirSync(dash)
  fs.mkdirSync(path.join(db, 'data', 'generated'), { recursive: true })
  fs.writeFileSync(path.join(db, 'data', 'generated', 'gurus.json'), JSON.stringify(summary))
  return { root, dash, db }
}

test('finds a Research Database checkout beside the dashboard, or the folder named in .env', () => {
  const { root, dash, db } = layout()
  assert.equal(findCheckout(dash, ''), db)
  assert.equal(findCheckout(dash, db), db)
  assert.equal(findCheckout(dash, path.join(root, 'nowhere')), null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('serves the summary with where it came from and the app link, and re-reads it when it changes', async () => {
  const { root, dash, db } = layout()
  const g = createGuruTracker({ dir: dash, env: { RESEARCH_DB_URL: 'http://localhost:5051/app/#gurus' } })
  const a = await g.get()
  assert.equal(a.available, true)
  assert.equal(a.source, 'local')
  assert.equal(a.where, db)
  assert.equal(a.researchUrl, 'http://localhost:5051/app/')
  assert.equal(a.period, '2026-06-30')
  const file = path.join(db, 'data', 'generated', 'gurus.json')
  fs.writeFileSync(file, JSON.stringify({ period: '2026-09-30' }))
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
  assert.equal((await g.get()).period, '2026-09-30')
  fs.rmSync(root, { recursive: true, force: true })
})

test('says how to connect it when there is no checkout and no token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gurus-none-'))
  const saved = { gh: process.env.GITHUB_TOKEN, rt: process.env.RESEARCH_DB_TOKEN, rd: process.env.RESEARCH_DB_DIR }
  delete process.env.GITHUB_TOKEN; delete process.env.RESEARCH_DB_TOKEN; delete process.env.RESEARCH_DB_DIR
  try {
    const r = await createGuruTracker({ dir, env: {} }).get()
    assert.equal(r.available, false)
    assert.match(r.reason, /RESEARCH_DB_DIR/)
    assert.equal(r.researchUrl, 'http://localhost:5050/app/')
  } finally {
    for (const [k, v] of [['GITHUB_TOKEN', saved.gh], ['RESEARCH_DB_TOKEN', saved.rt], ['RESEARCH_DB_DIR', saved.rd]]) if (v !== undefined) process.env[k] = v
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
