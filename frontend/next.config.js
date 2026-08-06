/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next is only the deployment adapter for generated static SVGMap assets.
  output: 'standalone',
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), interest-cohort=()' },
        ],
      },
      {
        // マップデータ JSON — 5分キャッシュ、バックグラウンド再検証
        source: '/map/data/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=60' },
        ],
      },
      {
        // WebApp HTML / JS / レイヤーSVG = コード。長期キャッシュするとデプロイと実態が乖離する
        // （SVGMap の disableCacheQuery は controller HTML にしか効かず、ES module import や
        //   レイヤーSVG は古いまま残る）。ETag 再検証(304)なので実コストはほぼゼロ。
        source: '/map/webapp/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, no-cache' },
        ],
      },
      {
        // allow-same-originを持たないcontroller iframeはopaque originになる。
        // S-LaWAのES moduleとその相対importだけをCORSで読み込めるようにする。
        source: '/map/vendor/svgmapjs/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Cache-Control', value: 'public, no-cache' },
        ],
      },
      {
        // アイコン / 地域境界 SVG — 1日キャッシュ
        source: '/map/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' },
        ],
      },
      {
        // runtime-config / municipalities = 設定。publish や設定変更が即反映されるべき
        source: '/map/regions/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, no-cache' },
        ],
      },
      {
        // コンテナSVG = 生成された設定ファイル。レイヤー構成変更が即反映されるべき
        source: '/map/containers/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, no-cache' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
