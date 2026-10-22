# AI build-out tracker

AI Economy → **Build-Out** scores two readings of the AI capex boom, signal by signal:

- **Funding loop** (Craig Moffett): deals inside the AI complex move money around without adding any. What matters is whether new dollars arrive from customers outside it, or whether the build is increasingly funded by debt, vendor financing and off-balance-sheet structures.
- **Productivity**: AI already creates value (coding first), so output per hour and per worker should rise.

Both can be true at once: value is created but captured by users rather than by the builders. So value creation (panel C) and the funding question (panels A and B) are scored separately.

## Where things live

| Piece | File |
|---|---|
| Page | `src/tabs/ai/BuildOut.jsx` |
| Data and scoring | `server/aiBuildout.js` → `/api/ai-buildout` (cache `ai-buildout.json`, gitignored) |
| Scoring rules | `data/ai-tracker/thresholds.json` (read on every request; edit and refresh) |
| Hand-kept inputs | `data/ai-tracker/manual-inputs.json` |
| Status report | `node scripts/ai-tracker-check.mjs` (needs the dev server running) |

**Keys never reach the browser.** The repo has no build-time JSON pipeline; every feed is a server module behind an `/api` route in the Vite middleware. FRED goes through the shared server cache. SEC, Census, BTOS and SF Fed are keyless.

**Charts are not duplicated.** The detailed charts the tracker scores stay where they already were (the one-home rule):
- **AI Economy → Pulse:** hyperscaler capex
- **AI Economy → Compute:** capex returns and the AI debt market
- **AI Economy → Tokens and Compute:** GPU rental and token prices
- **AI Economy → Dark Output:** services revenue, software jobs and productivity

## Series and verification (checked October 2026)

| # | Signal | Source | Verified | Notes |
|---|---|---|---|---|
| 1 | Capex ÷ operating cash flow, 5 hyperscalers | SEC XBRL companyconcept: `PaymentsToAcquirePropertyPlantAndEquipment` + `PaymentsToAcquireProductiveAssets` (Amazon), `NetCashProvidedByUsedInOperatingActivities` | Yes | 10-Q cash flows are year to date: quarters are un-cumulated. Fiscal quarters count in the calendar quarter they end in, so Oracle's (May/Aug/Nov/Feb) sit a month apart from the others. Ratio = trailing-4Q capex ÷ trailing-4Q OCF, on quarters where all five have filed. |
| 2 | Debt raised | SEC XBRL. Amazon and Meta: `ProceedsFromIssuanceOfLongTermDebt`. Oracle: `ProceedsFromIssuanceOfSeniorLongTermDebt`. Alphabet: `ProceedsFromDebtNetOfIssuanceCosts`. Microsoft: `ProceedsFromDebtMaturingInMoreThanThreeMonths` (zero). | Yes | The four tags are merged; a company with no fact in a quarter counts as zero. |
| 3 | Contracted backlog (RPO) | SEC XBRL `RevenueRemainingPerformanceObligation` | Microsoft, Alphabet, Oracle | **Amazon stopped tagging RPO in 2020** (AWS backlog is a manual series). Meta reports none. The total is summed on quarters where all three have filed. |
| — | Finance-lease capacity adds | SEC XBRL `RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability` | Yes (Meta only to 2023) | Shown in the per-company table: capacity added through leases that reported capex misses. |
| 4 | Off-balance-sheet / vendor-financing events | `manual-inputs.json` → `events` | Manual | SPVs and joint ventures, leases not yet commenced, chipmaker investments in or loans to customers, backstops. Announced debt facilities are separately in `data/ai/ai-debt.json`. |
| 5 | QSS 518 revenue growth vs capex growth | Census Quarterly Services Survey, NAICS 518, from the Dark Output feed (QSS zip, keyless), and #1 | Yes | Both are trailing-4Q y/y. QSS is nominal and seasonally adjusted. |
| 6 | Investment in IT equipment and software | FRED `A679RC1Q027SBEA` (BEA, nominal) | Yes | Real software investment (`B985RX`) is used in #12. |
| 7 | Data-center construction | Census construction spending, `privsatime.xlsx`, "Data center" column (private, SA annual rate) | Yes | Monthly. |
| 8 | Business AI use | Census BTOS `National.xlsx`, question 7 (used AI in the last two weeks) and 24 (expects to in six months), "Yes" share | Yes | Census now words it "Super Intelligence or SI (formerly AI)". The current question starts in late 2025, so it doesn't splice with the older curated points on AI Economy → Pulse. |
| 9 | GPU rental and token volume | AI pulse feed (Vast.ai H100 median, OpenRouter tokens) | Automated | The original spec had these as manual series; they were already automated. |
| 10 | Labor productivity | BLS `PRS85006093` (identical to FRED `OPHNFB`), from the Dark Output feed | Yes | |
| 11 | Utilization-adjusted TFP | SF Fed `quarterly_tfp.xlsx`, sheet `quarterly`, column `dtfp_util` | Yes | **Request it with a query string** (the module adds the date). Without one, the CDN serves a stale 2023 copy. |
| 12 | Software output vs headcount | Real software investment `B985RX1Q020SBEA` (Dark Output raw, FRED or BEA) vs BLS CES software publishers (5132) + computer systems design (5415) | Yes | y/y growth gap in points. |

**Not built:**
- **Ramp AI Index:** no API, so it's a manual series.
- **Meta and Google ad revenue:** XBRL segment data is messy, so manual as the spec allowed.
- **Leases not yet commenced:** no XBRL tag in use at these filers, so manual from the lease footnote.

## Scoring

Rules are in `thresholds.json`. They are starting points to argue with. A null threshold means the signal is shown for context only.

| Signal | Leans funding loop | Leans productivity |
|---|---|---|
| Capex ÷ OCF | above 0.8 and rising over 4 quarters | below 0.6 |
| Debt raised (trailing 4Q) | up more than 50% y/y | — |
| QSS 518 growth − capex growth | below −15 pp | above 0 |
| TFP, labor productivity | — | last 8 quarters' average above the 2010–2019 average |
| Software output − employment growth | — | above 2 pp |

**Panels and the synthesis line.** Each panel reads as whichever direction has more scored signals. The synthesis line then combines the panels: panel A leaning funding loop while panel C leans productivity reads "Both theses holding — gains accruing to users, not builders."

**Staleness.** A series is stale when its latest period ended more than 1.5 × its frequency plus its usual publication lag ago. The lag is added so a monthly series doesn't read stale the day before its normal release. Lags:
- 50 days: SEC
- 80: QSS
- 60: BEA
- 35: construction
- 14: BTOS
- 100: TFP
- 45: BLS productivity

## Updating the hand-kept inputs

Edit `data/ai-tracker/manual-inputs.json` and refresh the page; no restart is needed.

**Events.** Add one object per deal to `events`:
- `date`
- `company`
- `counterparty`
- `type`: one of `spv`, `lease-not-commenced`, `vendor-financing`, `equity-stake-in-customer`, `backstop`
- `amountBn`
- `onBalanceSheet`
- a one-sentence `description`
- `source_url`

Delete the example row or leave it; rows marked `"example": true` are ignored.

**Series.** Append `{ "date": "YYYY-MM-DD", "company": "…", "value": …, "source_url": "…", "added": "YYYY-MM-DD" }` to a series' `values`. Never enter an estimate.

## Scheduled refresh (proposed, not enabled)

The local dashboard refreshes itself: each source is cached 12 hours and refetched on demand. This repo has no deploy workflow (`.github/workflows` holds only the special-situations digest), so there is nothing to schedule here. The static Netlify fork bakes `/api` responses at build time. Adding `/api/ai-buildout` to its bake list, with a weekly scheduled build there, would keep the public copy current.
