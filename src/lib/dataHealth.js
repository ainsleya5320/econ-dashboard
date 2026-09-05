export function formatDateLabel(dateLike) {
  if (!dateLike) return "No date";
  const date = typeof dateLike === "number" ? new Date(dateLike) : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return String(dateLike);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function getFreshness(dateLike, { staleDays = 45 } = {}) {
  if (!dateLike) return { label: "No date", tone: "unknown", ageDays: null };
  const date = typeof dateLike === "number" ? new Date(dateLike) : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return { label: String(dateLike), tone: "unknown", ageDays: null };
  const ageDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  const tone = ageDays > staleDays ? "stale" : "fresh";
  return { label: formatDateLabel(date), tone, ageDays };
}

export function collectLatestDate(records) {
  const dates = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.lastDate) dates.push(value.lastDate);
    if (value.d) dates.push(value.d);
    if (Array.isArray(value.history) && value.history.length) {
      const last = value.history[value.history.length - 1];
      if (last?.d) dates.push(last.d);
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(records);
  return dates.sort().at(-1) || null;
}

export function sourceStatus({ label, date, loading = false, error = false, live = true, staleDays = 45 }) {
  const freshness = getFreshness(date, { staleDays });
  let tone = freshness.tone;
  if (error) tone = "error";
  else if (loading) tone = "loading";
  else if (!live) tone = "sample";
  return { label, date, loading, error, live, staleDays, freshness, tone };
}

export const toneColor = {
  fresh: "#10B981",
  stale: "#F59E0B",
  loading: "#F59E0B",
  sample: "#F59E0B",
  error: "#EF4444",
  unknown: "#64748b",
};
