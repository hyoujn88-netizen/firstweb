// ==========================================
// [1단계] 카카오 로그인 시작
// 주소: /.netlify/functions/kakao-login
// 하는 일: 사용자를 카카오 로그인 화면으로 보내요.
// ==========================================
import crypto from 'node:crypto';
import {
  STATE_COOKIE,
  requireEnv,
  isHttps,
  makeCookie,
  redirectHome,
} from '../lib/session.mjs';

export default async (req) => {
  try {
    const clientId = requireEnv('KAKAO_REST_API_KEY');
    const redirectUri = requireEnv('KAKAO_REDIRECT_URI');

    // state: 매번 새로 만드는 무작위 값이에요.
    // 카카오에서 돌아왔을 때 이 값이 같은지 확인해서, 남이 꾸민 로그인 요청을 막아요.
    const state = crypto.randomBytes(16).toString('hex');

    const kakaoUrl = new URL('https://kauth.kakao.com/oauth/authorize');
    kakaoUrl.searchParams.set('response_type', 'code');
    kakaoUrl.searchParams.set('client_id', clientId);
    kakaoUrl.searchParams.set('redirect_uri', redirectUri);
    kakaoUrl.searchParams.set('state', state);

    const headers = new Headers({
      Location: kakaoUrl.toString(),
      'Cache-Control': 'no-store',
    });
    // state 값은 10분 동안만 보관해요
    headers.append('Set-Cookie', makeCookie(STATE_COOKIE, state, { maxAge: 600, secure: isHttps(req) }));

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('[kakao-login] 설정 오류:', error.message);
    return redirectHome('config');
  }
};
