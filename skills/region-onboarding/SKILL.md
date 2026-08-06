---
name: region-onboarding
description: Use when adding or repairing a prefecture/region in SVG3, including region metadata, municipalities, viewport, generated Containers, QTCT shards, search indexes, and native-map selection.
---

# Region Onboarding

SVG3 has no server allowlist or per-region API. Regions are static declarations
and generated assets.

## Required files

```text
map/regions/index.json
map/regions/<regionId>/runtime-config.json
map/regions/<regionId>/municipalities.json
map/containers/Containers_webapp_denshi_<prefCode>.svg
```

`runtime-config.json` points to the generated Container and static map assets.
Do not add `/api/map/*` URLs.

## Data flow

Managed layer builders produce regional data:

```text
map/data/qtct/<layer>/<regionId>/detail.json
map/data/search/<layer>/<regionId>.json
```

Missing records are represented by valid empty regional outputs. Do not create
special host branches for a region.

## Procedure

1. Add/update the region entry in `map/regions/index.json`.
2. Add municipality IDs, codes, labels, and viewports.
3. Confirm `prefCode`, Container URL, and initial viewport.
4. Run the generators from `frontend/`.

```bash
npm run generate:district-svgs
npm run layers:build
npm run containers:generate
npm run assets:prepare
npm run assets:check
npm run containers:check
```

## Verify

Open:

```text
/map/webapp/native-map.html?regionId=<regionId>&municipalityId=<municipalityId>
```

Check region selection, municipality viewport, layer toggles, POI details, search,
and that the Container has the same declared layer count as other regions.

Do not edit `frontend/public/map`; it is a generated mirror.
