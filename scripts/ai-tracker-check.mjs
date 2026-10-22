// AI build-out tracker check: prints every signal's status, latest period,
// staleness and source, plus any source that failed, from the running dev
// server. Usage: node scripts/ai-tracker-check.mjs [http://localhost:5180]
const base = process.argv[2] || 'http://localhost:5180'
const r = await fetch(`${base}/api/ai-buildout`).catch(e => ({ ok: false, statusText: e.message }))
if (!r.ok) { console.error(`AI build-out: ${base}/api/ai-buildout unreachable (${r.status || ''} ${r.statusText}). Is the dev server running?`); process.exit(1) }
const d = await r.json()
console.log(`AI build-out tracker — built ${d.built}${d.stale ? ' (stale copy)' : ''}`)
console.log(`Synthesis: ${d.synthesis?.line}\n`)
for (const s of d.sources || []) console.log(`${s.from === 'live' ? 'OK  ' : s.from === 'cache' ? 'OLD ' : 'FAIL'} ${s.label}${s.fetched ? ` (fetched ${String(s.fetched).slice(0, 10)})` : ''}`)
for (const e of d.sourceErrors || []) console.log(`  ! ${e}`)
console.log('')
const pad = (v, n) => String(v ?? '—').padEnd(n)
for (const s of d.signals || []) console.log(`${s.panel} ${pad(s.id, 18)} ${pad(s.status, 13)} ${pad(s.display, 20)} ${pad(s.period, 11)} ${s.stale ? 'STALE ' : s.stale === false ? 'fresh ' : '      '} ${s.source_name || ''}`)
const manual = Object.entries(d.manualSeries || {}).map(([k, v]) => `${k} ${(v.values || []).length}`).join(', ')
console.log(`\nManual inputs: ${(d.events || []).filter(e => !e.example).length} events; series ${manual}`)
if (d.thresholdsError || d.manualError) console.log(`Config errors: ${d.thresholdsError || ''} ${d.manualError || ''}`)
