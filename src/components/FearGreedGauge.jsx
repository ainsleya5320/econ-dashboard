import React, { useState, useEffect } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";

// Classification thresholds → colors
const zoneColor = (score) => {
  if (score == null) return "#64748b";
  if (score < 25) return "#DC2626"; // Extreme Fear - red
  if (score < 45) return "#F97316"; // Fear - orange
  if (score < 55) return "#EAB308"; // Neutral - yellow
  if (score < 75) return "#84CC16"; // Greed - lime
  return "#16A34A";                  // Extreme Greed - green
};

const zoneLabel = (score) => {
  if (score == null) return "—";
  if (score < 25) return "Extreme Fear";
  if (score < 45) return "Fear";
  if (score < 55) return "Neutral";
  if (score < 75) return "Greed";
  return "Extreme Greed";
};

/* Semi-circular gauge, needle pointing to composite score 0–100 */
function SemiGauge({ score }) {
  const safeScore = score ?? 50;
  // Needle angle: -90° (score 0, hard left) to +90° (score 100, hard right)
  const angle = (safeScore / 100) * 180 - 90;

  // Color stops for the arc
  const stops = [
    { pct: 0, color: "#DC2626" },
    { pct: 25, color: "#F97316" },
    { pct: 45, color: "#EAB308" },
    { pct: 55, color: "#84CC16" },
    { pct: 100, color: "#16A34A" },
  ];

  // Generate arc path segments
  const cx = 100, cy = 100, r = 80;
  const arcs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const startAngle = (stops[i].pct / 100) * 180 - 180;  // -180 to 0
    const endAngle = (stops[i + 1].pct / 100) * 180 - 180;
    const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180);
    const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180);
    const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180);
    const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180);
    arcs.push({
      d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`,
      color: stops[i + 1].color,
    });
  }

  const needleAngle = (angle + 90 - 90) * (Math.PI / 180);  // convert to radians; -90 is left
  const needleX = cx + (r - 10) * Math.cos(((safeScore / 100) * 180 - 180) * (Math.PI / 180));
  const needleY = cy + (r - 10) * Math.sin(((safeScore / 100) * 180 - 180) * (Math.PI / 180));

  return (
    <svg width="220" height="130" viewBox="0 0 200 120" style={{ overflow: "visible" }}>
      {/* Arc background (darker) */}
      <path
        d={`M 20 100 A 80 80 0 0 1 180 100`}
        fill="none"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth="16"
        strokeLinecap="round"
      />
      {/* Colored arcs */}
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth="14" strokeLinecap="round" opacity="0.9" />
      ))}
      {/* Tick marks at each zone boundary */}
      {[0, 25, 45, 55, 75, 100].map((pct, i) => {
        const a = (pct / 100) * 180 - 180;
        const x1 = cx + (r - 8) * Math.cos((a * Math.PI) / 180);
        const y1 = cy + (r - 8) * Math.sin((a * Math.PI) / 180);
        const x2 = cx + (r + 8) * Math.cos((a * Math.PI) / 180);
        const y2 = cy + (r + 8) * Math.sin((a * Math.PI) / 180);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />;
      })}
      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={needleX}
        y2={needleY}
        stroke={zoneColor(score)}
        strokeWidth="3"
        strokeLinecap="round"
        style={{ transition: "all 0.6s ease" }}
      />
      <circle cx={cx} cy={cy} r="6" fill={zoneColor(score)} />
      <circle cx={cx} cy={cy} r="3" fill="#0f172a" />
    </svg>
  );
}

/* Mini component bar */
function ComponentRow({ label, score, detail }) {
  const color = zoneColor(score);
  const pct = score ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <div style={{ flex: "0 0 170px", fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 3,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <div style={{ flex: "0 0 40px", fontSize: 10, fontWeight: 600, color, fontFamily: fonts.mono, textAlign: "right" }}>
        {score != null ? Math.round(score) : "—"}
      </div>
      <div style={{ flex: "0 0 220px", fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, textAlign: "right" }}>
        {detail}
      </div>
    </div>
  );
}

function FearGreedGauge() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/fear-greed")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error("Fear&Greed error:", e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>Loading Fear & Greed composite...</div>
      </div>
    );
  }
  if (!data || data.composite == null) {
    return (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#F59E0B", fontFamily: fonts.mono }}>Fear & Greed data unavailable.</div>
      </div>
    );
  }

  const color = zoneColor(data.composite);
  const components = data.components || {};
  const order = ["vix", "momentum", "safeHaven", "junkBond", "breadth"];

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "center" }}>
        {/* Left: Gauge + composite score */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
            Market Sentiment
          </div>
          <SemiGauge score={data.composite} />
          <div style={{ fontSize: 36, fontWeight: 700, color, fontFamily: fonts.heading, lineHeight: 1, marginTop: -8 }}>
            {data.composite}
          </div>
          <div style={{ fontSize: 12, color, fontFamily: fonts.heading, fontWeight: 600, marginTop: 2, letterSpacing: 0.5, textTransform: "uppercase" }}>
            {data.classification}
          </div>
          <div style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 6 }}>
            0 = Extreme Fear · 100 = Extreme Greed
          </div>
        </div>

        {/* Right: Component breakdown */}
        <div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
            Component Breakdown
          </div>
          {order.map(key => {
            const c = components[key];
            if (!c) return null;
            return <ComponentRow key={key} label={c.label} score={c.score} detail={c.detail} />;
          })}
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
            Equal-weighted composite of VIX, SPY momentum, safe-haven flow, high-yield credit spreads, and market breadth. Updated every 15 min.
          </div>
        </div>
      </div>
    </div>
  );
}

export default FearGreedGauge;
