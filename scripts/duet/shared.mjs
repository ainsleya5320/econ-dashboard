// What scripts/duet/snapshot.mjs, build-page.mjs and the page's shim.js must
// agree on: how a request becomes a lookup key, and which FRED chunk holds a
// series. shim.js repeats both in plain browser JavaScript; change them together.

export const FRED_CHUNKS = 24

// query parameters that change nothing in a saved copy
export const IGNORED_PARAMS = ['refresh', 'auto', 'api_key', 'file_type', '_', 't']

export function routeKey(u) {
  const url = new URL(u, 'http://x')
  const ps = []
  url.searchParams.forEach((v, k) => { if (!IGNORED_PARAMS.includes(k)) ps.push(`${k}=${v}`) })
  ps.sort()
  return url.pathname.replace(/\/+$/, '') + (ps.length ? '?' + ps.join('&') : '')
}

export function fredChunk(id) {
  let x = 0
  for (let i = 0; i < id.length; i++) x = (Math.imul(x, 31) + id.charCodeAt(i)) >>> 0
  return x % FRED_CHUNKS
}
