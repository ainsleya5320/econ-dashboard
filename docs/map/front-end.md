# Front end

Back to the [master map](../../CLAUDE.md).

## Projects
- [index.html](../../index.html): the page shell Vite serves at /
- [src/main.jsx](../../src/main.jsx): React entry point
- [src/App.jsx](../../src/App.jsx): the shell: tab groups (Today: Cockpit, News Desk and a link out to Ideas; Valuation, Income, Macro, Themes), data loading, data-health status. `?view=` opens any tab; `?view=stocks&sub=…` and `?view=economy&sub=…` open a sub-view (StocksTab.jsx, USEconomyTab.jsx), and `?view=stocks&symbol=…` a stock page
- [ideas.html](../../ideas.html): the second page shell, served at /ideas (vite.config.js rewrites the path and lists it as a build input)
- [src/ideas/](../../src/ideas): the Ideas page: IdeasApp.jsx (shortlist; Magic Formula stocks by sector with a market-value floor and a rank lookup; special situations; fixed income; each idea links to its evidence on the dashboard) and ideas.css (its own light and dark tokens; shares the dashboard's theme setting)
- [src/tabs/NewsDeskTab.jsx](../../src/tabs/NewsDeskTab.jsx): the News Desk: the daily brief, news by holding and by category with Claude's reads, proposed rows for the data/ai tables, the clip bookmarklet and paste box, feed health
- [src/tabs/](../../src/tabs): one component per tab and sub-tab (Overview cockpit, Rates, CPI, U.S. Economy, SFC Model, Tightening …)
- [src/tabs/stocks/](../../src/tabs/stocks): S&P 500 screener, people screener, research sheet, debt & cash (with optimal debt), accounting (Beneish, Montier, accruals, footnotes, filings), technicals, valuation (cost of capital, industry yardstick, story valuation), value book, special situations (with the Odd lots board: issuer tenders that buy holders of under 100 shares in full, priced as a 99-share trade), closed-end funds (ClosedEndFunds.jsx: discount screener, a fund's discount against its own range, distributions, and a monthly backtest run in the browser on /api/cef's panel), sin & folly; the biggest company ÷ GDP (TopCompanyGdp.jsx, on S&P Overview)
- [src/tabs/options/](../../src/tabs/options): the Options tab's views. MarketView.jsx is the landing page (VIX family and term structure, put/call, SKEW/VVIX, cross-asset vol, the volatility-and-skew board, skew curves, premium traded, unusual activity) on /api/options-market via the shared hook marketData.js; SymbolNav.jsx steps through the watchlist / ETFs / S&P 500 (by size or sector) with ‹ › and ← →, prefetching the neighbours' chains; MiniFans.jsx draws small-multiple implied ranges from the scan above ExpectationsView; StrategiesView.jsx is the strategy rail, explainer, builder (payoff over the risk-neutral density on one price axis) and cross-name screener on src/lib/optionStrategies.js; ui.jsx holds the shared dense components and the validated --oc-* chart palette (OptionsResearch.css). Also income, expectations, volatility history, watchlist ladder
- [src/tabs/BondsTab.jsx](../../src/tabs/BondsTab.jsx): Income → Bonds (`?view=bonds`): every Treasury on the fitted curve, rich and cheap against neighbouring issues, TIPS breakevens by maturity, graded auctions and the upcoming calendar, and the full list to filter, search and sort
- [src/tabs/history/](../../src/tabs/history): the Historical tab's long-run sections (interest rates, inflation, growth), under HistoricalTab.jsx with the asset-returns view
- [src/tabs/realEstate/](../../src/tabs/realEstate): market map (states, metros, counties), market profile, metro comparison, rental pricing, refinancing; Global (GlobalHousing.jsx: ~60 countries' real house prices, valuation, household debt, world map, commercial property)
- [src/tabs/ai/](../../src/tabs/ai): capex returns, GPU economics, intelligence per megawatt, Nebius spot (NebiusSpot.jsx, on Compute), GPU markets (GpuMarkets.jsx: the price ladder, CME forward curve, availability, a year of prices, used-GPU index, hyperscaler spot by region), token estimates, token spot; Dark Output (DarkOutput.jsx: SemiAnalysis fingerprints of AI work the statistics miss)
- [src/tabs/intl/](../../src/tabs/intl): the International tab's five views — international pulse (IntlPulseTab.jsx, also exports the Big Mac panel Forex uses), Central Banks & Rates (CentralBanks.jsx: BIS policy rates for ~40 banks), Forex (ForexTab.jsx with TradeFlows.jsx), Share of the World and China; GlobalImbalances.jsx and LastMile.jsx are shared pieces; Share of the World (ShareOfWorld.jsx: Li Lu's wealth-as-share-of-world-output lens) and China (ChinaMonitor.jsx: objective vs cost)
- [src/tabs/WorldTab.jsx](../../src/tabs/WorldTab.jsx): the World tab — the globe as one economy: balance sheet (real estate, equities, bonds, broad money, central-bank assets, reserves, debt by sector, household wealth) in $tn and × world GDP, market cap ÷ GDP, money, trade, saving vs investment, imbalances, people, IMF member table
- [src/tabs/OilMarket.jsx](../../src/tabs/OilMarket.jsx): Commodities → Oil — prices and the CME curve, timespreads since 1985, product prices and cracks, U.S. stocks vs their five-year range, SPR, refining, supply and demand, the EIA STEO balance and producers
- [src/tabs/CftcSubTab.jsx](../../src/tabs/CftcSubTab.jsx): Commodities → CFTC Positioning — the Commitments of Traders explained: primer and glossary, a 35-market scoreboard (COT index, flows, price + open interest), per-market detail with a plain-English read, and a crowding backtest
- [src/tabs/ai/BuildOut.jsx](../../src/tabs/ai/BuildOut.jsx): AI Economy → Build-Out — synthesis line, the three to watch, panels A (funding loop), B (boundary), C (productivity), the hand-kept event log and the thresholds in force
- [src/tabs/consumer/](../../src/tabs/consumer): household wealth and owner wealth panels
- [src/components/](../../src/components): shared widgets: chat drawer, data-health panel, fear & greed gauge, choropleth, ticker search, the news crawl (NewsTicker.jsx, which marks watchlist tickers)
- [src/components/TensionBoard.jsx](../../src/components/TensionBoard.jsx): the Tensions sub-tab on AI Economy and U.S. Economy, one board for both (domain prop)
- [src/lib/](../../src/lib): client logic: api.js (FRED/FMP fetches), constants, fallback data, options/property/rental/stock analysis, the options strategy engine (optionStrategies.js: twelve strategies, candidate builder, payoff, screenChain), technicals, styles, Damodaran cost of capital (costOfCapital.js) and the FMP → Damodaran industry map (industryMap.js)
- [src/lib/accountingQuality.js](../../src/lib/accountingQuality.js): Beneish M-score, Montier C-score, accruals and useful life, shared by the stock page's Accounting tab and server/sinMonitorSeed.js
- [src/lib/assistantContext.js](../../src/lib/assistantContext.js): turns the dashboard's verdicts into text for the chat assistant
- [src/theme.css](../../src/theme.css): global theme

## State
- [src/lib/damodaran.json](../../src/lib/damodaran.json): Damodaran annual implied ERP (1960 on) and rating spreads, built by the refresh script
- [src/lib/damodaranIndustries.json](../../src/lib/damodaranIndustries.json): his U.S. industry averages (betas, costs of capital, margins, returns, multiples, working capital), built by the same script
- [src/data/labRevenueTracker.json](../../src/data/labRevenueTracker.json): hand-curated AI lab revenue and deployed-GW observations (append by hand)
- [src/lib/fallbackData.js](../../src/lib/fallbackData.js): baked-in series shown when FRED is unreachable
- [src/lib/forecasts.js](../../src/lib/forecasts.js): curated FutureSearch forecast snapshots
- `/api/tickers` persists the watchlist to the gitignored `tickers.json` at the root

## Skills
- `npm run dev`: Vite dev server on port 5180 (or `$PORT`), all interfaces
- `npm run build`: production bundle into `dist/`
- `npm run preview`: serve the built bundle

## Memory
- [README.md](../../README.md): quick start and what each tab shows (partly out of date: the port is now 5180)

## Routines
None. The browser pulls from the /api routes on load; see [server data modules](server.md) for cache TTLs.

## Not here
- The /api routes and the code that fetches FRED, FMP, BLS, BEA and the rest: [server data modules](server.md)
- The JSON archives those routes read and append: [data snapshots](data.md)
- The SFC simulation behind the SFC Model tab: [SFC model](sfc.md)
- Unit tests for src/lib analysis code: [scripts and automation](operations.md)
