import React, { useState } from "react";
import { fonts } from "../lib/styles.js";

export default function NewsTicker({ items, loading }) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(null);

  if (loading) {
    return (
      <div style={{ height: 38, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", paddingLeft: 14 }}>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, letterSpacing: 1 }}>LOADING NEWS...</span>
      </div>
    );
  }

  if (!items?.length) return null;

  // Duplicate for seamless looping
  const doubled = [...items, ...items];
  const duration = Math.max(60, items.length * 5);

  const handleClick = (item) => {
    setSelected(prev => prev?.url === item.url ? null : item);
  };

  const fmtAge = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  };

  return (
    <>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-headline:hover { color: #93c5fd !important; }
      `}</style>

      {/* Ticker bar */}
      <div style={{ display: "flex", alignItems: "center", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginBottom: selected ? 8 : 16, overflow: "hidden", height: 38, position: "relative" }}>

        {/* NEWS badge */}
        <div style={{ flexShrink: 0, padding: "0 14px", height: "100%", display: "flex", alignItems: "center", background: "linear-gradient(135deg, #2563eb, #4f46e5)", fontSize: 9, fontWeight: 700, color: "#fff", letterSpacing: 2, fontFamily: fonts.mono, zIndex: 2 }}>
          NEWS
        </div>

        {/* Left fade */}
        <div style={{ position: "absolute", left: 60, width: 32, height: "100%", background: "linear-gradient(to right, #0c0f1a, transparent)", zIndex: 1, pointerEvents: "none" }} />

        {/* Scrolling strip */}
        <div
          style={{ overflow: "hidden", flex: 1, height: "100%", cursor: "default" }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div style={{
            display: "flex", alignItems: "center", height: "100%", whiteSpace: "nowrap",
            animation: `ticker-scroll ${duration}s linear infinite`,
            animationPlayState: paused ? "paused" : "running",
          }}>
            {doubled.map((item, i) => (
              <span
                key={i}
                className="ticker-headline"
                onClick={() => handleClick(item)}
                style={{
                  padding: "0 24px",
                  fontSize: 11,
                  color: selected?.url === item.url ? "#93c5fd" : "#cbd5e1",
                  fontFamily: fonts.heading,
                  borderRight: "1px solid rgba(255,255,255,0.05)",
                  cursor: "pointer",
                  transition: "color 0.15s",
                  userSelect: "none",
                }}
              >
                {item.site && (
                  <span style={{ color: "#4b5563", marginRight: 8, fontSize: 9, fontFamily: fonts.mono, letterSpacing: 0.5 }}>
                    {item.site.toUpperCase()}
                  </span>
                )}
                {item.title}
              </span>
            ))}
          </div>
        </div>

        {/* Right fade */}
        <div style={{ position: "absolute", right: 0, width: 40, height: "100%", background: "linear-gradient(to left, #0c0f1a, transparent)", zIndex: 1, pointerEvents: "none" }} />
      </div>

      {/* Expanded article panel */}
      {selected && (
        <div style={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "16px 20px", marginBottom: 16, position: "relative", animation: "none" }}>
          <button
            onClick={() => setSelected(null)}
            style={{ position: "absolute", top: 10, right: 14, background: "none", border: "none", color: "#475569", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 0 }}
            aria-label="Close"
          >×</button>

          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {selected.image && (
              <img
                src={selected.image}
                alt=""
                onError={e => { e.target.style.display = "none"; }}
                style={{ width: 130, height: 80, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid rgba(255,255,255,0.07)" }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {selected.site}{selected.site && selected.publishedDate ? " · " : ""}{fmtAge(selected.publishedDate)}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", fontFamily: fonts.heading, marginBottom: 8, lineHeight: 1.45 }}>
                {selected.title}
              </div>
              {selected.text && (
                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.65, marginBottom: 12 }}>
                  {selected.text.length > 320 ? selected.text.slice(0, 320) + "…" : selected.text}
                </div>
              )}
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ fontSize: 11, color: "#3b82f6", fontFamily: fonts.mono, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                Read full story →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
