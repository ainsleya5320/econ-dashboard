import React, { useMemo } from "react";
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

const COLORS = {
  revenue:   "#818cf8", // indigo
  cogs:      "#f87171", // red
  gross:     "#60a5fa", // blue
  rnd:       "#f97316", // orange
  sga:       "#a78bfa", // violet
  otherOpex: "#fb923c", // lighter orange
  opIncome:  "#34d399", // emerald
  otherNet:  "#fbbf24", // amber
  taxes:     "#f472b6", // pink
  netIncome: "#4ade80", // green
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
  const inc = data?.inc;
  if (!inc || !inc.length) return null;

  // Use most recent fiscal year
  const d = inc[inc.length - 1];
  const rev = d.revenue;
  if (!rev || rev <= 0) return null;

  const nodes = useMemo(() => {
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
  }, [d]);

  const { cogs, gross, rnd, sga, otherOpex, opIncome, otherNet, taxes, netIncome } = nodes;

  /* ── Layout constants ── */
  const W = 900, H = 420;
  const PAD_TOP = 10, PAD_BOT = 10;
  const COL_X = [30, 260, 520, 740]; // 4 columns
  const BOX_W = 14;
  const LABEL_GAP = 6;
  const usableH = H - PAD_TOP - PAD_BOT;

  /* px-per-dollar scale: revenue takes full usable height */
  const scale = usableH / rev;

  /* ── Column 0: Revenue ── */
  const c0y = PAD_TOP;
  const revH = rev * scale;

  /* ── Column 1: COGS (top), Gross Profit (bottom) ── */
  const cogsH = cogs * scale;
  const grossH = gross * scale;
  const c1_cogs_y = c0y;
  const c1_gross_y = c0y + cogsH + 4; // small gap

  /* ── Column 2: R&D, SG&A, Other OpEx (top), Operating Income (bottom) ── */
  // These come from Gross Profit, so position relative to gross profit's y range
  const rndH = rnd * scale;
  const sgaH = sga * scale;
  const otherOpexH = otherOpex * scale;
  const opIncH = opIncome * scale;
  const c2_rnd_y = c1_gross_y;
  const c2_sga_y = c2_rnd_y + rndH + 2;
  const c2_otherOpex_y = c2_sga_y + sgaH + 2;
  const c2_opInc_y = c2_otherOpex_y + (otherOpex > 0 ? otherOpexH + 2 : 0);

  /* ── Column 3: Other Inc/Exp, Taxes, Net Income — from Operating Income ── */
  const otherNetAbs = Math.abs(otherNet);
  const otherNetH = otherNetAbs * scale;
  const taxH = taxes * scale;
  const niH = Math.abs(netIncome) * scale;
  const c3_other_y = c2_opInc_y;
  const c3_tax_y = c3_other_y + (otherNetAbs > 0 ? otherNetH + 2 : 0);
  const c3_ni_y = c3_tax_y + taxH + 2;

  /* ── Helper to build link + label data ── */
  const links = [];
  const labels = [];

  function addLink(srcCol, srcYtop, srcYbot, dstCol, dstYtop, dstYbot, color, opacity = 0.35) {
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

  /* ── Build links (left edge of source to right edge) ── */
  // Revenue → COGS
  let srcTracker = c0y;
  addLink(0, srcTracker, srcTracker + cogsH, 1, c1_cogs_y, c1_cogs_y + cogsH, COLORS.cogs);
  srcTracker += cogsH;
  // Revenue → Gross Profit
  addLink(0, srcTracker, srcTracker + grossH, 1, c1_gross_y, c1_gross_y + grossH, COLORS.gross);

  // Gross Profit → R&D
  let gpTracker = c1_gross_y;
  if (rnd > 0) {
    addLink(1, gpTracker, gpTracker + rndH, 2, c2_rnd_y, c2_rnd_y + rndH, COLORS.rnd);
    gpTracker += rndH;
  }
  // Gross Profit → SG&A
  if (sga > 0) {
    addLink(1, gpTracker, gpTracker + sgaH, 2, c2_sga_y, c2_sga_y + sgaH, COLORS.sga);
    gpTracker += sgaH;
  }
  // Gross Profit → Other OpEx
  if (otherOpex > 0) {
    addLink(1, gpTracker, gpTracker + otherOpexH, 2, c2_otherOpex_y, c2_otherOpex_y + otherOpexH, COLORS.otherOpex);
    gpTracker += otherOpexH;
  }
  // Gross Profit → Operating Income
  addLink(1, gpTracker, gpTracker + opIncH, 2, c2_opInc_y, c2_opInc_y + opIncH, COLORS.opIncome);

  // Operating Income → Other Net
  let opTracker = c2_opInc_y;
  if (otherNetAbs > 0) {
    addLink(2, opTracker, opTracker + otherNetH, 3, c3_other_y, c3_other_y + otherNetH, COLORS.otherNet);
    opTracker += otherNetH;
  }
  // Operating Income → Taxes
  if (taxes > 0) {
    addLink(2, opTracker, opTracker + taxH, 3, c3_tax_y, c3_tax_y + taxH, COLORS.taxes);
    opTracker += taxH;
  }
  // Operating Income → Net Income
  addLink(2, opTracker, opTracker + niH, 3, c3_ni_y, c3_ni_y + niH, COLORS.netIncome, 0.45);

  /* ── Build labels ── */
  addLabel(0, c0y, revH, "Revenue", fmtB(rev), COLORS.revenue, "left");
  addLabel(1, c1_cogs_y, cogsH, "Cost of Revenue", `${fmtB(cogs)}  (${fmtPct(cogs, rev)})`, COLORS.cogs);
  addLabel(1, c1_gross_y, grossH, "Gross Profit", `${fmtB(gross)}  (${fmtPct(gross, rev)})`, COLORS.gross);
  if (rnd > 0) addLabel(2, c2_rnd_y, rndH, "R&D", `${fmtB(rnd)}  (${fmtPct(rnd, rev)})`, COLORS.rnd);
  if (sga > 0) addLabel(2, c2_sga_y, sgaH, "SG&A", `${fmtB(sga)}  (${fmtPct(sga, rev)})`, COLORS.sga);
  if (otherOpex > 0) addLabel(2, c2_otherOpex_y, otherOpexH, "Other OpEx", `${fmtB(otherOpex)}  (${fmtPct(otherOpex, rev)})`, COLORS.otherOpex);
  addLabel(2, c2_opInc_y, opIncH, "Operating Income", `${fmtB(opIncome)}  (${fmtPct(opIncome, rev)})`, COLORS.opIncome);
  if (otherNetAbs > 0) addLabel(3, c3_other_y, otherNetH, otherNet < 0 ? "Other Expense" : "Other Income", `${fmtB(otherNet)}`, COLORS.otherNet);
  if (taxes > 0) addLabel(3, c3_tax_y, taxH, "Income Tax", `${fmtB(taxes)}  (${fmtPct(taxes, rev)})`, COLORS.taxes);
  addLabel(3, c3_ni_y, niH, "Net Income", `${fmtB(netIncome)}  (${fmtPct(netIncome, rev)})`, COLORS.netIncome);

  /* ── Box definitions ── */
  const boxes = [
    { x: COL_X[0], y: c0y, h: revH, color: COLORS.revenue },
    { x: COL_X[1], y: c1_cogs_y, h: cogsH, color: COLORS.cogs },
    { x: COL_X[1], y: c1_gross_y, h: grossH, color: COLORS.gross },
    ...(rnd > 0 ? [{ x: COL_X[2], y: c2_rnd_y, h: rndH, color: COLORS.rnd }] : []),
    ...(sga > 0 ? [{ x: COL_X[2], y: c2_sga_y, h: sgaH, color: COLORS.sga }] : []),
    ...(otherOpex > 0 ? [{ x: COL_X[2], y: c2_otherOpex_y, h: otherOpexH, color: COLORS.otherOpex }] : []),
    { x: COL_X[2], y: c2_opInc_y, h: opIncH, color: COLORS.opIncome },
    ...(otherNetAbs > 0 ? [{ x: COL_X[3], y: c3_other_y, h: otherNetH, color: COLORS.otherNet }] : []),
    ...(taxes > 0 ? [{ x: COL_X[3], y: c3_tax_y, h: taxH, color: COLORS.taxes }] : []),
    { x: COL_X[3], y: c3_ni_y, h: niH, color: COLORS.netIncome },
  ];

  const fy = d.fiscalYear || d.date?.slice(0, 4) || "";

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 16px", marginBottom: 20, overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#818cf8", fontFamily: fonts.heading, letterSpacing: 0.3, textTransform: "uppercase" }}>
          Profitability Waterfall
        </span>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>FY{fy} · {data.symbol}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 440 }}>
        {/* Links */}
        {links.map((l, i) => (
          <path key={`link-${i}`} d={l.path} fill={l.color} opacity={l.opacity} />
        ))}
        {/* Boxes */}
        {boxes.map((b, i) => (
          <rect key={`box-${i}`} x={b.x} y={b.y} width={BOX_W} height={Math.max(b.h, 2)} rx={3} fill={b.color} opacity={0.9} />
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
