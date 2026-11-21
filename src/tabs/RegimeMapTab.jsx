import React, { useEffect, useState } from "react";
import SubViews from "../components/SubViews.jsx";
import { DenseHeader } from "../components/dense.jsx";
import FourMarkets from "./FourMarkets.jsx";
import RegimeAnalogs from "./RegimeAnalogs.jsx";

// ============================================================================
// REGIME MAP — Today → Regime Map: what kind of market this is, read two ways.
//   Four markets  stocks, bonds, currencies and commodities read together in
//                 the manner Druckenmiller describes: the liquidity × growth
//                 regime, clarity and stance, each market's chart read and
//                 instruments, the yield-curve regime, the Fed turn, the
//                 momentum leaderboard and the playbook (FourMarkets.jsx)
//   Analogs       when has the market looked like this before: the similarity
//                 map, the closest periods and what followed (RegimeAnalogs.jsx)
// The Cockpit carries a one-card summary of both (RegimeSummary.jsx) that links
// here; ?view=regime&sub=markets|analogs lands on a view. The view is owned by
// App.jsx so the Cockpit's links can choose it.
// ============================================================================

export const REGIME_VIEWS = ["markets", "analogs"];

export default function RegimeMapTab({ view, onView }) {
  const [erp, setErp] = useState(null);
  // the Cockpit's valuation lens, so the stance can be read beside "am I paid to own stocks?"
  useEffect(() => { let live = true; fetch("/api/erp").then(r => (r.ok ? r.json() : null)).then(j => { if (live && j && !j.error) setErp(j); }).catch(() => {}); return () => { live = false; }; }, []);
  return (
    <div>
      <DenseHeader
        eyebrow="Regime map · what kind of market is this?"
        headline="Two reads of the same question: where the four markets say we are, and when it has looked like this before."
        blurb="Four markets scores liquidity and growth from stocks, bonds, currencies and commodities and turns the agreement between them into a stance; it also labels the yield curve and asks, in a selloff, whether the Fed is blinking. Analogs compares the past 13 weeks with every 13-week window in the record and shows what followed the closest ones. Both describe the present; neither is a forecast, and each prints its own record."
        meta={<>weekly, with the latest close · FRED and FMP<br />rules and thresholds are this dashboard's</>}
      />
      <SubViews view={view} onChange={onView} views={[
        { id: "markets", label: "Four markets", hint: "regime, stance, yield curve, Fed turn, leaderboard, playbook", render: () => <FourMarkets erp={erp} /> },
        { id: "analogs", label: "Analogs", hint: "when has the market looked like this before, and what followed", render: () => <RegimeAnalogs /> },
      ]} />
    </div>
  );
}
