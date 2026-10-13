# Server data modules

Back to the [master map](../../CLAUDE.md).

## Projects
- [vite.config.js](../../vite.config.js): the whole back end: dev-server middleware for every /api route, inline feeds (FRED relay, S&P screener, fear & greed, AI usage, memory prices …), proxies for CBOE, FRED, OpenRouter, Zillow, CFTC, and the /api/chat assistant (Anthropic SDK)
- [server/](../../server): one module per feed, each `createX({ dir, keys })` with memory, disk and rebuild caching
- [server/usPulse.js](../../server/usPulse.js): U.S. Economy landing feed (~50 FRED series, leading indicators, consumer, debt)
- [server/intlPulse.js](../../server/intlPulse.js): International landing feed (13 economies, Big Mac index)
- [server/fxFundamentals.js](../../server/fxFundamentals.js): FX valuation, PPP and central-bank stance for 14 currencies
- [server/tradeFlows.js](../../server/tradeFlows.js): tariffs, pass-through and dollar invoicing (/api/trade-flows)
- [server/machine.js](../../server/machine.js): Dalio "economic machine" tracker from FRED
- [server/tightening.js](../../server/tightening.js): bond-market tightening monitor (FRED and Treasury FiscalData)
- [server/damodaranErp.js](../../server/damodaranErp.js): Damodaran monthly implied ERP workbook reader
- [server/commodityPulse.js](../../server/commodityPulse.js): 15 commodity contracts, real-price fair value, CFTC positioning
- [server/aiPulse.js](../../server/aiPulse.js): AI Economy landing feed: token tracker, Artificial Analysis, GPU rentals
- [server/gpuEconomics.js](../../server/gpuEconomics.js): GPU-hour cost vs revenue by generation (InferenceX)
- [server/intelligencePerMw.js](../../server/intelligencePerMw.js): intelligence per megawatt: Artificial Analysis score × InferenceX tokens per provisioned MW, frontier-class models (/api/intelligence-mw)
- [server/tokenEstimates.js](../../server/tokenEstimates.js): bounding OpenAI and Anthropic token volume four ways
- [server/tokenSpot.js](../../server/tokenSpot.js): $/token derived from GPU rental prices
- [server/capexReturns.js](../../server/capexReturns.js): AI capex returns on capital from SEC XBRL
- [server/householdWealth.js](../../server/householdWealth.js): Distributional Financial Accounts wealth by percentile
- [server/ownerWealth.js](../../server/ownerWealth.js): IRS SOI state tables, the business-owner wealth question
- [server/realEstateFeeds.js](../../server/realEstateFeeds.js): Redfin, FRED pipeline, rents, build costs, CRE credit, Kastle
- [server/marketMap.js](../../server/marketMap.js): Real Estate → Market Map: states, metros and counties from Zillow and Realtor.com joined to the annual seed (/api/market-map)
- [server/marketMapSeed.js](../../server/marketMapSeed.js): builds that annual seed from Census (SAIPE, ACS, estimates, permits, CBSA) and Realtor.com's 2017–19 baseline
- [server/longRun.js](../../server/longRun.js): Historical tab → interest rates, inflation and growth back a century and more: the long-run seed joined to FRED (/api/long-run)
- [server/longRunSeed.js](../../server/longRunSeed.js): builds that seed from Shiller, Jordà–Schularick–Taylor, the Bank of England millennium dataset, Schmelzing and the Minneapolis Fed CPI
- [server/metroComparison.js](../../server/metroComparison.js): metro housing stock, permits and rents joined
- [server/metroEmployment.js](../../server/metroEmployment.js): BLS CES metro employment by industry
- [server/localMarketData.js](../../server/localMarketData.js): Census ACS and Zillow parsers for local markets
- [server/rentalConcessions.js](../../server/rentalConcessions.js): Zillow rent-report concession parser
- [server/municipalities.js](../../server/municipalities.js): one metro at a time: labor, housing, WARN notices
- [server/bankruptcy.js](../../server/bankruptcy.js): U.S. Courts F-2 tables, CM/ECF feeds, CourtListener, 8-K Item 1.03
- [server/specialSituations.js](../../server/specialSituations.js): spinoffs, mergers, tenders, insider buys from SEC EDGAR and FMP
- [server/specialScore.js](../../server/specialScore.js): 0-100 score for special-situation ideas
- [server/accountingFlags.js](../../server/accountingFlags.js): the stock page's Accounting tab, filings half: restatements, auditor changes, late filings, weaknesses, comment letters, Friday-night 8-Ks and footnote lines from EDGAR, per company (/api/accounting-flags)
- [server/sinMonitor.js](../../server/sinMonitor.js): Stocks → Sin & Folly: serves the sin-monitor seed and rebuilds its recent years weekly in the background (/api/sin-monitor)
- [server/sinMonitorSeed.js](../../server/sinMonitorSeed.js): builds that seed from SEC XBRL frames (the 500 largest non-financial 10-K filers since 2010) and EDGAR full-text counts since 2001
- [server/follyMarkets.js](../../server/follyMarkets.js): Stocks → Sin & Folly, the market half: Shiller CAPE, FRED margin loans, Ritter IPOs, the S&P 500 street-vs-GAAP gap (FMP, seed only) and the folly/sin/reckoning gauge (/api/folly-markets)
- [server/tensions/](../../server/tensions): AI Economy → Tensions and U.S. Economy → Tensions: index.js is the engine (/api/tensions?domain=ai|economy, 1h cache, daily history); lib.js the shared arithmetic (formatting, grading, Kalshi strike ladders; editing it needs a dev-server restart); aiCapexPath.js the one yearly path for SemiAnalysis's $11.1T that the AI revenue and AI power checks share; checks/ one module per check, each saying which board it belongs to. A check sets what independent sources claim side by side and grades the gap: consistent, tension or contradiction. The return shape is documented in index.js and ai-financing.js is the reference check
- [server/predictionMarkets.js](../../server/predictionMarkets.js): read-only Kalshi and Polymarket client for the Tensions checks (15-minute cache, no keys)
- [server/newsDesk/](../../server/newsDesk): the News Desk (/api/news-desk, /news-clip). index.js is the integrator: routes, the refresh cycle, the clip window and bookmarklet, and the this-computer-only guard on the routes that spend or write; feeds.js the WSJ, NYT and Economist RSS, Seeking Alpha write-ups (per-ticker feeds and Editors' Picks; links only, never deep-read from the headline), FMP stock news and SEC filings; profile.js the watchlist, categories and Tensions checks the news is read against; store.js the item store; analyzer.js Claude's triage, deep reads and daily brief; budget.js the hard daily cap on Claude spending. Each file's header documents its part
- [server/peopleScreener.js](../../server/peopleScreener.js): S&P 500 revenue and profit per employee (FMP)
- [server/optionsContext.js](../../server/optionsContext.js): earnings and dividend events for the options views
- [server/sfcModel.js](../../server/sfcModel.js): serves the SFC model JSON to the SFC Model tab

## State
- [.env.example](../../.env.example): key names; the real `.env` also takes ANTHROPIC_API_KEY, EIA_API_KEY, ARTIFICIAL_ANALYSIS_KEY
- [.env](../../.env): API keys, gitignored; every key is optional and its feed degrades without it. NEWS_DAILY_BUDGET_USD sets the News Desk's daily Claude cap (default 2)
- [fred-cache.json](../../fred-cache.json): shared FRED observation cache (gitignored)
- [tickers.json](../../tickers.json): the saved watchlist behind /api/tickers (gitignored)
- [special-dealbook.json](../../special-dealbook.json): the personal Deal Book behind /api/special-dealbook (gitignored)
- News Desk state at the root, gitignored because it names the watchlist: `news-desk.json` (items and Claude's reads), `news-desk-meta.json` (the brief, feed health, the last run), `news-usage.json` (Claude spend per day), `news-profile.json` (company names and CIKs; other names for a company go in its `aliases` list)
- Other feed caches (us-pulse.json, redfin.json, gpu-economics.json, accounting-flags.json, sin-monitor.json, folly-markets.json, intelligence-mw-cache.json …) are gitignored; see [.gitignore](../../.gitignore)
- Tracked archives these modules append to: [data snapshots](data.md)

## Skills
- `npm run dev`: start the dev server, which is also the API server (port 5180 or `$PORT`)
- `curl localhost:5180/api/tickers`: cheap health check (reads a local file, no upstream calls)
- `curl "localhost:5180/api/news-desk?auto=0"`: the News Desk payload without starting a refresh

## Memory
- The header comment of each server/ module documents its sources, scores and cache TTLs

## Routines
Each feed rebuilds on request once its TTL (2h to 30 days) expires. The one timer is the News Desk's: it refreshes hourly, but only while the desk has been opened on this computer in the past 24 hours; between midnight and 5 am it only scores, and briefs follow the clock (after 6 am, noon and 4 pm) (server/newsDesk/index.js).

## Not here
- The tabs that render these feeds: [front end](front-end.md)
- The tracked JSON archives: [data snapshots](data.md)
- The Python model that writes data/sfc/: [SFC model](sfc.md)
- The emailed special-situations digest: [scripts and automation](operations.md)
