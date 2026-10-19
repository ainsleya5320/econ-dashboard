// ============================================================================
// GPU HYPERSCALERS: what AWS and Azure list for a GPU-hour, spot, on-demand
// and reserved, per GPU (instance or VM price ÷ its GPUs).
//   aws spot      website.spot.ec2.aws.a2z.com/spot.json (~2.9 MB): the feed
//                 behind AWS's Spot pricing page, one Linux price per instance
//                 type per region (local zones included; AWS does not say which
//                 zone the regional figure is). As of = its Last-Modified. (The
//                 older spot.js has been frozen since 2024; not used.)
//   aws on-demand b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/
//                 ec2-ondemand-without-sec-sel/{Location}/Linux/index.json
//                 (~0.6-0.7 MB each) for US East (N. Virginia), US East (Ohio),
//                 US West (Oregon), EU (Ireland) and Asia Pacific (Tokyo): Linux,
//                 no pre-installed software, shared tenancy. AWS's location name
//                 for Ireland is "EU (Ireland)" ("Europe (Ireland)" is a 404).
//                 As of = the manifest's hawkFilePublicationDate.
//   instances     p5.48xlarge 8×H100, p5.4xlarge 1×H100 (listed with slice: true
//                 and left out of byGpu), p5e.48xlarge and p5en.48xlarge 8×H200,
//                 p6-b200.48xlarge 8×B200, p6-b300.48xlarge 8×B300,
//                 p6e-gb200.36xlarge 4×B200 (GB200), p4d.24xlarge 8×A100 40GB,
//                 p4de.24xlarge 8×A100 80GB (GPU counts from AWS's accelerated
//                 computing instance specs, Oct 2026). A type absent from both
//                 feeds is named in aws.missing; any other p-family type the
//                 feeds list is named in aws.unmapped.
//   azure         prices.azure.com/api/retail/prices (keyless OData), one query
//                 for the VMs Standard_ND96isr_H100_v5 (8×H100),
//                 Standard_ND96isr_H200_v5 (8×H200), Standard_ND128isr_NDR_GB200_v6
//                 (4×GB200), Standard_ND96isr_MI300X_v5 (8×MI300X) and
//                 Standard_ND96amsr_A100_v4 (8×A100 80GB), NextPageLink followed.
//                 Linux only (Windows product names dropped), USD, US Gov regions
//                 dropped. Consumption meters: plain = on-demand, "Spot" = spot,
//                 "Low Priority" = low priority; Reservation 1 Year / 3 Years
//                 unitPrice is the total for the term, so ÷ 8,760 or 26,280 hours.
//                 Units: unitPrice is per VM-hour ("1 Hour" for the whole VM):
//                 ND96isr_H100_v5 is $98.32/hour in eastus, $12.29 per GPU-hour.
//                 Azure lists a "Spot" meter at the on-demand price for some SKUs
//                 (H200 and GB200 in Oct 2026): a region's spot counts only when it
//                 is under 97% of that region's on-demand, and spotIsReal is false
//                 for a SKU with no such region (its spot is null, not a fake
//                 discount).
// Summary: per instance or SKU, medians across regions (AWS on-demand per GPU is
// us-east-1, else the first of the five regions listed). byGpu pools the
// full-node instance types of a GPU: AWS spot min and median per GPU over every
// region of every type, on-demand the cheapest type's us-east-1 price, the
// median spot ÷ on-demand ratio; Azure the SKU's medians. Null where absent.
// Prices are list prices, before negotiated discounts and savings plans.
// Cadence: stale-while-revalidate. A GET answers from the cache at once and
// refreshes in the background when it is over 6 hours old; the first GET with no
// cache waits (about 4 s). A failed refresh is not retried for 15 minutes.
// 7 requests a refresh (1 spot, 5 on-demand, 1 Azure page), browser user agent.
// A source that fails keeps its last extract for up to 3 days (named in
// sourceErrors), then is null; never a throw once anything is cached.
// Files:
//   gpu-hyperscalers.json                 (root, gitignored) the full response
//                                         plus each source's last extract
//   data/ai/gpu-hyperscalers-daily.json   (tracked; public list prices) one row
//                                         per UTC day per provider per GPU,
//                                         one row per line, the day's last
//                                         refresh wins; rows only from fresh
//                                         (not carried) data. Never written over
//                                         when it cannot be read; written through
//                                         a data/ai/*.tmp-*.json temp (gitignored).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const SPOT_URL = 'https://website.spot.ec2.aws.a2z.com/spot.json'
const OD_URL = loc => `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${encodeURIComponent(loc)}/Linux/index.json`
const AZURE_URL = 'https://prices.azure.com/api/retail/prices'
const AWS_TYPES = {
  'p5.48xlarge': ['H100', 8], 'p5.4xlarge': ['H100', 1, true], 'p5e.48xlarge': ['H200', 8], 'p5en.48xlarge': ['H200', 8],
  'p6-b200.48xlarge': ['B200', 8], 'p6-b300.48xlarge': ['B300', 8], 'p6e-gb200.36xlarge': ['GB200', 4],
  'p4d.24xlarge': ['A100', 8], 'p4de.24xlarge': ['A100', 8],
}
const OD_REGIONS = [['US East (N. Virginia)', 'us-east-1'], ['US East (Ohio)', 'us-east-2'], ['US West (Oregon)', 'us-west-2'], ['EU (Ireland)', 'eu-west-1'], ['Asia Pacific (Tokyo)', 'ap-northeast-1']]
const AZURE_SKUS = [
  ['Standard_ND96isr_H100_v5', 'H100', 8], ['Standard_ND96isr_H200_v5', 'H200', 8], ['Standard_ND128isr_NDR_GB200_v6', 'GB200', 4],
  ['Standard_ND96isr_MI300X_v5', 'MI300X', 8], ['Standard_ND96amsr_A100_v4', 'A100', 8],
]
const GPUS = ['H100', 'H200', 'B200', 'B300', 'GB200', 'MI300X', 'A100']
const NEW_P = /^(p([4-9]|\d{2})|u-p\d)/ // p4 and later GPU families (p2/p3 are retired-generation and ignored)
const TERM_HOURS = { '1 Year': 8760, '3 Years': 26280 }
const H = 3600e3, TTL = 6 * H, RETRY = 15 * 60e3, CARRY = 72 * H, REAL_SPOT = 0.97
const ARCHIVE_REL = 'data/ai/gpu-hyperscalers-daily.json'

const fin = v => v != null && Number.isFinite(v)
const r3 = v => (fin(v) ? Math.round(v * 1000) / 1000 : null), r4 = v => (fin(v) ? Math.round(v * 1e4) / 1e4 : null)
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const minOf = xs => { const v = xs.filter(fin); return v.length ? Math.min(...v) : null }
const iso = s => { const t = Date.parse(s || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function readStrict(file) {
  try { return { data: JSON.parse(fs.readFileSync(file, 'utf8')) } } catch (e) { return e?.code === 'ENOENT' ? { missing: true } : { error: e.message } }
}

export function createGpuHyperscalers({ UA, dir }) {
  const CACHE = path.join(dir, 'gpu-hyperscalers.json'), ARCHIVE = path.join(dir, ...ARCHIVE_REL.split('/'))
  let mem = null, inflight = null, lastFail = 0, lastError = null, archiveBroken = null

  async function fetchJson(url, ms = 30_000) {
    for (let a = 1; ; a++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, */*' }, signal: AbortSignal.timeout(ms) })
        if (r.ok) return { json: await r.json(), headers: r.headers }
        r.body?.cancel().catch(() => {})
        const err = new Error(`HTTP ${r.status}`); err.status = r.status
        if (a >= 2 || r.status < 500) throw err
      } catch (e) {
        if (e.status || a >= 2) throw e.name === 'TimeoutError' ? new Error('timed out') : e
      }
      await sleep(1500)
    }
  }

  // ── sources: each returns a small extract ──
  async function awsSpot() {
    const { json, headers } = await fetchJson(SPOT_URL, 60_000)
    const prices = {}, unmapped = new Set()
    for (const reg of json?.config?.regions || []) {
      for (const it of reg.instanceTypes || []) for (const s of it.sizes || []) {
        const type = s.size
        if (!AWS_TYPES[type]) { if (NEW_P.test(type || '')) unmapped.add(type); continue }
        const v = Number(s.valueColumns?.find(c => c.name === 'linux')?.prices?.USD)
        if (fin(v) && v > 0) ((prices[type] ||= {})[reg.region] ??= v) // a type listed twice in a region (p4de) keeps the first
      }
    }
    if (!Object.keys(prices).length) throw new Error('no GPU instance prices in spot.json')
    return { at: new Date().toISOString(), asOf: iso(headers.get('last-modified')), prices, unmapped: [...unmapped].sort() }
  }
  async function awsOnDemand(prev, errors) {
    const prices = {}, regions = {}, unmapped = new Set()
    let asOf = null
    await Promise.all(OD_REGIONS.map(async ([loc, code]) => {
      try {
        const { json } = await fetchJson(OD_URL(loc))
        const items = Object.values(json?.regions?.[loc] || {})
        if (!items.length) throw new Error('no prices listed')
        for (const v of items) {
          const type = v['Instance Type']
          if (v['Operating System'] !== 'Linux' || (v['Pre Installed S/W'] && v['Pre Installed S/W'] !== 'NA')) continue
          if (!AWS_TYPES[type]) { if (NEW_P.test(type || '')) unmapped.add(type); continue }
          const p = Number(v.price)
          if (fin(p) && p > 0) (prices[type] ||= {})[code] = p
        }
        const pub = iso(json?.manifest?.hawkFilePublicationDate)
        if (pub && (!asOf || pub > asOf)) asOf = pub
        regions[code] = new Date().toISOString()
      } catch (e) {
        // keep the last extract of this region while it is under 3 days old
        const kept = prev?.regions?.[code] && Date.now() - Date.parse(prev.regions[code]) < CARRY
        if (kept) { regions[code] = prev.regions[code]; for (const [t, by] of Object.entries(prev.prices || {})) if (fin(by[code])) (prices[t] ||= {})[code] = by[code] }
        errors.push({ source: `AWS on-demand ${loc}`, error: `${e.message}${kept ? `; kept the copy from ${prev.regions[code].slice(0, 10)}` : ''}` })
      }
    }))
    if (!Object.keys(regions).length) throw new Error('no on-demand region could be read')
    return { at: new Date().toISOString(), asOf: asOf || prev?.asOf || null, prices, regions, unmapped: [...unmapped].sort() }
  }
  async function azure() {
    const filter = `serviceName eq 'Virtual Machines' and (${AZURE_SKUS.map(([s]) => `armSkuName eq '${s}'`).join(' or ')}) and (priceType eq 'Consumption' or priceType eq 'Reservation')`
    let url = `${AZURE_URL}?$filter=${encodeURIComponent(filter)}`, pages = 0
    const rows = []
    while (url && pages < 10) {
      const { json } = await fetchJson(url)
      pages++
      for (const i of json?.Items || []) {
        if (i.currencyCode !== 'USD' || /Windows/i.test(i.productName || '') || /^usgov|^usdod/i.test(i.armRegionName || '')) continue
        const kind = i.type === 'Reservation' ? (i.reservationTerm === '1 Year' ? 'r1y' : i.reservationTerm === '3 Years' ? 'r3y' : null)
          : i.type === 'Consumption' ? (/\bSpot\b/i.test(i.meterName || '') ? 'spot' : /Low Priority/i.test(i.meterName || '') ? 'low' : 'od') : null
        if (!kind || !fin(i.unitPrice) || i.unitPrice <= 0 || !/hour/i.test(i.unitOfMeasure || '')) continue
        const vmHour = kind === 'r1y' || kind === 'r3y' ? i.unitPrice / TERM_HOURS[i.reservationTerm] : i.unitPrice
        rows.push({ sku: i.armSkuName, region: i.armRegionName, kind, vmHour, eff: (i.effectiveStartDate || '').slice(0, 10) })
      }
      url = json?.NextPageLink || null
    }
    if (!rows.length) throw new Error('no prices returned')
    return { at: new Date().toISOString(), asOf: new Date().toISOString(), pages, rows }
  }

  // ── the payload ──
  function buildAws(spot, od) {
    if (!spot && !od) return null
    const types = Object.keys(AWS_TYPES).filter(t => spot?.prices?.[t] || od?.prices?.[t])
    const instances = types.map(type => {
      const [gpu, gpus, slice] = AWS_TYPES[type]
      const sp = spot?.prices?.[type] || {}, op = od?.prices?.[type] || {}
      const regions = [...new Set([...Object.keys(sp), ...Object.keys(op)])].sort().map(region => {
        const s = sp[region] ?? null, o = op[region] ?? null
        return { region, spot: s, onDemand: o, spotPerGpu: r3(fin(s) ? s / gpus : null), odPerGpu: r3(fin(o) ? o / gpus : null), ratio: fin(s) && fin(o) ? r3(s / o) : null }
      })
      const odRegion = fin(op['us-east-1']) ? 'us-east-1' : OD_REGIONS.map(r => r[1]).find(c => fin(op[c])) || null
      return {
        type, gpu, gpus, ...(slice ? { slice: true } : {}), regions,
        spotPerGpuMin: r3(minOf(regions.map(r => r.spotPerGpu))), spotPerGpuMedian: r3(median(regions.map(r => r.spotPerGpu))),
        odPerGpu: odRegion ? r3(op[odRegion] / gpus) : null, odRegion,
      }
    })
    return {
      spotAsOf: spot?.asOf || null, onDemandAsOf: od?.asOf || null, instances,
      missing: Object.keys(AWS_TYPES).filter(t => !types.includes(t)),
      unmapped: [...new Set([...(spot?.unmapped || []), ...(od?.unmapped || [])])].sort(),
    }
  }
  function buildAzure(az) {
    if (!az) return null
    const skus = AZURE_SKUS.map(([sku, gpu, gpus]) => {
      const mine = az.rows.filter(r => r.sku === sku)
      if (!mine.length) return null
      // per region and kind, the meter with the latest effective date
      const at = new Map()
      for (const r of mine) { const k = `${r.region}|${r.kind}`, o = at.get(k); if (!o || r.eff > o.eff) at.set(k, r) }
      const get = (region, kind) => at.get(`${region}|${kind}`)?.vmHour ?? null
      const regions = [...new Set(mine.map(r => r.region))].sort().map(region => {
        const od = get(region, 'od'), sp = get(region, 'spot')
        const realSpot = fin(sp) && (!fin(od) || sp < REAL_SPOT * od)
        const per = v => r3(fin(v) ? v / gpus : null)
        return { region, odPerGpu: per(od), spotPerGpu: realSpot ? per(sp) : null, lowPerGpu: per(get(region, 'low')), r1yPerGpu: per(get(region, 'r1y')), r3yPerGpu: per(get(region, 'r3y')), ...(fin(sp) && !realSpot ? { spotAtOd: true } : {}) }
      }).filter(r => [r.odPerGpu, r.spotPerGpu, r.lowPerGpu, r.r1yPerGpu, r.r3yPerGpu].some(fin))
      const med = k => r3(median(regions.map(r => r[k])))
      return {
        sku, gpu, gpus, spotIsReal: regions.some(r => fin(r.spotPerGpu)), regions,
        odPerGpuMedian: med('odPerGpu'), spotPerGpuMedian: med('spotPerGpu'), r1yPerGpuMedian: med('r1yPerGpu'), r3yPerGpuMedian: med('r3yPerGpu'),
        priceChanged: mine.reduce((m, r) => (r.eff > m ? r.eff : m), '') || null,
      }
    }).filter(Boolean)
    return { asOf: az.asOf, skus }
  }
  function buildByGpu(aws, az) {
    return Object.fromEntries(GPUS.map(g => {
      const ins = (aws?.instances || []).filter(i => i.gpu === g && !i.slice), regs = ins.flatMap(i => i.regions)
      const sku = (az?.skus || []).find(s => s.gpu === g)
      return [g, {
        awsSpotMin: r3(minOf(regs.map(r => r.spotPerGpu))), awsSpotMedian: r3(median(regs.map(r => r.spotPerGpu))),
        awsOd: r3(minOf(ins.map(i => i.odPerGpu))), awsRatioMedian: r3(median(regs.map(r => r.ratio))),
        azureOd: sku?.odPerGpuMedian ?? null, azureSpot: sku?.spotPerGpuMedian ?? null, azure1y: sku?.r1yPerGpuMedian ?? null, azure3y: sku?.r3yPerGpuMedian ?? null,
        // for the archive: the cheapest real Azure spot region
        _azureSpotMin: sku ? r3(minOf(sku.regions.map(r => r.spotPerGpu))) : null,
      }]
    }))
  }

  // ── the daily archive (tracked) ──
  function updateArchive(byGpu, fresh) {
    const st = readStrict(ARCHIVE)
    if (st.error || (st.data && !Array.isArray(st.data.rows))) {
      archiveBroken = `${ARCHIVE_REL} could not be read (${st.error || 'no rows'}); it is not written until it is fixed`
      console.warn(`GPU hyperscalers: ${archiveBroken}`)
      return null
    }
    archiveBroken = null
    const rows = st.data?.rows || []
    const d = new Date().toISOString().slice(0, 10)
    const keep = new Map(rows.map(r => [`${r.d}|${r.provider}|${r.gpu}`, r]))
    for (const g of GPUS) {
      const b = byGpu[g]
      const add = row => { if ([row.spotMin, row.spotMedian, row.od, row.r1y, row.r3y].some(fin)) keep.set(`${d}|${row.provider}|${g}`, row) }
      if (fresh.aws) add({ d, provider: 'aws', gpu: g, spotMin: b.awsSpotMin, spotMedian: b.awsSpotMedian, od: b.awsOd, r1y: null, r3y: null })
      if (fresh.azure) add({ d, provider: 'azure', gpu: g, spotMin: b._azureSpotMin, spotMedian: b.azureSpot, od: b.azureOd, r1y: b.azure1y, r3y: b.azure3y })
    }
    const rank = g => GPUS.indexOf(g)
    const out = [...keep.values()].sort((a, b) => a.d.localeCompare(b.d) || a.provider.localeCompare(b.provider) || rank(a.gpu) - rank(b.gpu))
    const head = {
      source: 'AWS (website.spot.ec2.aws.a2z.com/spot.json; b0.p.awsstatic.com on-demand price maps) and Azure Retail Prices (prices.azure.com) public list prices, USD per GPU-hour; built by server/gpuHyperscalers.js',
      fields: 'd = UTC day of the refresh (the last of the day wins); spotMin, spotMedian = cheapest and median spot across regions (AWS: full-node instance types pooled; Azure: regions whose spot is under 97% of on-demand, else null); od = AWS us-east-1 on-demand of the cheapest full-node type, Azure median on-demand across regions; r1y, r3y = Azure 1- and 3-year reservation median, per hour',
    }
    const text = `{${Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')},\n"rows":[\n${out.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`
    const tmp = path.join(dir, 'data', 'ai', `gpu-hyperscalers-daily.tmp-${process.pid}.json`) // matches the /data/ai/*.tmp-*.json ignore
    try { fs.mkdirSync(path.dirname(ARCHIVE), { recursive: true }); fs.writeFileSync(tmp, text); fs.renameSync(tmp, ARCHIVE) } catch (e) { console.warn(`GPU hyperscalers: archive not written (${e.message})`); try { fs.unlinkSync(tmp) } catch {} }
    return out
  }
  function readArchiveRows() {
    const st = readStrict(ARCHIVE)
    return Array.isArray(st.data?.rows) ? st.data.rows : []
  }

  function loadCache() {
    if (mem) return mem
    const st = readStrict(CACHE)
    if (st.data?.built) mem = st.data
    return mem
  }

  async function refresh() {
    const t0 = Date.now(), errors = [], prev = loadCache()?.raw || {}
    const carry = (name, old, e) => {
      const ok = old?.at && Date.now() - Date.parse(old.at) < CARRY
      errors.push({ source: name, error: `${e.message}${ok ? `; showing the copy from ${old.at.slice(0, 16).replace('T', ' ')} UTC` : ''}` })
      return ok ? old : null
    }
    const [spot, od, az] = await Promise.all([
      awsSpot().then(v => ({ v, fresh: true }), e => ({ v: carry('AWS spot', prev.awsSpot, e) })),
      awsOnDemand(prev.awsOd, errors).then(v => ({ v, fresh: true }), e => ({ v: carry('AWS on-demand', prev.awsOd, e) })),
      azure().then(v => ({ v, fresh: true }), e => ({ v: carry('Azure retail prices', prev.azure, e) })),
    ])
    if (!spot.v && !od.v && !az.v) throw new Error(errors.map(e => `${e.source}: ${e.error}`).join('; '))
    const aws = buildAws(spot.v, od.v), azureBlock = buildAzure(az.v)
    if (!aws) errors.push({ source: 'AWS', error: 'no AWS prices' })
    if (!azureBlock) errors.push({ source: 'Azure', error: 'no Azure prices' })
    const byGpuFull = buildByGpu(aws, azureBlock)
    const archived = updateArchive(byGpuFull, { aws: !!(spot.fresh && aws), azure: !!(az.fresh && azureBlock) })
    const byGpu = Object.fromEntries(Object.entries(byGpuFull).map(([g, { _azureSpotMin, ...b }]) => [g, b]))
    const missing = aws?.missing?.length ? ` AWS lists no spot or on-demand price for ${aws.missing.join(', ')}${aws.missing.includes('p6e-gb200.36xlarge') ? ' (GB200 is sold as UltraServers through capacity blocks)' : ''}.` : ''
    const fakeSpot = (azureBlock?.skus || []).filter(s => !s.spotIsReal).map(s => s.gpu)
    const next = {
      built: new Date().toISOString(), stale: false, sourceErrors: errors, aws, azure: azureBlock, byGpu,
      history: archived || readArchiveRows(),
      note: `List prices in USD per GPU-hour (instance or VM price ÷ its GPUs), Linux, before negotiated discounts and savings plans. AWS spot is one price per region from AWS's Spot pricing page (local zones included); spot ÷ on-demand ratios exist only for the five regions whose on-demand prices are read (us-east-1, us-east-2, us-west-2, eu-west-1, ap-northeast-1).${missing} Azure prices are per VM-hour in the source (ND96isr H100 v5: $98.32/hour in eastus = $12.29 per GPU-hour); reservations are the term total spread over its hours; US Gov regions are left out.${fakeSpot.length ? ` Azure lists a Spot meter at the on-demand price for ${fakeSpot.join(' and ')}: no real spot discount, so spot is shown as none.` : ''} A100 on AWS pools p4d (40GB) and p4de (80GB); on Azure it is the 80GB ND96amsr A100 v4. GB200 on Azure is the 4-GPU ND128isr NDR GB200 v6 VM.`,
      ms: Date.now() - t0,
      raw: { awsSpot: spot.v, awsOd: od.v, azure: az.v },
    }
    mem = next
    try { fs.writeFileSync(CACHE, JSON.stringify(next)) } catch (e) { console.warn(`GPU hyperscalers: cache not written (${e.message})`) }
    return next
  }

  function startRefresh() {
    if (inflight || Date.now() - lastFail < RETRY) return inflight
    inflight = refresh()
      .then(v => { lastError = null; return v })
      .catch(e => { lastFail = Date.now(); lastError = e.message; console.warn(`GPU hyperscalers: refresh failed: ${e.message}`); return null })
      .finally(() => { inflight = null })
    return inflight
  }

  async function get() {
    let c = loadCache()
    if (!c) { await startRefresh(); c = loadCache() }
    else if (Date.now() - Date.parse(c.built) > TTL) startRefresh()
    if (!c) {
      return {
        built: null, stale: true, sourceErrors: [{ source: 'refresh', error: lastError || 'no data yet' }], aws: null, azure: null,
        byGpu: Object.fromEntries(GPUS.map(g => [g, { awsSpotMin: null, awsSpotMedian: null, awsOd: null, awsRatioMedian: null, azureOd: null, azureSpot: null, azure1y: null, azure3y: null }])),
        history: readArchiveRows(), note: null, refreshing: !!inflight,
      }
    }
    const { raw, ...out } = c
    out.sourceErrors = [...(out.sourceErrors || [])]
    if (lastError) out.sourceErrors.push({ source: 'refresh', error: lastError })
    if (archiveBroken) out.sourceErrors.push({ source: 'archive', error: archiveBroken })
    out.stale = Date.now() - Date.parse(c.built) > TTL || !!lastError || out.sourceErrors.length > 0
    out.refreshing = !!inflight
    return out
  }

  return { get }
}
