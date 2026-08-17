//
// Description:
//  Web App Layer Initializer
//  for SVG Map Level0.1/0.2 Implementation
//
// The html of the SVGMap's web App Layer must import this initializer with the script element.
//
// Programmed by Satoru Takagi
//
// Contributors:
//  kusariya
//
// Home Page: http://svgmap.org/
// GitHub: https://github.com/svgmap/svgmapjs
//
// License: (MPL v2)
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// History:
// 2024/07/23 1st implementatiion, to fix https://github.com/svgmap/svgmapjs/issues/5
// 2026/04/16 S-LaWAモードを追加

// Note:
// 将来、このイニシャライザーは、より高度・複雑な実装になる可能性がある。またWeb App Layerの作法もさらに変更される可能性もある
// 今のところWebAppLayerはESMを必須としていない為、このライブラリもmoduleではないことにしている。

const _currentScriptUrl = document.currentScript
	? document.currentScript.src
	: location.href;

addEventListener("DOMContentLoaded", function () {
	let tightLaWA = false; // 密結合(レガシー)LaWAかどうかのフラグ
	// console.log(window.parent, window.parent.svgMap);
	try {
		if (window.parent?.initSvgMapWebAppLayer) {
			// for svgMapESM
			tightLaWA = true;
			window.parent?.initSvgMapWebAppLayer(window);
		} else if (window.parent?.svgMap?.initSvgMapWebAppLayer) {
			// for svgMapESM (2)
			tightLaWA = true;
			window.parent?.svgMap?.initSvgMapWebAppLayer(window);
		} else if (window.parent?.svgMapLayerUI?.initSvgMapWebAppLayer) {
			// for svgMap0.1_r17
			tightLaWA = true;
			window.parent.svgMapLayerUI.initSvgMapWebAppLayer(window);
		}
	} catch (e) {}
	if (!tightLaWA) {
		// S-LaWAモジュールの動的ロード
		console.log("Do initialize as S-LaWA");

		const moduleUrl = new URL("./svgMapSandboxLayerLib.js", _currentScriptUrl)
			.href;

		import(moduleUrl)
			.then((module) => {
				module.initSandboxLayer();
			})
			.catch((error) => {
				console.error("[svgMapLayerLib] Failed to load S-LaWA module:", error);
			});
	} else {
		if (window.svgMap && typeof window.svgMap.setCORSproxy !== "function") {
			window.svgMap.setCORSproxy = function (proxyPath, encodeUri) {
				console.log("setCORSproxy is ignored in legacy LaWA mode.");
			};
		}
		addEventListener("load", function () {
			// 2026/4/15 S-LaWAと LaWAとの互換性のためにLaWAでも"layerWebAppReady"を発行する
			// console.log("dispatch layerWebAppReady event for legacy LaWA");
			const svgMapEvent = new Event("layerWebAppReady");
			window.dispatchEvent(svgMapEvent);
		});
	}
});
