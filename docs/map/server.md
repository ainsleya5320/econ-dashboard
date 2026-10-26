# Server data modules

Back to the [master map](../../CLAUDE.md).

## Projects
- [vite.config.js](../../vite.config.js): the whole back end: dev-server middleware for every /api route, inline feeds (FRED relay, S&P screener, fear & greed, AI usage, memory prices …), proxies for CBOE, FRED, OpenRouter, Zillow, CFTC, and the /api/chat assistant (Anthropic SDK)
- [server/](../../server): one module per feed, each `createX({ dir, keys })` with memory, disk and rebuild caching
- [server/usPulse.js](../../server/usPulse.js): U.S. Economy landing feed (~50 FRED series, leading indicators, consumer, debt)
- [server/intlPulse.js](../../server/intlPulse.js): International landing feed (13 economies, Big Mac index)
- [server/policyRates.js](../../server/policyRates.js): BIS central bank policy rates (~40 banks, monthly history, daily latest) — /api/policy-rates and the base layer of /api/cb-rates (vite.config.js), which the pulse and Forex read
- [server/worldEconomy.js](../../server/worldEconomy.js): /api/world-economy — IMF WEO, World Bank WLD, BIS (total credit, world house prices, central-bank assets, debt securities, USD FX), IMF COFER, CPB World Trade Monitor, nine economies' broad money (FRED, ECB, Eastmoney, BoJ, BoE, SNB, BoC, RBA, BCB), VT nowcast, Savills/UBS anchors; rewrites its tracked seed when IMF/COFER data change
- [server/oilMarket.js](../../server/oilMarket.js): /api/oil-market — EIA API v2 (spot prices, frozen NYMEX futures to Apr 2024, weekly stocks/supply/demand/utilization, monthly production by state, STEO) and CME WTI/Brent settlement curves with a daily archive (personal use; gitignored cache only)
- [server/cotReport.js](../../server/cotReport.js): /api/cot-report — CFTC Disaggregated (kh3c-gbw2) and Traders in Financial Futures (yw9f-hn96) combined reports for 35 markets plus Yahoo weekly prices; COT index, flows, price/OI quadrant, top-4 concentration, forward-return backtest
- [server/aiBuildout.js](../../server/aiBuildout.js): /api/ai-buildout — funding loop vs productivity scoring: SEC XBRL (capex, OCF, debt proceeds, backlog, finance-lease adds) for the capexReturns hyperscalers, Census construction (data centers) and BTOS, SF Fed TFP, BEA via FRED, plus the Dark Output and AI pulse feeds; rules and hand inputs in data/ai-tracker/ (see docs/ai-tracker.md)
- [server/magicFormula.js](../../server/magicFormula.js): Greenblatt's Magic Formula across all U.S. stocks: the FMP screener universe (daily) and each company's quarterly income statements and balance sheet, fetched in the background at 150 requests a minute, pausing when FMP refuses (a cold build takes about 35 minutes, then a company is refetched when a new quarter should be out); ranked at four market-value floors; one fetch loop per process across dev-server restarts
- [server/ideas.js](../../server/ideas.js): /api/ideas, the Ideas page's three buckets: Magic Formula stocks, special situations (the scorer's A and B grades plus open odd-lot tenders) and fixed-income rules (FRED curve, TIPS, ICE BofA spreads, mortgage rates; bond closed-end fund discounts). `?symbol=` looks up one stock's rank, `?only=stocks` returns the stock bucket alone. Rules only, no model; see [docs/ideas.md](../ideas.md)
- [server/onePager.js](../../server/onePager.js): /api/ideas/onepager, Claude Opus 5.5 one-pagers for the Ideas page (web search and fetch, a strict submit tool, sources checked against what the searches returned); its own daily cap through newsDesk/budget.js; see [docs/ideas.md](../ideas.md)
- [server/treasuryBonds.js](../../server/treasuryBonds.js): /api/treasury-bonds, Income → Bonds: every marketable Treasury from TreasuryDirect FedInvest end-of-day prices (a session-and-CSRF form; the table needs a same-site Referer) and TreasuryDirect auction results: yields, duration, DV01, a Svensson curve, rich / cheap against neighbouring issues, TIPS breakevens, on-the-runs, auctions graded against the six before
- [server/fxFundamentals.js](../../server/fxFundamentals.js): FX valuation, PPP and central-bank stance for 14 currencies
- [server/tradeFlows.js](../../server/tradeFlows.js): tariffs, pass-through and dollar invoicing (/api/trade-flows)
- [server/machine.js](../../server/machine.js): Dalio "economic machine" tracker from FRED
- [server/tightening.js](../../server/tightening.js): bond-market tightening monitor (FRED and Treasury FiscalData)
- [server/damodaranErp.js](../../server/damodaranErp.js): Damodaran monthly implied ERP workbook reader
- [server/commodityPulse.js](../../server/commodityPulse.js): 15 commodity contracts, real-price fair value, CFTC positioning
- [server/aiPulse.js](../../server/aiPulse.js): AI Economy landing feed: token tracker, Artificial Analysis, GPU rentals
- [server/gpuEconomics.js](../../server/gpuEconomics.js): GPU-hour cost vs revenue by generation (InferenceX)
- [server/gpuFutures.js](../../server/gpuFutures.js): CME Silicon Data H100/B200 rental-index futures settlements, archived daily in the gitignored gpu-futures.json (CME terms: personal use; CME serves only ~5 trade days, so a timer reads it every 3 hours)
- [server/gpuHyperscalers.js](../../server/gpuHyperscalers.js): AWS spot (spot.json) vs on-demand (price maps) and Azure spot/list/1- and 3-year reserved, per GPU-hour
- [server/gpuMarketData.js](../../server/gpuMarketData.js): Shadeform availability across ~18 clouds, GetDeploying weekly price history (CC BY 4.0), AmCompute used-GPU resale index
- [server/nebiusSpot.js](../../server/nebiusSpot.js): Nebius preemptible (spot) GPU prices by market from its public billing API, 30 days hourly (the API limit), floor/ceiling states since market pricing began (2026-10-08), and the daily archive
- [server/intelligencePerMw.js](../../server/intelligencePerMw.js): intelligence per megawatt: Artificial Analysis score × InferenceX tokens per provisioned MW, frontier-class models (/api/intelligence-mw)
- [server/tokenEstimates.js](../../server/tokenEstimates.js): bounding OpenAI and Anthropic token volume four ways
- [server/tokenSpot.js](../../server/tokenSpot.js): $/token derived from GPU rental prices
- [server/capexReturns.js](../../server/capexReturns.js): AI capex returns on capital from SEC XBRL
- [server/householdWealth.js](../../server/householdWealth.js): Distributional Financial Accounts wealth by percentile
- [server/ownerWealth.js](../../server/ownerWealth.js): IRS SOI state tables, the business-owner wealth question
- [server/realEstateFeeds.js](../../server/realEstateFeeds.js): Redfin, FRED pipeline, rents, build costs, CRE credit, Kastle
- [server/globalHousing.js](../../server/globalHousing.js): Real Estate → Global: BIS residential property prices (~60 countries), OECD price-to-income and price-to-rent vs long-run average, BIS household credit and debt service, BIS commercial property prices (~20 economies, one curated headline each)
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
- [server/shareOfWorld.js](../../server/shareOfWorld.js): assets and countries as a share of world GDP in USD (IMF WEO, World Bank market caps, Damodaran annual returns), with tracked seeds in data/seeds/
- [server/topCompanyGdp.js](../../server/topCompanyGdp.js): the most valuable US company ÷ US GDP since 1984 (FMP daily market caps, spin-off-corrected; FRED GDP)
- [server/chinaMonitor.js](../../server/chinaMonitor.js): China objective (manufacturing, technology) vs cost (housing, households) series
- [server/darkOutput.js](../../server/darkOutput.js): dark-output fingerprints: BLS jobs vs pay in AI-exposed industries, Indeed postings, New York Fed recent grads, Census QSS revenue vs PPI, labor share, productivity, software investment
- [server/specialSituations.js](../../server/specialSituations.js): spinoffs, mergers, tenders, odd-lot tenders (priority clause read from the Offer to Purchase, fund tenders valued with cefDiscounts.lookup), post-reorganisation equity (reorgEvents/reorgCase: each 8-K dated by what it says happened, never by its filing date), insider buys from SEC EDGAR and FMP; tickerEvents() feeds the closed-end fund screener. EDGAR full-text search: name the root form only ('SC TO-I' includes its amendments; 'SC TO-I,SC TO-I/A' returns amendments only)
- [server/specialScore.js](../../server/specialScore.js): 0-100 score for special-situation ideas
- [server/accountingFlags.js](../../server/accountingFlags.js): the stock page's Accounting tab, filings half: restatements, auditor changes, late filings, weaknesses, comment letters, Friday-night 8-Ks and footnote lines from EDGAR, per company (/api/accounting-flags)
- [server/sinMonitor.js](../../server/sinMonitor.js): Stocks → Sin & Folly: serves the sin-monitor seed and rebuilds its recent years weekly in the background (/api/sin-monitor)
- [server/sinMonitorSeed.js](../../server/sinMonitorSeed.js): builds that seed from SEC XBRL frames (the 500 largest non-financial 10-K filers since 2010) and EDGAR full-text counts since 2001
- [server/follyMarkets.js](../../server/follyMarkets.js): Stocks → Sin & Folly, the market half: Shiller CAPE, FRED margin loans, Ritter IPOs, the S&P 500 street-vs-GAAP gap (FMP, seed only) and the folly/sin/reckoning gauge (/api/folly-markets)
- [server/tensions/](../../server/tensions): AI Economy → Tensions and U.S. Economy → Tensions: index.js is the engine (/api/tensions?domain=ai|economy, 1h cache, daily history); lib.js the shared arithmetic (formatting, grading, Kalshi strike ladders; editing it needs a dev-server restart); aiCapexPath.js the one yearly path for SemiAnalysis's $11.1T that the AI revenue and AI power checks share; checks/ one module per check, each saying which board it belongs to. A check sets what independent sources claim side by side and grades the gap: consistent, tension or contradiction. The return shape is documented in index.js and ai-financing.js is the reference check
- [server/predictionMarkets.js](../../server/predictionMarkets.js): read-only Kalshi and Polymarket client for the Tensions checks (15-minute cache, no keys)
- [server/newsDesk/](../../server/newsDesk): the News Desk (/api/news-desk, /news-clip). index.js is the integrator: routes, the refresh cycle, the clip window and bookmarklet, and the this-computer-only guard on the routes that spend or write; feeds.js the WSJ, NYT and Economist RSS, Seeking Alpha write-ups (per-ticker feeds and Editors' Picks; links only, never deep-read from the headline), FMP stock news and SEC filings; profile.js the watchlist, categories and Tensions checks the news is read against; store.js the item store; analyzer.js Claude's triage, deep reads and daily brief; budget.js the hard daily cap on Claude spending. xposts.js reads write-ups shared on X for the cashtags in the gitignored news-x.json (X_BEARER_TOKEN in .env), under a monthly cap kept in the gitignored news-x-state.json. Each file's header documents its part
- [server/peopleScreener.js](../../server/peopleScreener.js): S&P 500 revenue and profit per employee (FMP)
- [server/optionsContext.js](../../server/optionsContext.js): earnings and dividend events for the options views
- [server/optionsMarket.js](../../server/optionsMarket.js): Options → Market: Cboe volatility indices and the VIX term structure, put/call ratios, and an implied-volatility, skew and activity scan of index, macro and sector ETFs, the 15 largest stocks and the watchlist, with unusual activity (/api/options-market, stale-while-revalidate every 30 minutes)
- [server/cefDiscounts.js](../../server/cefDiscounts.js): closed-end fund discounts from CEFConnect: screener rows (same-day discount, z-scores, own five-year percentile, distribution rate, coverage, return of capital), the weekly cross-section of discounts, month-by-month seasonality and a monthly panel for the in-browser backtest; backfills five years of weekly price/NAV and distributions in the background (/api/cef and /api/cef?fund=, stale-while-revalidate every 6 hours)
- [server/sfcModel.js](../../server/sfcModel.js): serves the SFC model JSON to the SFC Model tab

## State
- [.env.example](../../.env.example): key names; the real `.env` also takes ANTHROPIC_API_KEY, EIA_API_KEY, ARTIFICIAL_ANALYSIS_KEY
- [.env](../../.env): API keys, gitignored; every key is optional and its feed degrades without it. NEWS_DAILY_BUDGET_USD sets the News Desk's daily Claude cap (default 2), IDEAS_DAILY_BUDGET_USD the Ideas one-pagers' (default 5)
- [fred-cache.json](../../fred-cache.json): shared FRED observation cache (gitignored)
- [tickers.json](../../tickers.json): the saved watchlist behind /api/tickers (gitignored)
- [special-dealbook.json](../../special-dealbook.json): the personal Deal Book behind /api/special-dealbook (gitignored)
- News Desk state at the root, gitignored because it names the watchlist: `news-desk.json` (items and Claude's reads), `news-desk-meta.json` (the brief, feed health, the last run), `news-usage.json` (Claude spend per day), `news-profile.json` (company names and CIKs; other names for a company go in its `aliases` list)
- Options → Market state at the root, gitignored because it names the watchlist: `options-market-scan.json` (the last scan), `options-market-history.json` (each name's daily IV, skew and put/call, 400 days; an archive, never written over when unreadable) and `options-market-indices.json` (the Cboe index histories)
- Other feed caches (us-pulse.json, redfin.json, gpu-economics.json, accounting-flags.json, sin-monitor.json, folly-markets.json, intelligence-mw-cache.json …) are gitignored; see [.gitignore](../../.gitignore)
- Tracked archives these modules append to: [data snapshots](data.md)

## Skills
- `npm run dev`: start the dev server, which is also the API server (port 5180 or `$PORT`)
- `curl localhost:5180/api/tickers`: cheap health check (reads a local file, no upstream calls)
- `curl "localhost:5180/api/news-desk?auto=0"`: the News Desk payload without starting a refresh

## Memory
- The header comment of each server/ module documents its sources, scores and cache TTLs
- [docs/ideas.md](../ideas.md): the Ideas recommender's buckets, rules and known limits

## Routines
Each feed rebuilds on request once its TTL (2h to 30 days) expires. The one timer is the News Desk's: it refreshes hourly, but only while the desk has been opened on this computer in the past 24 hours; between midnight and 5 am it only scores, and briefs follow the clock (after 6 am, noon and 4 pm) (server/newsDesk/index.js).

## Not here
- The tabs that render these feeds: [front end](front-end.md)
- The tracked JSON archives: [data snapshots](data.md)
- The Python model that writes data/sfc/: [SFC model](sfc.md)
- The emailed special-situations digest: [scripts and automation](operations.md)
