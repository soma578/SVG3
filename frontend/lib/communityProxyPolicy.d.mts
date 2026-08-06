export const COMMUNITY_PROXY_PATH: string
export const COMMUNITY_PROXY_MAX_BYTES: number
export function communityProxyTargets(): Array<{ hostname: string; pathnamePrefixes: string[] }>
export function validateCommunityProxyUrl(value: unknown): URL
export function fetchCommunityProxy(
  requestUrl: string,
  method?: string,
  fetchImpl?: typeof fetch,
): Promise<Response>
