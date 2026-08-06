// canonical 実装は portable パッケージ側にある。ここで再実装しないこと
// (以前 shared 版と portable 版が別々に育ち、cachedAt の対応を両方へ手で入れる
//  羽目になった)。mapMessages.js と同じ re-export 規約。
export {
  RUNTIME_DATA_CACHE_NAME,
  STORED_AT_HEADER,
  cachedResponseStoredAt,
  documentObservedAt,
  fetchWithRuntimeCache,
} from '../../layers/portable/representative-pins/runtimeCache.js';
