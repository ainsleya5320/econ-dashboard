# Scripts and automation

Back to the [master map](../../CLAUDE.md).

## Projects
- [package.json](../../package.json): npm scripts (dev, build, preview) and dependencies (React, Recharts, Plotly, Anthropic SDK, xlsx)
- [scripts/refresh-damodaran.mjs](../../scripts/refresh-damodaran.mjs): rebuilds src/lib/damodaran.json and src/lib/damodaranIndustries.json from Damodaran's yearly spreadsheets
- [scripts/refresh-seeds.mjs](../../scripts/refresh-seeds.mjs): rebuilds data/seeds/ (BLS metro catalog, IMF DataMapper, the Market Map's annual Census and Realtor.com data, the Historical tab's long-run history, Stocks → Sin & Folly) and data/options/cboe-put-call.json (Options → Market put/call history)
- [scripts/ritter-ipos.py](../../scripts/ritter-ipos.py): rebuilds data/folly/ritter-ipos.json from Jay Ritter's IPO statistics PDF (Table 9; needs pypdf)
- [scripts/special-digest.mjs](../../scripts/special-digest.mjs): builds and scores the special-situations feed, emails new ideas through Resend
- [scripts/duet/](../../scripts/duet): the Claude Duet copy of the dashboard, a published page with no server: snapshot.mjs saves every /api answer and the FRED cache on this computer, build-page.mjs turns that snapshot into the page, shim.js answers the page's /api requests from it, shared.mjs holds the rules the three share
- [tests/](../../tests): node:test unit tests for local market, metro, options, property and stock-research code, the special-situations reorg stages (reorgStages.test.js) and the Gurus tab's feed (guruTracker.test.js)

## State
- [state/](../../state): digest memory, what has been sent (gitignored; kept in the Actions cache)
- [special-digest-preview.html](../../special-digest-preview.html): `--dry-run` output (gitignored)
- [.env.example](../../.env.example): the key names to copy into `.env`
- `duet-snapshot/`, `duet-snapshot.tar.gz`, `.duet-page/`: the Duet snapshot and the page built from it (gitignored: the snapshot names the watchlist)

## Skills
- `npm install`: required before anything else
- `npm run dev`: the app and its API on port 5180
- `node --test tests/*.test.js`: run the unit tests (after npm install; they import xlsx)
- `node scripts/refresh-damodaran.mjs`: once a year, in January
- `node scripts/refresh-seeds.mjs [bls|imf|market-map|long-run|sin|folly|putcall]`: after the releases its header lists, then commit data/seeds/ (putcall: data/options/)
- `python -I scripts/ritter-ipos.py`: each January, when Ritter updates his IPO statistics
- `node scripts/special-digest.mjs --dry-run`: build and score the digest without sending
- `npm run duet:snapshot`: save every /api answer to duet-snapshot.tar.gz for the Duet page (`-- --with-finra` keeps the FINRA bond data)
- `node scripts/duet/build-page.mjs duet-snapshot.tar.gz`: build the Duet page into .duet-page/ (no .env present)

## Memory
- [README.md](../../README.md): quick start and data sources
- The header comment of scripts/special-digest.mjs lists its environment variables

## Routines
- [.github/workflows/special-digest.yml](../../.github/workflows/special-digest.yml): weekdays 14:30 UTC, runs the digest (secrets FMP_KEY, RESEND_API_KEY, DIGEST_TO_EMAIL); upstream repo only; never commits

## Not here
- The scoring the digest uses: [server data modules](server.md) (server/specialScore.js)
- The SFC rebuild command: [SFC model](sfc.md)
- The archive the digest caches: [data snapshots](data.md)
