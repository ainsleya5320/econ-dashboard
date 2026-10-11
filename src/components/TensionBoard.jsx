import React, { useEffect, useState } from "react";
import { fonts } from "../lib/styles.js";
import { fin, card, label, note, chip, DenseHeader, fmtDay, useIsPhone } from "./dense.jsx";

// ============================================================================
// TENSION BOARD: the Tensions sub-tab on AI Economy and U.S. Economy. Each
// card is one check from server/tensions/checks: what independent sources
// claim, what those claims jointly require, how far apart they are (the gap
// meter), what would have to give, and what to watch. Data:
// /api/tensions?domain=ai|economy (server/tensions/index.js).
// ============================================================================

// Text colours come from theme tokens (src/theme.css) with darker light-theme shades, because
// dense.jsx's bright hexes are illegible as small text on a white card. Tints mix the same token.
const T = { red: "var(--tension-red)", amber: "var(--tension-amber)", green: "var(--tension-green)", indigo: "var(--tension-indigo)", slate: "var(--tension-slate)", cyan: "var(--tension-cyan)", violet: "var(--tension-violet)", orange: "var(--tension-orange)" };
const tint = (c, p) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const pad2 = n => String(n).padStart(2, "0");
const localDay = iso => { const t = new Date(iso); return isNaN(t) ? null : `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };

const STATUS = {
  contradiction: { label: "Contradiction", color: T.red, rank: 0, blurb: "cannot all be true at once" },
  tension: { label: "Tension", color: T.amber, rank: 1, blurb: "the circle needs squaring" },
  consistent: { label: "Consistent", color: T.green, rank: 2, blurb: "the claims fit together" },
  unavailable: { label: "Unavailable", color: T.slate, rank: 3, blurb: "a source failed" },
};
// where each claim comes from, so a market price is never mistaken for a forecast
const KIND = {
  market: { label: "Market", color: T.indigo, title: "Priced in a market: prediction markets, bonds, stocks" },
  consensus: { label: "Consensus", color: T.cyan, title: "A survey or committee projection, such as the Fed's Summary of Economic Projections" },
  official: { label: "Official", color: T.slate, title: "Published statistics or filings: BEA, the Fed's Z.1, Treasury, SEC" },
  forecast: { label: "Forecast", color: T.violet, title: "A named third party's forecast" },
  company: { label: "Company", color: T.orange, title: "What companies announce, report or guide to" },
  estimate: { label: "Our arithmetic", color: T.slate, title: "Derived on this page from the claims above" },
};
const DOMAIN = { ai: "AI Economy", economy: "U.S. Economy" };
// a YYYY-MM-DD date prints as a day; a period label ("2026 Q2", "FY2025") prints as given
const asOfText = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? fmtDay(d) : d);

const Tag = ({ kind }) => {
  const k = KIND[kind] || KIND.estimate;
  return <span title={k.title} style={{ fontSize: 8, fontFamily: fonts.mono, color: k.color, border: `1px solid ${tint(k.color, 45)}`, borderRadius: 4, padding: "0 4px", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{k.label}</span>;
};

const StatusPill = ({ status }) => {
  const s = STATUS[status] || STATUS.unavailable;
  return <span style={{ fontSize: 9, fontFamily: fonts.mono, fontWeight: 700, color: s.color, background: tint(s.color, 12), border: `1px solid ${tint(s.color, 45)}`, borderRadius: 5, padding: "2px 7px", textTransform: "uppercase", letterSpacing: 0.6, whiteSpace: "nowrap" }}>{s.label}</span>;
};

// the gap on a scale banded at the check's own thresholds
function GapMeter({ gap }) {
  if (!gap || !fin(gap.value)) return null;
  const max = gap.max ?? gap.contradiction * 1.6;
  const at = v => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const over = gap.value > max;
  return (
    <div style={{ margin: "10px 0 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ ...label, fontSize: 9 }}>{gap.label}</span>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: fonts.heading, color: "var(--text-primary)" }}>{gap.display}</span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 4, marginTop: 5, overflow: "hidden", display: "flex" }}>
        <div style={{ width: at(gap.tension), background: tint(T.green, 35) }} />
        <div style={{ width: `calc(${at(gap.contradiction)} - ${at(gap.tension)})`, background: tint(T.amber, 35) }} />
        <div style={{ flex: 1, background: tint(T.red, 35) }} />
      </div>
      <div style={{ position: "relative", height: 12 }}>
        <div title={gap.display} style={{ position: "absolute", left: over ? "calc(100% - 3px)" : `calc(${at(gap.value)} - 3px)`, top: -11, width: 6, height: 14, borderRadius: 2, background: "var(--text-primary)", boxShadow: "0 0 0 2px var(--card-bg, #0b1220)" }} />
        <span style={{ ...note, position: "absolute", left: at(gap.tension), transform: "translateX(-50%)", fontSize: 8.5 }}>{gap.tensionLabel || fmtNum(gap.tension)}</span>
        <span style={{ ...note, position: "absolute", left: at(gap.contradiction), transform: "translateX(-50%)", fontSize: 8.5 }}>{gap.contradictionLabel || fmtNum(gap.contradiction)}</span>
      </div>
      {gap.note && <div style={{ ...note, marginTop: 2 }}>{gap.note}</div>}
    </div>
  );
}
const fmtNum = v => (fin(v) ? (Math.abs(v) >= 10 ? Math.round(v).toString() : String(Math.round(v * 100) / 100)) : "");

// one status square per day the board has built
function HistoryStrip({ rows }) {
  if (!rows?.length) return null;
  const tail = rows.slice(-120);
  return (
    <div>
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginTop: 4 }}>
        {tail.map(r => <span key={r.d} title={`${fmtDay(r.d)}: ${STATUS[r.status]?.label || r.status}${fin(r.gap) ? ` · gap ${fmtNum(r.gap)}` : ""}`} style={{ width: 9, height: 9, borderRadius: 2, background: STATUS[r.status]?.color || T.slate, opacity: 0.85 }} />)}
      </div>
      <div style={{ ...note, marginTop: 3 }}>{tail.length === 1 ? `History starts ${fmtDay(tail[0].d)}; a square is added each day the board builds.` : `${fmtDay(tail[0].d)} to ${fmtDay(tail[tail.length - 1].d)}, one square per day`}</div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>{title}</div>
    {children}
  </div>
);
const Row = ({ left, right, sub, tag }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "1px 10px", padding: "4px 0", borderTop: "1px solid var(--border-subtle)" }}>
    <span style={{ fontSize: 10.5, color: "var(--text-secondary)", fontFamily: fonts.mono, lineHeight: 1.4 }}>{tag && <><Tag kind={tag} />{" "}</>}{left}</span>
    <span style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{right}</span>
    {sub && <span style={{ ...note, gridColumn: "1 / -1" }}>{sub}</span>}
  </div>
);

// Collapsed, a card is the finding: status, headline, gap meter and the names of
// what would have to give. Open, it adds the evidence behind it.
function TensionCard({ c, history, startOpen }) {
  const [open, setOpen] = useState(!!startOpen);
  const s = STATUS[c.status] || STATUS.unavailable;
  const phone = useIsPhone();
  const hasMore = c.claims?.length > 0 || c.implied?.length > 0 || c.watch?.length > 0 || c.math?.length > 0;
  return (
    <div style={{ ...card, borderLeft: `3px solid ${s.color}`, padding: phone ? "12px 12px" : "14px 16px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill status={c.status} />
        {c.asOf && <span style={note}>data to {asOfText(c.asOf)}</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 6 }}>{c.title}</div>
      {c.question && <div style={{ ...note, fontSize: 10, marginTop: 2 }}>{c.question}</div>}
      {c.headline && <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, lineHeight: 1.55, marginTop: 8 }}>{c.headline}</div>}
      {c.error && <div style={{ fontSize: 10.5, color: T.amber, fontFamily: fonts.mono, marginTop: 8 }}>Could not build this check: {c.error}</div>}
      <GapMeter gap={c.gap} />

      {!open && c.gives?.length > 0 && (
        <div style={{ ...note, fontSize: 10, marginTop: 6 }}>
          <span style={{ ...label, fontSize: 9 }}>What has to give: </span>
          {c.gives.map(g => g.label).join(" · ")}
        </div>
      )}
      {hasMore && (
        <button onClick={() => setOpen(o => !o)} style={{ marginTop: 10, background: "transparent", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", color: "var(--text-secondary)", fontSize: 10, fontFamily: fonts.mono }}>
          {open ? "Hide the evidence" : "Show the evidence, the arithmetic and sources"}
        </button>
      )}

      {open && (<>
        {(c.claims?.length > 0 || c.implied?.length > 0 || c.gives?.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "0 18px" }}>
            {c.claims?.length > 0 && (
              <Section title="What the sources say">
                {c.claims.map((x, i) => <Row key={i} tag={x.kind} left={x.label} right={x.display} sub={[x.source, x.asOf && `as of ${asOfText(x.asOf)}`, x.note].filter(Boolean).join(" · ")} />)}
              </Section>
            )}
            <div>
              {c.implied?.length > 0 && (
                <Section title="What that requires">
                  {c.implied.map((x, i) => <Row key={i} tag="estimate" left={x.label} right={x.display} sub={x.note} />)}
                </Section>
              )}
              {c.gives?.length > 0 && (
                <Section title="What has to give">
                  {c.gives.map((g, i) => (
                    <div key={i} style={{ padding: "4px 0", borderTop: "1px solid var(--border-subtle)" }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.mono }}>{g.label}</div>
                      {g.note && <div style={{ ...note, fontSize: 10 }}>{g.note}</div>}
                    </div>
                  ))}
                </Section>
              )}
            </div>
          </div>
        )}
        {c.watch?.length > 0 && (
          <Section title="What to watch">
            {c.watch.map((w, i) => <Row key={i} left={w.label} right={w.display || ""} sub={w.note} />)}
          </Section>
        )}
        {c.math?.length > 0 && (
          <Section title="The arithmetic">
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {c.math.map((m, i) => <li key={i} style={{ fontSize: 10.5, color: "var(--text-secondary)", fontFamily: fonts.mono, lineHeight: 1.55, marginBottom: 3 }}>{m}</li>)}
            </ol>
          </Section>
        )}
        <Section title="History"><HistoryStrip rows={history} /></Section>
        {c.sources?.length > 0 && (
          <Section title="Sources">
            {c.sources.map((x, i) => <div key={i} style={{ ...note, fontSize: 10 }}>{x.url ? <a href={x.url} target="_blank" rel="noreferrer" style={{ color: T.indigo }}>{x.label}</a> : x.label}</div>)}
          </Section>
        )}
        {c.see && <div style={{ ...note, marginTop: 8 }}>{c.see}</div>}
      </>)}
    </div>
  );
}

export default function TensionBoard({ domain }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/tensions?domain=${domain}`).then(r => r.json()).then(j => { if (live) (j.error ? setErr(j.error) : setD(j)); }).catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [domain]);

  if (err) return <div style={{ ...card, fontSize: 11, color: T.amber, fontFamily: fonts.mono }}>The tensions board is unavailable: {err}</div>;
  if (!d) return <div style={{ ...card, fontSize: 11, color: T.slate, fontFamily: fonts.mono }}>Pricing the claims against each other…</div>;

  const checks = [...d.checks].sort((a, b) => (STATUS[a.status]?.rank ?? 9) - (STATUS[b.status]?.rank ?? 9) || (a.order ?? 99) - (b.order ?? 99));
  const n = d.counts || {};
  const live = checks.length - (n.unavailable || 0);
  const headline = !live ? "No check could be built"
    : n.contradiction ? `${n.contradiction} of ${live} ${live === 1 ? "check" : "checks"} ${n.contradiction === 1 ? "finds" : "find"} claims that cannot all be true${n.tension ? `; ${n.tension} more ${n.tension === 1 ? "needs" : "need"} squaring` : ""}`
    : n.tension ? `No outright contradictions; ${n.tension} of ${live} ${live === 1 ? "check" : "checks"} ${n.tension === 1 ? "needs" : "need"} squaring`
    : live === 1 ? "The one check that could be built fits together" : `All ${live} checks fit together`;

  return (<>
    <DenseHeader
      eyebrow={`Tensions · ${DOMAIN[domain] || domain}${d.stale ? " · cached" : ""}`}
      headline={headline}
      blurb={<>Each check sets side by side what independent sources claim about one piece of the economy (prediction markets, bond and stock prices, the Fed&apos;s projections, official statistics, named forecasts) and works out what those claims jointly require.
        Where the requirement is implausible, at least one of them is wrong. The point is to spot the issue, not to place a bet: each card says what would have to give and what to watch.</>}
      meta={<>built {fmtDay(localDay(d.built))}<br />refreshes hourly</>}
      chips={["contradiction", "tension", "consistent", "unavailable"].filter(k => n[k] || k !== "unavailable").map(k => chip(STATUS[k].label, n[k] || 0, STATUS[k].color, STATUS[k].blurb))}
    />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
      <span style={note}>Sources are tagged:</span>
      {Object.entries(KIND).map(([k, v]) => <span key={k} title={v.title} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Tag kind={k} /></span>)}
    </div>
    <div style={{ display: "grid", gap: 12 }}>
      {checks.map((c, i) => <TensionCard key={c.id} c={c} history={d.history?.[c.id]} startOpen={i === 0} />)}
    </div>
  </>);
}
