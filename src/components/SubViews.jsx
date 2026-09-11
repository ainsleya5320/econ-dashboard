import React from "react";
import { fonts } from "../lib/styles.js";

// A row of view pills under a sub-tab, for tabs that fold several former pages
// into one: Regional (metros / states), Growth (activity / profits), Credit
// (corporate / banks / defaults), Rates & Fed, Machine (Dalio / stock-flow).
// Controlled: the hub owns the active view so Pulse drill-downs can land on a
// specific view, and the choice survives switching tabs and back.
export default function SubViews({ views, view, onChange, accent = "#818cf8" }) {
  const active = views.find(v => v.id === view) || views[0];
  return (<>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
      {views.map(v => {
        const on = v.id === active.id;
        return (
          <button key={v.id} onClick={() => onChange(v.id)} style={{
            padding: "4px 12px", borderRadius: 999, cursor: "pointer",
            background: on ? `${accent}22` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? accent : "rgba(255,255,255,0.08)"}`,
            color: on ? "#e2e8f0" : "#64748b", fontFamily: fonts.heading, fontSize: 11.5, fontWeight: on ? 600 : 400, whiteSpace: "nowrap",
          }}>{v.label}</button>
        );
      })}
      {active.hint && <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginLeft: 6 }}>{active.hint}</span>}
    </div>
    {active.render()}
  </>);
}
