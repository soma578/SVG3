const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const canonicalizeJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`
    )).join(',')}}`;
  }
  throw new TypeError('署名対象に未対応の値が含まれています');
};

export const artifactIndexSigningPayload = (index) => {
  const { signature: _signature, ...payload } = index || {};
  return new TextEncoder().encode(canonicalizeJson(payload));
};

const assertRelativePath = (value, label) => {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) {
    throw new Error(`${label}が相対パスではありません`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label}に不正なパスが含まれています`);
  }
};

const assertDistribution = (distribution, label) => {
  if (!distribution?.packageVersion || typeof distribution.packageVersion !== 'string') {
    throw new Error(`${label}のpackage versionがありません`);
  }
  if (!distribution.publisher?.id || !distribution.publisher?.name) {
    throw new Error(`${label}の発行者が不正です`);
  }
  if (!distribution.license?.spdx || !distribution.license?.name) {
    throw new Error(`${label}のライセンスが不正です`);
  }
  if (!distribution.publishedAt || Number.isNaN(Date.parse(distribution.publishedAt))) {
    throw new Error(`${label}の公開日時が不正です`);
  }
};

export const validateArtifactIndex = (index, { requireSignature = false, now = Date.now() } = {}) => {
  if (!isRecord(index) || index.schemaVersion !== 1 || !Array.isArray(index.artifacts)) {
    throw new Error('配布レイヤー一覧のschemaが不正です');
  }
  if (requireSignature) {
    if (!index.issuedAt || Number.isNaN(Date.parse(index.issuedAt))) throw new Error('署名一覧の発行日時が不正です');
    if (!index.expiresAt || Number.isNaN(Date.parse(index.expiresAt))) throw new Error('署名一覧の有効期限が不正です');
    if (Date.parse(index.issuedAt) > now + 5 * 60_000) throw new Error('署名一覧の発行日時が未来です');
    if (Date.parse(index.expiresAt) <= now) throw new Error('署名一覧の有効期限が切れています');
    if (index.signature?.algorithm !== 'Ed25519' || !index.signature?.keyId || !index.signature?.value) {
      throw new Error('配布レイヤー一覧の署名が不正です');
    }
  }
  for (const artifact of index.artifacts) {
    const label = `${artifact?.packageId || 'artifact'}/${artifact?.regionId || '?'}`;
    if (!artifact?.packageId || !artifact?.layerId || !artifact?.regionId || !artifact?.title) {
      throw new Error(`${label}の識別情報が不正です`);
    }
    if (artifact.description !== undefined && typeof artifact.description !== 'string') {
      throw new Error(`${label}の説明が不正です`);
    }
    assertRelativePath(artifact.path, `${label} path`);
    assertRelativePath(artifact.entrypoints?.container, `${label} Container`);
    if (artifact.archive !== undefined) {
      assertRelativePath(artifact.archive?.path, `${label} archive`);
      if (!artifact.archive?.fileName || !/\.zip$/i.test(artifact.archive.fileName)) {
        throw new Error(`${label}のarchive filenameが不正です`);
      }
      if (!Number.isSafeInteger(artifact.archive?.bytes) || artifact.archive.bytes < 1) {
        throw new Error(`${label}のarchive sizeが不正です`);
      }
      if (!/^[a-f0-9]{64}$/.test(artifact.archive?.sha256 || '')) {
        throw new Error(`${label}のarchive hashが不正です`);
      }
    }
    if (artifact.portability?.lawaModes?.tight !== 'supported') throw new Error(`${label}はtight非対応です`);
    if (!/^[a-f0-9]{64}$/.test(artifact.manifestSha256 || '')) throw new Error(`${label}のmanifest hashが不正です`);
    assertDistribution(artifact.distribution, label);
  }
  return index;
};

const base64UrlBytes = (value) => {
  const base64 = String(value).replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const verifyArtifactIndexSignature = async (index, trustStore, options = {}) => {
  validateArtifactIndex(index, { ...options, requireSignature: true });
  if (trustStore?.schemaVersion !== 1 || !Array.isArray(trustStore.keys)) {
    throw new Error('信頼済み公開鍵ストアが不正です');
  }
  const trusted = trustStore.keys.find((entry) => (
    entry?.keyId === index.signature.keyId && entry?.algorithm === 'Ed25519' && entry?.enabled !== false
  ));
  if (!trusted?.publicKeyJwk || !trusted.publisherId) throw new Error('署名鍵が信頼ストアにありません');
  if (index.artifacts.some((artifact) => artifact.distribution.publisher.id !== trusted.publisherId)) {
    throw new Error('署名者とartifact発行者が一致しません');
  }
  const key = await crypto.subtle.importKey('jwk', trusted.publicKeyJwk, { name: 'Ed25519' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    base64UrlBytes(index.signature.value),
    artifactIndexSigningPayload(index),
  );
  if (!valid) throw new Error('配布レイヤー一覧の署名を検証できません');
  return { keyId: trusted.keyId, publisherId: trusted.publisherId };
};

export const sha256Hex = async (value) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const resolveArtifactUrl = (artifact, indexUrl, relativePath) => {
  assertRelativePath(artifact.path, 'artifact path');
  assertRelativePath(relativePath, 'artifact file');
  const indexBase = new URL('./', indexUrl);
  const bundleBase = new URL(`${artifact.path}/`, indexBase);
  const resolved = new URL(relativePath, bundleBase);
  if (bundleBase.origin !== indexBase.origin || !bundleBase.href.startsWith(indexBase.href) || !resolved.href.startsWith(bundleBase.href)) {
    throw new Error('artifactの参照先が配布一覧の外です');
  }
  return resolved;
};

export const fetchVerifiedArtifactContainer = async (artifact, indexUrl, fetchImpl = fetch) => {
  const manifestUrl = resolveArtifactUrl(artifact, indexUrl, 'bundle.manifest.json');
  const manifestResponse = await fetchImpl(manifestUrl, { mode: 'cors' });
  if (!manifestResponse.ok) throw new Error(`${manifestResponse.status} bundle.manifest.json`);
  const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
  if (await sha256Hex(manifestBytes) !== artifact.manifestSha256) throw new Error('bundle manifestのhashが一致しません');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.packageId !== artifact.packageId || manifest.layerId !== artifact.layerId || manifest.regionId !== artifact.regionId) {
    throw new Error('bundle manifestの識別情報が一致しません');
  }
  if (canonicalizeJson(manifest.distribution) !== canonicalizeJson(artifact.distribution)) {
    throw new Error('bundle manifestの配布情報が一致しません');
  }
  if (canonicalizeJson(manifest.portability) !== canonicalizeJson(artifact.portability)) {
    throw new Error('bundle manifestの互換性情報が一致しません');
  }
  const containerPath = artifact.entrypoints.container;
  const declared = manifest.files?.find((file) => file.path === containerPath);
  if (!declared || !/^[a-f0-9]{64}$/.test(declared.sha256 || '')) throw new Error('Containerのhash宣言がありません');
  const containerUrl = resolveArtifactUrl(artifact, indexUrl, containerPath);
  const containerResponse = await fetchImpl(containerUrl, { mode: 'cors' });
  if (!containerResponse.ok) throw new Error(`${containerResponse.status} ${containerPath}`);
  const containerBytes = new Uint8Array(await containerResponse.arrayBuffer());
  if (await sha256Hex(containerBytes) !== declared.sha256) throw new Error('Containerのhashが一致しません');
  return { text: new TextDecoder().decode(containerBytes), url: containerUrl.href, manifest };
};
