import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * S-LaWA cross-origin iframe support middleware
 *
 * next.config.js の headers() で同一キーの上書きができないため、
 * Middleware で /map/layers/**\/*.html の X-Frame-Options を削除し、
 * frame-ancestors * の CSP で代替する。
 *
 * これにより第三者ホストの SVGMap から controller HTML を
 * cross-origin iframe としてロードできるようになる。
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const { pathname } = request.nextUrl;

  // /map/layers/ 以下の .html ファイルのみ対象
  if (pathname.startsWith('/map/layers/') && pathname.endsWith('.html')) {
    // ブラウザが X-Frame-Options と CSP frame-ancestors を両方見る場合、
    // X-Frame-Options が優先されることがあるため削除する
    response.headers.delete('X-Frame-Options');

    // 現代ブラウザ向け: どのオリジンからでも iframe 埋め込みを許可
    response.headers.set('Content-Security-Policy', "frame-ancestors *");

    // controller HTML 自体と相対 import も CORS で取得可能にする
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  return response;
}

export const config = {
  // _next/static, _next/image, favicon は除外してパフォーマンスを確保
  matcher: ['/map/layers/:path*.html'],
};
