# Ideas: the trade recommender

`localhost:5180/ideas` is a second page on the dashboard's server. It shows trade ideas, each with:
- the call in one line
- a few sentences of why
- what would change it
- a horizon
- a link to the dashboard view that holds the evidence

There are three buckets: stocks, special situations and fixed income. A shortlist on the front tab takes the best of each.

Every call comes from a rule, so each one can be traced to a number. There is no model and no per-idea cost.

## Where things live

| Piece | File |
|---|---|
| Page | `ideas.html`, `src/ideas/IdeasApp.jsx`, `src/ideas/ideas.css` |
| Aggregator | `server/ideas.js` → `/api/ideas` (`?symbol=X` for one stock's rank, `?only=stocks` for the stock bucket) |
| Magic Formula | `server/magicFormula.js` (cache `magic-formula.json`, gitignored) |
| Special situations | `server/specialSituations.js` and `server/specialScore.js`, unchanged |
| Bond fund discounts | `server/cefDiscounts.js`, unchanged |

The `/ideas` path is a rewrite in `vite.config.js` to `ideas.html`, which is also listed as a second build input.

Evidence links open the dashboard with `?view=` and `?view=…&sub=…`; see `src/App.jsx`, `StocksTab.jsx` and `USEconomyTab.jsx`.

## Stocks: the Magic Formula

This is Joel Greenblatt's screen. It ranks every company on two measures and adds the two ranks.

**The two measures**
- **Earnings yield:** EBIT ÷ enterprise value.
- **Return on capital:** EBIT ÷ (net working capital + net PP&E).

**Definitions**
- **EBIT:** the last four quarters of FMP's `operatingIncome`. FMP's own `ebit` adds non-operating items.
- **Enterprise value:** market value + short- and long-term debt + minority interest + preferred − cash and short-term investments.
- **Net working capital:** current assets less cash, minus current liabilities less short-term debt. A negative figure counts as zero.
- **Net PP&E:** FMP's `propertyPlantEquipmentNet`. When that is missing, or under 5% of assets while tangible long-term assets are over half, capital uses the tangible long-term assets instead: long-term assets less goodwill, intangibles, long-term investments and tax assets. FMP often files oil and gas properties, railroads' track and homebuilders' land in another line. The card notes it.

**Universe** (FMP's company screener, refreshed daily)
- U.S.-domiciled, actively trading, over $50M.
- Listed on the NYSE, Nasdaq or NYSE American.
- Financials, utilities and REITs are left out, as are health insurers (FMP files them under Healthcare) and royalty and mineral trusts (pass-throughs with next to no capital on the books).
- Share classes are merged, keeping the most traded line. Preferreds, rights (including contingent value rights), warrants and units are left out: FMP files the issuer's statements under them.
- Loss-makers and companies reporting in another currency are not ranked.
- Companies whose latest quarter is over ten months old, or that have a gap in the last four quarters, are not ranked either.

**Records that can't be right are left out, not ranked.** Each would otherwise land at the top of a list. On the first full build (October 22, 2026) these caught about a dozen companies:
- cash above total assets (one $8B engineering firm showed $762 billion of cash)
- a balance sheet missing its liabilities and equity, or showing no assets
- a balance sheet under 5% of a year's revenue or 0.2% of the market value (one gold miner's was a thousandth of the real one)
- a year's operating profit above the price of the whole business
- one quarter earning more than the whole year while the other quarters lost money, unless the same quarter carried the year a year earlier too (that reads as seasonal and gets a note instead)

The lookup box says which rule left a company out.

**Measures off the scale.** If no enterprise value is left after cash, or the company uses almost no tangible capital, it ranks first on that measure and gets a flag.

**Market-value floors.** Ranks are relative, so they are computed separately at four floors: $50M, $250M, $1B and $10B. The page's switch picks one, and it is remembered per browser.

**Flags.** A card lists a flag when:
- the earnings yield is over 50%
- one quarter supplied over 60% of the year's profit (a note if the same quarter did a year earlier, a check otherwise)
- capital uses the tangible long-term assets because PP&E is missing
- profit more than doubled, or fell over 25%
- debt is over 4× EBIT
- it is a micro-cap, illiquid, or under $5
- its figures are stale, or its balance sheet has no current assets

The shortlist skips names with a "check" flag.

**New entrants.** The date each name entered a floor's top 50 is kept once the universe is fully fetched. A "new" badge marks the past week.

**Fetching.** Each company takes two requests: 8 quarters of income statement and the latest balance sheet.
- Requests run one every 400 ms, 150 a minute, under the plan's 300. The rest of the dashboard shares that limit, so a refusal pauses every worker for a minute, and five pauses in a row stop the build for half an hour.
- A cold build runs about 35 minutes in the background. The page shows partial rankings with progress, biggest companies first.
- After that, a company is refetched weekly once its last quarter on file ended over 125 days ago, and every 45 days regardless.
- The rate gate and a generation counter live on `globalThis`, so a dev-server restart leaves one fetch loop running, not two. Saves merge with the file on disk.

## Special situations

The bucket shows:
- ideas the Special Situations scorer grades A ("research now") or B ("worth a look"), with the scorer's top three reasons as the why
- open odd-lot tenders with a positive edge, listed first

For odd lots, a priority clause marked "mentioned" (odd lots mentioned, priority not confirmed) gets a "check the clause first" call.

Each category has a stock horizon and a "what would change it" line, set in `SS` in `server/ideas.js`.

Ideas dismissed on the dashboard's Top ideas view stay hidden.

The page waits 8 seconds for a Special Situations rebuild, then serves its last copy.

**Price floor.** A reorganization idea whose stock trades under 10 cents is dropped. The reorg board dates a case only by what its 8-Ks say happened, and it prices only the new stock, never old shares the plan cancels. A sub-dime quote on a reorg idea would therefore be old shares whose cancellation the board could not read. Such a stock is no buy either way.

## Fixed income

Each rule reads one market and makes at most one call. Thresholds are in `fixedBucket()` in `server/ideas.js`; they are starting points, not forecasts.

| Market | Reading | Calls |
|---|---|---|
| Treasury curve | DGS10 − DGS3MO | below 0: stay in bills · 0 to 1: ladder 1–5 years · over 1: extend to 7–10 years |
| TIPS | DFII10, T10YIE vs CPI y/y | real yield ≥ 2%: buy · breakeven over 0.5 below CPI: favor TIPS · real yield ≤ 0.5%: avoid |
| High yield | BAMLH0A0HYM2 | ≤ 3: underweight · ≥ 6: consider |
| Investment grade | BAMLC0A0CM | ≤ 0.9: prefer Treasuries · ≥ 1.8: attractive |
| Agency mortgages | MORTGAGE30US − DGS10 | ≥ 2.5: cheap |
| Long bond | DGS30 | ≥ 5%: lock in |
| Bond closed-end funds | see below | buy, as a short trade |

**"Highest since."** Phrases like this search back to the start of the series as fetched, about 23 years of daily data. FRED's ICE BofA spread history covers only about 3 years, so the long-run spread averages quoted on the cards are stated rather than computed.

**Bond and municipal closed-end funds** (CEFConnect data, never committed)
- Screened funds trade at least $500K a day.
- To pass, a fund needs a discount of 5% or more and a one-year z-score of −2 or lower.
- Up to four are picked, at most two per category.
- Discounts past 25% and payouts over 20% are left out: at that point the market doubts the NAV itself, as with private credit or CLO equity.
- The horizon is weeks. The dashboard's backtest found most of the edge in the first month.
- When one category is most of the cheap list, the note says so.

## Not built (possible next steps)

- A Claude "explain more" button under the News Desk's daily cap.
- A weekly email of the shortlist, like the special-situations digest.
- Options income ideas (Options → Strategies screener), COT extremes and the Market Map's correction-risk scores as further buckets.
