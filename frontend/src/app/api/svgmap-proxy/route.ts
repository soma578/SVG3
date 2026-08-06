import { fetchCommunityProxy } from '../../../../lib/communityProxyPolicy.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return fetchCommunityProxy(request.url, 'GET')
}

export async function HEAD(request: Request) {
  return fetchCommunityProxy(request.url, 'HEAD')
}
