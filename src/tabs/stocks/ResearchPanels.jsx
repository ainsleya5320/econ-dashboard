import React, { useState, useEffect, useMemo } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { fetchFMP } from "../../lib/api.js";

// ─── Shared bits ─────────────────────────────────────────────────────────────
const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8";
const fin = v => v != null && isFinite(v);
const pctOf = (arr, val) => {
  const a = arr.filter(fin);
  if (a.length < 5 || !fin(val)) return null;
  return Math.round((a.filter(v => v < val).length / a.length) * 100);
};
const median = arr => {
  const a = arr.filter(fin).sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const fmtCap = n => n == null ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;

function PanelTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>{children}</div>
      {sub && <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

// ─── 1. Valuation vs Own History — "is it cheap vs itself" ──────────────────
// History comes from the 20yr annual ratios/key-metrics already fetched for
// the detail view; only the current TTM values need 2 extra calls.
const BAND_METRICS = [
  { key: "pe",  label: "P/E",        hist: d => d.rat.map(r => r.priceToEarningsRatio), ttm: (r, k) => r?.priceToEarningsRatioTTM, lowCheap: true,  fmt: v => `${v.toFixed(1)}×`, cap: 300 },
  { key: "ev",  label: "EV/EBITDA",  hist: d => d.km.map(r => r.evToEBITDA),            ttm: (r, k) => k?.evToEBITDATTM,           lowCheap: true,  fmt: v => `${v.toFixed(1)}×`, cap: 200 },
  { key: "ps",  label: "P/S",        hist: d => d.rat.map(r => r.priceToSalesRatio),    ttm: (r, k) => r?.priceToSalesRatioTTM,    lowCheap: true,  fmt: v => `${v.toFixed(1)}×`, cap: 100 },
  { key: "fcf", label: "FCF Yield",  hist: d => d.km.map(r => r.freeCashFlowYield),     ttm: (r, k) => k?.freeCashFlowYieldTTM,    lowCheap: false, fmt: v => `${(v * 100).toFixed(1)}%`, cap: 1 },
];

export function ValuationBands({ data, fmpKey }) {
  const [ttm, setTtm] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchFMP(`/ratios-ttm?symbol=${data.symbol}`, fmpKey).catch(() => null),
      fetchFMP(`/key-metrics-ttm?symbol=${data.symbol}`, fmpKey).catch(() => null),
    ]).then(([r, k]) => { if (alive) setTtm({ r: r?.[0], k: k?.[0] }); });
    return () => { alive = false; };
  }, [data.symbol, fmpKey]);

  const rows = useMemo(() => {
    if (!ttm) return null;
    return BAND_METRICS.map(m => {
      const hist = m.hist(data).filter(v => fin(v) && v > (m.lowCheap ? 0 : -m.cap) && Math.abs(v) < m.cap);
      const cur = m.ttm(ttm.r, ttm.k);
      if (hist.length < 5 || !fin(cur)) return null;
      const pct = pctOf(hist, cur);
      // cheapness percentile: for multiples low=cheap; for yields high=cheap
      const cheapPct = m.lowCheap ? pct : (pct == null ? null : 100 - pct);
      return { ...m, hist, cur, pct, cheapPct, min: Math.min(...hist), max: Math.max(...hist), med: median(hist) };
    }).filter(Boolean);
  }, [ttm, data]);

  const overall = useMemo(() => {
    if (!rows?.length) return null;
    const cp = median(rows.map(r => r.cheapPct).filter(fin));
    if (cp == null) return null;
    return cp <= 30 ? { label: "Cheap vs Its Own History", color: GREEN, cp }
      : cp <= 70 ? { label: "Mid-Range vs Its Own History", color: AMBER, cp }
      : { label: "Rich vs Its Own History", color: RED, cp };
  }, [rows]);

  if (!rows) return <div style={{ padding: 14, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading valuation history…</div>;
  if (!rows.length) return null;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 22px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <PanelTitle sub={`Today's multiple vs its own ${rows[0].hist.length}-year annual range — the "cheap vs itself" test. Marker = today; tick = its historical median.`}>
          Valuation vs Own History
        </PanelTitle>
        {overall && (
          <span style={{ fontSize: 12, fontWeight: 700, color: overall.color, fontFamily: fonts.heading }}>
            {overall.label} <span style={{ fontSize: 10, fontFamily: fonts.mono, color: "#64748b" }}>(cheapness pctile {overall.cp})</span>
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13, marginTop: 8 }}>
        {rows.map(r => {
          const span = r.max - r.min || 1;
          const pos = Math.max(0, Math.min(100, ((r.cur - r.min) / span) * 100));
          const medPos = Math.max(0, Math.min(100, ((r.med - r.min) / span) * 100));
          const color = r.cheapPct == null ? "#94a3b8" : r.cheapPct <= 30 ? GREEN : r.cheapPct <= 70 ? AMBER : RED;
          return (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 78, fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, flexShrink: 0 }}>{r.label}</div>
              <div style={{ flex: 1, position: "relative", height: 18 }}>
                <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2 }} />
                <div title={`median ${r.fmt(r.med)}`} style={{ position: "absolute", top: 3, left: `${medPos}%`, width: 2, height: 12, background: "#64748b" }} />
                <div title={`today ${r.fmt(r.cur)}`} style={{ position: "absolute", top: 3, left: `calc(${pos}% - 6px)`, width: 12, height: 12, borderRadius: "50%", background: color, border: "2px solid #0f172a" }} />
              </div>
              <div style={{ width: 190, display: "flex", justifyContent: "space-between", gap: 8, flexShrink: 0, fontSize: 10.5, fontFamily: fonts.mono }}>
                <span style={{ color: "#475569" }}>{r.fmt(r.min)}–{r.fmt(r.max)}</span>
                <span style={{ color, fontWeight: 700 }}>{r.fmt(r.cur)} <span style={{ color: "#64748b", fontWeight: 400 }}>p{r.pct}</span></span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
        Percentile = share of its own annual history below today&apos;s TTM value. For FCF yield, HIGH is cheap (percentile inverted in the verdict). A stock can be cheap vs itself and still expensive for a reason — pair with the Peers tab.
      </div>
    </div>
  );
}

// ─── 2. Peer comparison — "cheap for what it is, or cheap for a reason?" ────
export function PeerCompare({ symbol, fmpKey }) {
  const [state, setState] = useState({ loading: true, rows: null, error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const peers = await fetchFMP(`/stock-peers?symbol=${symbol}`, fmpKey);
        const list = (Array.isArray(peers) ? peers : []).slice(0, 8);
        const all = [{ symbol, companyName: "(this company)", mktCap: null }, ...list];
        const ttm = await Promise.all(all.map(p =>
          fetchFMP(`/ratios-ttm?symbol=${p.symbol}`, fmpKey).then(r => r?.[0]).catch(() => null)
        ));
        if (!alive) return;
        const rows = all.map((p, i) => ({
          symbol: p.symbol,
          name: p.companyName,
          mktCap: p.mktCap ?? null,
          pe: ttm[i]?.priceToEarningsRatioTTM ?? null,
          ps: ttm[i]?.priceToSalesRatioTTM ?? null,
          margin: ttm[i]?.netProfitMarginTTM ?? null,
          gross: ttm[i]?.grossProfitMarginTTM ?? null,
          payout: ttm[i]?.dividendPayoutRatioTTM ?? null,
        }));
        setState({ loading: false, rows, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, rows: null, error: e.message });
      }
    })();
    return () => { alive = false; };
  }, [symbol, fmpKey]);

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "#64748b", fontFamily: fonts.mono }}>Loading peer set + TTM ratios (~9 calls)…</div>;
  if (!state.rows?.length) return <div style={{ padding: 30, fontSize: 12, color: "#f87171", fontFamily: fonts.mono }}>Could not load peers{state.error ? ` — ${state.error}` : ""}.</div>;

  const subj = state.rows[0];
  const peersOnly = state.rows.slice(1).sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0));
  const ordered = [subj, ...peersOnly];
  const medOf = k => median(peersOnly.map(r => r[k]));
  const meds = { pe: medOf("pe"), ps: medOf("ps"), margin: medOf("margin"), gross: medOf("gross") };
  const fmtX = v => v == null ? "—" : `${v.toFixed(1)}×`;
  const fmtP = v => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

  const verdict = (() => {
    if (subj.pe == null || meds.pe == null) return null;
    const cheaper = subj.pe < meds.pe;
    const better = subj.margin != null && meds.margin != null && subj.margin > meds.margin;
    if (cheaper && better) return { t: "Cheaper than peers with better margins — screen-worthy.", c: GREEN };
    if (cheaper && !better) return { t: "Cheaper than peers, but margins lag — cheap for a reason?", c: AMBER };
    if (!cheaper && better) return { t: "Premium to peers, justified by superior margins — quality costs.", c: AMBER };
    return { t: "Premium multiple without a margin edge — the burden of proof is on the bull case.", c: RED };
  })();

  return (<>
    {verdict && (
      <div style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${verdict.c}`, borderRadius: 12, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#cbd5e1", fontFamily: fonts.heading, fontWeight: 600 }}>
        {verdict.t}
      </div>
    )}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead><tr>
          {["Company", "Mkt Cap", "P/E (TTM)", "P/S (TTM)", "Gross Margin", "Net Margin"].map((h, i) => (
            <th key={h} style={{ padding: "9px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {ordered.map((r, i) => {
            const isSubj = i === 0;
            return (
              <tr key={r.symbol} style={{ background: isSubj ? "rgba(129,140,248,0.08)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, fontWeight: isSubj ? 700 : 500, color: isSubj ? INDIGO : "#cbd5e1" }}>
                  {r.symbol}<span style={{ marginLeft: 8, fontSize: 10, color: "#64748b", fontFamily: fonts.heading, fontWeight: 400 }}>{r.name}</span>
                </td>
                <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{fmtCap(r.mktCap)}</td>
                {["pe", "ps"].map(k => (
                  <td key={k} style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: isSubj ? 700 : 400, color: r[k] == null ? "#475569" : isSubj && meds[k] != null ? (r[k] < meds[k] ? GREEN : RED) : "var(--text-primary)" }}>{fmtX(r[k])}</td>
                ))}
                {["gross", "margin"].map(k => (
                  <td key={k} style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: isSubj ? 700 : 400, color: r[k] == null ? "#475569" : isSubj && meds[k] != null ? (r[k] > meds[k] ? GREEN : RED) : "var(--text-primary)" }}>{fmtP(r[k])}</td>
                ))}
              </tr>
            );
          })}
          <tr style={{ borderTop: "2px solid rgba(255,255,255,0.08)" }}>
            <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b", fontStyle: "italic" }}>Peer median</td>
            <td />
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtX(meds.pe)}</td>
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtX(meds.ps)}</td>
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtP(meds.gross)}</td>
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtP(meds.margin)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, lineHeight: 1.5 }}>
      Peer set from FMP&apos;s stock-peers (same industry/size cohort). Subject row colored vs the peer median: green = better (cheaper multiple / higher margin). TTM values.
    </div>
  </>);
}

// ─── 3. Dividend safety — payout, FCF coverage, growth streak ────────────────
export function DividendSafety({ data, fmpKey }) {
  const [divs, setDivs] = useState(undefined); // undefined = loading, null = none

  useEffect(() => {
    let alive = true;
    fetchFMP(`/dividends?symbol=${data.symbol}&limit=60`, fmpKey)
      .then(d => { if (alive) setDivs(Array.isArray(d) && d.length ? d : null); })
      .catch(() => { if (alive) setDivs(null); });
    return () => { alive = false; };
  }, [data.symbol, fmpKey]);

  const calc = useMemo(() => {
    if (!divs) return null;
    // annual dividend-per-share from payment history
    const byYear = {};
    divs.forEach(r => { const y = (r.date || "").slice(0, 4); if (y) byYear[y] = (byYear[y] || 0) + (r.adjDividend || 0); });
    const years = Object.keys(byYear).sort();
    // growth streak over complete years (exclude current partial year)
    const nowY = String(new Date().getFullYear());
    const complete = years.filter(y => y < nowY);
    let streak = 0;
    for (let i = complete.length - 1; i > 0; i--) {
      if (byYear[complete[i]] > byYear[complete[i - 1]] + 1e-9) streak++;
      else break;
    }
    // payout + coverage from the annual statements already loaded
    const lastRat = data.rat?.[data.rat.length - 1];
    const lastCf = data.cf?.[data.cf.length - 1];
    const paid = Math.abs(lastCf?.commonDividendsPaid ?? lastCf?.netDividendsPaid ?? 0);
    const fcf = lastCf?.freeCashFlow ?? null;
    const coverage = paid > 0 && fin(fcf) ? fcf / paid : null;
    const payout = lastRat?.dividendPayoutRatio ?? null;
    const yieldPct = lastRat?.dividendYieldPercentage ?? (lastRat?.dividendYield != null ? lastRat.dividendYield * 100 : null);
    let verdict = { label: "Adequate", color: AMBER };
    if (payout != null && coverage != null) {
      if (payout < 0.6 && coverage > 1.5 && streak >= 5) verdict = { label: "Safe & Growing", color: GREEN };
      else if (payout > 0.8 || coverage < 1.1) verdict = { label: "Strained", color: RED };
    }
    return { streak, payout, coverage, yieldPct, verdict, lastDps: complete.length ? byYear[complete[complete.length - 1]] : null };
  }, [divs, data]);

  if (divs === undefined) return null;
  if (divs === null) return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 22px", marginBottom: 16, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>
      No dividend — {data.symbol} doesn&apos;t pay one.
    </div>
  );

  const c = calc;
  const cell = (label, val, color) => (
    <div>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "var(--text-primary)", fontFamily: fonts.heading }}>{val}</div>
    </div>
  );

  return (
    <div style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${c.verdict.color}`, borderRadius: 14, padding: "14px 22px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <PanelTitle>Dividend Safety</PanelTitle>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: c.verdict.color, fontFamily: fonts.heading }}>{c.verdict.label}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px 20px" }}>
        {cell("Yield", c.yieldPct != null ? `${c.yieldPct.toFixed(2)}%` : "—")}
        {cell("Payout Ratio", c.payout != null ? `${(c.payout * 100).toFixed(0)}%` : "—", c.payout == null ? null : c.payout < 0.6 ? GREEN : c.payout < 0.8 ? AMBER : RED)}
        {cell("FCF Coverage", c.coverage != null ? `${c.coverage.toFixed(1)}×` : "—", c.coverage == null ? null : c.coverage > 1.5 ? GREEN : c.coverage > 1.1 ? AMBER : RED)}
        {cell("Growth Streak", `${c.streak} yr${c.streak === 1 ? "" : "s"}`, c.streak >= 5 ? GREEN : null)}
        {cell("DPS (last full yr)", c.lastDps != null ? `$${c.lastDps.toFixed(2)}` : "—")}
      </div>
      <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
        Coverage = free cash flow ÷ dividends paid (last fiscal year). Streak = consecutive complete years of rising dividend per share. Safe = payout &lt;60%, coverage &gt;1.5×, streak ≥5yrs.
      </div>
    </div>
  );
}

// ─── 4. Earnings week-ahead for the watchlist ────────────────────────────────
export function EarningsWeekAhead({ tickers, fmpKey }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!fmpKey || !tickers?.length) return;
    let alive = true;
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    fetchFMP(`/earnings-calendar?from=${from}&to=${to}`, fmpKey)
      .then(d => {
        if (!alive) return;
        const mine = new Set(tickers);
        const hits = (Array.isArray(d) ? d : []).filter(r => mine.has(r.symbol))
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        // one row per symbol (earliest date)
        const seen = new Set();
        setRows(hits.filter(r => { if (seen.has(r.symbol)) return false; seen.add(r.symbol); return true; }));
      })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [tickers, fmpKey]);

  if (!rows) return null;
  if (!rows.length) return (
    <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginBottom: 14 }}>
      📅 No watchlist earnings in the next 10 days.
    </div>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 }}>
        📅 Watchlist Earnings — Next 10 Days
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {rows.map(r => (
          <div key={r.symbol} style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${AMBER}`, borderRadius: 10, padding: "8px 14px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: INDIGO, fontFamily: fonts.mono }}>{r.symbol}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, marginLeft: 10 }}>{r.date}</span>
            {r.epsEstimated != null && <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginLeft: 10 }}>est. EPS ${Number(r.epsEstimated).toFixed(2)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
