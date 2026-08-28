/**
 * ランタイムデータ取得 + フォールバックキャッシュ
 * ==============================================
 * ここが canonical 実装。map/webapp/shared/runtimeCache.js は本ファイルを
 * re-export するだけ (mapMessages.js と同じ規約)。二重に実装しないこと。
 *
 * 時刻の意味を混同しないこと:
 *
 *   observedAt … 情報そのものの時点 (観測時刻/生成時刻)。データ本体が持つ。
 *                「その情報がいつの状況か」を表す。鮮度判定ではこちらを優先する。
 *   storedAt   … この端末がキャッシュへ保存した時刻。保存時に自前で刻む。
 *                「いつ取ってきたか」を表す。
 *
 * HTTP の Date ヘッダは「サーバが応答を生成した時刻」であって、この端末が
 * 保存した時刻でも、情報が観測された時刻でもない。max-age 内でブラウザHTTP
 * キャッシュやプロキシから配られた応答では実際の取得時刻より古くなりうるし、
 * そもそも欠落することもある。だから Date は最後の当て推量としてしか使わない。
 */

export const RUNTIME_DATA_CACHE_NAME = 'svgmap-runtime-data-v1';

// 自前の保存時刻。Cache API は任意メタデータを持てないので合成ヘッダで運ぶ。
export const STORED_AT_HEADER = 'x-svg3-stored-at';

const MAX_CACHE_BYTES = 25 * 1024 * 1024;

const isoOrNull = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

/**
 * キャッシュ応答の取得時刻。自前で刻んだ値を最優先し、
 * 無ければ Date ヘッダを近似として使う。どちらも無ければ null (=不明)。
 */
export const cachedResponseStoredAt = (response) =>
  isoOrNull(response?.headers?.get?.(STORED_AT_HEADER))
  || isoOrNull(response?.headers?.get?.('date'));

/**
 * ドキュメントが自分で名乗っている観測/生成時刻。
 * レイヤー固有の意味は解釈せず、文書レベルの共通フィールドだけ見る。
 */
export const documentObservedAt = (data) => {
  if (!data || typeof data !== 'object') return null;
  return isoOrNull(data.observedAt) || isoOrNull(data.generatedAt);
};

export const fetchWithRuntimeCache = async (
  url,
  key,
  {
    responseType = 'json',
    label,
    emitDataStatus,
    logLabel = 'runtimeCache',
    requestCache = 'default',
    fetchImpl = globalThis.fetch?.bind(globalThis),
  } = {},
) => {
  const absoluteUrl = new URL(url, window.location.href).href;
  const request = new Request(absoluteUrl, { method: 'GET', cache: requestCache });
  const status = (payload) => emitDataStatus?.({
    ...payload,
    // updatedAt はこの状態を報告した時刻。データの時刻ではない。
    updatedAt: new Date().toISOString(),
  });

  const decode = (text, source, startedAt, receivedAt) => {
    const data = responseType === 'text' ? text : JSON.parse(text);
    const parsedAt = performance.now();
    return {
      source,
      data,
      metrics: {
        bytes: new TextEncoder().encode(text).byteLength,
        readMs: Math.round((receivedAt - startedAt) * 10) / 10,
        parseMs: Math.round((parsedAt - receivedAt) * 10) / 10,
      },
    };
  };

  try {
    const startedAt = performance.now();
    if (typeof fetchImpl !== 'function') throw new Error('runtime fetch implementation is unavailable');
    const response = await fetchImpl(request);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // 本文は一度だけ読む。キャッシュへ入れるものと返すものを同じ文字列から作る。
    const text = await response.text();
    const receivedAt = performance.now();
    const result = decode(text, 'network', startedAt, receivedAt);

    // ベストエフォート保存。保存の失敗がデータ取得を巻き添えにしてはいけない
    // (巨大ペイロードで QuotaExceededError が出て、レイヤーが無表示になった事故がある)。
    if ('caches' in window && result.metrics.bytes <= MAX_CACHE_BYTES) {
      try {
        const headers = new Headers(response.headers);
        headers.set(STORED_AT_HEADER, new Date().toISOString());
        const cache = await caches.open(RUNTIME_DATA_CACHE_NAME);
        await cache.put(request, new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }));
      } catch (cacheError) {
        console.warn(`[${logLabel}] runtime cache put skipped (non-fatal)`, { key, url, error: cacheError });
      }
    }

    status({ key, label, source: 'network', url, observedAt: documentObservedAt(result.data) });
    return result;
  } catch (error) {
    if ('caches' in window) {
      const cache = await caches.open(RUNTIME_DATA_CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        console.warn(`[${logLabel}] using cached runtime data`, { key, url, error });
        const startedAt = performance.now();
        const text = await cached.text();
        const receivedAt = performance.now();
        const result = decode(text, 'cache', startedAt, receivedAt);
        // 保存済みを表示するときは「いつの情報か」と「いつ取ったか」を両方伝える。
        // これが無いと利用者は古い開設状況を最新だと誤認する。
        status({
          key,
          label,
          source: 'cache',
          url,
          observedAt: documentObservedAt(result.data),
          cachedAt: cachedResponseStoredAt(cached),
          message: 'ネットワーク取得失敗のため保存済みを表示',
        });
        return result;
      }
    }
    status({ key, label, source: 'fallback', url, message: 'キャッシュなし' });
    throw error;
  }
};
