import { useEffect, useState } from "react";

// One shared copy of /api/options-market for the Market view, the ranges-at-a-glance grid and the
// Strategies screener: a single request in flight, re-polled every 15 s while the server is still
// building its first scan (or refreshing), otherwise every 5 minutes while any view is mounted.

let state = { data: null, error: null };
let inflight = null, timer = null, last = 0;
const subs = new Set();

function emit() { for (const f of subs) f(state); }

function load() {
  if (inflight) return inflight;
  inflight = fetch("/api/options-market")
    .then(r => r.json())
    .then(j => { state = j?.error ? { ...state, error: j.error } : { data: j, error: null }; })
    .catch(e => { state = { ...state, error: e?.message || "unavailable" }; })
    .finally(() => {
      inflight = null; last = Date.now(); emit();
      clearTimeout(timer);
      const building = !state.data?.scanBuilt || state.data?.refreshing;
      if (subs.size) timer = setTimeout(load, building ? 15000 : 5 * 60000);
    });
  return inflight;
}

export function useOptionsMarket() {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    if (!state.data || Date.now() - last > 5 * 60000) load(); else setS(state);
    return () => { subs.delete(setS); if (!subs.size) clearTimeout(timer); };
  }, []);
  return s;
}
