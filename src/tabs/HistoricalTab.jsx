import React, { useEffect, useState } from "react";
import { fonts } from "../lib/styles.js";
import HistoricalReturnsTab from "./HistoricalReturnsTab.jsx";
import LongRates from "./history/LongRates.jsx";
import LongInflation from "./history/LongInflation.jsx";
import LongGrowth from "./history/LongGrowth.jsx";

// ============================================================================
// HISTORICAL — the long view. Asset returns since 1928 (Damodaran), and
// interest rates, inflation and growth back a century and more
// (src/tabs/history/, served by /api/long-run). The U.S. Economy tabs carry
// the recent detail; these sections are for perspective.
// ============================================================================

const SECTIONS = [["returns", "Asset returns"], ["rates", "Interest rates"], ["inflation", "Inflation"], ["growth", "Growth"]];
const KEY = "history:section";

export default function HistoricalTab() {
  const [section, setSection] = useState(() => { try { const s = localStorage.getItem(KEY); return SECTIONS.some(x => x[0] === s) ? s : "rates"; } catch { return "rates"; } });
  useEffect(() => { try { localStorage.setItem(KEY, section); } catch { /* private window */ } }, [section]);
  return (<>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 16 }} role="tablist" aria-label="Historical sections">
      {SECTIONS.map(([id, text]) => (
        <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)} style={{
          flex: "1 1 auto", padding: "8px 10px", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: fonts.heading, fontSize: 12,
          background: section === id ? "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(99,102,241,0.1))" : "transparent",
          color: section === id ? "var(--tab-active-color)" : "var(--tab-inactive-color)", fontWeight: section === id ? 600 : 400,
          borderBottom: section === id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{text}</button>
      ))}
    </div>
    {section === "returns" && <HistoricalReturnsTab />}
    {section === "rates" && <LongRates />}
    {section === "inflation" && <LongInflation />}
    {section === "growth" && <LongGrowth />}
  </>);
}
