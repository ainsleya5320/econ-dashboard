import React, { useEffect, useMemo, useState } from "react";
import { finite, signed, usdK, VizCard, Kpi, Seg, Legend } from "./options/ui.jsx";
import "./options/OptionsResearch.css";

// ============================================================================
// GURUS: what well-known managers hold, build and hedge, from their 13Fs.
// The tracker lives in the Research Database, which reads every 13F from EDGAR
// each Monday (96 managers: every Dataroma superinvestor plus fundamental hedge
// funds and activists) and writes the summary this tab draws. Shown: consensus
// builds against sells, where the money moved by theme over nine quarters, the
// biggest exits, guru moves in your own names, names bought together, option
// lines (direction, never size) and the managers. A ticker opens its stock page
// here; "Story ↗" opens the Research Database's story workbench for the name
// (holders' estimated cost, filings around the purchases, hypotheses).
// Data: /api/gurus (server/guruTracker.js). Buying is blue and selling orange,
// the --oc-1/--oc-2 slots of the validated palette, in both themes.
// ============================================================================

const BUY = "var(--oc-1)", SELL = "var(--oc-2)";
const quarter = p => (p ? `Q${Math.floor((+p.slice(5, 7) - 1) / 3) + 1} ${p.slice(0, 4)}` : "—");
const qShort = p => quarter(p).replace(" 20", " ’");
const pts = v => (finite(v) ? signed(v * 100, 1) : "—");
const pctS = (v, dp = 0) => (finite(v) ? signed(v * 100, dp, "%") : "—");
const pct = (v, dp = 0) => (finite(v) ? `${(v * 100).toFixed(dp)}%` : "—");
const usd = v => (finite(v) ? `$${v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}` : "—");
const day = d => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const plainTicker = k => (k.startsWith("CUSIP:") ? k.slice(6) : k);
// a pole mixed into the gray midpoint by |t| (0..1): the dashboard's diverging cell, with the tracker's two hues
const heatBg = (v, max) => (!finite(v) || !v ? "transparent"
  : `color-mix(in srgb, ${v > 0 ? BUY : SELL} ${Math.round(14 + Math.min(1, (Math.abs(v) / (max || 1)) ** 0.65) * 50)}%, var(--oc-mid))`);

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

function Tags({ ids, labels, n = 2 }) {
  const list = (ids || []).slice(0, n);
  if (!list.length) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{list.map(id => <span key={id} className="otag">{short(labels[id] || id, 26)}</span>)}{(ids || []).length > n && <span className="otag">+{ids.length - n}</span>}</span>;
}

export default function GurusTab({ onTicker }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [rank, setRank] = useState("build"), [heat, setHeat] = useState("pts"), [style, setStyle] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/gurus").then(r => r.json()).then(j => { if (alive) { if (j.error) setErr(j.error); else setD(j); } }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);

  const themeLabel = useMemo(() => Object.fromEntries((d?.themes || []).map(t => [t.id, t.label])), [d]);
  const storyLabel = { spinoff: "Spin-off", activist: "Activist", turnaround: "Turnaround", contrarian: "Contrarian", theme: "Secular theme", compounder: "Compounder", cannibal: "Buybacks", merger: "M&A", "new-listing": "New listing", distressed: "Balance-sheet repair", crowded: "Crowded", bearish: "Hedged / bet against", "red-flags": "Red flags" };
  const firm = slug => d?.managers?.find(m => m.slug === slug)?.firm?.replace(/(,? (Capital|Asset|Investment|Investments|Management|Partners|Group|Associates|Advisors|LP|LLC|Inc\.?))+$/i, "") || slug;
  const story = k => `${d.researchUrl}#gurus/story/${encodeURIComponent(k)}`;

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
  const sorters = {
    build: (a, b) => (b[1].buyers - b[1].sellers) - (a[1].buyers - a[1].sellers) || (b[1].pts || 0) - (a[1].pts || 0),
    pts: (a, b) => (b[1].pts || 0) - (a[1].pts || 0),
    flow: (a, b) => (b[1].flow || 0) - (a[1].flow || 0),
  };
  const builds = [...(d.builds || [])].sort(sorters[rank]).slice(0, 20);
  const bmax = Math.max(1, ...builds.map(([, t]) => Math.max(t.buyers, t.sellers)));
  const exits = (d.exits || []).slice(0, 10), emax = Math.max(1, ...exits.map(([, t]) => Math.max(t.buyers, t.sellers)));
  const yours = Object.entries(d.book || {}).filter(([, t]) => t.buyers || t.sellers).sort((a, b) => (b[1].buyers + b[1].sellers) - (a[1].buyers + a[1].sellers));
  const newCount = (d.managers || []).reduce((n, m) => n + (m.new || 0), 0);
  // themes × quarters: points added (bought vs sold) or net buyers
  const col = heat === "pts" ? 4 : null;
  const heatVal = (s) => (col ? s[col] : s[5] - s[6]);
  const themes = [...(d.themes || [])].sort((a, b) => Math.abs(heatVal(b.series.at(-1)) || 0) - Math.abs(heatVal(a.series.at(-1)) || 0)).slice(0, 16);
  const hmax = Math.max(1e-9, ...themes.flatMap(t => t.series.map(s => Math.abs(heatVal(s) || 0))));
  const periods = themes[0]?.series.map(s => s[0]) || [];
  const fmtHeat = v => (col ? pts(v) : finite(v) ? signed(v, 0) : "—");
  const options = (d.options || []).slice(0, 12), omax = Math.max(1, ...options.flatMap(([, o]) => [o.callV, o.putV]));
  const managers = (d.managers || []).filter(m => !style || m.style === style);
  const dr = (d.quality?.dataroma?.checks || []).filter(c => c.theirs);
  const agree = dr.filter(c => c.matched >= 0.9 * c.theirs).length;
  const events = d.quality?.bookEvents || [];

  const nameCell = (k, name) => (
    <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 150 }}>
      {k.startsWith("CUSIP:") ? <strong>{plainTicker(k)}</strong>
        : <button type="button" onClick={() => onTicker?.(k)} title={`Open ${k} on the Stocks page`} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "600 12.5px var(--font-number)", color: "var(--text-primary)" }}>{k}</button>}
      {name && <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>{short(name, 32)}</div>}
    </td>
  );
  const storyCell = k => <td style={{ textAlign: "right" }}>{!k.startsWith("CUSIP:") && <a href={story(k)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)", fontSize: 11.5 }}>Story ↗</a>}</td>;

  return (
    <div className="options-research" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ font: "600 22px var(--font-body)", letterSpacing: -0.4, margin: 0, color: "var(--text-primary)" }}>Gurus: what the managers are building</h2>
        <a href={`${d.researchUrl}#gurus`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--oc-1)", fontSize: 12.5 }}>Open the full tracker ↗</a>
      </div>
      <p className="ohead-line">
        {q} 13F filings from {d.counts.participants} of {d.counts.managers} managers, read from EDGAR by the Research Database (built {day(d.asOf)}).
        Filings are up to 45 days old when they arrive and show long positions only: no shorts, cash or anything bought and sold within the quarter.
      </p>
      <div className="okpis">
        <Kpi label={`Filed ${q}`} value={d.counts.participants} sub={`of ${d.counts.managers} managers`} />
        <Kpi label="Securities held" value={d.counts.securities.toLocaleString("en-US")} />
        <Kpi label="New positions" value={newCount.toLocaleString("en-US")} sub="opened this quarter" />
        <Kpi label="Option lines" value={d.counts.optionLines} sub="calls and puts" />
        <Kpi label="Your names with moves" value={yours.length} sub="notes and watchlist" />
      </div>

      <VizCard eyebrow={`${q} · consensus`} title="Consensus builds"
        finding="The names the most managers bought or added to, against those who trimmed or sold. Points added sum how much of each buyer's book the new shares represent, so a concentrated fund counts for more than a sliver of a large one."
        right={<Seg label="Rank consensus builds" value={rank} onChange={setRank} options={[["build", "Net buyers"], ["pts", "Points added"], ["flow", "Dollars"]]} />}
        style={{ marginBottom: 12 }}>
        <Legend items={[["Bought or added", BUY], ["Trimmed or sold", SELL]]} />
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "left" }}>Sold · bought</th><th style={{ textAlign: "right" }}>Points added</th><th style={{ textAlign: "right" }}>Holders</th><th style={{ textAlign: "right" }}>vs holders' cost</th><th style={{ textAlign: "left" }}>Themes</th><th style={{ textAlign: "left" }}>Story leads</th><th style={{ textAlign: "right" }}>Research</th></tr></thead>
            <tbody>{builds.map(([k, t]) => (
              <tr key={k}>
                {nameCell(k, t.name)}
                <td style={{ textAlign: "left" }}><Diverge buyers={t.buyers} sellers={t.sellers} max={bmax} /><div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{t.new ? `${t.new} new · ` : ""}{t.add ? `${t.add} added · ` : ""}{t.sellers ? `${t.sellers} sold` : "no sellers"}</div></td>
                <td style={{ textAlign: "right" }}>{pts(t.pts)}</td>
                <td style={{ textAlign: "right" }}>{t.n}</td>
                <td style={{ textAlign: "right" }} title={t.basis ? `Holders' combined estimated cost ${usd(t.basis.est)} (range ${usd(t.basis.lo)}–${usd(t.basis.hi)}); last price ${usd(t.last)}` : undefined}>{pctS(t.vsBasis)}{t.basis && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>cost {usd(t.basis.est)}</div>}</td>
                <td style={{ textAlign: "left" }}><Tags ids={t.themes} labels={themeLabel} /></td>
                <td style={{ textAlign: "left" }}><Tags ids={t.story} labels={storyLabel} n={3} /></td>
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
              <tr><th style={{ textAlign: "left" }}>Theme</th>{periods.map(p => <th key={p} style={{ textAlign: "right" }}>{qShort(p)}</th>)}</tr>
              {themes.map(t => (
                <tr key={t.id}>
                  <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 170, fontFamily: "var(--font-body)" }}>{t.label}</td>
                  {t.series.map(s => {
                    const v = heatVal(s);
                    return <td key={s[0]} title={`${t.label} · ${quarter(s[0])}: ${s[5]} bought or added, ${s[6]} trimmed or sold, average weight ${pct(s[2], 1)}`} style={{ textAlign: "right", background: heatBg(v, hmax) }}>{fmtHeat(v)}</td>;
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
              <thead><tr><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "left" }}>Sold · bought</th><th style={{ textAlign: "right" }}>Holders left</th><th style={{ textAlign: "right" }}>Research</th></tr></thead>
              <tbody>{exits.map(([k, t]) => (
                <tr key={k}>{nameCell(k, t.name)}<td style={{ textAlign: "left" }}><Diverge buyers={t.buyers} sellers={t.sellers} max={emax} /><div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{t.exit ? `${t.exit} sold out` : ""}{t.exit && t.trim ? " · " : ""}{t.trim ? `${t.trim} trimmed` : ""}</div></td><td style={{ textAlign: "right" }}>{t.n}</td>{storyCell(k)}</tr>
              ))}</tbody>
            </table>
          </div>
        </VizCard>
        <VizCard eyebrow="Notes and watchlist" title="Guru moves in your names"
          finding={yours.length ? "Names you research that managers bought or sold this quarter." : "No manager moved in a name you research this quarter."}>
          {yours.length > 0 && <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "left" }}>Sold · bought</th><th style={{ textAlign: "right" }}>Holders</th><th style={{ textAlign: "right" }}>vs holders' cost</th><th style={{ textAlign: "right" }}>Research</th></tr></thead>
              <tbody>{yours.map(([k, t]) => (
                <tr key={k}>{nameCell(k, t.name)}<td style={{ textAlign: "left" }}><Diverge buyers={t.buyers} sellers={t.sellers} max={Math.max(1, ...yours.map(([, x]) => Math.max(x.buyers, x.sellers)))} /></td><td style={{ textAlign: "right" }}>{t.n}</td><td style={{ textAlign: "right" }}>{pctS(t.vsBasis)}</td>{storyCell(k)}</tr>
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
                <div style={{ color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.45 }}>{c.managers.length} managers bought at least two: {c.managers.map(firm).join(", ")}. {c.themes?.length ? `Shared theme: ${c.themes.map(id => themeLabel[id] || id).join(", ")}.` : <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>No shared theme on file.</strong>}</div>
              </div>
            ))}
          </div>
        </VizCard>
        <VizCard eyebrow={q} title="Options at a glance"
          finding="Calls and puts the managers reported, as the notional value of the shares underneath. A 13F never shows strike, expiry or premium, and options a manager wrote are not reported at all: read direction, never size."
          table={<table className="otable"><thead><tr><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "right" }}>Managers with calls</th><th style={{ textAlign: "right" }}>Call notional</th><th style={{ textAlign: "right" }}>Managers with puts</th><th style={{ textAlign: "right" }}>Put notional</th></tr></thead><tbody>{options.map(([k, o]) => <tr key={k}><td style={{ textAlign: "left" }}>{plainTicker(k)}</td><td style={{ textAlign: "right" }}>{o.calls}</td><td style={{ textAlign: "right" }}>{usdK(o.callV)}</td><td style={{ textAlign: "right" }}>{o.puts}</td><td style={{ textAlign: "right" }}>{usdK(o.putV)}</td></tr>)}</tbody></table>}>
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

      <VizCard eyebrow={`${d.counts.managers} managers`} title="The managers"
        right={<Seg label="Filter by style" value={style} onChange={setStyle} options={[["", "All"], ...Object.entries(d.styles || {}).map(([id, s]) => [id, s.label])]} />}
        finding={style ? d.styles?.[style]?.reads : "Every superinvestor Dataroma follows plus fundamental hedge funds and activists it does not, each read from its own filings."}
        style={{ marginBottom: 12 }}>
        <div className="otable-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="otable">
            <thead><tr><th style={{ textAlign: "left" }}>Manager</th><th style={{ textAlign: "left" }}>Style</th><th style={{ textAlign: "left" }}>Latest</th><th style={{ textAlign: "right" }}>Book</th><th style={{ textAlign: "right" }}>Positions</th><th style={{ textAlign: "right" }}>Top 10</th><th style={{ textAlign: "left" }}>This quarter</th><th style={{ textAlign: "left" }}>Largest</th></tr></thead>
            <tbody>{managers.map(m => (
              <tr key={m.slug} style={{ opacity: m.state === "stale" || m.state === "no filings" ? 0.6 : 1 }}>
                <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 160 }}><a href={`${d.researchUrl}#gurus/manager/${m.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", fontWeight: 600, fontFamily: "var(--font-body)" }}>{m.firm}</a>{m.manager && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{m.manager}</div>}</td>
                <td style={{ textAlign: "left" }}>{d.styles?.[m.style]?.label || m.style}</td>
                <td style={{ textAlign: "left" }}>{quarter(m.period)}</td>
                <td style={{ textAlign: "right" }}>{usdK(m.book)}</td>
                <td style={{ textAlign: "right" }}>{m.positions ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{pct(m.top10)}</td>
                <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 150 }}>{m.bookEvent ? <span title="The whole book moved together: money arriving or leaving, left out of the consensus counts">{m.bookEvent.kind === "emptied" ? "Book emptied" : `Whole book ×${m.bookEvent.factor.toFixed(2)}`}</span>
                  : m.state === "current" || m.state === "early" ? `${m.new || 0} new · ${m.add || 0} added · ${m.trim || 0} trimmed · ${m.exit || 0} sold` : <span style={{ color: "var(--text-muted)" }}>not filed</span>}</td>
                <td style={{ textAlign: "left" }}>{(m.top || []).slice(0, 3).map(([k, w]) => `${plainTicker(k)} ${pct(w)}`).join(" · ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </VizCard>

      <p className="onote">
        Source: the Research Database's guru tracker ({d.source === "local" ? `checkout at ${d.where}` : `GitHub, ${d.where}`}), filings last read from EDGAR {day(d.readAt)}.
        {dr.length > 0 && ` The parse agrees with Dataroma line for line for ${agree} of ${dr.length} managers.`}
        {events.length > 0 && ` Left out of the consensus counts as whole-book moves: ${events.map(e => `${firm(e.m)} (${e.kind === "emptied" ? "book emptied" : `every position ×${e.factor.toFixed(2)}`})`).join(", ")}.`}
        {" "}Estimated cost prices each quarter's purchases at its volume-weighted average; the method and its limits are in the tracker's Method page.
      </p>
    </div>
  );
}
