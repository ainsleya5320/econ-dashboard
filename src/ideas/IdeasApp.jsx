// Ideas (/ideas): trade ideas with the reasons, a separate page on the dashboard's server.
// Everything comes from /api/ideas (server/ideas.js); this page only lays it out.
import React, { useCallback, useEffect, useMemo, useState } from 'react'

const TABS = [['shortlist', 'Shortlist'], ['stocks', 'Stocks'], ['special', 'Special situations'], ['fixed', 'Fixed income']]
const FLAG_LABEL = { check: 'Check:', risk: 'Risk:', note: 'Note:' }
const read = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
const fin = v => v != null && Number.isFinite(v)
const pct = (v, d = 0) => (!fin(v) ? 'off the scale' : v > 10 ? 'over 1,000%' : `${(v * 100).toFixed(d)}%`)
const signed = v => (fin(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%` : '—')
const money = v => {
  if (!fin(v)) return '—'
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(1)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : `${s}$${Math.round(a / 1e6)}M`
}
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n.toLocaleString()}${s[(v - 20) % 10] || s[v] || s[0]}` }
const shortDate = iso => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const tabFromHash = () => { const h = window.location.hash.slice(1); return TABS.some(t => t[0] === h) ? h : 'shortlist' }

function useIdeas() {
  const [data, setData] = useState(null), [error, setError] = useState(null)
  const load = useCallback(async only => {
    try {
      const r = await fetch(`/api/ideas${only ? '?only=stocks' : ''}`)
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setData(d => (only ? { ...(d || {}), stocks: j.stocks } : j)); setError(null)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  // while the stock ranking fills in, refresh it every 15 seconds; everything every 10 minutes
  const building = !!data?.stocks?.building
  useEffect(() => {
    const t = setInterval(() => load(building ? 'stocks' : null), building ? 15e3 : 600e3)
    return () => clearInterval(t)
  }, [building, load])
  return { data, error }
}

function Links({ links }) {
  return <span className="i-links">{(links || []).map(l => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}{l.external ? ' ↗' : ' →'}</a>)}</span>
}

function Change({ text }) {
  return <p className="i-change"><span className="i-label">What would change it</span>{text}</p>
}

function Flags({ flags }) {
  if (!flags?.length) return null
  return <ul className="i-flags">{flags.map(f => <li key={f.id} data-k={f.kind}><b>{FLAG_LABEL[f.kind]}</b>{f.text}.</li>)}</ul>
}

// a special-situations or fixed-income idea
function IdeaCard({ idea }) {
  const graded = !!idea.grade
  const title = graded ? `${idea.call}: ${idea.ticker || idea.name}` : idea.call
  const sub = graded ? (idea.ticker ? idea.name : null) : idea.bucket === 'special' && idea.name ? `${idea.name}${idea.ticker ? ` (${idea.ticker})` : ''}` : null
  return (
    <article className="i-card">
      <div className="i-card-top">
        <span className="i-kind">{idea.kind}</span>
        <span className="i-strength" data-s={idea.strength}>{graded ? `Grade ${idea.grade}` : idea.strength === 'strong' ? 'Strong signal' : 'Signal'}</span>
      </div>
      <h3 className="i-call">{title}{sub && <small>{sub}</small>}</h3>
      {(idea.headline || idea.facts?.length) && (
        <div className="i-facts">{idea.headline ? <span className="i-fact">{idea.headline}</span> : idea.facts.map(f => <span key={f} className="i-fact">{f}</span>)}</div>
      )}
      <p className="i-why">{idea.why}</p>
      <Change text={idea.change} />
      <div className="i-foot"><span className="i-horizon">{idea.horizon}</span><Links links={idea.links} /></div>
    </article>
  )
}

const rankLine = (r, floor) => `Ranks ${ord(r.rank)} of ${r.n.toLocaleString()} U.S. stocks ${floor.id === 'all' ? 'over $50M' : `over ${floor.label.replace('+', '')}`} on the two measures combined (${ord(r.ey)} on earnings yield, ${ord(r.roc)} on return on capital).`
const stockLink = sym => [{ label: 'Stock page', href: `/?view=stocks&symbol=${encodeURIComponent(sym)}` }]
const isNew = (s, floor, sinceStart) => { const d = s.since?.[floor.id]; return !!d && d !== sinceStart && Date.now() - Date.parse(`${d}T12:00:00`) < 8 * 864e5 }

function StockCard({ s, floor, sinceStart }) {
  const r = s.rank[floor.id]
  if (!r) return null
  return (
    <article className="i-card">
      <div className="i-card-top"><span className="i-kind">Magic Formula · {s.sector}</span><span className="i-rank">#{r.rank} of {r.n.toLocaleString()}</span></div>
      <h3 className="i-call">Buy {s.sym} and hold about a year<small>{s.name} · {money(s.mcap)}{isNew(s, floor, sinceStart) && <span className="i-new">new this week</span>}</small></h3>
      <div className="i-facts">
        <span className="i-fact">earnings yield {pct(s.ey)}</span>
        <span className="i-fact">return on capital {pct(s.roc)}</span>
        {fin(s.growth) && <span className="i-fact">operating profit {signed(s.growth)} y/y</span>}
      </div>
      <p className="i-why">{rankLine(r, floor)} {s.why}</p>
      <Flags flags={s.flags} />
      <Change text={s.change} />
      <div className="i-foot"><span className="i-horizon">{s.horizon} · figures through {s.quarter?.label}</span><Links links={stockLink(s.sym)} /></div>
    </article>
  )
}

function StockRows({ syms, m, floor, sinceStart }) {
  const [open, setOpen] = useState(null)
  return (
    <>
      <div className="i-row-head" aria-hidden="true"><span>#</span><span>Company</span><span>Earn. yield</span><span>Return on cap.</span><span className="i-cap">Value</span></div>
      <ol className="i-rows">
        {syms.map(sym => {
          const s = m.names[sym], r = s?.rank[floor.id]
          if (!r) return null
          return (
            <li key={sym} className="i-row">
              <button aria-expanded={open === sym} onClick={() => setOpen(open === sym ? null : sym)}>
                <span className="i-rank">{r.rank}</span>
                <span><span className="i-sym">{sym}</span><span className="i-name">{s.name}</span>{isNew(s, floor, sinceStart) && <span className="i-new">new</span>}</span>
                <span className="i-cell">{pct(s.ey)}</span>
                <span className="i-cell">{pct(s.roc)}</span>
                <span className="i-cell i-cap">{money(s.mcap)}</span>
              </button>
              {open === sym && (
                <div className="i-row-detail">
                  <p className="i-why">{rankLine(r, floor)} {s.why}</p>
                  <Flags flags={s.flags} />
                  <Change text={s.change} />
                  <div className="i-foot"><span className="i-horizon">{s.horizon} · figures through {s.quarter?.label}</span><Links links={stockLink(sym)} /></div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}

function Progress({ m }) {
  const p = m.progress
  if (!m.building || !p) return null
  const left = p.total - p.done, secs = (Date.now() - Date.parse(p.started)) / 1000
  const mins = Math.max(1, Math.round((p.done > 20 ? (left * secs) / p.done : left * 0.8) / 60))
  const paused = p.pausedUntil && p.pausedUntil > Date.now()
  return (
    <div className="i-progress" role="status">
      {paused && 'Paused for a minute: FMP asked for fewer requests (the rest of the dashboard shares the limit). '}
      {m.complete
        ? `Refreshing ${p.total.toLocaleString()} companies with new quarters: ${p.done.toLocaleString()} done, about ${mins} minute${mins === 1 ? '' : 's'} left.`
        : `Building the first ranking: ${p.done.toLocaleString()} of ${p.total.toLocaleString()} companies fetched, about ${mins} minute${mins === 1 ? '' : 's'} left. The lists rank the ${m.universe.ranked.toLocaleString()} companies ranked so far, so they will shift as the rest arrive.`}
      <div className="i-bar"><div style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} /></div>
    </div>
  )
}

function Lookup({ floor }) {
  const [q, setQ] = useState(''), [res, setRes] = useState(null), [busy, setBusy] = useState(false)
  const go = async e => {
    e.preventDefault()
    const s = q.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) return
    setBusy(true)
    try { setRes(await fetch(`/api/ideas?symbol=${encodeURIComponent(s)}`).then(r => r.json())) } catch (err) { setRes({ sym: s, found: false, reason: err.message }) } finally { setBusy(false) }
  }
  const r = res?.found ? res.rank?.[floor.id] : null
  return (
    <>
      <form className="i-lookup" onSubmit={go}>
        <input aria-label="Ticker to look up" placeholder="Ticker" value={q} onChange={e => setQ(e.target.value)} maxLength={10} />
        <button className="i-ghost" type="submit" disabled={busy}>{busy ? 'Looking…' : 'Where does it rank?'}</button>
      </form>
      {res && (
        <div className="i-lookup-result i-card" role="status">
          <div className="i-card-top"><span className="i-kind">{res.sym}{res.name ? ` · ${res.name}` : ''}</span><button className="i-ghost" onClick={() => setRes(null)}>Close</button></div>
          {!res.found ? <p className="i-why">{res.reason}</p> : !r ? <p className="i-why">Below this floor ({money(res.mcap)} market value). {res.why}</p> : (
            <>
              <p className="i-why">{rankLine(r, floor)} That is the top {Math.max(1, Math.round((r.rank / r.n) * 100))}%. {res.why}</p>
              <Flags flags={res.flags} />
            </>
          )}
          {res.found && <div className="i-foot"><span className="i-horizon">figures through {res.quarter?.label}</span><Links links={stockLink(res.sym)} /></div>}
        </div>
      )}
    </>
  )
}

function Stocks({ m, floor, setFloor }) {
  const [showAll, setShowAll] = useState(false)
  if (!m?.floors?.length) return <div className="i-empty">The stock ranking has not started yet.</div>
  const f = m.floors.find(x => x.id === floor) || m.floors[0]
  const sk = Object.entries(m.universe.skipped || {}).filter(([k]) => k !== 'not fetched yet').map(([k, v]) => `${v.toLocaleString()} ${k}`).join(', ')
  return (
    <section className="i-section">
      <div className="i-head">
        <div>
          <h2>Stocks: the Magic Formula</h2>
          <p>Joel Greenblatt's screen: every U.S. stock ranked on how cheap the whole business is (earnings yield) and how much it earns on the capital it uses (return on capital), the two ranks added. {f.n.toLocaleString()} companies ranked at this floor.</p>
        </div>
        <div className="i-controls">
          <FloorSwitch floors={m.floors} floor={f} setFloor={setFloor} />
          <Lookup floor={f} />
        </div>
      </div>
      <Progress m={m} />
      {m.error && <div className="i-errors">{m.error}</div>}
      <h3 className="i-sub">Top of the list</h3>
      <div className="i-grid">{f.top.slice(0, 6).map(sym => <StockCard key={sym} s={m.names[sym]} floor={f} sinceStart={m.sinceStart} />)}</div>
      {f.top.length > 6 && (
        <div className="i-sector" style={{ marginTop: 16 }}>
          {showAll ? <StockRows syms={f.top.slice(6)} m={m} floor={f} sinceStart={m.sinceStart} />
            : <button className="i-ghost" style={{ margin: 14 }} onClick={() => setShowAll(true)}>Show ranks 7 to {f.top.length}</button>}
        </div>
      )}
      <h3 className="i-sub">By sector</h3>
      <div className="i-sectors">
        {m.sectors.map(sec => {
          const syms = f.sectors[sec] || []
          if (!syms.length) return null
          return (
            <details key={sec} className="i-sector">
              <summary>
                <strong>{sec}</strong>
                <span className="i-lead">{syms.slice(0, 4).map(s => `${s} (${pct(m.names[s].ey)} / ${pct(m.names[s].roc)})`).join(' · ')}</span>
                <span className="i-count">top {syms.length} of {(f.sectorCounts[sec] || 0).toLocaleString()}</span>
              </summary>
              <StockRows syms={syms} m={m} floor={f} sinceStart={m.sinceStart} />
            </details>
          )
        })}
      </div>
      <div className="i-method">
        <h3>How this works</h3>
        <p>{m.method}</p>
        <p>Universe on {shortDate(m.asOf)}: {m.universe.screened?.toLocaleString()} U.S. listings over $50M, {m.universe.listed?.toLocaleString()} after leaving out OTC names, financials, utilities and REITs, {m.universe.companies.toLocaleString()} companies once share classes are merged and health insurers set aside. {m.universe.ranked.toLocaleString()} are ranked{sk ? `; not ranked: ${sk}` : ''}. Earnings yield and return on capital are shown as the dollars of operating profit per $100: off the scale means no enterprise value is left after cash, or almost no tangible capital is used, and those rank first on that measure.</p>
        <p className="i-note">{m.source}.</p>
      </div>
    </section>
  )
}

function Bucket({ title, blurb, ideas, note, method, errors }) {
  return (
    <section className="i-section">
      <div className="i-head"><div><h2>{title}</h2><p>{blurb}</p></div></div>
      {errors?.length > 0 && <div className="i-errors" style={{ marginBottom: 16 }}>{errors.join('. ')}.</div>}
      {ideas?.length ? <div className="i-grid">{ideas.map(i => <IdeaCard key={i.id} idea={i} />)}</div> : <div className="i-empty">No ideas pass the rules today.</div>}
      {note && <p className="i-note">{note}</p>}
      {method && <div className="i-method"><h3>How this works</h3>{method}</div>}
    </section>
  )
}

const FIXED_METHOD = (
  <>
    <p>Each rule reads one market and makes one call; thresholds are starting points, not forecasts. Treasury curve, 10-year minus 3-month: below zero, stay short; zero to one point, ladder 1 to 5 years; over a point, extend. TIPS: a 10-year real yield of 2% or more is a buy; breakeven inflation more than half a point under the past year's CPI favors TIPS; 0.5% or less, avoid. High-yield spread: 3 points or less, underweight; 6 or more, consider. Investment-grade spread: 0.9 or less, prefer Treasuries; 1.8 or more, attractive. The 30-year mortgage rate 2.5 points or more over the 10-year: agency mortgage bonds are cheap. The 30-year Treasury at 5% or more: lock it in.</p>
    <p>Closed-end funds: bond and municipal funds trading at least $500K a day, at a discount of 5% or more and a one-year z-score of −2 or lower (unusually cheap against their own year). Discounts past 25% and payouts over 20% are left out, since the market then doubts the reported NAV itself.</p>
    <p className="i-note">FRED (Treasury yields, TIPS, breakevens, CPI, ICE BofA spreads, Freddie Mac mortgage rates) and CEFConnect.</p>
  </>
)
const SPECIAL_METHOD = (
  <>
    <p>Ideas the dashboard's Special Situations scorer grades A (research now) or B (worth a look): points for how fresh the event is, its size, and when insiders, activists or a second event line up on the same company, less points for risks. Odd-lot tenders come first: open offers where 99 shares bought today and tendered should be bought back above the current price, since holders of under 100 shares are usually exempt from proration. Ideas marked not interested on the dashboard's Top ideas view stay hidden here.</p>
    <p className="i-note">SEC EDGAR filings and FMP, via Stocks → Special Situations.</p>
  </>
)

function FloorSwitch({ floors, floor, setFloor }) {
  return <div className="i-seg" role="group" aria-label="Minimum market value">{floors.map(x => <button key={x.id} aria-pressed={x.id === floor.id} onClick={() => setFloor(x.id)}>{x.label}</button>)}</div>
}

function Shortlist({ data, floor, setFloor, go }) {
  const m = data.stocks, f = m?.floors?.find(x => x.id === floor) || m?.floors?.[0]
  // the shortlist skips names with a data question hanging over them
  const stocks = f ? f.top.map(s => m.names[s]).filter(s => s && !s.flags.some(x => x.kind === 'check')).slice(0, 3) : []
  // the best idea of each kind, so one kind (four cheap bond funds, say) doesn't fill the list
  const oneOfEach = (ideas, n) => ideas.filter((x, i, a) => a.findIndex(y => y.kind === x.kind) === i).slice(0, n)
  const groups = [
    ['stocks', 'Stocks', stocks.map(s => <StockCard key={s.sym} s={s} floor={f} sinceStart={m.sinceStart} />), f ? `${f.n.toLocaleString()} ranked at ${f.label}` : ''],
    ['special', 'Special situations', oneOfEach(data.special?.ideas || [], 2).map(i => <IdeaCard key={i.id} idea={i} />), `${data.special?.ideas?.length || 0} ideas`],
    ['fixed', 'Fixed income', oneOfEach(data.fixed?.ideas || [], 3).map(i => <IdeaCard key={i.id} idea={i} />), `${data.fixed?.ideas?.length || 0} calls`],
  ]
  return (
    <>
      {m && <Progress m={m} />}
      {groups.map(([id, label, cards, count]) => (
        <section key={id} className="i-section">
          <div className="i-head">
            <div><h2>{label}</h2></div>
            <div className="i-controls">
              {id === 'stocks' && f && <FloorSwitch floors={m.floors} floor={f} setFloor={setFloor} />}
              <button className="i-ghost" onClick={() => go(id)}>All {label.toLowerCase()} · {count} →</button>
            </div>
          </div>
          {cards.length ? <div className="i-grid">{cards}</div> : <div className="i-empty">Nothing here yet.</div>}
        </section>
      ))}
    </>
  )
}

export default function IdeasApp() {
  const { data, error } = useIdeas()
  const [tab, setTab] = useState(tabFromHash)
  const [floor, setFloorRaw] = useState(() => read('ideas.floor', 'all'))
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark')
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; write('econ-dash-theme', theme) }, [theme])
  const setFloor = id => { setFloorRaw(id); write('ideas.floor', id) }
  const go = id => { window.location.hash = id === 'shortlist' ? '' : id; setTab(id); window.scrollTo(0, 0) }
  const counts = useMemo(() => ({
    stocks: data?.stocks?.floors?.find(x => x.id === floor)?.n,
    special: data?.special?.ideas?.length, fixed: data?.fixed?.ideas?.length,
  }), [data, floor])
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="i-app">
      <header className="i-mast">
        <div>
          <div className="i-edition">Ideas · {today}</div>
          <h1>Trade ideas, with the reasons</h1>
          <p>Calls from rules on the dashboard's data: Greenblatt's Magic Formula across U.S. stocks, the special-situations scorer, and fixed-income rules on rates, spreads and fund discounts. Each says why, for how long, and what would change it.</p>
        </div>
        <div className="i-mast-side">
          <a href="/" target="_blank" rel="noopener noreferrer">Open the dashboard →</a>
          <button className="i-ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'} mode</button>
        </div>
      </header>
      <nav className="i-tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)}>{label}{fin(counts[id]) && <span>{counts[id].toLocaleString()}</span>}</button>)}
      </nav>
      {error && !data && <div className="i-errors">Could not load ideas: {error}</div>}
      {!data && !error && <div className="i-empty">Loading ideas…</div>}
      {data && (
        <main>
          {data.errors?.length > 0 && tab === 'shortlist' && <div className="i-errors" style={{ marginBottom: 20 }}>{data.errors.join('. ')}.</div>}
          {tab === 'shortlist' && <Shortlist data={data} floor={floor} setFloor={setFloor} go={go} />}
          {tab === 'stocks' && <Stocks m={data.stocks} floor={floor} setFloor={setFloor} />}
          {tab === 'special' && (
            <Bucket title="Special situations" ideas={data.special?.ideas} method={SPECIAL_METHOD}
              blurb={`Corporate events that move a stock for reasons other than the business: tenders, spinoffs, reorganizations, activists, insider buying. ${data.special?.asOf ? `Board built ${shortDate(data.special.asOf)}.` : ''}`} />
          )}
          {tab === 'fixed' && (
            <Bucket title="Fixed income" ideas={data.fixed?.ideas} note={data.fixed?.cefNote} method={FIXED_METHOD}
              blurb={`Where to lend: how far out on the Treasury curve, inflation protection, credit, mortgages and bond funds trading below their holdings. Readings as of ${shortDate(data.fixed?.asOf)}${fin(data.fixed?.cpiYoy) ? `; CPI ${data.fixed.cpiYoy.toFixed(1)}% over the past year` : ''}.`} />
          )}
        </main>
      )}
    </div>
  )
}
