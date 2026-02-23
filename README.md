# Economic Dashboard

A personal dashboard tracking interest rates, inflation (CPI), housing data, and stock fundamentals.

## Data Sources
- **FRED** (Federal Reserve Economic Data) — rates, CPI, housing
- **Financial Modeling Prep** — stock fundamentals

## Quick Start

1. Open this folder in VS Code
2. Open the terminal (View → Terminal)
3. Run these commands:

```bash
npm install
npm run dev
```

4. Open http://localhost:5173 in your browser
5. Enter your API keys in the dashboard:
   - **FRED key**: Free at https://fred.stlouisfed.org/docs/api/api_key.html
   - **FMP key**: Free at https://site.financialmodelingprep.com (250 requests/day)

## What Each Tab Shows

- **Interest Rates**: U.S. mortgage rates, Treasury yields, global central bank rates
- **CPI & Inflation**: CPI, Core CPI, Core PCE, breakeven inflation, yield curve spread
- **Housing**: Median home price, Case-Shiller index, housing starts, permits, sales, months' supply
- **Stocks**: Fundamental screener with market cap, ROE, ROIC, FCF yield, PEG, SBC/revenue, and more

## Deploying (optional)

To put this on the internet:

```bash
npm run build
```

This creates a `dist` folder you can deploy to Vercel, Netlify, or GitHub Pages.
