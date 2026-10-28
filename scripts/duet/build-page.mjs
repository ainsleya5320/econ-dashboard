// ============================================================================
// Build the Claude Duet page from a snapshot made by scripts/duet/snapshot.mjs.
//
//   node scripts/duet/build-page.mjs duet-snapshot.tar.gz   (or the folder)
//
// Writes .duet-page/ (gitignored): econ-dashboard.html, the page to publish
// with the Artifact tool, and every other file beside it, to pass as `files`.
// The page is the normal production bundle plus scripts/duet/shim.js, which
// answers /api from the snapshot. Run it without a .env: the build sets a dummy
// VITE_FRED_KEY so the FRED panels load, and no real key may reach the bundle.
// ============================================================================
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRED_CHUNKS, IGNORED_PARAMS } from './shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const OUT = path.join(ROOT, '.duet-page')
const log = (...a) => console.log('[duet]', ...a)

const src = process.argv[2] || path.join(ROOT, 'duet-snapshot')
let snapDir = src
if (src.endsWith('.tar.gz') || src.endsWith('.tgz')) {
  snapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-snap-'))
  execFileSync('tar', ['-xzf', src, '-C', snapDir])
}
const manifest = JSON.parse(fs.readFileSync(path.join(snapDir, 'manifest.json'), 'utf8'))

if (fs.existsSync(path.join(ROOT, '.env'))) throw new Error('move .env aside first: its keys would be compiled into a page built here')
fs.rmSync(OUT, { recursive: true, force: true })
log('building the bundle…')
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base', './', '--outDir', OUT, '--emptyOutDir'], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_FRED_KEY: 'snapshot', VITE_FMP_KEY: '' },
})
// the Artifact tool refuses U+FFFD; it only appears inside string literals
for (const f of fs.readdirSync(path.join(OUT, 'assets'))) {
  const p = path.join(OUT, 'assets', f)
  if (f.endsWith('.js')) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('�', '\\uFFFD'))
}

fs.cpSync(path.join(snapDir, 'data'), path.join(OUT, 'data'), { recursive: true })

// map outlines the app fetches from jsDelivr, which the page cannot reach
const atlases = [
  ['us-atlas@3.0.1', 'states-10m.json', 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'],
  ['us-atlas@3.0.1', 'counties-albers-10m.json', 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json'],
  ['world-atlas@2.0.2', 'countries-110m.json', 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'],
]
const geo = {}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-atlas-'))
fs.mkdirSync(path.join(OUT, 'data', 'geo'), { recursive: true })
for (const pkg of new Set(atlases.map(a => a[0]))) {
  const tgz = execFileSync('npm', ['pack', pkg, '--silent'], { cwd: tmp }).toString().trim().split('\n').pop()
  fs.mkdirSync(path.join(tmp, pkg)); execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', path.join(tmp, pkg)])
}
for (const [pkg, file, url] of atlases) {
  fs.copyFileSync(path.join(tmp, pkg, 'package', file), path.join(OUT, 'data', 'geo', file))
  geo[url] = `data/geo/${file}`
}

const day = new Date(manifest.built).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const shim = fs.readFileSync(path.join(__dirname, 'shim.js'), 'utf8')
const shimFor = page => '<script>' + shim.replace('__SNAP__', () => JSON.stringify({
  page, routes: manifest.routes, geo, fredChunks: FRED_CHUNKS, ignored: IGNORED_PARAMS,
  label: `Duet snapshot · ${day}` + (manifest.fredAsOf ? ` · FRED through ${manifest.fredAsOf}` : ''),
})) + '</script>'

// the Artifact tool wraps the page in its own <html>/<head>/<body>
const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')
const grab = re => [...index.matchAll(re)].map(m => m[1])
const page = [
  '<title>Economic Dashboard</title>',
  ...grab(/rel="stylesheet" crossorigin href="\.\/([^"]+)"/g).map(h => `<link rel="stylesheet" href="${h}">`),
  ...grab(/rel="modulepreload" crossorigin href="\.\/([^"]+)"/g).map(h => `<link rel="modulepreload" href="${h}">`),
  shimFor('main'),
  '<div id="root"></div>',
  ...grab(/<script type="module" crossorigin src="\.\/([^"]+)"/g).map(s => `<script type="module" src="${s}"></script>`),
].join('\n')
fs.writeFileSync(path.join(OUT, 'econ-dashboard.html'), page + '\n')
fs.rmSync(path.join(OUT, 'index.html'))
const ideas = path.join(OUT, 'ideas.html')
fs.writeFileSync(ideas, fs.readFileSync(ideas, 'utf8').replace('<head>', '<head>\n    ' + shimFor('ideas')))

const files = []
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) walk(p); else if (e.name !== 'econ-dashboard.html') files.push(path.relative(OUT, p))
})
walk(OUT)
fs.writeFileSync(path.join(OUT, '..', '.duet-page-files.json'), JSON.stringify(files.sort().map(p => ({ path: p }))))
log(`${files.length + 1} files in .duet-page/ · ${Object.keys(manifest.routes).length} routes · ${manifest.missing.length} missing from the snapshot`)
if (files.length + 1 > 255) log('more than 255 files: publish in two calls to the same url')
