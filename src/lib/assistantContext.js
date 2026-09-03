// ============================================================================
// ASSISTANT CONTEXT — the dashboard's own verdicts, as text for the chat model
// The Cockpit and the theme tabs already compute one-word verdicts from live
// data (regime, valuation lenses, the AI chain, profits, credit, housing).
// This module re-derives them with the SAME exported functions the tabs use
// and renders a compact block that ChatDrawer appends to every request, so
// the assistant can discuss what's actually on screen instead of guessing.
// Everything comes from server-cached endpoints; a failed feed just drops
// its line. Cached for 5 minutes so chatting doesn't re-pull the world.
// ============================================================================
import { computeRegime, damodaranSummary } from "../tabs/OverviewTab.jsx";
import { chainModel, chainVerdicts, chainHeadline } from "../tabs/AIEconomyTab.jsx";
import { fvTone } from "../components/MarketFairValue.jsx";

const fin = v => v != null && isFinite(v);
const pct = (v, dp = 2) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "n/a");
const num = (v, dp = 2) => (fin(v) ? v.toFixed(dp) : "n/a");
const tok = n => (!fin(n) ? "n/a" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(0)}B` : `${(n / 1e6).toFixed(0)}M`);
const firstClause = s => (s || "").split(/ — |\. /)[0];
const ord = n => (!fin(n) ? "n/a" : `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`);

const FEEDS = {
  summary: "/api/dashboard-summary", erp: "/api/erp", ms: "/api/ms-fair-value", fg: "/api/fear-greed",
  kalecki: "/api/kalecki", debt: "/api/debt-market", bank: "/api/bank-credit", housing: "/api/housing-health",
  or: "/api/or-rankings-history", ornn: "/api/ornn", semi: "/api/semi-h100", mem: "/api/memory",
};

let cache = { text: "", ts: 0 };
const TTL = 5 * 60 * 1000;

async function getJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; const d = await r.json(); return d && !d.error ? d : null; } catch { return null; }
}

export function buildVerdictText(d) {
  const L = ["=== Dashboard verdicts (computed live by the app — cite these when relevant) ==="];
  const asOf = d.summary?.asOf ? new Date(d.summary.asOf).toLocaleString() : null;
  if (asOf) L.push(`Snapshot time: ${asOf}`);

  // Cockpit — regime + tape
  const reg = d.summary ? computeRegime(d.summary.indexes || [], d.summary.commodities || [], d.summary.crypto || []) : null;
  if (reg) {
    L.push(`Cockpit regime: ${reg.regime} — SPY ${pct(reg.spyChg)} at $${num(reg.spy.price)}; ${reg.upCount}/${reg.n} major indexes up; VIX ${pct(reg.vixChg, 1)}; read: ${reg.note}.`);
    L.push(`Cross-asset today: ${reg.rows.map(r => `${r.label} ${pct(r.chg)}`).join(", ")}.`);
  }

  // Valuation lenses
  const lens = [];
  if (d.erp && fin(d.erp.currentErp)) lens.push(`simple ERP ${d.erp.currentErp >= 0 ? "+" : ""}${num(d.erp.currentErp)}pp ("${d.erp.verdict}", ${ord(d.erp.percentile)} pct of 25y; earnings yield ${num(d.erp.earningsYield)}% vs 10Y ${num(d.erp.tenYear)}%)`);
  const dam = damodaranSummary();
  if (dam) lens.push(`Damodaran implied ERP ${(dam.last.erp * 100).toFixed(2)}% (${ord(dam.pct)} pct since ${dam.series[0].y}, end-${dam.last.y})`);
  if (d.ms?.available) lens.push(`Morningstar bottom-up fair value: market ${Math.abs(d.ms.latest * 100).toFixed(1)}% ${d.ms.latest < 0 ? "undervalued" : "overvalued"} (median price/fair value across ~1,500 covered stocks; cheaper than ${d.ms.cheaperThan}% of days since ${String(d.ms.start).slice(0, 4)}; tone ${fvTone(d.ms.cheaperThan).label}; as of ${d.ms.asOf})`);
  if (lens.length) L.push(`Valuation lenses: ${lens.join("; ")}.`);

  // Rates + sentiment
  const rates = d.summary?.rates || [];
  const rv = id => rates.find(r => r.id === id)?.value;
  const rlist = [["Fed funds", "DFF"], ["2Y", "DGS2"], ["10Y", "DGS10"], ["30Y", "DGS30"], ["30Y mortgage", "MORTGAGE30US"]].filter(([, id]) => fin(rv(id))).map(([l, id]) => `${l} ${num(rv(id))}%`);
  const sp = rv("spread2s10s");
  if (rlist.length) L.push(`Rates: ${rlist.join(", ")}${fin(sp) ? `; 2s10s ${sp >= 0 ? "+" : ""}${sp.toFixed(0)}bp (${sp < 0 ? "inverted" : "un-inverted"})` : ""}.`);
  if (d.fg && fin(d.fg.composite)) {
    const s = d.fg.composite;
    const zone = s < 25 ? "Extreme Fear" : s < 45 ? "Fear" : s < 55 ? "Neutral" : s < 75 ? "Greed" : "Extreme Greed";
    const comp = k => { const v = d.fg.components?.[k]; return v == null ? null : Math.round(typeof v === "number" ? v : v.score); };
    L.push(`Fear & Greed: ${Math.round(s)} (${zone}) — VIX ${comp("vix") ?? "n/a"}, momentum ${comp("momentum") ?? "n/a"}, safe haven ${comp("safeHaven") ?? "n/a"}, junk demand ${comp("junkBond") ?? "n/a"}, breadth ${comp("breadth") ?? "n/a"}.`);
  }

  // AI chain
  if (d.or || d.ornn || d.semi || d.mem) {
    const c = chainModel(d.or, d.ornn, d.semi, d.mem);
    const v = chainVerdicts(c);
    const h = chainHeadline(c);
    L.push(`AI chain (AI Economy tab) headline: ${h.label}${h.why ? ` — ${h.why}` : ""}.`);
    L.push(`  Stage 1 Token demand: ${v.vDemand[0]} — ${tok(c.wkLast?.v)} API tokens/wk (OpenRouter sample), 13-week ${pct(c.demand13, 0)}.`);
    L.push(`  Link A realized $/M tokens (big-4 avg): ${c.otpiNow ? `$${c.otpiNow.v.toFixed(2)} (30d ${pct(c.otpiChg, 1)})` : "n/a"}.`);
    L.push(`  Stage 2 Models & labs: ${v.vLabs[0]} — disclosed AI revenue run-rates sum $${c.arrTotal.toFixed(0)}B; revenue-per-GW wedge ${c.wedge.latestRev ? `latest $${c.wedge.latestRev.rev.toFixed(0)}M/MW/yr vs $${c.wedge.costBand.min}–${c.wedge.costBand.max}M compute cost` : "no print yet"} (status ${c.wedge.status.title}).`);
    L.push(`  Stage 3 Compute & power: ${v.vCompute[0]} — tracked lab footprint ${c.wedge.gwTotal ? `${c.wedge.gwTotal.toFixed(0)} GW by ${c.wedge.gwDate} (incl. projections)` : "n/a"}; AI debt announced $${c.debtTotal.toFixed(0)}B; PJM capacity $${c.pjm?.price}/MW-day.`);
    L.push(`  Link C H100 1-yr contract: ${c.hNow ? `$${c.hNow.h100.toFixed(2)}/hr (4wk ${pct(c.hChg, 1)})` : "n/a"}.`);
    L.push(`  Stage 4 Silicon & memory: ${v.vSilicon[0]} — DDR5 16Gb spot $${c.ddr5 ? c.ddr5.avg.toFixed(1) : "n/a"}; memory breadth ${c.memUp} up / ${c.memDown} down of ${c.memTotal} parts (TrendForce).`);
  }

  // Theme verdicts from the U.S. Economy tabs
  if (d.kalecki?.verdict) {
    const k = d.kalecki, kl = k.latest;
    L.push(`Profits engine (Kalecki-Levy): ${k.verdict.label}${kl ? ` — corporate profits ${kl.actual.toFixed(1)}% of GDP (p${k.pct}); ${kl.gov > kl.inv ? "the government deficit is the largest engine" : "private investment is the largest engine"}` : ""}.`);
  }
  if (d.debt?.verdict) L.push(`Debt & credit: ${d.debt.verdict.label}${fin(d.debt.verdict.hy) ? ` — HY spread ${d.debt.verdict.hy.toFixed(2)}%${fin(d.debt.verdict.hyPct) ? ` (${ord(d.debt.verdict.hyPct)} pct, 3y)` : ""}` : ""}.`);
  if (d.bank?.verdict) L.push(`Bank credit (Fed H.8): ${d.bank.verdict.label} — ${firstClause(d.bank.verdict.note)}.`);
  if (d.housing?.verdict) L.push(`Housing health: ${d.housing.verdict.label} — ${firstClause(d.housing.verdict.note)}.`);

  return L.length > 1 ? L.join("\n") : "";
}

// Fetch every feed in parallel (all server-cached), build the block, cache 5 min.
export async function getVerdictContext(force = false) {
  if (!force && cache.text && Date.now() - cache.ts < TTL) return cache.text;
  const keys = Object.keys(FEEDS);
  const results = await Promise.all(keys.map(k => getJson(FEEDS[k])));
  const d = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
  const text = buildVerdictText(d);
  if (text) cache = { text, ts: Date.now() };
  return text;
}
