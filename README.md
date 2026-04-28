# RFP Map

A mobile-first map for exploring live federal contract opportunities from SAM.gov.

RFP Map turns the public SAM.gov Contract Opportunities bulk feed into a semantic market map. Instead of starting with a search form, you start with the market: agencies as regions, work categories as neighborhoods, and individual RFPs as tappable pins.

<p align="center">
  <strong>Federal Market → Agency → Category → RFP → SAM.gov</strong>
</p>

## Why this exists

SAM.gov is the official source of federal contract opportunities, but it is hard to explore casually. It works like a database. RFP Map makes it feel like a map.

The goal is not to replace GovWin, HigherGov, GovTribe, or SAM.gov. The goal is simpler:

> Let a curious user open the app and understand what the federal government is trying to buy right now.

## Demo flow

1. Open the **Federal Market** overview.
2. Tap an agency region, e.g. `Veterans Affairs`.
3. Tap a market category, e.g. `Construction`.
4. Tap an RFP pin.
5. Open the original SAM.gov source record.

## Product principles

- **Map first.** The interface starts with exploration, not search.
- **Mobile first.** One-thumb drilldown: tap region, tap market, tap RFP.
- **No token in the browser.** The checked-in demo uses static precomputed tiles.
- **Source linked.** Every RFP points back to SAM.gov.
- **Fast by default.** The browser loads compact map tiles instead of the full bulk CSV.
- **Approximate value is enough.** Dollar amounts are market-gravity estimates, not official award values.

## Data

RFP Map is built from the public SAM.gov Contract Opportunities bulk CSV:

```text
https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv
```

Current static snapshot:

- **73,946** active/open opportunity rows
- **187** precomputed map tiles
- Static tile payload: `public/data/map-tiles.json`

The raw CSV and generated local development payloads are intentionally not committed. Only the compact static map tiles are checked in so the app can be hosted permanently on static infrastructure.

## Architecture

```text
SAM.gov bulk CSV
        ↓
scripts/ingest-sam.py
        ↓
local normalized data in data/sam/  ignored by git
        ↓
precomputed compact map tiles
        ↓
public/data/map-tiles.json
        ↓
Next.js static export
        ↓
GitHub Pages / any static host
```

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Static export for long-lived hosting

## Local development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Build static site

```bash
npm run build
```

The exported site is written to:

```text
out/
```

Serve it locally:

```bash
npm run serve
```

## Refreshing data

The repo includes an ingestion script for rebuilding SAM.gov data:

```bash
npm run ingest:sam
```

The script downloads the public SAM.gov Contract Opportunities bulk CSV, keeps the raw/generated development files under ignored `data/sam/`, and writes the compact browser payload to:

```text
public/data/map-tiles.json
```

The static site never fetches the 200MB bulk CSV in the browser and does not require a SAM.gov API key.

### Automated refresh

The checked-in workflow:

```text
.github/workflows/refresh-sam-data.yml
```

runs daily at `05:30 UTC`, after SAM.gov's overnight active-notice refresh window. It:

1. downloads the latest public bulk CSV,
2. regenerates `public/data/map-tiles.json` and `public/data/bulk-summary.json`,
3. validates the static build with `GITHUB_PAGES=true npm run build`,
4. commits the refreshed compact data if it changed, and
5. deploys the refreshed static site to GitHub Pages.

## Deployment

This repo includes a GitHub Pages workflow:

```text
.github/workflows/pages.yml
```

On every push to `main`, GitHub Actions runs:

```bash
npm ci
npm run build
```

and deploys the `out/` directory to GitHub Pages.

After creating the GitHub repo, enable Pages with **GitHub Actions** as the source:

```text
Settings → Pages → Build and deployment → Source: GitHub Actions
```

Then the app can live indefinitely at the repo's Pages URL.

## What this is not

RFP Map is not:

- a capture-management CRM
- a GovWin replacement
- a proposal workflow system
- a pricing intelligence product
- a SAM.gov API proxy

Those may be useful products, but they are different products.

## Related idea

**Uncle Sam's Cart** is a separate concept: a playful, media-friendly feed of weird things the government is buying. That should live in a separate repo.

RFP Map stays focused on the map.

## License

MIT
