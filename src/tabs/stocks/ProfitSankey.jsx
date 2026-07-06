import React, { useMemo, useState, useEffect } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";

/*
 * ProfitSankey — App Economy Insights–style revenue waterfall
 *
 * Revenue splits left→right through the income statement:
 *   Revenue → COGS + Gross Profit
 *   Gross Profit → R&D + SG&A + Other OpEx + Operating Income
 *   Operating Income → Other Inc/Exp + Taxes + Net Income
 *
 * Pure SVG, zero dependencies beyond React.
 */

// App Economy Insights palette: green = profit path, red = cost path,
// neutral slate for revenue (the trunk).
const COLORS = {
  revenue:   "#64748b", // neutral slate trunk
  cogs:      "#f87171", // red — cost
  gross:     "#4ade80", // green — profit
  rnd:       "#ef4444", // red — cost
  sga:       "#f87171", // red — cost
  otherOpex: "#fca5a5", // light red — cost
  opIncome:  "#22c55e", // green — profit
  otherNet:  "#fca5a5", // light red — other/cost
  taxes:     "#dc2626", // deep red — cost
  netIncome: "#16a34a", // deep green — bottom line
};

function fmtB(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtPct(part, whole) {
  if (!whole) return "";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/* ── curved link path from a source box right-edge to a target box left-edge ── */
function linkPath(x0, y0top, y0bot, x1, y1top, y1bot) {
  const mx = (x0 + x1) / 2;
  return `M${x0},${y0top} C${mx},${y0top} ${mx},${y1top} ${x1},${y1top} L${x1},${y1bot} C${mx},${y1bot} ${mx},${y0bot} ${x0},${y0bot} Z`;
}

export default function ProfitSankey({ data }) {
  // Last up to 5 fiscal years with real revenue, oldest → newest
  const years5 = (data?.inc || []).filter(x => x && x.revenue > 0).slice(-5);

  // selIdx === null means "latest"; reset when the ticker changes
  const [selIdx, setSelIdx] = useState(null);
  useEffect(() => { setSelIdx(null); }, [data?.symbol]);
  const effIdx = selIdx == null ? years5.length - 1 : Math.min(selIdx, years5.length - 1);
  const d = years5[effIdx] || null;
  const rev = d?.revenue || 0;

  const nodes = useMemo(() => {
    if (!d || rev <= 0) return null;
    const cogs = d.costOfRevenue || 0;
    const gross = d.grossProfit || (rev - cogs);
    const rnd = d.researchAndDevelopmentExpenses || 0;
    const sga = d.sellingGeneralAndAdministrativeExpenses || 0;
    const totalOpex = d.operatingExpenses || (rnd + sga);
    const otherOpex = Math.max(0, totalOpex - rnd - sga);
    const opIncome = d.operatingIncome || (gross - totalOpex);
    const otherNet = d.totalOtherIncomeExpensesNet || (d.incomeBeforeTax - opIncome) || 0;
    const taxes = d.incomeTaxExpense || 0;
    const netIncome = d.netIncome || 0;

    return { rev, cogs, gross, rnd, sga, otherOpex, opIncome, otherNet, taxes, netIncome };
  }, [d, rev]);

  // All hooks are above this line — safe to bail out now
  if (!years5.length || !nodes) return null;

  const { cogs, gross, rnd, sga, otherOpex, opIncome, otherNet, taxes, netIncome } = nodes;

  /* ── Layout: the profit rail (green) descends gently stage by stage so its
     ribbons bend like the red ones instead of reading as flat blocks; costs
     peel off and dive downward with real gaps — App Economy Insights style ── */
  const W = 900, H = 480;
  const PAD_TOP = 14;
  const BOTTOM = 18;
  const COL_X = [30, 250, 510, 730];
  const BOX_W = 16;
  const LABEL_GAP = 8;
  const GAP_MAIN = 34;  // separation between profit rail and cost cluster
  const GAP_SUB = 12;   // separation within a cost cluster
  const RS = 30;        // rail step: how far the green river drops each stage
  const usableH = H - PAD_TOP - BOTTOM - RS - GAP_MAIN;
  const scale = usableH / rev;

  const revH = rev * scale;
  const cogsH = cogs * scale, grossH = gross * scale;
  const rndH = rnd * scale, sgaH = sga * scale, otherOpexH = otherOpex * scale, opIncH = opIncome * scale;
  const otherNetAbs = Math.abs(otherNet);
  const otherNetH = otherNetAbs * scale, taxH = taxes * scale, niH = Math.abs(netIncome) * scale;

  /* Column 0 — revenue trunk */
  const c0y = PAD_TOP;

  /* Column 1 — gross profit continues the rail (dropped one step); COGS dives */
  const c1_gross_y = PAD_TOP + RS;
  const c1_cogs_y = c1_gross_y + grossH + GAP_MAIN;

  /* Column 2 — operating income on the rail (two steps down); opex fans out */
  const c2_opInc_y = PAD_TOP + 2 * RS;
  const c2_rnd_y = c2_opInc_y + opIncH + GAP_MAIN;
  const c2_sga_y = c2_rnd_y + (rnd > 0 ? rndH + GAP_SUB : 0);
  const c2_otherOpex_y = c2_sga_y + (sga > 0 ? sgaH + GAP_SUB : 0);

  /* Column 3 — net income finishes the rail (three steps down); other + taxes below */
  const c3_ni_y = PAD_TOP + 3 * RS;
  const c3_other_y = c3_ni_y + niH + GAP_MAIN;
  const c3_tax_y = c3_other_y + (otherNetAbs > 0 ? otherNetH + GAP_SUB : 0);

  /* Ribbons use horizontal gradients so each flow has a soft "current" sheen;
     the profit greens merge into one continuous river along the top rail. */
  const FLOW_GREEN = "url(#flow-green)", FLOW_RED = "url(#flow-red)";

  const links = [];
  const labels = [];

  function addLink(srcCol, srcYtop, srcYbot, dstCol, dstYtop, dstYbot, color, opacity = 0.5) {
    const x0 = COL_X[srcCol] + BOX_W;
    const x1 = COL_X[dstCol];
    links.push({ path: linkPath(x0, srcYtop, srcYbot, x1, dstYtop, dstYbot), color, opacity });
  }

  function addLabel(col, y, h, text, sub, color, side = "right") {
    const x = side === "right" ? COL_X[col] + BOX_W + LABEL_GAP : COL_X[col] - LABEL_GAP;
    const anchor = side === "right" ? "start" : "end";
    const cy = y + h / 2;
    labels.push({ x, cy, text, sub, color, anchor });
  }

  /* Revenue → Gross Profit (rail), then → COGS (dives) */
  let srcTracker = c0y;
  addLink(0, srcTracker, srcTracker + grossH, 1, c1_gross_y, c1_gross_y + grossH, FLOW_GREEN, 0.55);
  srcTracker += grossH;
  addLink(0, srcTracker, srcTracker + cogsH, 1, c1_cogs_y, c1_cogs_y + cogsH, FLOW_RED, 0.5);

  /* Gross Profit → Operating Income first (rail), then costs fan below */
  let gpTracker = c1_gross_y;
  addLink(1, gpTracker, gpTracker + opIncH, 2, c2_opInc_y, c2_opInc_y + opIncH, FLOW_GREEN, 0.55);
  gpTracker += opIncH;
  if (rnd > 0) { addLink(1, gpTracker, gpTracker + rndH, 2, c2_rnd_y, c2_rnd_y + rndH, FLOW_RED, 0.5); gpTracker += rndH; }
  if (sga > 0) { addLink(1, gpTracker, gpTracker + sgaH, 2, c2_sga_y, c2_sga_y + sgaH, FLOW_RED, 0.5); gpTracker += sgaH; }
  if (otherOpex > 0) { addLink(1, gpTracker, gpTracker + otherOpexH, 2, c2_otherOpex_y, c2_otherOpex_y + otherOpexH, FLOW_RED, 0.45); gpTracker += otherOpexH; }

  /* Operating Income → Net Income (rail), then other + taxes below */
  let opTracker = c2_opInc_y;
  addLink(2, opTracker, opTracker + niH, 3, c3_ni_y, c3_ni_y + niH, FLOW_GREEN, 0.6);
  opTracker += niH;
  if (otherNetAbs > 0) { addLink(2, opTracker, opTracker + otherNetH, 3, c3_other_y, c3_other_y + otherNetH, FLOW_RED, 0.45); opTracker += otherNetH; }
  if (taxes > 0) { addLink(2, opTracker, opTracker + taxH, 3, c3_tax_y, c3_tax_y + taxH, FLOW_RED, 0.5); }

  /* ── Build labels ── */
  addLabel(0, c0y, revH, "Revenue", fmtB(rev), "#94a3b8", "left");
  addLabel(1, c1_gross_y, grossH, "Gross Profit", `${fmtB(gross)}  (${fmtPct(gross, rev)})`, COLORS.gross);
  addLabel(1, c1_cogs_y, cogsH, "Cost of Revenue", `${fmtB(cogs)}  (${fmtPct(cogs, rev)})`, COLORS.cogs);
  addLabel(2, c2_opInc_y, opIncH, "Operating Income", `${fmtB(opIncome)}  (${fmtPct(opIncome, rev)})`, COLORS.opIncome);
  if (rnd > 0) addLabel(2, c2_rnd_y, rndH, "R&D", `${fmtB(rnd)}  (${fmtPct(rnd, rev)})`, COLORS.rnd);
  if (sga > 0) addLabel(2, c2_sga_y, sgaH, "SG&A", `${fmtB(sga)}  (${fmtPct(sga, rev)})`, COLORS.sga);
  if (otherOpex > 0) addLabel(2, c2_otherOpex_y, otherOpexH, "Other OpEx", `${fmtB(otherOpex)}  (${fmtPct(otherOpex, rev)})`, COLORS.otherOpex);
  addLabel(3, c3_ni_y, niH, "Net Income", `${fmtB(netIncome)}  (${fmtPct(netIncome, rev)})`, COLORS.netIncome);
  if (otherNetAbs > 0) addLabel(3, c3_other_y, otherNetH, otherNet < 0 ? "Other Expense" : "Other Income", `${fmtB(otherNet)}`, COLORS.otherNet);
  if (taxes > 0) addLabel(3, c3_tax_y, taxH, "Income Tax", `${fmtB(taxes)}  (${fmtPct(taxes, rev)})`, COLORS.taxes);

  /* ── Box definitions ── */
  const boxes = [
    { x: COL_X[0], y: c0y, h: revH, color: COLORS.revenue },
    { x: COL_X[1], y: c1_gross_y, h: grossH, color: COLORS.gross },
    { x: COL_X[1], y: c1_cogs_y, h: cogsH, color: COLORS.cogs },
    { x: COL_X[2], y: c2_opInc_y, h: opIncH, color: COLORS.opIncome },
    ...(rnd > 0 ? [{ x: COL_X[2], y: c2_rnd_y, h: rndH, color: COLORS.rnd }] : []),
    ...(sga > 0 ? [{ x: COL_X[2], y: c2_sga_y, h: sgaH, color: COLORS.sga }] : []),
    ...(otherOpex > 0 ? [{ x: COL_X[2], y: c2_otherOpex_y, h: otherOpexH, color: COLORS.otherOpex }] : []),
    { x: COL_X[3], y: c3_ni_y, h: niH, color: COLORS.netIncome },
    ...(otherNetAbs > 0 ? [{ x: COL_X[3], y: c3_other_y, h: otherNetH, color: COLORS.otherNet }] : []),
    ...(taxes > 0 ? [{ x: COL_X[3], y: c3_tax_y, h: taxH, color: COLORS.taxes }] : []),
  ];

  const fy = d.fiscalYear || d.date?.slice(0, 4) || "";

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 16px", marginBottom: 20, overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#818cf8", fontFamily: fonts.heading, letterSpacing: 0.3, textTransform: "uppercase" }}>
          Profitability Waterfall
        </span>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>FY{fy} · {data.symbol}</span>
        {years5.length > 1 && (
          <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
            {years5.map((yd, i) => {
              const lbl = yd.fiscalYear || yd.date?.slice(0, 4) || "";
              const active = i === effIdx;
              return (
                <button key={lbl + i} onClick={() => setSelIdx(i)} style={{
                  background: active ? "#818cf8" : "transparent",
                  border: `1px solid ${active ? "#818cf8" : "var(--border-subtle)"}`,
                  color: active ? "#0f172a" : "var(--text-secondary)",
                  padding: "4px 11px", fontSize: 11, fontWeight: 600, borderRadius: 7,
                  cursor: "pointer", fontFamily: fonts.mono,
                }}>{lbl}</button>
              );
            })}
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 470 }}>
        <defs>
          <linearGradient id="flow-green" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#bbf7d0" />
            <stop offset="100%" stopColor="#86efac" />
          </linearGradient>
          <linearGradient id="flow-red" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fecdd3" />
            <stop offset="100%" stopColor="#fca5a5" />
          </linearGradient>
        </defs>
        {/* Flows — solid pale bands so the profit rail reads as one river */}
        {links.map((l, i) => (
          <path key={`link-${i}`} d={l.path} fill={l.color} opacity={0.9} />
        ))}
        {/* Nodes — thin vivid bars that "pinch" the flows */}
        {boxes.map((b, i) => (
          <rect key={`box-${i}`} x={b.x} y={b.y} width={BOX_W} height={Math.max(b.h, 2)} rx={2} fill={b.color} />
        ))}
        {/* Labels */}
        {labels.map((lb, i) => (
          <g key={`label-${i}`}>
            <text x={lb.x} y={lb.cy - 5} textAnchor={lb.anchor} fill={lb.color} fontSize={11} fontWeight={600} fontFamily="DM Sans, sans-serif">{lb.text}</text>
            <text x={lb.x} y={lb.cy + 9} textAnchor={lb.anchor} fill="#94a3b8" fontSize={10} fontFamily="JetBrains Mono, monospace">{lb.sub}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
