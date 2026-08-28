export class PortableNetworkPolicyError extends Error {
  constructor(message, code = 'NETWORK_POLICY_DENIED') {
    super(message);
    this.name = 'PortableNetworkPolicyError';
    this.code = code;
  }
}

const MODES = new Set(['none', 'static', 'bundled-snapshot', 'snapshot-required', 'controlled-direct', 'user-action-direct', 'tile-direct']);

const validateContract = (network) => {
  if (!network || typeof network !== 'object' || Array.isArray(network)) {
    throw new PortableNetworkPolicyError('portable network contract is missing', 'NETWORK_CONTRACT_MISSING');
  }
  if (network.schemaVersion !== 1 || !MODES.has(network.mode)) {
    throw new PortableNetworkPolicyError('portable network contract is unsupported', 'NETWORK_CONTRACT_INVALID');
  }
  if (network.failClosed !== true) {
    throw new PortableNetworkPolicyError('portable network contract must fail closed', 'NETWORK_CONTRACT_INVALID');
  }
  if (!Array.isArray(network.allowedOrigins)) {
    throw new PortableNetworkPolicyError('allowedOrigins must be an array', 'NETWORK_CONTRACT_INVALID');
  }
  if (!Number.isFinite(Number(network.minimumIntervalSeconds)) || Number(network.minimumIntervalSeconds) < 0
    || !Number.isFinite(Number(network.cacheSeconds)) || Number(network.cacheSeconds) < 0) {
    throw new PortableNetworkPolicyError('network timing values must be non-negative', 'NETWORK_CONTRACT_INVALID');
  }
  if (!Number.isInteger(network.maxConcurrency) || network.maxConcurrency < 1) {
    throw new PortableNetworkPolicyError('maxConcurrency must be a positive integer', 'NETWORK_CONTRACT_INVALID');
  }
  if (!Number.isInteger(network.retry?.maxAttempts)
    || network.retry.maxAttempts < 1
    || network.retry.maxAttempts > 3
    || !Number.isFinite(Number(network.retry?.backoffMilliseconds))
    || Number(network.retry.backoffMilliseconds) < 0) {
    throw new PortableNetworkPolicyError('retry policy is invalid', 'NETWORK_CONTRACT_INVALID');
  }
  if (network.mode === 'bundled-snapshot') {
    if (network.runtimeExternalFetch !== false
      || network.sameOriginOnly !== true
      || network.externalFallback !== false
      || network.allowedOrigins.length !== 0) {
      throw new PortableNetworkPolicyError(
        'bundled-snapshot must stay inside its bundle and disable external fallback',
        'NETWORK_CONTRACT_INVALID',
      );
    }
  }
  if (['none', 'static', 'snapshot-required'].includes(network.mode)
    && (network.runtimeExternalFetch !== false || network.allowedOrigins.length !== 0)) {
    throw new PortableNetworkPolicyError(
      `${network.mode} must disable external runtime fetches`,
      'NETWORK_CONTRACT_INVALID',
    );
  }
  if (['controlled-direct', 'user-action-direct', 'tile-direct'].includes(network.mode)
    && (network.runtimeExternalFetch !== true || network.allowedOrigins.length === 0)) {
    throw new PortableNetworkPolicyError(
      `${network.mode} requires explicit allowed origins`,
      'NETWORK_CONTRACT_INVALID',
    );
  }
  return network;
};

const bundleAssetRoot = (manifestUrl) => {
  const url = new URL(manifestUrl);
  const mapSegment = 'map';
  const marker = `/${mapSegment}/layers/portable/`;
  const markerIndex = url.pathname.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new PortableNetworkPolicyError(
      'bundled-snapshot manifest must be inside /map/layers/portable/',
      'NETWORK_CONTRACT_INVALID',
    );
  }
  return `${url.pathname.slice(0, markerIndex)}/${mapSegment}/`.replace(/\/+/g, '/');
};

const assertBundledSnapshotUrl = (input, { manifestUrl, baseUrl }) => {
  const resolvedManifestUrl = new URL(manifestUrl, baseUrl).href;
  const url = new URL(String(input), baseUrl);
  const manifestOrigin = new URL(resolvedManifestUrl).origin;
  if (url.origin !== manifestOrigin) {
    throw new PortableNetworkPolicyError(`external origin is not permitted: ${url.origin}`);
  }
  const root = bundleAssetRoot(resolvedManifestUrl);
  if (!url.pathname.startsWith(root)) {
    throw new PortableNetworkPolicyError(
      `same-origin URL is outside the bundled map assets: ${url.pathname}`,
      'BUNDLE_PATH_REQUIRED',
    );
  }
  return url.href;
};

export const validateBundledSnapshotFragment = ({
  rawHash,
  manifestUrl,
  baseUrl,
  defaults = {},
  required = [],
  urlParams = [],
  forbidden = [],
}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(defaults || {})) {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  }
  const injected = new URLSearchParams(String(rawHash || '').replace(/^#/, ''));
  for (const [key, value] of injected) params.set(key, value);
  for (const key of required) {
    if (!params.get(key)) {
      throw new PortableNetworkPolicyError(`required data parameter is missing: ${key}`, 'DATA_PARAMETER_REQUIRED');
    }
  }
  for (const key of forbidden) {
    if (params.has(key)) {
      throw new PortableNetworkPolicyError(`data parameter is forbidden by this package: ${key}`, 'DATA_PARAMETER_FORBIDDEN');
    }
  }
  for (const key of urlParams) {
    const value = params.get(key);
    if (value) assertBundledSnapshotUrl(value, { manifestUrl, baseUrl });
  }
  return params;
};

const responseFromCache = (entry) => {
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.response.clone();
};

export const createPortableNetworkClient = ({
  manifestUrl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseUrl = globalThis.location?.href,
} = {}) => {
  if (!manifestUrl || typeof fetchImpl !== 'function') {
    throw new PortableNetworkPolicyError('manifestUrl and fetch implementation are required', 'NETWORK_CLIENT_INVALID');
  }

  const resolvedManifestUrl = new URL(manifestUrl, baseUrl).href;
  const runtimeOrigin = new URL(baseUrl || resolvedManifestUrl).origin;
  let contractPromise = null;
  let active = 0;
  const waiters = [];
  const memoryCache = new Map();
  const lastRequestAt = new Map();

  const assertRequestAllowed = (request, policy) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method !== 'GET') {
      throw new PortableNetworkPolicyError(`method is not permitted: ${method}`);
    }

    const external = url.origin !== runtimeOrigin;
    if (external) {
      if (policy.runtimeExternalFetch !== true || !policy.allowedOrigins.includes(url.origin)) {
        throw new PortableNetworkPolicyError(`external origin is not permitted: ${url.origin}`);
      }
    } else if (policy.mode === 'bundled-snapshot') {
      assertBundledSnapshotUrl(url.href, { manifestUrl: resolvedManifestUrl, baseUrl });
    }
    return { url, external };
  };

  const contract = async () => {
    if (!contractPromise) {
      contractPromise = (async () => {
        const response = await fetchImpl(resolvedManifestUrl, { method: 'GET', cache: 'no-store' });
        if (!response.ok) {
          throw new PortableNetworkPolicyError(`network contract manifest unavailable: HTTP ${response.status}`, 'NETWORK_CONTRACT_UNAVAILABLE');
        }
        const manifest = await response.json();
        return validateContract(manifest.network);
      })().catch((error) => {
        contractPromise = null;
        if (error instanceof PortableNetworkPolicyError) throw error;
        throw new PortableNetworkPolicyError(`network contract could not be loaded: ${error.message}`, 'NETWORK_CONTRACT_UNAVAILABLE');
      });
    }
    return contractPromise;
  };

  const acquire = async (limit) => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    active += 1;
  };

  const release = () => {
    active = Math.max(0, active - 1);
    waiters.shift()?.();
  };

  const safeFetch = async (input, init = {}, context = {}) => {
    const policy = await contract();
    const request = input instanceof Request ? input : new Request(new URL(String(input), baseUrl).href, init);
    const { external } = assertRequestAllowed(request, policy);
    if (external && policy.mode === 'user-action-direct' && context.userAction !== true) {
      throw new PortableNetworkPolicyError('external request requires an explicit user action', 'USER_ACTION_REQUIRED');
    }

    const cacheSeconds = Math.max(0, Number(policy.cacheSeconds) || 0);
    const cached = responseFromCache(memoryCache.get(request.url));
    if (cached) return cached;

    const minimumIntervalMs = Math.max(0, Number(policy.minimumIntervalSeconds) || 0) * 1000;
    const previous = lastRequestAt.get(request.url) || 0;
    if (minimumIntervalMs && Date.now() - previous < minimumIntervalMs) {
      throw new PortableNetworkPolicyError('request cooldown is active', 'REQUEST_COOLDOWN');
    }

    await acquire(policy.maxConcurrency);
    try {
      lastRequestAt.set(request.url, Date.now());
      const attempts = Math.max(1, Math.min(3, Number(policy.retry?.maxAttempts) || 1));
      let response;
      let lastError;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          response = await fetchImpl(request.clone());
          if (response.status < 500 || attempt + 1 >= attempts) break;
        } catch (error) {
          lastError = error;
          if (attempt + 1 >= attempts) throw error;
        }
        const delay = Math.max(0, Number(policy.retry?.backoffMilliseconds) || 0) * (2 ** attempt);
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (!response && lastError) throw lastError;
      if (cacheSeconds > 0 && response?.ok) {
        memoryCache.set(request.url, {
          expiresAt: Date.now() + cacheSeconds * 1000,
          response: response.clone(),
        });
      }
      return response;
    } finally {
      release();
    }
  };

  const assertUrlAllowed = async (input) => {
    const policy = await contract();
    const request = input instanceof Request ? input : new Request(new URL(String(input), baseUrl).href);
    assertRequestAllowed(request, policy);
    return request.url;
  };

  const validateFragment = async (rawHash, {
    required = [],
    urlParams = [],
    forbidden = [],
  } = {}) => {
    const params = new URLSearchParams(String(rawHash || '').replace(/^#/, ''));
    for (const key of required) {
      if (!params.get(key)) {
        throw new PortableNetworkPolicyError(`required data parameter is missing: ${key}`, 'DATA_PARAMETER_REQUIRED');
      }
    }
    for (const key of forbidden) {
      if (params.has(key)) {
        throw new PortableNetworkPolicyError(`data parameter is forbidden by this package: ${key}`, 'DATA_PARAMETER_FORBIDDEN');
      }
    }
    for (const key of urlParams) {
      const value = params.get(key);
      if (value) await assertUrlAllowed(value);
    }
    return params;
  };

  return { fetch: safeFetch, contract, assertUrlAllowed, validateFragment };
};
