/**
 * Service Worker クライアント
 * ===========================
 * ページ側の窓口。判定は swCachePolicy / swMessages（純粋関数）に置き、
 * ここは登録と往復だけを担う。
 *
 * Service Worker が無い環境（未対応ブラウザ、非セキュアコンテキスト、登録失敗）でも
 * オンライン利用が壊れないこと。すべての操作は失敗しても黙って諦める。
 */
import { SW_MESSAGES, SW_RESULTS } from './swMessages.js';

const SW_URL = '/sw.js';
const SW_SCOPE = '/';
// 地区SVGやハザードを含むので数十秒かかりうる。
const REQUEST_TIMEOUT_MS = 60_000;

export const serviceWorkerSupported = () =>
  typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator
  && typeof window !== 'undefined'
  && window.isSecureContext !== false;

export const registerServiceWorker = async () => {
  if (!serviceWorkerSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    return registration;
  } catch (error) {
    console.warn('[swClient] service worker registration failed', error);
    return null;
  }
};

/** 応答つきで Service Worker へ送る。制御下に無ければ null。 */
const request = async (message) => {
  if (!serviceWorkerSupported()) return null;
  let worker = navigator.serviceWorker.controller;
  if (!worker) {
    try {
      const registration = await navigator.serviceWorker.ready;
      worker = registration.active;
    } catch {
      return null;
    }
  }
  if (!worker) return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data || null);
    };
    try {
      worker.postMessage(message, [channel.port2]);
    } catch (error) {
      clearTimeout(timer);
      console.warn('[swClient] postMessage failed', error);
      resolve(null);
    }
  });
};

/**
 * 地域を保存する。pinned=true は利用者による明示保存で、LRU の自動削除対象から外れる。
 * 上限が pin で埋まっているときは capacityChoice が返る（黙って消さない）。
 */
export const cacheRegion = async (regionId, { pinned = false } = {}) => {
  const result = await request({ type: SW_MESSAGES.cacheRegion, regionId, pinned });
  if (result?.type === SW_RESULTS.regionCached) return result;
  if (result?.type === SW_RESULTS.capacityChoice) return result;
  return null;
};

/** 保存の進行状況などを受け取る。返り値は購読解除関数。 */
export const onCacheEvent = (listener) => {
  if (!serviceWorkerSupported()) return () => {};
  const handler = (event) => {
    const type = event.data?.type;
    if (typeof type === 'string' && type.startsWith('sw:')) listener(event.data);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
};

export const removeRegion = async (regionId) => {
  const result = await request({ type: SW_MESSAGES.removeRegion, regionId });
  return result?.type === SW_RESULTS.regionRemoved ? result : null;
};

export const listCachedRegions = async () => {
  const result = await request({ type: SW_MESSAGES.listCachedRegions });
  return result?.type === SW_RESULTS.cachedRegions ? result : null;
};
