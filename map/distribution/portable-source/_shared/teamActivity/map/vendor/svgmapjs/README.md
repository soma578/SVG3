SVGMap is a web mapping framework based on SVG. It has loosely coupled and decentralized web mapping capabilities that conventional mapping frameworks do not have, as well as an advanced tiling mechanism that goes beyond ordinary vector tiles, making it possible to implement large-scale WebGIS.

The standardization activities are being undertaken at W3C.

* [HomePage](https://svgmap.org/) ([Japanese README here](README_ja.md))

* [API Docs](https://www.svgmap.org/wiki/index.php?title=%E8%A7%A3%E8%AA%AC%E6%9B%B8)

* [demo](https://svgmap.org/devinfo/devkddi/lvl0.1/demos/demo0.html)
* [demo(github pages)](https://svgmap.github.io/svgMapDemo/) [(source)](https://github.com/svgmap/svgMapDemo)

# Modular SVGMap.js

This repository contains a modularized SVGMap.js, which replaces SVGMapLv0.1.

Development has started in May 2022 as SVGMapLv0.1_r18module.js, and this version became mainstream in August 2024.


## Quick Start

You can use SVGMap by including JSTS and importing the ESM module. Here is a minimal example to get you started:

```html
<!DOCTYPE html>
<html>
<head>
  <title>SVGMap Quick Start</title>
  <style>
    #mapcanvas { width: 100%; height: 500px; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <div id="mapcanvas"></div>

  <!-- Required dependency -->
  <script src="https://unpkg.com/jsts@1.6.1/dist/jsts.min.js"></script>

  <script type="module">
    import { svgMap } from 'https://cdn.jsdelivr.net/gh/svgmap/svgmapjs@latest/SVGMapLv0.1_r18module.js';

    // Initialize the map
    window.svgMap = svgMap;
    // Example: svgMap.init('mapcanvas', ...);
  </script>
</body>
</html>
```

For more examples and detailed API usage, please refer to the [API Docs](https://www.svgmap.org/wiki/index.php?title=%E8%A7%A3%E8%AA%AC%E6%9B%B8).


## Contributing

We welcome your feedback and contributions!

- **Found a bug or have a feature request?** Please [open an issue](https://github.com/svgmap/svgmapjs/issues) on GitHub.
- **Want to contribute code?** Detailed guidelines for environment setup and testing can be found in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is now licensed under the MPL-2.0 License.

**License Update:**

On 2025-04-07, the license was changed from GPLv3 to MPLv2 by contributor agreement, to allow for broader use, including commercial applications. See [LICENSE](LICENSE) or [MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/) for details.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/svgmap/svgmapjs)
