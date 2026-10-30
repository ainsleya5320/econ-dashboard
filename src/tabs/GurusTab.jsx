import React, { useEffect, useMemo, useRef, useState } from "react";
import { finite, signed, usdK, VizCard, Kpi, Seg, Legend } from "./options/ui.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// GURUS: the managers first, then what they agree on.
// The tracker lives in the Research Database, which reads every 13F from EDGAR
// each Monday (96 managers: every Dataroma superinvestor plus fundamental hedge
// funds and activists) and writes the files this tab draws.
//   Managers   the roster (one row per manager: book, holdings, concentration,
//              turnover, this quarter's moves, largest names; sortable, searchable,
//              filtered by style) and, under it, the names most of them share.
//              A manager opens their page: twelve quarters of book value, where the
//              book sits by theme, this quarter's new buys, adds, trims and exits,
//              and every position with weight, shares, estimated cost and the return
//              since. ?manager=<slug> deep-links a page.
//   Consensus  the cross-manager read: consensus builds against sells, where the
//              money moved by theme over nine quarters, the biggest exits, guru moves
//              in your own names, names bought together and option lines.
// A ticker opens its stock page here; "Story ↗" opens the Research Database's
// story workbench for the name. Data: /api/gurus, /api/gurus/manager?slug=,
// /api/gurus/held (server/guruTracker.js). Buying is blue and selling orange,
// the --oc-1/--oc-2 slots of the validated palette, in both themes; adds and trims
// are the same hues at half strength, so a bar still reads with the legend.
// ============================================================================

const BUY = "var(--oc-1)", SELL = "var(--oc-2)";
const ACT = { new: ["New", BUY, 1], add: ["Added", BUY, 0.5], trim: ["Trimmed", SELL, 0.5], exit: ["Sold out", SELL, 1], hold: ["Held", "var(--text-muted)", 0.35] };
const quarter = p => (p ? `Q${Math.floor((+p.slice(5, 7) - 1) / 3) + 1} ${p.slice(0, 4)}` : "—");
const qShort = p => quarter(p).replace(" 20", " ’");
const pts = v => (finite(v) ? signed(v * 100, 1) : "—");
const pctS = (v, dp = 0) => (finite(v) ? signed(v * 100, dp, "%") : "—");
const pct = (v, dp = 0) => (finite(v) ? `${(v * 100).toFixed(dp)}%` : "—");
const usd = v => (finite(v) ? `$${v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}` : "—");
const num = v => (!finite(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : Math.round(v).toLocaleString("en-US"));
const day = d => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const plainTicker = k => (k.startsWith("CUSIP:") ? k.slice(6) : k);
const shortFirm = f => (f || "").replace(/(,? (Capital|Asset|Investment|Investments|Management|Partners|Group|Associates|Advisors|LP|LLC|Inc\.?))+$/i, "");
// a pole mixed into the gray midpoint by |t| (0..1): the dashboard's diverging cell, with the tracker's two hues
const heatBg = (v, max) => (!finite(v) || !v ? "transparent"
  : `color-mix(in srgb, ${v > 0 ? BUY : SELL} ${Math.round(14 + Math.min(1, (Math.abs(v) / (max || 1)) ** 0.65) * 50)}%, var(--oc-mid))`);
const cell = { textAlign: "left" }, right = { textAlign: "right" };
const tickerBtn = { background: "none", border: 0, padding: 0, cursor: "pointer", font: "600 12.5px var(--font-number)", color: "var(--text-primary)" };
const linkStyle = { color: "var(--oc-1)", fontSize: 11.5 };

// Buyers to the right in blue, sellers to the left in orange, on one scale for the whole table.
function Diverge({ buyers, sellers, max }) {
  const W = 120, mid = 60, s = n => (n ? Math.max(3, (n / Math.max(1, max)) * 56) : 0);
  return (
    <svg width={W} height={14} role="img" aria-label={`${buyers} bought or added, ${sellers} trimmed or sold`} style={{ display: "block" }}>
      <line x1={mid} x2={mid} y1={0} y2={14} stroke="var(--border-subtle)" />
      {sellers > 0 && <rect x={mid - 1 - s(sellers)} y={3} width={s(sellers)} height={8} rx={2} fill={SELL} />}
      {buyers > 0 && <rect x={mid + 1} y={3} width={s(buyers)} height={8} rx={2} fill={BUY} />}
    </svg>
  );
}

// One manager's quarter as four segments on a shared scale: new and added to the right, trimmed and sold to the left.
function Moves({ m, max }) {
  const W = 120, mid = 60, s = n => (n ? (n / Math.max(1, max)) * 56 : 0);
  const segs = [["exit", -s(m.exit || 0) - s(m.trim || 0), s(m.exit || 0)], ["trim", -s(m.trim || 0), s(m.trim || 0)], ["new", 0, s(m.new || 0)], ["add", s(m.new || 0), s(m.add || 0)]];
  return (
    <svg width={W} height={14} role="img" aria-label={`${m.new || 0} new, ${m.add || 0} added, ${m.trim || 0} trimmed, ${m.exit || 0} sold out`} style={{ display: "block" }}>
      <line x1={mid} x2={mid} y1={0} y2={14} stroke="var(--border-subtle)" />
      {segs.map(([a, x, w]) => w > 0 && <rect key={a} x={mid + x + (x < 0 ? -1 : 1)} y={3} width={Math.max(2, w)} height={8} rx={1.5} fill={ACT[a][1]} opacity={ACT[a][2]} />)}
    </svg>
  );
}

function ActTag({ act }) {
  const [label, color, op] = ACT[act] || [act, "var(--text-muted)", 0.5];
  return <span className="otag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: color, opacity: op, display: "inline-block" }} />{label}</span>;
}

function Tags({ ids, labels, n = 2 }) {
  const list = (ids || []).slice(0, n);
  if (!list.length) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{list.map(id => <span key={id} className="otag">{short(labels[id] || id, 26)}</span>)}{(ids || []).length > n && <span className="otag">+{ids.length - n}</span>}</span>;
}

// Twelve quarters of reported book value as thin bars (one axis, the latest labelled); the count of positions rides along in the hover.
function BookHistory({ history }) {
  const h = (history || []).filter(x => finite(x.book));
  if (h.length < 2) return <p className="onote">Fewer than two quarters on file.</p>;
  const W = 520, H = 130, pad = { l: 8, r: 8, t: 18, b: 22 }, max = Math.max(...h.map(x => x.book)) || 1;
  const bw = (W - pad.l - pad.r) / h.length, iw = Math.max(4, bw - 6);
  return (
    <div className="otable-wrap">
      <svg width={W} height={H} role="img" aria-label="Reported book value by quarter" style={{ display: "block", maxWidth: "100%" }}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--border-subtle)" />
        {h.map((x, i) => {
          const bh = ((x.book / max) * (H - pad.t - pad.b)), x0 = pad.l + i * bw + (bw - iw) / 2, last = i === h.length - 1;
          return (
            <g key={x.p}>
              <title>{`${quarter(x.p)}: ${usdK(x.book)} across ${x.n} positions, top 10 = ${pct(x.top10)}`}</title>
              <rect x={x0} y={H - pad.b - bh} width={iw} height={bh} rx={3} fill={BUY} opacity={last ? 1 : 0.6} />
              {(last || i % 2 === 0) && <text x={x0 + iw / 2} y={H - 7} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{qShort(x.p)}</text>}
              {last && <text x={x0 + iw / 2} y={H - pad.b - bh - 5} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: "var(--text-primary)", fontFamily: "var(--font-number)" }}>{usdK(x.book)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Horizontal bars for a share-of-book list (theme mix), the prior quarter's share as a hairline tick.
function ShareBars({ rows }) {
  const max = Math.max(1e-9, ...rows.map(r => Math.max(r.w || 0, r.prev || 0)));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {rows.map(r => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.1fr) 2fr 52px 56px", alignItems: "center", gap: 8, fontSize: 11.5 }} title={`${r.label}: ${pct(r.w, 1)} of the book${finite(r.prev) ? `, ${pct(r.prev, 1)} a quarter earlier` : ""}`}>
          <span style={{ fontFamily: "var(--font-body)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span style={{ position: "relative", height: 10 }}>
            <i style={{ position: "absolute", left: 0, top: 0, height: 10, borderRadius: 2, width: `${Math.max(1, (r.w / max) * 100)}%`, background: BUY, opacity: 0.75 }} />
            {finite(r.prev) && <i style={{ position: "absolute", left: `${(r.prev / max) * 100}%`, top: -2, height: 14, width: 2, background: "var(--text-primary)", opacity: 0.6 }} />}
          </span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-number)", color: "var(--text-primary)" }}>{pct(r.w, 1)}</span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-number)", color: "var(--text-secondary)" }}>{finite(r.prev) ? pts(r.w - r.prev) : "new"}</span>
        </div>
      ))}
    </div>
  );
}

function SortTh({ col, sort, onSort, children, align = "right" }) {
  const on = sort.key === col;
  return <th style={{ textAlign: align }}><button type="button" onClick={() => onSort(col)} aria-sort={on ? (sort.dir < 0 ? "descending" : "ascending") : undefined} style={{ fontWeight: on ? 600 : 500, color: on ? "var(--text-primary)" : undefined }}>{children}{on ? (sort.dir < 0 ? " ↓" : " ↑") : ""}</button></th>;
}

const urlManager = () => new URLSearchParams(window.location.search).get("manager") || "";
function setUrlManager(slug) {
  const u = new URL(window.location.href);
  if (slug) u.searchParams.set("manager", slug); else u.searchParams.delete("manager");
  window.history.replaceState(null, "", u);
}

export default function GurusTab({ onTicker }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [view, setView] = useState(() => (urlManager() ? "managers" : "managers"));
  const [slug, setSlug] = useState(urlManager);
  const [held, setHeld] = useState(null);
  const [mgr, setMgr] = useState(null), [mgrErr, setMgrErr] = useState(null);
  const pages = useRef(new Map());
  const top = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/gurus").then(r => r.json()).then(j => { if (alive) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => alive && setErr(e.message));
    fetch("/api/gurus/held").then(r => r.json()).then(j => alive && setHeld(j)).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    setUrlManager(slug);
    if (!slug) { setMgr(null); return; }
    setMgrErr(null);
    if (pages.current.has(slug)) { setMgr(pages.current.get(slug)); return; }
    let alive = true;
    setMgr(null);
    fetch(`/api/gurus/manager?slug=${encodeURIComponent(slug)}`).then(r => r.json()).then(j => { if (!alive) return; if (j.error) setMgrErr(j.error); else { pages.current.set(slug, j); setMgr(j); } }).catch(e => alive && setMgrErr(e.message));
    return () => { alive = false; };
  }, [slug]);

  const themeLabel = useMemo(() => Object.fromEntries((d?.themes || []).map(t => [t.id, t.label])), [d]);
  const firmOf = useMemo(() => Object.fromEntries((d?.managers || []).map(m => [m.slug, m])), [d]);
  const firm = s => shortFirm(firmOf[s]?.firm) || s;
  const story = k => `${d.researchUrl}#gurus/story/${encodeURIComponent(k)}`;
  const open = s => { setSlug(s); setView("managers"); top.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); };

  if (err) return <div className="options-research"><p className="ohead-line">The guru tracker could not be loaded: {err}</p></div>;
  if (!d) return <div className="options-research"><p className="ohead-line" style={{ color: "var(--text-muted)" }}>Loading the guru tracker…</p></div>;
  if (!d.available) {
    return (
      <div className="options-research">
        <h2 style={{ font: "600 22px var(--font-body)", margin: "0 0 6px", color: "var(--text-primary)" }}>Gurus</h2>
        <section className="ocard">
          <h3 className="ocard-title">The Research Database's guru data was not found</h3>
          <p className="ocard-finding">{d.reason}</p>
          <ol style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-primary)", margin: "4px 0 0", paddingLeft: 18 }}>
            <li>Point the dashboard at your Research Database folder: <code>RESEARCH_DB_DIR=C:\path\to\Research-Database</code> in <code>.env</code>, then restart <code>npm run dev</code>.</li>
            <li>Or, to read it from GitHub instead, put a token that can read the private repo in <code>RESEARCH_DB_TOKEN</code>.</li>
            <li>The summary is written by <code>python scripts/gurus.py</code> there (and by its Monday refresh).</li>
          </ol>
        </section>
      </div>
    );
  }

  const q = quarter(d.period);
  const newCount = (d.managers || []).reduce((n, m) => n + (m.new || 0), 0);
  const totalBook = (d.managers || []).reduce((s, m) => s + (m.state === "current" || m.state === "early" ? m.book || 0 : 0), 0);
  const yours = Object.entries(d.book || {}).filter(([, t]) => t.buyers || t.sellers);

  const nameCell = (k, name, sub) => (
    <td style={{ ...cell, whiteSpace: "normal", minWidth: 150 }}>
      {k.startsWith("CUSIP:") ? <strong>{plainTicker(k)}</strong>
        : <button type="button" onClick={() => onTicker?.(k)} title={`Open ${k} on the Stocks page`} style={tickerBtn}>{k}</button>}
      {(name || sub) && <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>{short(name, 32)}{sub ? <span style={{ color: "var(--text-muted)" }}> · {short(sub, 28)}</span> : null}</div>}
    </td>
  );
  const storyCell = k => <td style={right}>{!k.startsWith("CUSIP:") && <a href={story(k)} target="_blank" rel="noopener noreferrer" style={linkStyle}>Story ↗</a>}</td>;
  const ctx = { d, q, onTicker, themeLabel, firm, story, nameCell, storyCell, open };

  return (
    <div className="options-research" style={{ marginBottom: 12 }} ref={top}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ font: "600 22px var(--font-body)", letterSpacing: -0.4, margin: 0, color: "var(--text-primary)" }}>Gurus: {view === "managers" ? (slug ? "a manager's book" : "the managers") : "what they agree on"}</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Seg label="View" value={view} onChange={v => { setView(v); if (v === "consensus") setSlug(""); }} options={[["managers", "Managers"], ["consensus", "Consensus"]]} />
          <a href={`${d.researchUrl}#gurus`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)", fontSize: 12.5 }}>Open the full tracker ↗</a>
        </div>
      </div>
      <p className="ohead-line">
        {q} 13F filings from {d.counts.participants} of {d.counts.managers} managers, read from EDGAR by the Research Database (built {day(d.asOf)}).
        Filings are up to 45 days old when they arrive and show long positions only: no shorts, cash or anything bought and sold within the quarter.
      </p>
      <div className="okpis">
        <Kpi label={`Filed ${q}`} value={d.counts.participants} sub={`of ${d.counts.managers} managers`} />
        <Kpi label="Reported books" value={usdK(totalBook)} sub="combined, long positions" />
        <Kpi label="Securities held" value={d.counts.securities.toLocaleString("en-US")} />
        <Kpi label="New positions" value={newCount.toLocaleString("en-US")} sub="opened this quarter" />
        <Kpi label="Option lines" value={d.counts.optionLines} sub="calls and puts" />
        <Kpi label="Your names with moves" value={yours.length} sub="notes and watchlist" />
      </div>

      {view === "managers" && slug && <ManagerPage ctx={ctx} slug={slug} page={mgr} error={mgrErr} />}
      {view === "managers" && !slug && <Roster ctx={ctx} />}
      {view === "managers" && !slug && <WidelyHeld ctx={ctx} held={held} />}
      {view === "consensus" && <Consensus ctx={ctx} />}

      <p className="onote">
        Source: the Research Database's guru tracker ({d.source === "local" ? `checkout at ${d.where}` : `GitHub, ${d.where}`}), filings last read from EDGAR {day(d.readAt)}.
        {" "}Estimated cost prices each quarter's purchases at its volume-weighted average; the method and its limits are in the tracker's Method page.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The roster: one row per manager, sorted and filtered, each opening their page.
// ---------------------------------------------------------------------------
function Roster({ ctx }) {
  const { d, q, open } = ctx;
  const [sort, setSort] = useState({ key: "book", dir: -1 }), [style, setStyle] = useState(""), [find, setFind] = useState("");
  const onSort = key => setSort(s => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "manager" || key === "style" ? 1 : -1 }));
  const get = {
    manager: m => (m.manager || m.firm || "").toLowerCase(), style: m => m.style || "", period: m => `${m.period || ""} ${m.filed || ""}`,
    book: m => m.book || 0, chg: m => (m.prevBook ? m.book / m.prevBook - 1 : -Infinity), positions: m => m.positions || 0, top10: m => m.top10 || 0,
    turnover: m => m.turnover || 0, moves: m => (m.new || 0) + (m.add || 0) + (m.trim || 0) + (m.exit || 0), new: m => m.new || 0,
  };
  const needle = find.trim().toLowerCase();
  const rows = (d.managers || [])
    .filter(m => !style || m.style === style)
    .filter(m => !needle || [m.manager, m.firm, m.slug, m.filer, ...(m.top || []).map(([k]) => k)].some(s => (s || "").toLowerCase().includes(needle)))
    .sort((a, b) => { const x = get[sort.key](a), y = get[sort.key](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || (b.book || 0) - (a.book || 0); });
  const mmax = Math.max(1, ...rows.map(m => (m.new || 0) + (m.add || 0)), ...rows.map(m => (m.trim || 0) + (m.exit || 0)));
  const styles = Object.entries(d.styles || {});
  return (
    <VizCard eyebrow={`${rows.length} of ${d.counts.managers} managers · ${q}`} title="The managers"
      finding={style ? d.styles?.[style]?.reads : "Every superinvestor Dataroma follows plus fundamental hedge funds and activists it does not, each read from its own filings. Click a manager for the book; sort by any column."}
      right={<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="oinput" type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="Manager, firm or ticker" aria-label="Find a manager" style={{ width: 170 }} />
        <Seg label="Filter by style" value={style} onChange={setStyle} options={[["", "All"], ...styles.map(([id, s]) => [id, s.label])]} />
      </div>}
      style={{ marginBottom: 12 }}>
      <Legend items={[["New", BUY], ["Added", `color-mix(in srgb, ${BUY} 50%, transparent)`], ["Trimmed", `color-mix(in srgb, ${SELL} 50%, transparent)`], ["Sold out", SELL]]} />
      <div className="otable-wrap" style={{ maxHeight: 560, overflowY: "auto" }}>
        <table className="otable">
          <thead><tr>
            <SortTh col="manager" sort={sort} onSort={onSort} align="left">Manager</SortTh>
            <SortTh col="style" sort={sort} onSort={onSort} align="left">Style</SortTh>
            <SortTh col="period" sort={sort} onSort={onSort} align="left">Portfolio date</SortTh>
            <SortTh col="book" sort={sort} onSort={onSort}>Value</SortTh>
            <SortTh col="chg" sort={sort} onSort={onSort}>q/q</SortTh>
            <SortTh col="positions" sort={sort} onSort={onSort}>Holdings</SortTh>
            <SortTh col="top10" sort={sort} onSort={onSort}>Top 10</SortTh>
            <SortTh col="turnover" sort={sort} onSort={onSort}>Turnover</SortTh>
            <SortTh col="moves" sort={sort} onSort={onSort} align="left">This quarter</SortTh>
            <th style={cell}>Largest positions</th>
          </tr></thead>
          <tbody>{rows.map(m => {
            const chg = m.prevBook ? m.book / m.prevBook - 1 : null, filed = m.state === "current" || m.state === "early";
            return (
              <tr key={m.slug} className="oclick" onClick={() => open(m.slug)} style={{ opacity: m.state === "stale" || m.state === "no filings" ? 0.6 : 1 }}>
                <td style={{ ...cell, whiteSpace: "normal", minWidth: 170 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); open(m.slug); }} style={{ ...tickerBtn, font: "600 12.5px var(--font-body)", textAlign: "left" }}>{m.manager || m.firm}</button>
                  {m.manager && <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>{m.firm}</div>}
                </td>
                <td style={cell}><span className="otag">{d.styles?.[m.style]?.label || m.style}</span></td>
                <td style={cell}>{quarter(m.period)}<div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{m.filed ? `filed ${day(m.filed)}` : m.state}</div></td>
                <td style={right}>{usdK(m.book)}</td>
                <td style={{ ...right, color: finite(chg) ? (chg > 0 ? BUY : chg < 0 ? SELL : undefined) : "var(--text-muted)" }} title={m.bookEvent ? "The whole book moved together: money arriving or leaving" : chg != null ? `From ${usdK(m.prevBook)} a quarter earlier (price moves included)` : undefined}>{pctS(chg)}</td>
                <td style={right}>{m.positions ?? "—"}</td>
                <td style={right}>{pct(m.top10)}</td>
                <td style={right}>{pct(m.turnover)}</td>
                <td style={cell}>{filed ? <>
                  <Moves m={m} max={mmax} />
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{m.bookEvent ? (m.bookEvent.kind === "emptied" ? "book emptied" : `whole book ×${m.bookEvent.factor.toFixed(2)}`) : `${m.new || 0} new · ${m.add || 0} added · ${m.trim || 0} trimmed · ${m.exit || 0} sold`}</div>
                </> : <span style={{ color: "var(--text-muted)" }}>not filed</span>}</td>
                <td style={cell}><span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{(m.top || []).slice(0, 4).map(([k, w]) => <span key={k} className="otag"><strong style={{ color: "var(--text-primary)" }}>{plainTicker(k)}</strong> {pct(w)}</span>)}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </VizCard>
  );
}

// ---------------------------------------------------------------------------
// The names most managers share: the combined book, Dataroma's "grand portfolio" read.
// ---------------------------------------------------------------------------
function WidelyHeld({ ctx, held }) {
  const { q, nameCell, storyCell, firm, open } = ctx;
  const [rank, setRank] = useState("n");
  if (!held) return null;
  if (!held.available) return <section className="ocard" style={{ marginBottom: 12 }}><h3 className="ocard-title">Most widely held</h3><p className="ocard-finding">{held.reason}</p></section>;
  const sorters = { n: (a, b) => b.n - a.n || b.value - a.value, value: (a, b) => b.value - a.value, net: (a, b) => (b.buyers - b.sellers) - (a.buyers - a.sellers) || b.n - a.n, w: (a, b) => (b.avgW || 0) - (a.avgW || 0) };
  const rows = [...(held.rows || [])].sort(sorters[rank]).slice(0, 25);
  const max = Math.max(1, ...rows.map(r => Math.max(r.buyers, r.sellers)));
  return (
    <VizCard eyebrow={`${q} · ${held.participants || "the"} books combined`} title="Most widely held"
      finding="The names the most managers own, with the holders' combined position and how much of a typical holder's book each one is. A name many hold at a sliver each is a different fact from one a few hold in size: read holders against average weight."
      right={<Seg label="Rank" value={rank} onChange={setRank} options={[["n", "Holders"], ["w", "Avg weight"], ["value", "Combined value"], ["net", "Net buyers"]]} />}
      style={{ marginBottom: 12 }}>
      <Legend items={[["Bought or added", BUY], ["Trimmed or sold", SELL]]} />
      <div className="otable-wrap">
        <table className="otable">
          <thead><tr><th style={cell}>Name</th><th style={right}>Holders</th><th style={right}>Avg weight</th><th style={cell}>Largest holder</th><th style={cell}>Sold · bought</th><th style={right}>Combined</th><th style={right}>vs holders' cost</th><th style={right}>Research</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.k}>
              {nameCell(r.k, r.name, r.sic)}
              <td style={right}>{r.n}</td>
              <td style={right}>{pct(r.avgW, 1)}</td>
              <td style={cell}>{r.top?.[0] ? <button type="button" onClick={() => open(r.top[0][0])} style={{ ...tickerBtn, font: "12px var(--font-body)", color: "var(--text-primary)" }}>{firm(r.top[0][0])} <span style={{ color: "var(--text-muted)" }}>{pct(r.top[0][1])}</span></button> : "—"}</td>
              <td style={cell}><Diverge buyers={r.buyers} sellers={r.sellers} max={max} /><div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{r.new ? `${r.new} new · ` : ""}{r.add ? `${r.add} added · ` : ""}{r.trim ? `${r.trim} trimmed · ` : ""}{r.exit ? `${r.exit} sold out` : ""}</div></td>
              <td style={right}>{usdK(r.value)}</td>
              <td style={right} title={r.basis ? `Holders' combined estimated cost ${usd(r.basis.est)}; last price ${usd(r.last)}` : undefined}>{pctS(r.vsBasis)}</td>
              {storyCell(r.k)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </VizCard>
  );
}

// ---------------------------------------------------------------------------
// One manager's page: profile, book over time, where it sits, this quarter's moves, every position.
// ---------------------------------------------------------------------------
function ManagerPage({ ctx, slug, page, error }) {
  const { d, onTicker, themeLabel, story, open } = ctx;
  const [show, setShow] = useState("all");
  const back = <button type="button" className="ochip" onClick={() => open("")}>← All managers</button>;
  if (error) return <section className="ocard" style={{ marginBottom: 12 }}>{back}<p className="ocard-finding" style={{ marginTop: 8 }}>The manager's book could not be loaded: {error}</p></section>;
  if (!page) return <section className="ocard" style={{ marginBottom: 12 }}>{back}<p className="ocard-finding" style={{ marginTop: 8, color: "var(--text-muted)" }}>Loading {d.managers?.find(m => m.slug === slug)?.firm || slug}…</p></section>;
  if (!page.available) return <section className="ocard" style={{ marginBottom: 12 }}>{back}<p className="ocard-finding" style={{ marginTop: 8 }}>{page.reason}</p></section>;

  const m = page, det = page.detail || {}, styleDoc = d.styles?.[m.style];
  const hist = det.history || [], latest = hist.at(-1), prior = hist.at(-2);
  const chg = m.prevBook ? m.book / m.prevBook - 1 : null;
  const live = (det.positions || []).filter(p => p.act !== "exit"), exits = (det.positions || []).filter(p => p.act === "exit");
  const moves = { new: live.filter(p => p.act === "new"), add: live.filter(p => p.act === "add"), trim: live.filter(p => p.act === "trim"), exit: exits };
  const shown = show === "all" ? live : show === "moves" ? live.filter(p => p.act !== "hold") : live.filter(p => p.act === show);
  const mix = Object.entries(latest?.themes || {}).map(([id, w]) => ({ id, label: themeLabel[id] || id, w, prev: prior?.themes?.[id] })).sort((a, b) => b.w - a.w).slice(0, 10);
  const inThemes = mix.reduce((s, r) => s + r.w, 0);
  const since = b => (!b?.since ? "—" : b.carried ? `≤ ${quarter(b.since)}` : quarter(b.since));   // carried: already held at the tracker's first snapshot
  const filing = (det.filings || [])[0];
  const dataroma = m.dataroma ? `https://www.dataroma.com/m/holdings.php?m=${encodeURIComponent(m.dataroma)}` : null;

  return (
    <>
      <section className="ocard" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            {back}
            <h3 style={{ font: "600 20px var(--font-body)", margin: "8px 0 2px", color: "var(--text-primary)" }}>{m.manager ? <>{m.manager} <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>· {m.firm}</span></> : m.firm}</h3>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, maxWidth: 760 }}>
              <span className="otag">{styleDoc?.label || m.style}</span>{styleDoc?.reads ? ` ${styleDoc.reads}` : ""}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.6 }}>
              Files as {det.filer || m.filer} (CIK {det.cik || (m.ciks || [])[0]}). {quarter(m.period)} holdings{m.filed ? `, filed ${day(m.filed)}` : ""}{filing ? ` as a ${filing.form}${filing.amend ? ` (${filing.amend})` : ""}, ${filing.lines} lines` : ""}{m.confidential ? "; some positions filed confidentially" : ""}{m.amended ? "; amended" : ""}.
              {det.combined ? ` ${det.combined}` : ""}{(det.notice || []).length ? ` ${det.notice.join(" ")}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 12.5, flexWrap: "wrap" }}>
            <a href={`${d.researchUrl}#gurus/manager/${m.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)" }}>Research Database ↗</a>
            {dataroma && <a href={dataroma} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)" }}>Dataroma ↗</a>}
            <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${det.cik || (m.ciks || [])[0]}&type=13F&dateb=&owner=include&count=40`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)" }}>EDGAR ↗</a>
          </div>
        </div>
        <div className="okpis" style={{ marginTop: 12 }}>
          <Kpi label="Reported book" value={usdK(m.book)} sub={finite(chg) ? `${pctS(chg, 1)} q/q, prices included` : "first quarter on file"} tone={finite(chg) ? (chg >= 0 ? BUY : SELL) : undefined} />
          <Kpi label="Holdings" value={m.positions ?? live.length} sub={`${pct(m.top10)} in the top 10`} />
          <Kpi label="Effective positions" value={finite(m.effective) ? m.effective.toFixed(1) : "—"} sub="1 ÷ Σ weight², how many names really matter" />
          <Kpi label="Turnover" value={pct(m.turnover, 1)} sub="of the book traded this quarter" />
          <Kpi label="This quarter" value={`${moves.new.length} · ${moves.add.length} · ${moves.trim.length} · ${moves.exit.length}`} sub="new · added · trimmed · sold out" />
          {(det.options || []).length > 0 && <Kpi label="Option lines" value={det.options.length} sub={`${det.options.filter(o => o.kind === "call").length} calls, ${det.options.filter(o => o.kind === "put").length} puts`} />}
        </div>
      </section>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={`${hist.length} quarters`} title="Reported book"
          finding="The long book at each quarter's prices. A step the market did not make is money arriving or leaving, not a view.">
          <BookHistory history={hist} />
        </VizCard>
        <VizCard eyebrow={quarter(latest?.p)} title="Where the book sits"
          finding={mix.length ? `${pct(inThemes)} of the book is in the tracker's named themes; the tick marks the prior quarter's share.` : "None of this book is in a theme the tracker names."}>
          {mix.length > 0 && <ShareBars rows={mix} />}
        </VizCard>
      </div>

      <VizCard eyebrow={quarter(m.period)} title="This quarter's moves"
        finding={m.bookEvent ? `The whole book moved together this quarter (${m.bookEvent.kind === "emptied" ? "emptied" : `every position ×${m.bookEvent.factor.toFixed(2)}`}): money arriving or leaving, so the counts below say little about conviction.` : "What changed against the prior filing: positions opened and closed, and the share count change on the rest. Weight is of the current book."}
        style={{ marginBottom: 12 }}>
        <div className="ogrid ogrid-2" style={{ gap: 10 }}>
          {[["new", "New positions"], ["add", "Added to"], ["trim", "Trimmed"], ["exit", "Sold out"]].map(([a, title]) => (
            <div key={a} style={{ border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "6px 9px", borderLeft: `3px solid ${ACT[a][1]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}><span>{title}</span><span>{moves[a].length}</span></div>
              {moves[a].length === 0 ? <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>none</div>
                : <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {moves[a].slice(0, 14).map(p => (
                    <button key={p.k} type="button" className="ochip" onClick={() => !p.k.startsWith("CUSIP:") && onTicker?.(p.k)} title={`${p.name || plainTicker(p.k)}: ${a === "exit" ? `was ${pct(p.prevW, 1)} of the book` : `${pct(p.w, 1)} of the book${finite(p.chg) && a !== "new" ? `, shares ${pctS(p.chg)}` : ""}`}`}>
                      {plainTicker(p.k)} <span style={{ color: "var(--text-muted)" }}>{a === "exit" ? pct(p.prevW, 1) : a === "new" ? pct(p.w, 1) : pctS(p.chg)}</span>
                    </button>
                  ))}
                  {moves[a].length > 14 && <span className="otag">+{moves[a].length - 14}</span>}
                </div>}
            </div>
          ))}
        </div>
      </VizCard>

      <VizCard eyebrow={`${live.length} positions`} title="The book"
        finding="Every reported long position. Cost is the tracker's estimate (each quarter's purchases at that quarter's volume-weighted average price) and the return runs from it to the last price; a position carried from before the tracker's window shows its cost since then only."
        right={<Seg label="Show" value={show} onChange={setShow} options={[["all", "All"], ["moves", "Moved"], ["new", "New"], ["add", "Added"], ["trim", "Trimmed"]]} />}
        style={{ marginBottom: 12 }}>
        <div className="otable-wrap" style={{ maxHeight: 620, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={right}>#</th><th style={cell}>Name</th><th style={right}>Weight</th><th style={right}>Value</th><th style={right}>Shares</th><th style={right}>Δ shares</th><th style={cell}>Action</th><th style={right}>Est. cost</th><th style={right}>Return since</th><th style={cell}>Held since</th><th style={right}>Holders</th><th style={right}>Research</th></tr></thead>
            <tbody>{shown.map((p, i) => (
              <tr key={p.k}>
                <td style={{ ...right, color: "var(--text-muted)" }}>{i + 1}</td>
                <td style={{ ...cell, whiteSpace: "normal", minWidth: 170 }}>
                  {p.k.startsWith("CUSIP:") ? <strong>{plainTicker(p.k)}</strong> : <button type="button" onClick={() => onTicker?.(p.k)} title={`Open ${p.k} on the Stocks page`} style={tickerBtn}>{p.k}</button>}
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>{short(p.name, 34)}{p.sic ? <span style={{ color: "var(--text-muted)" }}> · {short(p.sic, 30)}</span> : null}</div>
                </td>
                <td style={right}><div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}><i aria-hidden="true" style={{ display: "inline-block", height: 7, borderRadius: 2, width: Math.max(2, Math.round((p.w / Math.max(1e-9, live[0]?.w || 1)) * 56)), background: BUY, opacity: 0.6 }} />{pct(p.w, 1)}</div></td>
                <td style={right}>{usdK(p.v)}</td>
                <td style={right}>{num(p.sh)}</td>
                <td style={{ ...right, color: p.act === "new" ? BUY : finite(p.chg) && p.chg < 0 ? SELL : finite(p.chg) && p.chg > 0 ? BUY : "var(--text-muted)" }}>{p.act === "new" ? "new" : finite(p.chg) && p.chg !== 0 ? pctS(p.chg) : "—"}</td>
                <td style={cell}><ActTag act={p.act} /></td>
                <td style={right} title={p.b?.est ? `Estimated ${usd(p.b.est)} (range ${usd(p.b.lo)}–${usd(p.b.hi)}), ${pct(p.b.cov)} of today's shares priced` : "No priced purchases in the window"}>{p.b?.est ? usd(p.b.est) : "—"}</td>
                <td style={{ ...right, color: finite(p.pnl) ? (p.pnl >= 0 ? BUY : SELL) : "var(--text-muted)" }} title={finite(p.last) ? `Last ${usd(p.last)} (${p.lastDate || ""})` : undefined}>{pctS(p.pnl)}</td>
                <td style={cell}>{since(p.b)}</td>
                <td style={right}>{p.holders ?? "—"}</td>
                <td style={right}>{!p.k.startsWith("CUSIP:") && <a href={story(p.k)} target="_blank" rel="noopener noreferrer" style={linkStyle}>Story ↗</a>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </VizCard>

      {(det.options || []).length > 0 && (
        <VizCard eyebrow={quarter(m.period)} title="Option lines"
          finding="Calls and puts reported, as the notional value of the shares underneath. A 13F never shows strike, expiry or premium, and options a manager wrote are not reported at all: read direction, never size."
          style={{ marginBottom: 12 }}>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={cell}>Name</th><th style={cell}>Kind</th><th style={right}>Notional</th><th style={right}>Of book</th><th style={cell}>Change</th><th style={cell}>Reading</th></tr></thead>
              <tbody>{det.options.map((o, i) => (
                <tr key={`${o.k}-${o.kind}-${i}`}>
                  <td style={{ ...cell, whiteSpace: "normal" }}>{o.k.startsWith("CUSIP:") ? <strong>{plainTicker(o.k)}</strong> : <button type="button" onClick={() => onTicker?.(o.k)} style={tickerBtn}>{o.k}</button>}<div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>{short(o.name, 34)}</div></td>
                  <td style={cell}><span className="otag" style={{ borderColor: o.kind === "put" ? SELL : BUY }}>{o.kind}</span></td>
                  <td style={right}>{usdK(o.v)}</td>
                  <td style={right}>{pct(o.ofBook, 1)}</td>
                  <td style={cell}><ActTag act={o.act} />{finite(o.chg) && o.chg !== 0 ? <span style={{ marginLeft: 6, color: "var(--text-muted)" }}>{pctS(o.chg)}</span> : null}</td>
                  <td style={{ ...cell, whiteSpace: "normal", fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>{o.reading}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </VizCard>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The cross-manager read: what they agree on.
// ---------------------------------------------------------------------------
function Consensus({ ctx }) {
  const { d, q, onTicker, themeLabel, firm, nameCell, storyCell } = ctx;
  const [rank, setRank] = useState("build"), [heat, setHeat] = useState("pts");
  const storyLabel = { spinoff: "Spin-off", activist: "Activist", turnaround: "Turnaround", contrarian: "Contrarian", theme: "Secular theme", compounder: "Compounder", cannibal: "Buybacks", merger: "M&A", "new-listing": "New listing", distressed: "Balance-sheet repair", crowded: "Crowded", bearish: "Hedged / bet against", "red-flags": "Red flags" };
  const sorters = {
    build: (a, b) => (b[1].buyers - b[1].sellers) - (a[1].buyers - a[1].sellers) || (b[1].pts || 0) - (a[1].pts || 0),
    pts: (a, b) => (b[1].pts || 0) - (a[1].pts || 0),
    flow: (a, b) => (b[1].flow || 0) - (a[1].flow || 0),
  };
  const builds = [...(d.builds || [])].sort(sorters[rank]).slice(0, 20);
  const bmax = Math.max(1, ...builds.map(([, t]) => Math.max(t.buyers, t.sellers)));
  const exits = (d.exits || []).slice(0, 10), emax = Math.max(1, ...exits.map(([, t]) => Math.max(t.buyers, t.sellers)));
  const yours = Object.entries(d.book || {}).filter(([, t]) => t.buyers || t.sellers).sort((a, b) => (b[1].buyers + b[1].sellers) - (a[1].buyers + a[1].sellers));
  const col = heat === "pts" ? 4 : null;
  const heatVal = s => (col ? s[col] : s[5] - s[6]);
  const themes = [...(d.themes || [])].sort((a, b) => Math.abs(heatVal(b.series.at(-1)) || 0) - Math.abs(heatVal(a.series.at(-1)) || 0)).slice(0, 16);
  const hmax = Math.max(1e-9, ...themes.flatMap(t => t.series.map(s => Math.abs(heatVal(s) || 0))));
  const periods = themes[0]?.series.map(s => s[0]) || [];
  const fmtHeat = v => (col ? pts(v) : finite(v) ? signed(v, 0) : "—");
  const options = (d.options || []).slice(0, 12), omax = Math.max(1, ...options.flatMap(([, o]) => [o.callV, o.putV]));
  const dr = (d.quality?.dataroma?.checks || []).filter(c => c.theirs);
  const agree = dr.filter(c => c.matched >= 0.9 * c.theirs).length;
  const events = d.quality?.bookEvents || [];

  return (
    <>
      <VizCard eyebrow={`${q} · consensus`} title="Consensus builds"
        finding="The names the most managers bought or added to, against those who trimmed or sold. Points added sum how much of each buyer's book the new shares represent, so a concentrated fund counts for more than a sliver of a large one."
        right={<Seg label="Rank consensus builds" value={rank} onChange={setRank} options={[["build", "Net buyers"], ["pts", "Points added"], ["flow", "Dollars"]]} />}
        style={{ marginBottom: 12 }}>
        <Legend items={[["Bought or added", BUY], ["Trimmed or sold", SELL]]} />
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={cell}>Name</th><th style={cell}>Sold · bought</th><th style={right}>Points added</th><th style={right}>Holders</th><th style={right}>vs holders' cost</th><th style={cell}>Themes</th><th style={cell}>Story leads</th><th style={right}>Research</th></tr></thead>
            <tbody>{builds.map(([k, t]) => (
              <tr key={k}>
                {nameCell(k, t.name)}
                <td style={cell}><Diverge buyers={t.buyers} sellers={t.sellers} max={bmax} /><div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{t.new ? `${t.new} new · ` : ""}{t.add ? `${t.add} added · ` : ""}{t.sellers ? `${t.sellers} sold` : "no sellers"}</div></td>
                <td style={right}>{pts(t.pts)}</td>
                <td style={right}>{t.n}</td>
                <td style={right} title={t.basis ? `Holders' combined estimated cost ${usd(t.basis.est)} (range ${usd(t.basis.lo)}–${usd(t.basis.hi)}); last price ${usd(t.last)}` : undefined}>{pctS(t.vsBasis)}{t.basis && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>cost {usd(t.basis.est)}</div>}</td>
                <td style={cell}><Tags ids={t.themes} labels={themeLabel} /></td>
                <td style={cell}><Tags ids={t.story} labels={storyLabel} n={3} /></td>
                {storyCell(k)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </VizCard>

      <VizCard eyebrow="Nine quarters · by theme" title="Where the money is moving"
        finding={heat === "pts" ? "Each cell is one theme in one quarter: shares bought or sold at that quarter's prices, as points of each manager's book, summed. Weight that grew only because prices rose is not counted." : "Each cell is the number of managers buying a theme less the number selling it."}
        right={<Seg label="Measure" value={heat} onChange={setHeat} options={[["pts", "Points added"], ["net", "Net buyers"]]} />}
        style={{ marginBottom: 12 }}>
        <Legend items={[["Bought", BUY], ["Sold", SELL]]} />
        <div className="otable-wrap">
          <table className="otable">
            <tbody>
              <tr><th style={cell}>Theme</th>{periods.map(p => <th key={p} style={right}>{qShort(p)}</th>)}</tr>
              {themes.map(t => (
                <tr key={t.id}>
                  <td style={{ ...cell, whiteSpace: "normal", minWidth: 170, fontFamily: "var(--font-body)" }}>{t.label}</td>
                  {t.series.map(s => {
                    const v = heatVal(s);
                    return <td key={s[0]} title={`${t.label} · ${quarter(s[0])}: ${s[5]} bought or added, ${s[6]} trimmed or sold, average weight ${pct(s[2], 1)}`} style={{ ...right, background: heatBg(v, hmax) }}>{fmtHeat(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VizCard>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={q} title="Biggest exits and trims">
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={cell}>Name</th><th style={cell}>Sold · bought</th><th style={right}>Holders left</th><th style={right}>Research</th></tr></thead>
              <tbody>{exits.map(([k, t]) => (
                <tr key={k}>{nameCell(k, t.name)}<td style={cell}><Diverge buyers={t.buyers} sellers={t.sellers} max={emax} /><div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{t.exit ? `${t.exit} sold out` : ""}{t.exit && t.trim ? " · " : ""}{t.trim ? `${t.trim} trimmed` : ""}</div></td><td style={right}>{t.n}</td>{storyCell(k)}</tr>
              ))}</tbody>
            </table>
          </div>
        </VizCard>
        <VizCard eyebrow="Notes and watchlist" title="Guru moves in your names"
          finding={yours.length ? "Names you research that managers bought or sold this quarter." : "No manager moved in a name you research this quarter."}>
          {yours.length > 0 && <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={cell}>Name</th><th style={cell}>Sold · bought</th><th style={right}>Holders</th><th style={right}>vs holders' cost</th><th style={right}>Research</th></tr></thead>
              <tbody>{yours.map(([k, t]) => (
                <tr key={k}>{nameCell(k, t.name)}<td style={cell}><Diverge buyers={t.buyers} sellers={t.sellers} max={Math.max(1, ...yours.map(([, x]) => Math.max(x.buyers, x.sellers)))} /></td><td style={right}>{t.n}</td><td style={right}>{pctS(t.vsBasis)}</td>{storyCell(k)}</tr>
              ))}</tbody>
            </table>
          </div>}
        </VizCard>
      </div>

      <div className="ogrid ogrid-2">
        <VizCard eyebrow={q} title="Bought together"
          finding="Names the same managers bought in the same quarter. A group with no shared theme on file is the interesting kind: the managers may be acting on a story the theme list does not name yet.">
          <div style={{ display: "grid", gap: 8 }}>
            {(d.clusters || []).slice(0, 8).map((c, i) => (
              <div key={i} style={{ border: "1px solid var(--border-subtle)", borderLeft: `3px solid ${c.explained ? "var(--border-subtle)" : BUY}`, borderRadius: 6, padding: "6px 9px", fontSize: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{c.members.map(k => <button key={k} type="button" onClick={() => onTicker?.(k)} className="ochip">{k}</button>)}</div>
                <div style={{ color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.45 }}>{c.managers.length} managers bought at least two: {c.managers.map(s => <button key={s} type="button" onClick={() => ctx.open(s)} style={{ ...tickerBtn, font: "inherit", color: "var(--text-primary)" }}>{firm(s)}</button>).reduce((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}. {c.themes?.length ? `Shared theme: ${c.themes.map(id => themeLabel[id] || id).join(", ")}.` : <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>No shared theme on file.</strong>}</div>
              </div>
            ))}
          </div>
        </VizCard>
        <VizCard eyebrow={q} title="Options at a glance"
          finding="Calls and puts the managers reported, as the notional value of the shares underneath. A 13F never shows strike, expiry or premium, and options a manager wrote are not reported at all: read direction, never size."
          table={<table className="otable"><thead><tr><th style={cell}>Name</th><th style={right}>Managers with calls</th><th style={right}>Call notional</th><th style={right}>Managers with puts</th><th style={right}>Put notional</th></tr></thead><tbody>{options.map(([k, o]) => <tr key={k}><td style={cell}>{plainTicker(k)}</td><td style={right}>{o.calls}</td><td style={right}>{usdK(o.callV)}</td><td style={right}>{o.puts}</td><td style={right}>{usdK(o.putV)}</td></tr>)}</tbody></table>}>
          <Legend items={[["Puts", SELL], ["Calls", BUY]]} />
          <div style={{ display: "grid", gap: 4 }}>
            {options.map(([k, o]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr 1fr 84px", alignItems: "center", gap: 6, fontSize: 11.5 }} title={`${plainTicker(k)}: ${o.calls} with calls (${usdK(o.callV)}), ${o.puts} with puts (${usdK(o.putV)})`}>
                <strong style={{ fontFamily: "var(--font-number)" }}>{plainTicker(k)}</strong>
                <span style={{ display: "flex", justifyContent: "flex-end" }}>{o.putV > 0 && <i style={{ display: "block", height: 9, borderRadius: 2, width: `${Math.max(2, (o.putV / omax) * 100)}%`, background: SELL }} />}</span>
                <span>{o.callV > 0 && <i style={{ display: "block", height: 9, borderRadius: 2, width: `${Math.max(2, (o.callV / omax) * 100)}%`, background: BUY }} />}</span>
                <span style={{ color: "var(--text-secondary)", textAlign: "right", fontFamily: "var(--font-number)" }}>{o.calls ? `${o.calls}C` : ""}{o.calls && o.puts ? " " : ""}{o.puts ? `${o.puts}P` : ""}</span>
              </div>
            ))}
          </div>
        </VizCard>
      </div>

      {(dr.length > 0 || events.length > 0) && <p className="onote">
        {dr.length > 0 && `The parse agrees with Dataroma line for line for ${agree} of ${dr.length} managers.`}
        {events.length > 0 && ` Left out of the consensus counts as whole-book moves: ${events.map(e => `${firm(e.m)} (${e.kind === "emptied" ? "book emptied" : `every position ×${e.factor.toFixed(2)}`})`).join(", ")}.`}
      </p>}
    </>
  );
}
