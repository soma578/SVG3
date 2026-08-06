// Description:
// サンドボックス化されたLayers as Web Apps (S-LaWA) の概念検証のため、既存のLaWA上に構築したS-LaWAラッパー
//
// 解決する課題:
// 従来のLaWAは同一オリジンに存在することが必要だった。
// クロスオリジンのLaWAの場合はiframeへのsrcdoc(必要に応じてプロキシも使用)で無理に同一オリジン化していた⇒プロキシによる脆弱性
// InterWindowMessaging.js改 (window.postMessage) を用いたDOMシンクロ等の機構で、クロスオリジンでLaWAを稼働する機構構築
// これによりブラウザのセキュリティポリシーをベースとした実装となり、脆弱性改善
//
// License: (MPL v2)
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// History:
// プロトタイピング期(レガシーLaWA上に構築)
// History: (svgMapSandboxLayerLibの方もこちらに統合して書いてます)
// 2025/07/xx: 検討開始 2025/07ぐらいから本格化　ESM化段階から検討してましたが
// 2025/08/04: プロトタイピング開始
// 2025/08/08: 初期稼働確認
// 2025/08/12: google map tileのS-LaWAをつくりテスト拡充、バグ修正・不足機能追加
// 2025/08/13 : 差分更新機能の実装：r2
// 2025/09/01 : 正式版に向け、互換性向上実装を開始：r3
// 2025/09/01 : LaWAに紐づいたレイヤーsvgを扱う(シンクロ)機能を実装（未検証）
// 2025/11/19 : 開発再開 window.CRS対応、textNodeのサポート
// 2025/11/21 : processPreRenderFunction周りの互換性改善
//
// SVGMap.jsフレームワーク本体への導入後
// 2026/03/10 SVGMap.js ESM化・フレームワークに導入
//
//
// ToDo:
// SVGMapGIS, SVGMapAuthroing等の機能をsvgMapSandboxLayerLib.jsに載せていく
// パフォーマンスの改善：(差分更新・Mutation Observer:done)⇒差分レンダリング(フレームワーク)・refreshScreen()不要化⇒WebGL　（フレームワークのリファレンス）
// ルックアップテーブル型globalCoordinateSystemのtransformプロパティの規定と実装(これで非線形の図法でもjsを隔離できる)

import { InterWindowMessaging } from "../InterWindowMessaging.js";

const MODAL_MAX_SIZE = {
	width: 500,
	height: 500,
	default: { width: 300, height: 300 },
};
const CUSTOM_ID_ATTR = "data-slawa-id";
const BLOCKED_SVG_ELEMENTS = new Set([
	"a",
	"animation",
	"embed",
	"foreignobject",
	"iframe",
	"object",
	"script",
]);
const BLOCKED_MODAL_ELEMENTS = new Set([
	"base",
	"embed",
	"form",
	"iframe",
	"link",
	"meta",
	"object",
	"script",
]);
const isDangerousUrl = (value) => /^(?:javascript|vbscript|data:text\/html):/i.test(String(value || "").trim());

export class SandboxWrapper {
	constructor(svgMap, layerID, targetIframe, crossOriginUrl, sessionNonce) {
		this.svgMap = svgMap;
		this.layerID = layerID;
		this.sandboxFrame = targetIframe;
		this.crossOriginUrl = crossOriginUrl;
		this.sessionNonce = sessionNonce;
		this.messaging = null;
		this.sandboxLaWASVGurl = null;
		this.customShowPoiPropertyEnabled = false;
	}

	// 常に最新の svgImage と svgImageProps を取得するための Getter
	get svgImage() {
		return this.svgMap.getSvgImages()[this.layerID];
	}
	get svgImageProps() {
		return this.svgMap.getSvgImagesProps()[this.layerID];
	}

	async initLaWA() {
		// console.log("SandboxWrapper init for layer:", this.layerID);
		this.#initSvgImage();
		let originalSvgUrlStr =
			this.svgImage.documentElement.getAttribute("data-slawa-svg-url");
		let sLaWAurl, sLaWASVGurl, layerSvgDom;

		if (originalSvgUrlStr) {
			sLaWASVGurl = new URL(originalSvgUrlStr, location.href);
			// 外部SVGのfragmentはHTTP取得には送られず、ダミーSVGへ置換した時点で
			// svgImagePropsから失われる。既存controllerはここをレイヤー設定として
			// 使用するため、元URLから明示的に引き継ぐ。
			if (sLaWASVGurl.hash) this.svgImageProps.hash = sLaWASVGurl.hash;
			// console.log("[S-LaWA Lv2] ダミーSVGから本物SVGのURLを復元:", sLaWASVGurl.href);
		}

		// 【S-LaWA Lv2】 ダミーに退避された本物SVGのURLを復元

		let sLaWAurlHash;
		// コアから渡されたURL（または既存のプロパティ）をベースに解析
		if (
			this.svgImageProps.hash &&
			this.svgImageProps.hash.indexOf("https://") > 0
		) {
			sLaWAurlHash = this.svgImageProps.hash
				.substring(this.svgImageProps.hash.indexOf("https://"))
				.split(";");
		} else if (this.crossOriginUrl.indexOf("https://") > 0) {
			// Adapterからは controllerUrl が直接渡ってくるので、それを解析のベースに含める
			sLaWAurlHash = this.crossOriginUrl
				.substring(this.crossOriginUrl.indexOf("https://"))
				.split(";");
		} else {
			sLaWAurlHash = [this.crossOriginUrl]; // デフォルトフォールバック
		}

		//		let sLaWAurl, sLaWASVGurl, layerSvgDom;
		for (const slh of sLaWAurlHash) {
			const slurl = new URL(slh, location.href);
			if (slurl.pathname.endsWith(".svg")) {
				sLaWASVGurl = slurl;
			} else if (slurl.pathname.endsWith(".html")) {
				sLaWAurl = slurl;
			}
		}

		if (sLaWASVGurl) {
			this.sandboxLaWASVGurl = sLaWASVGurl;
			// console.log("レイヤールートSVGのURL：", this.sandboxLaWASVGurl);
		}

		if (!sLaWAurl && sLaWASVGurl) {
			const result = await this.#get_sLaWAurl_from_sLaWASVGurl(sLaWASVGurl);
			sLaWAurl = result.appurl;
			layerSvgDom = result.svgdom;
			if (layerSvgDom) {
				this.#replaceSvgContentFromDOM(this.svgImage, layerSvgDom);
				sLaWASVGurl = null;
			}
		}

		if (!sLaWAurl) {
			console.warn("S-LaWAのURLが解決できませんでした。終了します");
			return;
		}

		// iframe は allow-same-origin なしの sandbox で動くため、受信時の
		// event.origin は "null" になる。送信先を origin で固定することは
		// できないが、InterWindowMessaging は event.source をこの iframe の
		// contentWindow に固定して検証するため、opaque origin 用に "*" を使う。
		const targetOrigin = "*";

		// 通信チャネルの確立
		this.#establishChannel(targetOrigin, sLaWASVGurl);

		// S-LaWA本体のロードを開始
		this.sandboxFrame.setAttribute("src", sLaWAurl.href);
	}

	async #get_sLaWAurl_from_sLaWASVGurl(sLaWASVGurl) {
		try {
			const sLaWASVGsrc = await (await fetch(sLaWASVGurl)).text();
			const parser = new DOMParser();
			const newSvgDoc = parser.parseFromString(sLaWASVGsrc, "image/svg+xml");
			if (newSvgDoc.getElementsByTagName("parsererror").length > 0) {
				console.error(
					"XMLパースエラー:",
					newSvgDoc.getElementsByTagName("parsererror")[0]
				);
				return { svgdom: null, appurl: null };
			}
			const controllerPath =
				newSvgDoc.documentElement.getAttribute("data-controller");
			if (!controllerPath) {
				return { svgdom: newSvgDoc, appurl: null };
			}
			const controllerURL = new URL(controllerPath, sLaWASVGurl);
			return { svgdom: newSvgDoc, appurl: controllerURL };
		} catch (e) {
			return { svgdom: null, appurl: null };
		}
	}

	#establishChannel(targetOrigin, sLaWASVGurl) {
		// console.log("try establishChannel to:", targetOrigin);
		this.sandboxFrame.addEventListener("load", () => {
			// console.log("sandboxFrame loaded generate InterWindowMessaging");
			this.messaging = new InterWindowMessaging(
				{
					connectionReady: (msg) => {
						// console.log("ready");
						if (!sLaWASVGurl) {
							this.#setSvgImageToSandbox();
						} else {
							this.#getSvgImageFromSandbox(sLaWASVGurl);
						}
					},
					replaceSvgImage: (msg) => {
						// 2026/4/8 S-LaWA Lv2のために実装改善
						try {
							// ダミーDOMを本物に差し替え
							this.#replaceSvgContent(this.svgImage, msg.svgImageXml);

							// キャッシュを破棄して再評価させる
							this.svgImageProps.CRS = { unresolved: true };
							this.svgImageProps.metaSchema = ""; // スキーマも再読み込みさせる

							// コアに再描画（再パース）させる
							this.svgMap.refreshScreen();
							return true; // 子のawaitを解除
						} catch (e) {
							return false;
						}
					},
					getSvgImageProps: (msg) => {
						return this.#createSerializableSvgImageProps(this.svgImageProps);
					},
					setHash: (msg) => {
						this.svgImageProps.hash = msg.hash;
					},
					getGeoViewBox: (msg) => {
						return this.svgMap.getGeoViewBox();
					},
					applySvgDiff: (diffPayload) => {
						try {
							this.#applySvgDiff(diffPayload);
							this.svgMap.refreshScreen();
							return true;
						} catch (e) {
							return false;
						}
					},
					enableCustomShowPoiProperty: (msg) => {
						this.#enableCustomShowPoiProperty();
					},
					showModal: (msg) => {
						if (!msg.src || String(msg.src).length > 100000) return;
						let w = msg.width
							? Math.min(MODAL_MAX_SIZE.width, msg.width)
							: MODAL_MAX_SIZE.default.width;
						let h = msg.height
							? Math.min(MODAL_MAX_SIZE.height, msg.height)
							: MODAL_MAX_SIZE.default.height;
						const modalContent = this.svgMap.showModal(this.#sanitizeModalContent(msg.src), w, h);
						this.#bindDeclarativeModalActions(modalContent);
					},
				},
				this.sandboxFrame.contentWindow,
				targetOrigin,
				{ sessionNonce: this.sessionNonce },
			);
		});
	}

	destroy() {
		this.messaging?.destroy?.();
		this.messaging = null;
	}

	// -----------------------------------------------------------------
	// 外部（IframeAdapter4SLaWA）から呼ばれるイベント転送メソッド
	// -----------------------------------------------------------------
	async sendEventToSLaWA(eventName) {
		if (!this.messaging) return;
		const sip = this.#createSerializableSvgImageProps(this.svgImageProps);
		await this.messaging.callRemoteFunc("eventDispatch", {
			name: eventName,
			svgImagePropsJSONtext: sip,
		});
	}

	// -----------------------------------------------------------------
	// 内部処理メソッド群（旧コードからの移植）
	// -----------------------------------------------------------------

	#enableCustomShowPoiProperty() {
		const customShowPoiPropertyFunc = async (param) => {
			const serializer = new XMLSerializer();
			const svgTargetElementXml = serializer.serializeToString(param);
			// console.log("customShowPoiPropertyFunc:", svgTargetElementXml);
			await this.messaging.callRemoteFunc("callCustomShowPoiPropertyFunc", {
				xml: svgTargetElementXml,
			});
		};
		this.svgMap.setShowPoiProperty(customShowPoiPropertyFunc, this.layerID);
		this.customShowPoiPropertyEnabled = true;
	}

	#createSerializableSvgImageProps(obj) {
		const geoViewBox = this.svgMap.getGeoViewBox();
		// obj.hash (Getter) を明示的にシリアライズ対象に加える
		const serializableObj = { ...obj, hash: obj.hash, geoViewBox };
		return JSON.stringify(serializableObj, (key, value) => {
			// 循環参照の原因となるプロパティを特定して除外 2026/03/09
			if (key === "controllerWindow") {
				return undefined;
			}
			if (
				value === window ||
				typeof value === "function" ||
				typeof value === "symbol" ||
				value === undefined
			) {
				return undefined;
			}
			return value;
		});
	}

	async #setSvgImageToSandbox() {
		const sip = this.#createSerializableSvgImageProps(this.svgImageProps);
		const serializer = new XMLSerializer();
		const svgImageXml = serializer.serializeToString(this.svgImage);

		await this.messaging.callRemoteFunc("setInitialSvgImage", {
			svgImagePropsJSONtext: sip,
			layerID: this.layerID,
			svgImageXml,
		});
	}

	async #getSvgImageFromSandbox(sLaWASVGurl) {
		// S-LaWA Lv2用に改善
		const sip = this.#createSerializableSvgImageProps(this.svgImageProps);
		// 子にURLを渡して初期化フロー（Fetch〜置換〜Ready）をキックする
		await this.messaging.callRemoteFunc("getInitialSvgImage", {
			svgImagePropsJSONtext: sip,
			layerID: this.layerID,
			svgImageUrl: sLaWASVGurl.href, // ここで本物のURLをパス
		});
	}

	#replaceSvgContent(svgImageDom, xmlString) {
		try {
			if (typeof xmlString !== "string" || xmlString.length > 5000000) return false;
			const parser = new DOMParser();
			const newSvgDoc = parser.parseFromString(xmlString, "image/svg+xml");
			if (newSvgDoc.getElementsByTagName("parsererror").length > 0) {
				console.error(
					"XMLパースエラー:",
					newSvgDoc.getElementsByTagName("parsererror")[0]
				);
				return false;
			}
			this.#replaceSvgContentFromDOM(svgImageDom, newSvgDoc);
		} catch (e) {
			console.error("エラーが発生しました:", e);
			return false;
		}
	}

	#changeAbsoluteImagePath(node) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const imgs = node.getElementsByTagName("image");
			for (const img of imgs) {
				let href = img.getAttribute("xlink:href");
				if (href && this.sandboxLaWASVGurl) {
					href = new URL(href, this.sandboxLaWASVGurl).href;
					img.setAttribute("xlink:href", href);
				}
			}
		}
	}

	#replaceSvgContentFromDOM(svgImageDom, newSvgDoc) {
		try {
			while (svgImageDom.documentElement.firstChild) {
				svgImageDom.documentElement.removeChild(
					svgImageDom.documentElement.firstChild
				);
			}
			const newSvgRoot = newSvgDoc.documentElement;
			this.#sanitizeSvgSubtree(newSvgRoot);
			const propertyAttr = newSvgRoot.getAttribute("property");
			if (propertyAttr !== null) {
				svgImageDom.documentElement.setAttribute("property", propertyAttr);
			}

			// 【S-LaWA Lv2】 本物SVGのルート属性を親DOM（ダミーの枠）にコピー
			const attrsToCopy = ["viewBox", "data-controller", "data-nocache"];
			attrsToCopy.forEach((attr) => {
				const val = newSvgRoot.getAttribute(attr);
				if (val !== null) svgImageDom.documentElement.setAttribute(attr, val);
			});

			while (newSvgRoot.firstChild) {
				const newElem = newSvgRoot.firstChild;
				this.#changeAbsoluteImagePath(newElem);
				svgImageDom.documentElement.appendChild(newElem);
			}
			return true;
		} catch (e) {
			console.error("エラーが発生しました:", e);
			return false;
		}
	}

	#applySvgDiff(diffPayload) {
		try {
			if (!Array.isArray(diffPayload) || diffPayload.length > 5000) return false;
			diffPayload.forEach((change) => {
				const type = change.type;
				const payload = change.payload;

				if (type === "deletion") {
					const node = this.svgImage.querySelector(
						`[${CUSTOM_ID_ATTR}="${payload.id}"]`
					);
					if (node) {
						node.parentNode.removeChild(node);
					}
				} else if (type === "attributeChange") {
					const node = this.svgImage.querySelector(
						`[${CUSTOM_ID_ATTR}="${payload.id}"]`
					);
					if (node) {
						if (payload.attr === "textContent") {
							node.textContent = payload.value;
						} else if (this.#isSafeSvgAttribute(payload.attr, payload.value)) {
							node.setAttribute(payload.attr, payload.value);
						}
					}
				} else if (type === "addition") {
					const parent = this.svgImage.querySelector(
						`[${CUSTOM_ID_ATTR}="${payload.parentId}"]`
					);
					if (!parent) {
						console.warn(
							`Parent node not found for addition with ID: ${payload.id} , parentId:${payload.parentId} payload:`,
							payload
						);
						return;
					} else {
						// console.warn(`Parent node found for addition with ID: ${payload.id} , parentId:${payload.parentId} payload:`, payload);
					}

					const parser = new DOMParser();
					if (typeof payload.xml !== "string" || payload.xml.length > 1000000) return;
					const wrappedXml = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${payload.xml}</svg>`;
					const newSvgDoc = parser.parseFromString(wrappedXml, "image/svg+xml");
					if (newSvgDoc.getElementsByTagName("parsererror").length > 0) {
						console.error(
							"XML parse error:",
							newSvgDoc.getElementsByTagName("parsererror")[0]
						);
						return;
					}
					const newNode = newSvgDoc.documentElement.firstChild;
					if (!newNode) return;
					if (!this.#sanitizeSvgSubtree(newNode)) return;
					this.#changeAbsoluteImagePath(newNode);

					if (payload.nextSiblingId) {
						const nextSibling = parent.querySelector(
							`[${CUSTOM_ID_ATTR}="${payload.nextSiblingId}"]`
						);
						if (nextSibling) {
							parent.insertBefore(newNode, nextSibling);
						} else {
							parent.appendChild(newNode);
						}
					} else {
						parent.appendChild(newNode);
					}
				}
			});
			return true;
		} catch (e) {
			console.error("Error occurred:", e);
			return false;
		}
	}

	#isSafeSvgAttribute(name, value) {
		const normalized = String(name || "").toLowerCase();
		if (!normalized || normalized.startsWith("on") || normalized === "data-controller") return false;
		if (["href", "xlink:href", "src"].includes(normalized) && isDangerousUrl(value)) return false;
		return true;
	}

	#sanitizeSvgSubtree(root) {
		if (!root || root.nodeType !== Node.ELEMENT_NODE) return root;
		if (BLOCKED_SVG_ELEMENTS.has(root.localName.toLowerCase())) {
			root.remove();
			return null;
		}
		for (const element of [root, ...root.querySelectorAll("*")]) {
			if (BLOCKED_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
				element.remove();
				continue;
			}
			for (const attribute of [...element.attributes]) {
				if (!this.#isSafeSvgAttribute(attribute.name, attribute.value)) {
					element.removeAttribute(attribute.name);
				}
			}
		}
		return root;
	}

	#sanitizeModalContent(source) {
		const template = document.createElement("template");
		template.innerHTML = String(source);
		for (const element of template.content.querySelectorAll("*")) {
			if (BLOCKED_MODAL_ELEMENTS.has(element.localName.toLowerCase())) {
				element.remove();
				continue;
			}
			for (const attribute of [...element.attributes]) {
				const name = attribute.name.toLowerCase();
				if (name.startsWith("on") || (["href", "src", "action", "formaction"].includes(name) && isDangerousUrl(attribute.value))) {
					element.removeAttribute(attribute.name);
				}
			}
			if (element.localName.toLowerCase() === "a") {
				element.setAttribute("target", "_blank");
				element.setAttribute("rel", "noopener noreferrer");
			}
		}
		const container = document.createElement("div");
		container.append(template.content);
		return container;
	}

	#bindDeclarativeModalActions(root) {
		if (!root?.querySelectorAll) return;
		for (const button of root.querySelectorAll('[data-slawa-action="refresh-image"]')) {
			const media = button.closest('[data-slawa-media]');
			const image = media?.querySelector?.('img[data-slawa-media-source]');
			const status = media?.querySelector?.('[data-slawa-media-status]');
			const source = image?.getAttribute?.('data-slawa-media-source');
			let sourceUrl;
			try {
				sourceUrl = new URL(source || '', location.href);
			} catch {
				button.disabled = true;
				continue;
			}
			if (sourceUrl.protocol !== 'https:') {
				button.disabled = true;
				continue;
			}
			const requestedCooldown = Number(button.getAttribute('data-slawa-cooldown-ms'));
			const cooldownMs = Math.min(300000, Math.max(10000, Number.isFinite(requestedCooldown) ? requestedCooldown : 10000));
			let cooldownUntil = 0;
			button.addEventListener('click', () => {
				const now = Date.now();
				if (now < cooldownUntil) return;
				cooldownUntil = now + cooldownMs;
				button.disabled = true;
				const refreshUrl = new URL(sourceUrl.href);
				refreshUrl.searchParams.set('_svgmapRefresh', String(now));
				image.src = refreshUrl.href;
				if (status) status.textContent = '画像を更新しています';
				window.setTimeout(() => {
					button.disabled = false;
				}, cooldownMs);
			});
			image.addEventListener('load', () => {
				if (status) status.textContent = '最新画像';
			});
			image.addEventListener('error', () => {
				if (status) status.textContent = '画像を取得できません';
			});
		}
	}

	#initSvgImage() {
		const svgRoot = this.svgImage.documentElement;
		svgRoot.setAttribute(CUSTOM_ID_ATTR, "root");
	}
}
