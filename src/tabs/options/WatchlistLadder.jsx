import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH, InfoBox } from "../../components/shared.jsx";
import { fetchOptionsChain } from "../../lib/api.js";

// ============================================================================
// OPTIONS → WATCHLIST LADDER
// The single-name income ladder, one row per watchlist name: at ~45 days,
// the best 15–30Δ cash-secured put and the best 15–30Δ covered call, with
// annualized yield, assignment odds, breakeven / if-called, plus ATM IV and
// the market-implied 90-day "odds it's higher". Chains come from CBOE three
// at a time (their rate limit), cached for the visit; Refresh re-pulls.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569";
const fin = v => v != null && isFinite(v);
const pc = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const pcS = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "—");
const usd = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const TARGET = 45;

function nearestDte(dtes, target) {
  const tol = Math.max(10, target * 0.4);
  const c = dtes.filter(d => Math.abs(d - target) <= tol);
  if (!c.length) return null;
  return c.reduce((b, d) => (Math.abs(d - target) < Math.abs(b - target) ? d : b), c[0]);
}
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// one watchlist row from a chain
function analyze(symbol, chain) {
  const { options, spot } = chain;
  if (!spot || !options?.length) return { symbol, spot, empty: true };
  const dtes = [...new Set(options.map(o => o.dte))].sort((a, b) => a - b);
  const dte = nearestDte(dtes, TARGET);
  if (dte == null) return { symbol, spot, empty: true };
  const at = options.filter(o => o.dte === dte && o.bid > 0 && fin(o.delta));
  const atm = at.reduce((b, o) => (!b || Math.abs(o.strike - spot) < Math.abs(b.strike - spot) ? o : b), null);
  const atmIv = atm?.iv != null ? atm.iv * 100 : null;
  // sweet-spot put: highest annualized yield among 15–30Δ puts below spot
  const puts = at.filter(o => o.type === "P" && o.strike <= spot && Math.abs(o.delta) >= 0.15 && Math.abs(o.delta) <= 0.30)
    .map(o => ({ strike: o.strike, bid: o.bid, prob: Math.abs(o.delta), ann: (o.bid / o.strike) * (365 / dte) * 100, be: o.strike - o.bid, dist: (o.strike / spot - 1) * 100 }));
  const put = puts.length ? puts.reduce((b, p) => (p.ann > b.ann ? p : b)) : null;
  const calls = at.filter(o => o.type === "C" && o.strike >= spot && o.delta >= 0.15 && o.delta <= 0.30)
    .map(o => ({ strike: o.strike, bid: o.bid, prob: o.delta, ann: (o.bid / spot) * (365 / dte) * 100, ifCalled: ((o.strike - spot + o.bid) / spot) * 100, dist: (o.strike / spot - 1) * 100 }));
  const call = calls.length ? calls.reduce((b, c) => (c.ann > b.ann ? c : b)) : null;
  // market-implied odds it's higher in ~90 days (ATM vol, lognormal)
  const d90 = nearestDte(dtes, 90);
  let pUp90 = null;
  if (d90 != null) {
    const a90 = options.filter(o => o.dte === d90 && fin(o.iv) && o.iv > 0).reduce((b, o) => (!b || Math.abs(o.strike - spot) < Math.abs(b.strike - spot) ? o : b), null);
    if (a90) { const T = d90 / 365, s = a90.iv; pUp90 = normCdf((Math.log(Math.exp(0.04 * T)) - (s * s * T) / 2) / (s * Math.sqrt(T))); }
  }
  return { symbol, spot, dte, atmIv, put, call, pUp90, empty: false };
}

export default function WatchlistLadder({ tickers }) {
  const [rows, setRows] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [sortKey, setSortKey] = useState("putAnn");

  const load = useCallback(async (force = false) => {
    if (!tickers.length) return;
    setLoading(true);
    const out = force ? {} : { ...rows };
    const todo = tickers.filter(t => force || !out[t]);
    for (let i = 0; i < todo.length; i += 3) {
      const batch = todo.slice(i, i + 3);
      setProgress(`Loading ${Math.min(i + 3, todo.length)} of ${todo.length}…`);
      const res = await Promise.all(batch.map(async t => {
        try { return analyze(t, await fetchOptionsChain(t)); } catch { return { symbol: t, error: true }; }
      }));
      for (const r of res) out[r.symbol] = r;
      setRows({ ...out });
    }
    setProgress(""); setLoading(false);
  }, [tickers, rows]);

  useEffect(() => { load(false); }, [tickers]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const arr = tickers.map(t => rows[t]).filter(Boolean);
    const key = r => sortKey === "putAnn" ? (r.put?.ann ?? -1) : sortKey === "callAnn" ? (r.call?.ann ?? -1) : sortKey === "iv" ? (r.atmIv ?? -1) : (r.pUp90 ?? -1);
    return arr.sort((a, b) => key(b) - key(a));
  }, [rows, tickers, sortKey]);

  const th = (t, k, align = "right") => (
    <th onClick={k ? () => setSortKey(k) : undefined} style={{ padding: "6px 8px", fontSize: 8.5, color: sortKey === k ? INDIGO : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: k ? "pointer" : "default", whiteSpace: "nowrap" }}>{t}{k ? " ↕" : ""}</th>
  );
  const td = (v, extra = {}) => <td style={{ padding: "7px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "#cbd5e1", whiteSpace: "nowrap", ...extra }}>{v}</td>;
  const annColor = a => (!fin(a) ? DIM : a >= 15 ? GREEN : a >= 8 ? AMBER : SLATE);

  return (<>
    <SH>Watchlist Income Ladder — best 15–30Δ trade per name at ~{TARGET} days</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "10px 12px", marginBottom: 12, overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono }}>{loading ? progress : `${list.length} of ${tickers.length} names loaded · click a column to sort · bid prices`}</span>
        <button onClick={() => load(true)} disabled={loading} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 10px", fontSize: 10, color: SLATE, fontFamily: fonts.mono, cursor: loading ? "default" : "pointer" }}>{loading ? "Loading…" : "Refresh chains"}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          {th("Name", null, "left")}{th("Spot")}{th("ATM IV", "iv")}{th("Higher in 90d", "pUp")}
          {th("Sell put", null)}{th("Assign", null)}{th("Put ann.", "putAnn")}{th("Breakeven", null)}
          {th("Sell call", null)}{th("Called", null)}{th("Call ann.", "callAnn")}{th("If called", null)}
        </tr></thead>
        <tbody>
          {list.map(r => (
            <tr key={r.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {td(r.symbol, { textAlign: "left", color: "var(--text-primary)", fontWeight: 700, fontFamily: fonts.heading, fontSize: 12 })}
              {r.error ? <td colSpan={11} style={{ padding: 7, fontSize: 10.5, color: "#64748b", fontFamily: fonts.mono }}>chain unavailable</td> : r.empty ? <td colSpan={11} style={{ padding: 7, fontSize: 10.5, color: "#64748b", fontFamily: fonts.mono }}>no expiry near {TARGET} days</td> : (<>
                {td(usd(r.spot))}
                {td(pc(r.atmIv), { color: SLATE })}
                {td(fin(r.pUp90) ? `${Math.round(r.pUp90 * 100)}%` : "—", { color: r.pUp90 >= 0.5 ? GREEN : RED })}
                {td(r.put ? `${usd(r.put.strike, r.put.strike % 1 ? 1 : 0)} (${pcS(r.put.dist, 0)})` : "—")}
                {td(r.put ? `${Math.round(r.put.prob * 100)}%` : "—", { color: SLATE })}
                {td(pc(r.put?.ann), { color: annColor(r.put?.ann), fontWeight: 700 })}
                {td(r.put ? usd(r.put.be) : "—", { color: SLATE })}
                {td(r.call ? `${usd(r.call.strike, r.call.strike % 1 ? 1 : 0)} (${pcS(r.call.dist, 0)})` : "—")}
                {td(r.call ? `${Math.round(r.call.prob * 100)}%` : "—", { color: SLATE })}
                {td(pc(r.call?.ann), { color: annColor(r.call?.ann), fontWeight: 700 })}
                {td(r.call ? pcS(r.call.ifCalled) : "—", { color: SLATE })}
              </>)}
            </tr>
          ))}
          {!list.length && !loading && <tr><td colSpan={12} style={{ padding: 14, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Add tickers to the watchlist to scan.</td></tr>}
        </tbody>
      </table>
    </div>
    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>Reading the ladder.</strong> For each name, the highest-yielding put and call inside the 15–30Δ band at the expiry nearest 45 days — the classic income trade where premium is meaningful and assignment is still the exception. &ldquo;Higher in 90d&rdquo; is the options market&apos;s own odds the stock finishes above today&apos;s price (ATM vol, lognormal). High yields usually mean high implied vol, which usually means the market sees a reason: check the Market Expectations view for that name before selling into it.
    </InfoBox>
  </>);
}
