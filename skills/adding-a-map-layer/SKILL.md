---
name: adding-a-map-layer
description: Use when adding or substantially changing an SVG3 layer, including portable LaWA packages, managed mounts, CSV-to-QTCT data, drop-ins, external Containers, pin profiles, or layer-owned property modals.
---

# Add or Modify a Map Layer

## Choose the layer type

- `portable`: reusable SVGMap/LaWA runtime owned by this project.
- `managed`: this site's mount and data declaration for a portable runtime.
- `dropins`: simple SVG/HTML trial layer.
- `external`: upstream Container/assets imported without rewriting the layer.

New production data layers normally need a portable package and a managed mount.

## Portable package

Create:

```text
map/layers/portable/<layer>/
  layer.package.json
  <layer>Layer.svg
  <layer>Layer.html
  optional detail renderer
```

For point data, reuse:

```js
import { initRepresentativePinsLayer } from '../representative-pins/representativePinsCore.js'
```

The portable runtime receives data through SVG fragment parameters such as
`summary`, `data`, and `layer`. Package-local URLs must be relative. Do not depend
on `/api`, React, Supabase, or `window.parent.document`.

Initialize after `layerWebAppReady`, with the existing T-LaWA fallback pattern.
Use `svgMap.setShowPoiProperty` and `svgMap.showModal` for details.

## Managed mount

Create `map/layers/managed/<layer>/layer.config.json` with:

```json
{
  "id": "layer-example",
  "title": "Example",
  "href": "/map/layers/portable/example/exampleLayer.svg#summary=/map/data/qtct/example/summary.json&data=/map/data/qtct/example/{regionId}/detail.json&layer=example",
  "class": "poi clickable",
  "visibility": "hidden",
  "opacity": "1",
  "order": 80,
  "layerPackage": "/map/layers/portable/example/layer.package.json",
  "bundle": {
    "release": true
  },
  "ui": {
    "catalog": true,
    "group": "防災情報",
    "symbol": "例",
    "kind": "poi"
  }
}
```

`layer.package.json` owns runtime entrypoints, dependencies, portability, detail
mode, version, publisher, and license. The managed mount owns site placement,
data URLs, UI grouping, and build inputs. Do not duplicate package fields in a
`portable` or `portal` block. Set `bundle.release: true` on exactly the mount
that should produce the regional distribution bundle.

Use `ui.mounts` when one catalog toggle controls multiple animations. Put
layer-specific icon/status rules in `ui.pinProfile`.

## Data

Operator-owned CSV belongs beside the managed config. Upstream snapshots belong
under `map/sources/<layer>/` and must not be published directly.

For CSV-to-QTCT, declare `build.kind: "csv-qtct"`. Put arbitrary columns in
`propertyColumns`; do not extend the shared engine for every domain field.

Generated browser data belongs under `map/data/qtct/<qtctLayer>/`.

## Rules

- The host must not know layer names, coordinates, pin schemas, or detail fields.
- The layer must not register click handlers on the parent document.
- External browser clients must not poll upstream authorities.
- Keep portable runtime separate from publisher/admin tooling.
- Edit source under `map/`; never edit generated `public/map`.

## Verify

```bash
npm run layers:check
npm run layers:build -- --layer=<qtctLayer>
npm run containers:generate
npm run portable:check
npm run assets:prepare
npm run assets:check
npm run containers:check
npm run native-poi:check
```
