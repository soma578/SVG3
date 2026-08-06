---
name: map-postmessage-contract
description: Use when changing postMessage traffic between native-map.html, current-map.html, imported layers, or S-LaWA clients, or when debugging runtime readiness, layer visibility, imports, viewport commands, and isolated layer behavior.
---

# SVG3 Runtime Message Contract

## Boundaries

```text
native-map.html -> current-map.html -> SVGMap layers
```

- `native-map.html` owns generic shell commands and catalog state.
- `current-map.html` owns SVGMap runtime adaptation.
- Layers own feature detection, details, filters, and data loading.

The message constants live in:

```text
map/webapp/shared/mapMessages.js
```

There is no React/TypeScript duplicate.

## Prefer SVGMap APIs

Do not use postMessage for normal POI selection. The canonical path is:

```text
SVG content -> setShowPoiProperty -> showModal
```

Do not send coordinate registries or hit targets to the parent. Do not access
`window.parent.document`.

Use messages only for generic host operations such as runtime readiness, viewport,
layer visibility, runtime layer import/removal, and isolated S-LaWA bridging.

## Security

- Accept messages only from the expected frame/source.
- Use an exact origin for same-origin frames.
- Treat external layers as isolated by default.
- Never grant an imported child permission to command sibling or parent frames.
- Validate imported URLs, protocols, attributes, and package metadata.

S-LaWA packages use:

```text
map/layers/portable/svgmap-slawa-client/
```

## Change procedure

1. Search all existing uses of the message string.
2. Update `mapMessages.js` first.
3. Update native shell, host, importer, and S-LaWA client as applicable.
4. Keep payloads generic; do not add layer-specific fields to host messages.
5. Run:

```bash
npm run native-host:check
npm run runtime-import:check
npm run native-poi:check
npm run portable:check
```
