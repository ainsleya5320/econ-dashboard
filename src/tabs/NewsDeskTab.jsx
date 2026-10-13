import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fonts } from "../lib/styles.js";
import { label, note, chip, DenseHeader, Panel, Note, useIsPhone } from "../components/dense.jsx";

// ============================================================================
// NEWS DESK: the WSJ, NYT and Economist RSS feeds, FMP stock news and SEC
// filings, read against the watchlist (tickers.json) and the tracked categories
// (data/news/categories.json). Claude scores every item for relevance and reads
// the most relevant in depth; a paywalled article is read in full only when the
// user clips it from their own signed-in browser. Data: GET /api/news-desk
// (server/newsDesk/index.js). Refresh, clip and proposal POSTs spend the Claude
// budget or write files, so the server takes them from this computer only.
// ============================================================================

// Status and direction colours come from the theme tokens (src/theme.css), which have darker
// light-theme shades; dense.jsx's bright hexes are illegible as small text on a white card.
const T = { red: "var(--tension-red)", amber: "var(--tension-amber)", green: "var(--tension-green)", indigo: "var(--tension-indigo)", slate: "var(--tension-slate)", cyan: "var(--tension-cyan)", violet: "var(--tension-violet)", orange: "var(--tension-orange)" };
const tint = (c, p) => `color-mix(in srgb, ${c} ${p}%, transparent)`;

const DIRECTION = {
  positive: { label: "Positive", mark: "▲", color: T.green },
  negative: { label: "Negative", mark: "▼", color: T.red },
  mixed: { label: "Mixed", mark: "◆", color: T.amber },
  neutral: { label: "Neutral", mark: "●", color: T.slate },
};
const HORIZON = { days: "over days", months: "over months", years: "over years" };
const NOVELTY = {
  new: { label: "New", color: T.cyan, title: "Not reported before in the items the desk holds" },
  update: { label: "Update", color: T.indigo, title: "Moves a story the desk already holds" },
  rehash: { label: "Rehash", color: T.slate, title: "Repeats what earlier items said" },
};
const FILES = { "revenue-disclosures": "Revenue disclosures", "ai-debt": "AI debt", "pjm-capacity": "PJM capacity" };
const LOCAL_ONLY = "This works only in a browser on the computer running the dashboard: it spends the Claude budget or writes files, so the server takes it from localhost only.";
const CLIP_MAX = 40000; // the server keeps the first 40,000 characters of a clip

// ── small helpers ──
const fin = v => typeof v === "number" && isFinite(v);
const usd = v => (fin(v) ? `$${v.toFixed(2)}` : "—");
const ago = iso => {
  const t = Date.parse(iso || "");
  if (!isFinite(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
};
const clock = iso => {
  const t = new Date(iso || "");
  return isNaN(t) ? "" : t.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const arr = v => (Array.isArray(v) ? v : []);
const trimTo = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || "");
const same = (a, b) => String(a || "").toUpperCase() === String(b || "").toUpperCase();

// Whether an item is about a card's own holding or category (the server's rule, targetsOf in
// server/newsDesk/index.js): triage named it at a relevant score, or named it and a deep read
// confirms it; unscored, the source tagged the ticker; read in depth but never scored, its
// implications count. Otherwise it reaches the card only through a deep read's second-order
// implication, and is shown "via" its own subject.
function directFor(item, focus, relMin = 40) {
  if (!focus) return true;
  const tr = item.triage, imps = arr(item.analysis?.implications);
  if (tr) {
    const named = [...arr(tr.tickers), ...arr(tr.categories)].some(x => same(x, focus));
    return named && (tr.relevance >= relMin || imps.some(m => same(m.target, focus)));
  }
  return item.analysis ? true : arr(item.tickers).some(x => same(x, focus));
}
const viaOf = (item, focus, catLabel) => {
  const tr = item.triage || {};
  const t = [...arr(tr.tickers), ...arr(item.tickers)].find(x => !same(x, focus));
  if (t) return String(t).toUpperCase();
  const c = arr(tr.categories).find(x => !same(x, focus));
  return c ? catLabel[c] || c : null;
};
const scored = it => fin(it.triage?.relevance) || !!it.analysis;

// a fetch that tells "route missing" (Vite answers an unknown /api path with index.html) from a JSON error
async function call(url, opts) {
  const r = await fetch(url, opts);
  const json = (r.headers.get("content-type") || "").includes("json");
  const j = json ? await r.json().catch(() => null) : null;
  return { status: r.status, ok: r.ok && json, j, json };
}
const postJson = (url, body) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const failText = (res, what) => (res.status === 403 ? LOCAL_ONLY
  : !res.json ? `${what} failed: the server has no route for it yet (HTTP ${res.status}).`
  : res.j?.error || `${what} failed (HTTP ${res.status}).`);

// check ids → titles for the Tensions links. The payload may carry them (profile.tensions);
// otherwise they come from the two boards once, the first time an opened item cites one.
let tensionTitleCache = null;
function useTensionTitles(fromProfile, wanted) {
  const given = useMemo(() => {
    if (!arr(fromProfile).length) return null;
    const m = {};
    for (const c of fromProfile) if (c?.id) m[c.id] = { title: c.title || c.id, domain: c.domain };
    return m;
  }, [fromProfile]);
  const [fetched, setFetched] = useState(tensionTitleCache);
  useEffect(() => {
    if (given || !wanted || tensionTitleCache) return;
    let live = true;
    Promise.all(["ai", "economy"].map(d => fetch(`/api/tensions?domain=${d}`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
      .then(rs => {
        const m = {};
        rs.forEach(j => arr(j?.checks).forEach(c => { if (c?.id) m[c.id] = { title: c.title || c.id, domain: j.domain }; }));
        tensionTitleCache = m;
        if (live) setFetched(m);
      });
    return () => { live = false; };
  }, [given, wanted]);
  return given || fetched || {};
}

// what every item row needs from the page, without threading it through each level
const Desk = createContext({ tensions: {}, catLabel: {}, analysisOn: true, relMin: 40, wantTensions: () => {} });

// ── atoms ──
const btn = (color = T.indigo, extra = {}) => ({
  background: tint(color, 12), border: `1px solid ${tint(color, 45)}`, color, borderRadius: 6,
  padding: "4px 11px", fontSize: 10.5, fontFamily: fonts.mono, cursor: "pointer", whiteSpace: "nowrap", ...extra,
});
const Tag = ({ children, color = T.slate, title, style }) => (
  <span title={title} style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${tint(color, 45)}`, borderRadius: 4, padding: "0 4px", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", ...style }}>{children}</span>
);
const relColor = v => (!fin(v) ? T.slate : v >= 75 ? T.indigo : v >= 50 ? T.cyan : T.slate);
// title: what the number means when it is not the item's relevance to this card (a second-order item)
const Relevance = ({ v, title }) => {
  const c = title ? T.slate : relColor(v);
  return (
    <span title={title || (fin(v) ? `Relevance ${v} of 100` : "Not scored yet")} style={{ flexShrink: 0, minWidth: 26, textAlign: "center", fontSize: 10, fontWeight: 700, fontFamily: fonts.mono, color: c, background: tint(c, title ? 6 : 12), border: `1px ${title ? "dashed" : "solid"} ${tint(c, 40)}`, borderRadius: 5, padding: "1px 3px", marginTop: 1 }}>
      {fin(v) ? Math.round(v) : "–"}
    </span>
  );
};
const Sub = ({ children }) => <div style={{ ...label, fontSize: 8.5, margin: "10px 0 4px" }}>{children}</div>;
const inputStyle = { width: "100%", boxSizing: "border-box", background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-primary)" };

// the analysis behind one item: facts, what it means for each holding or category, linked checks, what to watch
function ItemDetail({ item, focus }) {
  const phone = useIsPhone();
  const { tensions, catLabel, analysisOn, wantTensions } = useContext(Desk);
  const a = item.analysis;
  const cites = arr(a?.tensions);
  useEffect(() => { if (cites.length) wantTensions(); }, [cites.length, wantTensions]);

  // implications for the card's own holding or category first, then by confidence
  const rank = { high: 0, medium: 1, low: 2 };
  const imps = arr(a?.implications).slice().sort((x, y) =>
    ((y.target || "").toUpperCase() === (focus || "").toUpperCase()) - ((x.target || "").toUpperCase() === (focus || "").toUpperCase())
    || (rank[x.confidence] ?? 3) - (rank[y.confidence] ?? 3));
  const pending = arr(a?.proposals).filter(p => p.status === "pending").length;
  const body = { fontSize: 11.5, color: "var(--text-secondary)", fontFamily: fonts.heading, lineHeight: 1.6 };

  return (
    <div style={{ margin: phone ? "8px 0 4px" : "8px 0 4px 34px", padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 8 }}>
      {item.dek && <div style={{ ...body, fontStyle: "italic", marginBottom: 6 }}>{item.dek}</div>}

      {!a && (
        <div style={{ ...note, color: item.error ? T.amber : "var(--text-muted)" }}>
          {item.error ? `The read failed: ${item.error}`
            : !analysisOn ? "Analysis is off, so this item has no score or read."
            : item.triageGaveUp ? "Claude could not score this item (it refused it, or failed on it twice), so it gets no read."
            : !fin(item.triage?.relevance) ? "Not scored yet: the next refresh scores it from its headline and summary."
            : `Not read in depth: only the most relevant items get a deep read. Its relevance score, ${Math.round(item.triage.relevance)} of 100, comes from the headline and summary.`}
        </div>
      )}

      {a && (<>
        <div style={{ ...note, marginBottom: 4 }}>
          {a.basis === "full-text" ? "Read in full" : "Read from the headline and summary only, so it reports no figures beyond them"}
          {a.at ? ` · ${clock(a.at)}` : ""}
          {a.novelty && NOVELTY[a.novelty] && <> · <Tag color={NOVELTY[a.novelty].color} title={NOVELTY[a.novelty].title}>{NOVELTY[a.novelty].label}</Tag></>}
        </div>
        {a.summary && <div style={{ ...body, color: "var(--text-primary)" }}>{a.summary}</div>}

        {arr(a.facts).length > 0 && (<>
          <Sub>Facts</Sub>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {a.facts.map((f, i) => (
              <li key={i} style={{ ...body, marginBottom: 2 }}>
                {f.figure && <span style={{ fontFamily: fonts.mono, fontWeight: 700, color: "var(--text-primary)", marginRight: 6 }}>{f.figure}</span>}
                {f.text}
              </li>
            ))}
          </ul>
        </>)}

        {imps.length > 0 && (<>
          <Sub>What it means</Sub>
          <div style={{ display: "grid", gap: 6 }}>
            {imps.map((m, i) => {
              const dir = DIRECTION[m.direction] || DIRECTION.neutral;
              const who = m.targetType === "category" ? catLabel[m.target] || m.target : (m.target || "").toUpperCase();
              return (
                <div key={i} style={{ borderLeft: `3px solid ${dir.color}`, paddingLeft: 8 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: fonts.mono, color: "var(--text-primary)" }}>{who}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: fonts.mono, color: dir.color }}>{dir.mark} {dir.label}</span>
                    <span style={note}>{[HORIZON[m.horizon], m.confidence && `${m.confidence} confidence`].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div style={body}>{m.text}</div>
                </div>
              );
            })}
          </div>
        </>)}

        {cites.length > 0 && (<>
          <Sub>Tensions checks it bears on</Sub>
          {cites.map((c, i) => {
            const t = tensions[c.checkId];
            return (
              <div key={i} style={{ ...body, marginBottom: 3 }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{t?.title || c.checkId}</span>
                {t?.domain && <span style={{ ...note, marginLeft: 6 }}>{t.domain === "ai" ? "AI Economy" : "U.S. Economy"} › Tensions</span>}
                {c.how && <div>{c.how}</div>}
              </div>
            );
          })}
        </>)}

        {arr(a.watch).length > 0 && (<>
          <Sub>What to watch</Sub>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {a.watch.map((w, i) => <li key={i} style={{ ...body, marginBottom: 2 }}>{w}</li>)}
          </ul>
        </>)}

        {pending > 0 && <div style={{ ...note, marginTop: 8, color: T.amber }}>{pending === 1 ? "It proposes one data update" : `It proposes ${pending} data updates`}: see Proposed data updates below.</div>}
        {item.error && <div style={{ ...note, marginTop: 6, color: T.amber }}>{item.error}</div>}
      </>)}

      <div style={{ ...note, marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: T.indigo }}>Open at {item.outlet || item.source} ↗</a>}
        {item.paywalled && <span>Subscriber page: clip it while you read it to get a full read.</span>}
        {item.kind === "filing" && item.form && <span>SEC form {item.form}{item.filingItems ? `, items ${item.filingItems}` : ""}</span>}
      </div>
    </div>
  );
}

// one story: the lead item, collapsed to a line or two; other outlets on the same story ride along
function ItemRow({ item, also = [], focus, focusLabel, startOpen = false, tags = [] }) {
  const [open, setOpen] = useState(startOpen);
  const { catLabel, relMin } = useContext(Desk);
  const tr = item.triage || {};
  const a = item.analysis;
  const direct = directFor(item, focus, relMin);
  const via = direct ? null : viaOf(item, focus, catLabel);
  const meta = [
    item.outlet || item.source,
    item.author ? `by ${item.author}` : item.section,
    item.kind === "filing" && item.form ? `Form ${item.form}` : null,
    ago(item.published),
  ].filter(Boolean).join(" · ");
  const secondOrder = `Another story${via ? ` (about ${via})` : ""} that bears on ${focusLabel || focus} only through a deep read's second-order implication`;
  return (
    <div className="nd-row" style={{ borderTop: "1px solid var(--border-subtle)", padding: "7px 2px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <Relevance v={tr.relevance} title={direct ? null : `${fin(tr.relevance) ? `Claude scored this item ${Math.round(tr.relevance)} for its own subject, not for ${focusLabel || focus}. ` : ""}${secondOrder}.`} />
        <div
          style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
          onClick={e => { if (!e.target.closest("a")) setOpen(o => !o); }}
        >
          <a className="nd-link" href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading, lineHeight: 1.4, textDecoration: "none", overflowWrap: "anywhere" }}>
            {item.title}
          </a>
          <div style={{ ...note, marginTop: 2, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            {tags.map(s => <Tag key={s} color={T.indigo}>{s}</Tag>)}
            <span title={clock(item.published)}>{meta}</span>
            {!direct && <Tag color={T.slate} title={`${secondOrder}.`}>{via ? `via ${via}` : "second-order"}</Tag>}
            {item.kind === "clip" && <Tag color={T.violet}>Clip</Tag>}
            {arr(item.xShares).length > 0 && (
              <a href={`https://x.com/i/web/status/${item.xShares[0].id}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}
                title={`Shared on X ${item.xShares.length === 1 ? "once" : `${item.xShares.length} times`}; opens the latest post`}>
                <Tag color={T.cyan}>{item.xShares.length === 1 ? "On X" : `On X ×${item.xShares.length}`}</Tag>
              </a>
            )}
            {a && <Tag color={a.basis === "full-text" ? T.green : T.cyan} title={a.basis === "full-text" ? "Read in full" : "Read from the headline and summary"}>{a.basis === "full-text" ? "Full read" : "Deep read"}</Tag>}
            {a?.novelty && NOVELTY[a.novelty] && a.novelty !== "new" && <Tag color={NOVELTY[a.novelty].color} title={NOVELTY[a.novelty].title}>{NOVELTY[a.novelty].label}</Tag>}
            {item.error && !a && <Tag color={T.amber} title={item.error}>Read failed</Tag>}
          </div>
          {tr.why && <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.heading, lineHeight: 1.45, marginTop: 2 }}>{tr.why}</div>}
          {also.length > 0 && (
            <div style={{ ...note, marginTop: 2 }}>
              Also:{" "}
              {also.map((x, i) => (
                <React.Fragment key={x.id}>
                  {i > 0 && ", "}
                  <a href={x.url} target="_blank" rel="noopener noreferrer" title={x.title} style={{ color: T.indigo }}>{x.outlet || x.source}</a>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide the analysis" : "Show the analysis"}
          title={open ? "Hide" : a ? "Show the analysis" : "Show the details"}
          style={{ flexShrink: 0, background: "transparent", border: "1px solid var(--border-subtle)", borderRadius: 5, color: a ? T.indigo : "var(--text-muted)", fontSize: 10, fontFamily: fonts.mono, padding: "1px 6px", cursor: "pointer", lineHeight: 1.5 }}
        >{open ? "▾" : "▸"}</button>
      </div>
      {open && <ItemDetail item={item} focus={focus} />}
    </div>
  );
}

// the same story from several outlets shares a triage cluster key: show it once, led by the best read
// of the card's own holding or category (a copy about it before a second-order one)
function clusterStories(items, focus, relMin) {
  const groups = new Map(), out = [];
  for (const it of items) {
    const k = it.triage?.cluster ? `c:${String(it.triage.cluster).toLowerCase()}` : `i:${it.id}`;
    let g = groups.get(k);
    if (!g) { g = { key: k, items: [] }; groups.set(k, g); out.push(g); }
    g.items.push(it);
  }
  for (const g of out) {
    g.items.sort((x, y) => (directFor(y, focus, relMin) - directFor(x, focus, relMin))
      || (!!y.analysis - !!x.analysis)
      || ((y.triage?.relevance ?? -1) - (x.triage?.relevance ?? -1))
      || String(y.published || "").localeCompare(String(x.published || "")));
    g.lead = g.items[0];
    g.also = g.items.slice(1);
  }
  return out;
}

// direction tally of the deep reads' implications for one holding or category; a low-confidence
// implication from another company's story (second-order) is left out
function tally(items, target, relMin) {
  const n = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const it of items) {
    const direct = directFor(it, target, relMin);
    for (const m of arr(it.analysis?.implications)) {
      if (same(m.target, target) && n[m.direction] != null && (direct || m.confidence !== "low")) n[m.direction]++;
    }
  }
  return n;
}

// what a card holds: news about it that Claude scored, only other stories' second-order effects, or nothing scored yet
const cardStatus = (items, key, relMin) => (items.some(it => directFor(it, key, relMin) && scored(it)) ? "scored"
  : items.some(scored) ? "indirect" : "unscored");
const CARD_TAG = {
  indirect: { text: "second-order only", title: "Only other companies' or topics' stories bear on this, through a deep read's implications" },
  unscored: { text: "not scored yet", title: "These items carry the source's own ticker tag; the next refresh scores them" },
};

// a holding's or a category's card: header, tally, its stories (the first few, then "show more")
function GroupCard({ title, sub, items, focus, status, show = 4 }) {
  const { relMin } = useContext(Desk);
  const [all, setAll] = useState(false);
  const stories = useMemo(() => clusterStories(items, focus, relMin), [items, focus, relMin]);
  const n = useMemo(() => tally(items, focus, relMin), [items, focus, relMin]);
  const shown = all ? stories : stories.slice(0, show);
  const tag = CARD_TAG[status];
  return (
    <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: "8px 10px 4px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: fonts.mono, color: "var(--text-primary)" }}>{title}</span>
        {sub && <span style={{ fontSize: 10.5, color: "var(--text-muted)", fontFamily: fonts.heading, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 80px", minWidth: 0 }}>{sub}</span>}
        {tag && <Tag color={T.slate} title={tag.title}>{tag.text}</Tag>}
        <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto", fontSize: 10, fontFamily: fonts.mono }}>
          {["positive", "negative", "mixed"].filter(k => n[k]).map(k => (
            <span key={k} title={`${n[k]} ${DIRECTION[k].label.toLowerCase()} ${n[k] === 1 ? "implication" : "implications"} in the deep reads (low-confidence second-order ones left out)`} style={{ color: DIRECTION[k].color, fontWeight: 700 }}>{DIRECTION[k].mark}{n[k]}</span>
          ))}
          <span style={{ color: "var(--text-muted)" }}>{stories.length} {stories.length === 1 ? "story" : "stories"}</span>
        </span>
      </div>
      {shown.map(g => <ItemRow key={g.key} item={g.lead} also={g.also} focus={focus} focusLabel={title} />)}
      {stories.length > show && (
        <button type="button" onClick={() => setAll(v => !v)} style={{ ...btn(T.slate), border: "none", background: "transparent", padding: "4px 0 6px" }}>
          {all ? "Show fewer" : `Show ${stories.length - show} more`}
        </button>
      )}
    </div>
  );
}

const grid = phone => ({ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "repeat(auto-fill, minmax(min(380px, 100%), 1fr))", gap: 10 });
// cards with scored news about them first (by their best score for themselves), then second-order only, then unscored
const STATUS_RANK = { scored: 0, indirect: 1, unscored: 2 };
const sortGroups = relMin => (a, b) => {
  const best = g => g.items.reduce((m, it) => (directFor(it, g.key, relMin) ? Math.max(m, it.triage?.relevance ?? 0) : m), 0);
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || best(b) - best(a) || b.items.length - a.items.length;
};

// ── the daily brief: one section per holding or category that moved, each with its sources ──
function BriefSection({ s, byId, catLabel, tickerName }) {
  const [openId, setOpenId] = useState(null);
  const srcs = arr(s.itemIds).map(id => byId.get(id)).filter(Boolean);
  const opened = srcs.find(x => x.id === openId);
  const target = s.target ? (catLabel[s.target] || (tickerName[String(s.target).toUpperCase()] ? String(s.target).toUpperCase() : s.target)) : null;
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{s.title}</span>
        {target && <Tag color={T.indigo}>{target}</Tag>}
      </div>
      {s.text && <div style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: fonts.heading, lineHeight: 1.6, marginTop: 3, maxWidth: 980 }}>{s.text}</div>}
      {srcs.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
          <span style={note}>Sources:</span>
          {srcs.map(x => (
            <button type="button" key={x.id} onClick={() => setOpenId(v => (v === x.id ? null : x.id))} aria-expanded={openId === x.id} title={x.title}
              style={{ ...btn(openId === x.id ? T.indigo : T.slate), padding: "1px 7px", fontSize: 9.5, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
              {x.outlet || x.source}: {trimTo(x.title, 46)}
            </button>
          ))}
        </div>
      )}
      {opened && (
        <div style={{ marginTop: 4 }}>
          <a href={opened.url} target="_blank" rel="noopener noreferrer" className="nd-link" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading, textDecoration: "none" }}>{opened.title}</a>
          <ItemDetail item={opened} focus={s.target} />
        </div>
      )}
    </div>
  );
}

// ── proposed data updates ──
const rowText = v => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
function ProposalRow({ p, item, onAct, busy }) {
  const phone = useIsPhone();
  const row = p.row && typeof p.row === "object" ? Object.entries(p.row) : [];
  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <Tag color={T.orange}>{FILES[p.file] || p.file}</Tag>
        {item && <a href={item.url} target="_blank" rel="noopener noreferrer" className="nd-link" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading, textDecoration: "none", flex: "1 1 240px", minWidth: 0 }}>{item.title}</a>}
        {item && <span style={note}>{item.outlet || item.source} · {ago(item.published)}</span>}
      </div>
      {row.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: phone ? "repeat(2, minmax(0,1fr))" : "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 12px", margin: "6px 0" }}>
          {row.map(([k, v]) => (
            <div key={k} style={{ minWidth: 0 }}>
              <div style={{ ...label, fontSize: 8 }}>{k}</div>
              <div style={{ fontSize: 11, fontFamily: fonts.mono, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{rowText(v)}</div>
            </div>
          ))}
        </div>
      )}
      {p.evidence && (p.quoted !== false
        ? <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.heading, lineHeight: 1.5, fontStyle: "italic" }}>“{p.evidence}”</div>
        : <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.heading, lineHeight: 1.5 }}><span style={note}>Claude's paraphrase, not a quotation: </span>{p.evidence}</div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" disabled={busy} onClick={() => onAct(p, "approve")} style={btn(T.green, { opacity: busy ? 0.5 : 1 })}>Approve</button>
        <button type="button" disabled={busy} onClick={() => onAct(p, "dismiss")} style={btn(T.slate, { opacity: busy ? 0.5 : 1 })}>Dismiss</button>
      </div>
    </div>
  );
}

// ── clip tools: the bookmarklet and a paste box ──
function ClipTools({ bookmarklet, left, canRead, minChars = 200, onDone }) {
  const phone = useIsPhone();
  const linkRef = useRef(null);
  const blank = { url: "", title: "", outlet: "", published: "", text: "" };
  const [f, setF] = useState(blank);
  const [state, setState] = useState({ busy: false, msg: null, bad: false, item: null });

  // React 18 warns on a javascript: href and later versions refuse one, so the link gets it directly.
  // Only a javascript: URL from our own server is used; clicking it on this page does nothing.
  useEffect(() => {
    const el = linkRef.current;
    if (!el) return;
    if (typeof bookmarklet === "string" && bookmarklet.startsWith("javascript:")) el.setAttribute("href", bookmarklet);
    else el.removeAttribute("href");
  }, [bookmarklet]);

  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const submit = async e => {
    e.preventDefault();
    const text = f.text.replace(/[ \t]+/g, " ").trim(), url = f.url.trim();
    if (text.length < minChars) { setState({ busy: false, msg: `Paste the article's text first: at least a paragraph (${minChars} characters).`, bad: true, item: null }); return; }
    if (url && !/^https?:\/\//i.test(url)) { setState({ busy: false, msg: "The URL should start with http:// or https://.", bad: true, item: null }); return; }
    let outlet = f.outlet.trim();
    if (!outlet && url) { try { outlet = new URL(url).hostname.replace(/^www\./, ""); } catch { /* left blank */ } }
    setState({ busy: true, msg: "Reading it in full: this takes up to a minute.", bad: false, item: null });
    try {
      // a bare date goes as noon local time, so it never shows as the day before
      const published = /^\d{4}-\d{2}-\d{2}$/.test(f.published) ? `${f.published}T12:00:00` : null;
      const res = await postJson("/api/news-desk/clip", { url: url || null, title: f.title.trim() || null, text: text.slice(0, CLIP_MAX), outlet: outlet || null, published });
      if (!res.ok) { setState({ busy: false, msg: failText(res, "The clip"), bad: true, item: null }); return; }
      const item = res.j?.item || (res.j?.id && res.j?.title ? res.j : null);
      setState({
        busy: false, bad: !item?.analysis, item,
        msg: res.j?.message || (item?.error ? `Saved, but the read failed: ${item.error}` : "Saved."),
      });
      setF(blank);
      onDone();
    } catch (err) {
      setState({ busy: false, msg: `The clip failed: ${err.message}`, bad: true, item: null });
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1.6fr)", gap: 16 }}>
      <div>
        <div style={{ ...label, fontSize: 8.5, marginBottom: 6 }}>From the page you are reading</div>
        {bookmarklet ? (
          <a ref={linkRef} draggable="true" onClick={e => e.preventDefault()} title="Drag me to your bookmarks bar"
            style={{ ...btn(T.violet), display: "inline-block", padding: "6px 14px", fontSize: 11.5, fontWeight: 600, textDecoration: "none", cursor: "grab" }}>
            Clip to News Desk
          </a>
        ) : <div style={note}>The server has not sent a bookmarklet yet.</div>}
        {bookmarklet && <>
          <div style={{ ...note, marginTop: 8, fontSize: 10.5 }}>Drag the button to your browser's bookmarks bar.</div>
          <div style={{ ...note, marginTop: 2, fontSize: 10.5 }}>On a WSJ, NYT or Economist article you are signed in to, click the bookmark: a window from this dashboard opens and sends the article only after you press its confirm button.</div>
        </>}
      </div>
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <div style={{ ...label, fontSize: 8.5 }}>Or paste it</div>
          <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "minmax(0,2fr) minmax(0,1fr)", gap: 6 }}>
            <input value={f.url} onChange={set("url")} placeholder="Article URL" aria-label="Article URL" style={inputStyle} />
            <input value={f.outlet} onChange={set("outlet")} placeholder="Outlet (e.g. WSJ)" aria-label="Outlet" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "minmax(0,2fr) minmax(0,1fr)", gap: 6 }}>
            <input value={f.title} onChange={set("title")} placeholder="Headline" aria-label="Headline" style={inputStyle} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }} title="Without it, a clip of an article the desk has not seen is dated today">
              <span style={{ ...note, whiteSpace: "nowrap" }}>Published</span>
              <input type="date" value={f.published} onChange={set("published")} aria-label="Date published (optional)" style={{ ...inputStyle, minWidth: 0 }} />
            </label>
          </div>
          <textarea value={f.text} onChange={set("text")} placeholder="The article's text" aria-label="Article text" rows={phone ? 5 : 6} style={{ ...inputStyle, resize: "vertical", fontFamily: fonts.heading, lineHeight: 1.5 }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={state.busy} style={btn(T.indigo, { opacity: state.busy ? 0.5 : 1, padding: "5px 14px" })}>{state.busy ? "Analysing…" : "Analyse"}</button>
            <span style={note}>
              {[
                f.text.length ? `${f.text.length.toLocaleString()} characters${f.text.length > CLIP_MAX ? `: the first ${CLIP_MAX.toLocaleString()} are read` : ""}.` : null,
                left != null ? `${usd(left)} of today's Claude budget left${canRead === false ? ", not enough for a full read today" : ""}.` : null,
              ].filter(Boolean).join(" ")}
            </span>
          </div>
        </form>
        {state.msg && <div style={{ ...note, fontSize: 10.5, color: state.bad ? T.amber : T.green }}>{state.msg}</div>}
        {state.item && <ItemRow item={state.item} startOpen />}
      </div>
    </div>
  );
}

// ── write-ups: Seeking Alpha analysis about the holdings, newest first, each tagged with the
// holdings it covers; the headline opens the article (clip it there for a full read) ──
function WriteupList({ items, held, show = 8 }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, show);
  const tagsOf = it => [...new Set([...arr(it.tickers), ...arr(it.triage?.tickers)].map(s => String(s).toUpperCase()))].filter(s => held.has(s));
  return (
    <>
      {shown.map(it => <ItemRow key={it.id} item={it} tags={tagsOf(it)} />)}
      {items.length > show && (
        <button type="button" onClick={() => setAll(v => !v)} style={{ ...btn(T.slate), border: "none", background: "transparent", padding: "4px 0 6px" }}>
          {all ? "Show fewer" : `Show ${items.length - show} more`}
        </button>
      )}
    </>
  );
}

// ── the reader's clips, newest first: every clip shows here, whether or not it bears on a holding ──
function ClipList({ clips, show = 5 }) {
  const [all, setAll] = useState(false);
  const shown = all ? clips : clips.slice(0, show);
  return (
    <>
      {shown.map(it => <ItemRow key={it.id} item={it} />)}
      {clips.length > show && (
        <button type="button" onClick={() => setAll(v => !v)} style={{ ...btn(T.slate), border: "none", background: "transparent", padding: "4px 0 6px" }}>
          {all ? "Show fewer" : `Show ${clips.length - show} more`}
        </button>
      )}
    </>
  );
}

// ── feed health: one pill per feed, failures spelled out ──
// the source is added only when the feed's own name lacks it ("The Economist Business" already has it)
const feedName = h => `${h.source && h.feed && !String(h.feed).includes(h.source) ? `${h.source} ` : ""}${h.feed || h.source || "feed"}`;
function FeedHealth({ health, notes }) {
  const rows = arr(health);
  const bad = rows.filter(h => !h.ok);
  return (
    <Panel title="Feeds" right={rows.length ? `${rows.length - bad.length} of ${rows.length} answering` : null}>
      {rows.length > 0 ? (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {rows.map((h, i) => {
            const c = h.ok ? T.green : T.red;
            return (
              <span key={`${h.source}-${h.feed}-${i}`} title={[h.latest && `newest item ${clock(h.latest)}`, h.error].filter(Boolean).join(" · ") || undefined}
                style={{ fontSize: 9.5, fontFamily: fonts.mono, color: "var(--text-secondary)", border: `1px solid ${tint(c, 40)}`, background: tint(c, 8), borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ color: c, marginRight: 4 }}>●</span>{feedName(h)}
                {h.ok ? ` · ${fin(h.count) ? h.count : 0}${h.latest ? ` · ${ago(h.latest)}` : ""}` : " · down"}
              </span>
            );
          })}
        </div>
      ) : <div style={note}>No feed has been read yet.</div>}
      {bad.map((h, i) => <Note key={i} style={{ color: T.amber }}>{feedName(h)}: {h.error || "no answer"}</Note>)}
      {arr(notes).map((n, i) => <Note key={`n${i}`}>{n}</Note>)}
      <Note>Paywalled pages are never fetched by the server; subscriber articles are read in full only when you clip them. SEC filings are public and read directly.</Note>
    </Panel>
  );
}

export default function NewsDeskTab() {
  const phone = useIsPhone();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [kicked, setKicked] = useState(false); // a refresh was asked for; keep polling until the server says done
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState(null);         // a failed refresh, shown under the header
  const [propMsg, setPropMsg] = useState(null); // a failed approve or dismiss, shown in its panel
  const [acting, setActing] = useState(null);
  const [wantT, setWantT] = useState(false);

  // view: the desk was opened or came back into sight. Only such a read counts as a view, which may
  // start a refresh and keeps the hourly one going; polls and reloads after an action send auto=0.
  const load = useCallback(async (view = false) => {
    try {
      const res = await call(view === true ? "/api/news-desk" : "/api/news-desk?auto=0", view === true ? { headers: { "X-News-Desk": "view" } } : undefined);
      if (!res.json) { setErr(`The News Desk route is not on this server yet (GET /api/news-desk answered HTTP ${res.status} without JSON).`); return null; }
      if (!res.ok || res.j?.error) { setErr(res.j?.error || `GET /api/news-desk failed (HTTP ${res.status}).`); return null; }
      setErr(null);
      setD(res.j);
      return res.j;
    } catch (e) {
      setErr(`Could not reach the server: ${e.message}`);
      return null;
    } finally {
      setTick(t => t + 1);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") load(true); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);

  // poll every 4s while a refresh runs; otherwise re-read every 10 minutes (reads are free, and not views)
  const running = !!d?.refreshing || kicked;
  useEffect(() => {
    const t = setTimeout(async () => {
      const j = await load();
      if (kicked && j && !j.refreshing) setKicked(false);
    }, running ? 4000 : 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, [tick, running, kicked, load]);

  // polling starts at the click, so progress shows whether the POST answers at once or when the run ends
  const refresh = async () => {
    setMsg(null);
    setKicked(true);
    try {
      const res = await postJson("/api/news-desk/refresh", {});
      if (!res.ok) { setKicked(false); setMsg(failText(res, "Refresh")); return; }
      if (res.j && "items" in res.j && "counts" in res.j) setD(res.j);
      else load();
    } catch (e) { setKicked(false); setMsg(`Refresh failed: ${e.message}`); }
  };

  const act = async (p, action) => {
    setActing(`${p.itemId}:${p.index}`);
    setPropMsg(null);
    try {
      const res = await postJson("/api/news-desk/proposal", { itemId: p.itemId, index: p.index, action });
      if (!res.ok) setPropMsg(failText(res, action === "approve" ? "Approving" : "Dismissing"));
      await load();
    } catch (e) { setPropMsg(`That failed: ${e.message}`); }
    setActing(null);
  };

  const items = arr(d?.items);
  const byId = useMemo(() => new Map(items.map(it => [it.id, it])), [items]);
  const catLabel = useMemo(() => Object.fromEntries(arr(d?.profile?.categories).map(c => [c.id, c.label || c.id])), [d]);
  const tickerName = useMemo(() => Object.fromEntries(arr(d?.profile?.tickers).map(t => [String(t.symbol).toUpperCase(), t.name || ""])), [d]);
  const tensions = useTensionTitles(d?.profile?.tensions, wantT);
  const wantTensions = useCallback(() => setWantT(true), []);
  const relMin = fin(d?.limits?.relevantMin) ? d.limits.relevantMin : 40;
  const ctx = useMemo(() => ({ tensions, catLabel, analysisOn: d?.analysisOn !== false, relMin, wantTensions }), [tensions, catLabel, d, relMin, wantTensions]);

  // cards: every tracked holding with items, then any symbol the server grouped that the profile lacks.
  // "with relevant news" counts only cards with a scored item about the holding itself.
  const holdings = useMemo(() => {
    const bt = d?.byTicker || {};
    const syms = [...arr(d?.profile?.tickers).map(t => String(t.symbol).toUpperCase())];
    for (const s of Object.keys(bt)) if (!syms.includes(s.toUpperCase())) syms.push(s.toUpperCase());
    const withNews = [], quiet = [];
    for (const s of syms) {
      const list = arr(bt[s] || bt[s.toLowerCase()]).map(id => byId.get(id)).filter(Boolean);
      if (list.length) withNews.push({ key: s, title: s, sub: tickerName[s], items: list, status: cardStatus(list, s, relMin) });
      else quiet.push(s);
    }
    const n = k => withNews.filter(g => g.status === k).length;
    return { withNews: withNews.sort(sortGroups(relMin)), quiet, total: syms.length, scored: n("scored"), indirect: n("indirect"), unscored: n("unscored") };
  }, [d, byId, tickerName, relMin]);
  const cats = useMemo(() => {
    const bc = d?.byCategory || {};
    const ids = arr(d?.profile?.categories).map(c => c.id);
    for (const k of Object.keys(bc)) if (!ids.includes(k)) ids.push(k);
    const withNews = [], quiet = [];
    for (const id of ids) {
      const list = arr(bc[id]).map(x => byId.get(x)).filter(Boolean);
      if (list.length) withNews.push({ key: id, title: catLabel[id] || id, items: list, status: cardStatus(list, id, relMin) });
      else quiet.push(catLabel[id] || id);
    }
    return { withNews: withNews.sort(sortGroups(relMin)), quiet, scored: withNews.filter(g => g.status === "scored").length };
  }, [d, byId, catLabel, relMin]);
  // write-ups, in the server's order (newest first), and the holdings their tags are checked against
  const writeups = useMemo(() => arr(d?.writeups).map(id => byId.get(id)).filter(Boolean), [d, byId]);
  const held = useMemo(() => new Set(arr(d?.profile?.tickers).map(t => String(t.symbol).toUpperCase())), [d]);
  // the reader's clips, newest clipped first
  const clips = useMemo(() => items.filter(it => it.kind === "clip" || it.source === "clip")
    .sort((a, b) => String(b.clipped || b.fetched || "").localeCompare(String(a.clipped || a.fetched || ""))), [items]);

  if (!d) {
    return (
      <div style={{ background: "var(--card-bg)", border: "var(--card-border)", borderRadius: 14, padding: "12px 14px", fontSize: 11, fontFamily: fonts.mono, color: err ? T.amber : "var(--text-muted)" }}>
        {err || "Loading the News Desk…"}
        {err && <div style={{ marginTop: 8 }}><button type="button" onClick={() => load(true)} style={btn(T.slate)}>Try again</button></div>}
      </div>
    );
  }

  const c = d.counts || {};
  const b = d.budget || {};
  const analysisOn = d.analysisOn !== false;
  // The server stops any call that would not fit under the cap, so "spent" never quite reaches it:
  // the budget is out once a deep read no longer fits (canDeepRead), or spending is paused.
  const spentOut = analysisOn && (!!b.paused || b.canDeepRead === false || (fin(b.spent) && fin(b.cap) && b.spent >= b.cap));
  const left = fin(b.remaining) ? b.remaining : fin(b.spent) && fin(b.cap) ? Math.max(0, b.cap - b.spent) : null;
  const budgetColor = !fin(b.spent) || !fin(b.cap) ? "var(--text-primary)" : spentOut ? T.red : b.spent >= 0.8 * b.cap ? T.amber : T.green;
  const proposals = arr(d.proposals);
  const pending = proposals.filter(p => p.status === "pending");
  const approved = proposals.filter(p => p.status === "approved").length, dismissed = proposals.filter(p => p.status === "dismissed").length;

  const status = running ? "Refreshing: reading the feeds and scoring new items"
    : !analysisOn ? `Analysis is off: ${c.items ?? items.length} items read from the feeds, none scored or read by Claude`
    : items.length ? `${c.relevant ?? items.length} relevant ${(c.relevant ?? items.length) === 1 ? "item" : "items"} for your holdings and categories, ${c.analysed ?? 0} read in depth; no brief yet today`
    : "Nothing relevant yet: press Refresh to read the feeds";

  return (
    <Desk.Provider value={ctx}>
      <style>{`
        .nd-link:hover { text-decoration: underline !important; }
        .nd-row:hover { background: color-mix(in srgb, var(--text-primary) 3%, transparent); }
      `}</style>

      <DenseHeader
        eyebrow={`News Desk${b.day ? ` · ${b.day}` : ""}`}
        headline={d.brief?.headline || status}
        blurb={<>Headlines and summaries from the WSJ, NYT and The Economist, FMP stock news and SEC filings, scored by Claude for what they mean to your holdings and categories; the most relevant get a deep read. Seeking Alpha write-ups on your holdings are listed with their links.
          Subscriber articles are read in full only when you clip one from your own browser.</>}
        meta={<button onClick={refresh} disabled={running} title="Read the feeds now and score what is new" style={btn(T.indigo, { opacity: running ? 0.55 : 1 })}>{running ? "Refreshing…" : "Refresh"}</button>}
        chips={[
          chip(fin(c.today) ? "Items today" : "Items read", fin(c.today) ? c.today : c.items ?? "—", undefined, "feeds and filings"),
          chip("Relevant", c.relevant ?? items.length, T.indigo, "to your holdings or categories"),
          chip("Deep reads", c.analysed ?? 0, undefined, analysisOn ? "by Claude" : "analysis off"),
          chip("Clips", c.clips ?? 0, undefined, "read in full"),
          chip("Claude budget", `${usd(b.spent)} of ${usd(b.cap)}`, budgetColor, fin(b.calls) ? `${b.calls} ${b.calls === 1 ? "call" : "calls"} today` : null),
          chip("Last refresh", d.built ? ago(d.built) : "never", undefined, d.built ? clock(d.built) : null),
        ]}
      />

      {(msg || !analysisOn || spentOut) && (
        <div style={{ display: "grid", gap: 4, marginBottom: 12 }}>
          {msg && <div style={{ ...note, fontSize: 10.5, color: T.amber }}>{msg}</div>}
          {!analysisOn && <div style={{ ...note, fontSize: 10.5, color: T.amber }}>Analysis is off: the server has no Claude API key, so the feeds show without relevance scores, deep reads or a brief.</div>}
          {analysisOn && spentOut && <div style={{ ...note, fontSize: 10.5, color: T.amber }}>
            {b.paused ? `${b.paused} Deep reads, clip reads, scoring and the brief wait until tomorrow.`
              : `Today's ${usd(b.cap)} Claude budget is used up for deep reads: ${usd(b.spent)} spent and ${usd(left)} left, less than the ${usd(b.deepEstimate)} a deep read is held at. Deep reads, clip reads and the brief wait until tomorrow; new headlines are still scored while the rest lasts.`}
          </div>}
        </div>
      )}

      {d.brief && arr(d.brief.sections).length > 0 && (
        <Panel title="Daily brief" right={d.brief.at ? `written ${clock(d.brief.at)}` : null}>
          {d.brief.sections.map((s, i) => <BriefSection key={i} s={s} byId={byId} catLabel={catLabel} tickerName={tickerName} />)}
        </Panel>
      )}

      {writeups.length > 0 && (
        <Panel title="Write-ups" right={`${writeups.length}, newest first`}>
          <WriteupList items={writeups} held={held} />
          <Note>Contributor analysis about your holdings (and any other Claude scored relevant), from Seeking Alpha and from write-ups shared on X: the author&apos;s view, not news. The headline opens the article; &quot;On X&quot; opens the post that shared it; clip an article while you read it for a full read.</Note>
        </Panel>
      )}

      <Panel title="By holding" right={holdings.total ? [
        `${holdings.scored} of ${holdings.total} with relevant news`,
        holdings.indirect ? `${holdings.indirect} second-order only` : null,
        holdings.unscored ? `${holdings.unscored} not scored yet` : null,
      ].filter(Boolean).join(", ") : null}>
        {holdings.withNews.length > 0
          ? <div style={grid(phone)}>{holdings.withNews.map(g => <GroupCard key={g.key} title={g.title} sub={g.sub} items={g.items} focus={g.key} status={g.status} />)}</div>
          : <div style={note}>No relevant news for any holding yet.</div>}
        {holdings.quiet.length > 0 && holdings.withNews.length > 0 && <Note>Nothing relevant for {holdings.quiet.join(", ")}.</Note>}
        <Note>The number on each item is Claude's relevance score (0 to 100) from the headline and summary; "–" means not scored yet. A row marked "via" is another company's story that bears on the holding only through a deep read's second-order implication, so its number is that story's own score. Click an item for its analysis; the headline opens the source.</Note>
      </Panel>

      <Panel title="By category" right={cats.withNews.length ? `${cats.scored} with relevant news` : null}>
        {cats.withNews.length > 0
          ? <div style={grid(phone)}>{cats.withNews.map(g => <GroupCard key={g.key} title={g.title} items={g.items} focus={g.key} status={g.status} />)}</div>
          : <div style={note}>No relevant news for any category yet.</div>}
        {cats.quiet.length > 0 && cats.withNews.length > 0 && <Note>Nothing relevant for {cats.quiet.join(", ")}.</Note>}
      </Panel>

      {proposals.length > 0 && (
        <Panel title="Proposed data updates" right={`${pending.length} waiting`}>
          <div style={{ ...note, fontSize: 10.5, marginBottom: 2 }}>A deep read found figures that belong in one of the dashboard's hand-kept tables. Approve adds the row to that table; Dismiss drops it.</div>
          {propMsg && <div style={{ ...note, fontSize: 10.5, color: T.amber, margin: "4px 0" }}>{propMsg}</div>}
          {pending.map(p => <ProposalRow key={`${p.itemId}:${p.index}`} p={p} item={byId.get(p.itemId)} onAct={act} busy={acting === `${p.itemId}:${p.index}`} />)}
          {(approved > 0 || dismissed > 0) && <Note>Earlier: {approved} approved, {dismissed} dismissed.</Note>}
        </Panel>
      )}

      {clips.length > 0 && (
        <Panel title="Your clips" right={`${clips.length} clipped`}>
          <ClipList clips={clips} />
          <Note>Every article you clip is listed here, newest first, whether or not it bears on a holding or category; one that does also shows on that card.</Note>
        </Panel>
      )}

      <Panel title="Clip an article">
        <ClipTools bookmarklet={d.bookmarklet} left={left} canRead={analysisOn ? b.canDeepRead !== false && !b.paused : null}
          minChars={fin(d.limits?.clipMinChars) ? d.limits.clipMinChars : 200} onDone={() => load()} />
      </Panel>

      <FeedHealth health={d.health} notes={d.notes} />
    </Desk.Provider>
  );
}
