---
name: project-overview
description: Use at the start of work on the SVG3 disaster map or when reasoning about its runtime, layer ownership, build pipeline, native UI, portable LaWA packages, or legacy React/MapLibre documentation.
---

# SVG3 Project Overview

## Current architecture

The current product is SVGMap-native. Do not reintroduce React, Supabase, MapLibre,
or per-layer Next.js APIs.

```text
native-map.html
  -> current-map.html (generic SVGMap host)
    -> generated Container.svg
      -> portable/external SVGMap layers
```

- `map/webapp/native-map.html`: user-facing shell, catalog, search, imports, region selection.
- `map/webapp/current-map.html`: generic SVGMap runtime frame. It must not know layer business rules.
- `map/containers/`: generated SVGMap `Container.svg` variants for 47 regions.
- `map/layers/portable/`: independently runnable LaWA packages.
- `map/layers/managed/`: site-specific mount, visibility, data, and catalog declarations.
- `map/layers/dropins/`: simple SVG/HTML additions.
- `map/layers/external/`: imported upstream Containers and assets.

Next.js remains only as a thin static-asset host during migration. `src/app/page.tsx`
redirects to the native map. There is no React map UI, admin UI, API, or Supabase
runtime control plane.

## Data ownership

```text
map/sources/       private operational input and upstream snapshots
map/data/          generated browser-facing JSON/QTCT/search data
map/distribution/  standalone portable release bundles
map/layers/_build/ local build scratch, never public
```

Layers read static data. Browsers must not fan out requests to upstream authorities.
External refresh runs as an operator/scheduled job with throttling and retains the
last known-good snapshot.

## Layer interaction

Feature selection belongs to the layer:

```text
SVG POI/content -> svgMap.setShowPoiProperty -> svgMap.showModal
```

Do not add parent-document hit testing. S-LaWA layers use the portable
`svgmap-slawa-client`; external imports default to isolated mode.

## Build and verification

Run from `frontend/`:

```bash
npm run layers:check
npm run layers:build
npm run containers:generate
npm run assets:prepare
npm run assets:check
npm run containers:check
```

Use `npm run map:build` for the complete release pipeline.

`public/map` is generated. Edit `map/`, never `frontend/public/map`.

## Sources of truth

- Layer package: `map/layers/portable/<layer>/layer.package.json`
- Site mount: `map/layers/managed/<layer>/layer.config.json`
- Catalog: generated `map/layers/catalog.json`
- Runtime configuration: `map/regions/<regionId>/runtime-config.json`
- Runtime protocol: `map/webapp/shared/mapMessages.js`

Treat `docs/legacy/` and old MapLibre/React descriptions as historical only.
