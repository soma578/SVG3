# SVGMap architecture audit

Updated: 2026-07-24

## Current state

The native SVGMap application is the product runtime.

- `map/webapp/region-picker.html`: nationwide and municipality navigation
- `map/webapp/native-map.html`: native application shell
- `map/webapp/current-map.html`: generic SVGMap host
- `map/layers/portable`: executable layer packages
- `map/layers/managed`: site-specific mounts, data sources and catalog metadata
- `map/layers/external`: imported upstream Containers
- `map/layers/dropins`: zero-registration local layers
- `map/publishers`: offline or scheduled data publishers
- `map/containers`, `map/data`, `map/distribution`: generated artifacts
- `frontend/public/map`: deployment mirror, never a source of truth

React application routes and Supabase services have been removed from the working
tree. Next.js currently has only two responsibilities:

1. Redirect `/` to the native nationwide selector.
2. Serve static assets with production cache and security headers.

`npm run dev:native` serves the same generated application without Next.js. This
is the portability baseline. `npm run dev` remains the Next delivery-adapter path.

## Findings

### P0: Protect the source-of-truth boundary

Status: enforced.

- Generators write to `map`, not `frontend/public/map`.
- `assets:prepare` is the only source-to-public synchronization step.
- `pipeline:check` rejects direct public output from generators.
- `frontend/public/map` must remain disposable.

### P0: Keep the host layer-agnostic

Status: substantially complete.

- Host visibility and controller messages are catalog-driven.
- Managed layer IDs are forbidden in `current-map.html` and `native-map`.
- Portable layers do not use `parent.document`.
- Layer-specific display and hit testing remain in layer controllers.
- S-LaWA compatibility code is isolated under `portable/svgmap-slawa-client`.

Remaining review:

- `hazard` is intentionally `workspace-portable` and uses host messaging.
- Legacy unpublished detail mounts still exist and should be removed only after
  confirming that no distributed bundle references them.

### P0: Do not stop information at the prefecture boundary

Status: implemented for prefecture-scoped layers.

Disaster response crosses administrative borders. Two different mechanisms cover
this, and they should not be confused:

- Nationwide QTCT layers (`evacuation`, `japanRiverWebcam`, `teamActivity`,
  `riverLevel`, `roadClosure`) already carry a `regionId: "all"` summary or shard
  index. Panning across a border loads the neighbouring shard. No per-region
  configuration is involved.
- Prefecture-scoped layers (`hazard`, `offline-basemap`) are pinned to one
  prefecture by construction. These declare `crossRegion` in their
  `layer.config.json`, and `containers:generate` mounts the adjacent
  prefectures' copies into every region's Container, hidden by default.

Adjacency is derived from `prefectures.geojson`, not hand-maintained:
`regions:adjacency` writes `map/regions/adjacency.json` from shared boundary
vertices, with sea crossings declared in `map/regions/adjacency.config.json`.
`regions:check` fails the build if the generated graph drifts from the source
data, if adjacency is asymmetric, or if a declared neighbour mount is missing
from a Container.

Constraints that must hold:

- neighbour mounts stay `visibilityStrategy: native` so a region with eight
  neighbours does not start eight extra controllers
- `{layerId}` expands to the mount id, so one controller cannot receive host
  messages meant for another prefecture's copy of the same layer
- search indexes, alert polling, freshness and management links belong to the
  primary mount only
- offline caching takes the neighbour background SVGs (~100KB) but not
  neighbour hazard SVGs (3-7MB each)

### P1: Make Next optional

Status: implemented for local runtime.

- `npm run dev:native` runs the generated map through a plain static server.
- `/` redirects to the native nationwide selector.
- Map data, code, region configuration and icons use explicit cache policies.

Production can later move to any static host that can reproduce these headers.
Next should not regain APIs, authentication, data conversion or layer logic.

### P1: Reduce build coupling

Status: implemented.

`map:build` currently performs generation, upstream-policy checks, bundle
construction, synchronization and all contract checks in one command. This is
correct but expensive and makes unrelated work wait for nationwide artifacts.

Commands:

- `map:generate`: source data to `map` artifacts
- `map:verify`: architecture and generated-artifact checks
- `map:sync`: `map` to `frontend/public/map`
- `map:release`: portable bundles and signatures
- `map:build`: the complete composition used by CI/release

Partial layer builds already exist and should remain the default for authoring.
`pipeline:check` verifies that the four stages and their ordering remain intact.

Typical local data update:

```bash
npm run layers:build -- --layer riverLevel
npm run assets:prepare -- --layer riverLevel
```

Full source regeneration without release packaging:

```bash
npm run map:generate
npm run map:verify
npm run map:sync
```

### P1: Control generated storage

Status: policy implemented; no files removed.

Current local sizes at audit time:

- `map/layers/_build`: about 3.2 GB
- `map/data`: about 1.1 GB
- `map/distribution/portable`: about 41 MB
- `frontend/public`: about 709 MB

Storage classes:

- `gis-workspace`: ignored GIS intermediates. It is not rebuilt by `map:build`;
  removal requires `--accept-manual-rebuild`.
- `public-map`: ignored deployment mirror. It can be rebuilt with `map:sync`.
- `portable-releases`: tracked release artifacts. The storage tool protects it.
- `map-data`: mixed authoritative snapshots and generated data. It is protected.
- `public-districts`: legacy tracked deployment assets. It is protected until
  repository migration is complete.

Audit without deleting:

```bash
npm run storage:audit
```

Remove only the disposable public map mirror:

```bash
npm run storage:clean -- --target public-map
```

Removing the GIS workspace is intentionally harder because the current pipeline
cannot recreate it:

```bash
npm run storage:clean -- --target gis-workspace --accept-manual-rebuild
```

No ordinary build or development command deletes these targets.

### P2: Remove transition-only files

Status: legacy detail relay removed.

Removed after confirming that neither generated Containers, catalog nor portable
bundles referenced them:

- `managed/evacuation-detail`
- `managed/team-activity-detail`
- corresponding `map/webapp/layers/*-detail` controllers

Native feature details are owned and rendered by each portable layer. The host
does not relay a selected feature into a hidden detail layer.

Remaining candidate:

- Next dependencies after a production static-host decision

## Invariants

Run before structural changes:

```bash
npm run architecture:check
```

Run the native application without React or Next:

```bash
npm run assets:prepare -- --if-missing
npm run dev:native
```

Run the complete release pipeline only when nationwide or release artifacts must
be regenerated:

```bash
npm run map:build
```
