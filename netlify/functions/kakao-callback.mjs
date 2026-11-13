// ==========================================
// [2단계] 카카오 로그인 후 돌아오는 곳 (Redirect URI)
// 주소: /.netlify/functions/kakao-callback
// 하는 일:
//   1) 카카오가 준 "인가 코드"로 "액세스 토큰"(사용자 정보를 볼 수 있는 출입증)을 받아요
//   2) 액세스 토큰으로 카카오에서 사용자 정보(닉네임, 프로필 사진)를 받아요
//   3) 로그인 상태를 쿠키에 저장하고 첫 화면으로 돌려보내요
// ==========================================
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_MAX_AGE,
  requireEnv,
  isHttps,
  parseCookies,
  makeCookie,
  clearCookie,
  createSessionToken,
  redirectHome,
} from '../lib/session.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const secure = isHttps(req);

  // 어떤 결과든 임시 state 쿠키는 지워요
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE, { secure }));

  // 사용자가 카카오 화면에서 "취소"를 눌렀거나 오류가 난 경우
  const kakaoError = url.searchParams.get('error');
  if (kakaoError) {
    console.error('[kakao-callback] 카카오가 오류를 알려 줌:', kakaoError);
    return redirectHome(kakaoError === 'access_denied' ? 'denied' : 'kakao', headers);
  }

  // 로그인 요청 위조 확인: 보낼 때 저장한 state와 돌아온 state가 같아야 해요
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const savedState = parseCookies(req)[STATE_COOKIE];
  if (!code || !returnedState || !savedState || returnedState !== savedState) {
    console.error('[kakao-callback] state 값이 맞지 않아 로그인을 중단함');
    return redirectHome('state', headers);
  }

  try {
    const clientId = requireEnv('KAKAO_REST_API_KEY');
    const redirectUri = requireEnv('KAKAO_REDIRECT_URI');
    const sessionSecret = requireEnv('SESSION_SECRET');
    const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim(); // 사용 설정한 경우에만 필요

    // 1) 인가 코드 → 액세스 토큰
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
    });
    if (clientSecret) tokenBody.set('client_secret', clientSecret);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenBody,
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      // 오류 종류만 기록해요 (키 값은 기록하지 않아요)
      console.error('[kakao-callback] 토큰 받기 실패:', tokenRes.status, token.error, token.error_code, token.error_description);
      return redirectHome('token', headers);
    }

    // 2) 액세스 토큰 → 사용자 정보
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const kakaoUser = await userRes.json().catch(() => ({}));
    if (!userRes.ok || !kakaoUser.id) {
      console.error('[kakao-callback] 사용자 정보 받기 실패:', userRes.status, kakaoUser.code, kakaoUser.msg);
      return redirectHome('profile', headers);
    }

    const profile = kakaoUser.kakao_account?.profile ?? {};
    const user = {
      id: String(kakaoUser.id),
      nickname: profile.nickname ?? kakaoUser.properties?.nickname ?? '카카오 사용자',
      profileImage: profile.thumbnail_image_url ?? kakaoUser.properties?.thumbnail_image ?? null,
    };

    // 3) 로그인 상태 저장
    headers.append(
      'Set-Cookie',
      makeCookie(SESSION_COOKIE, createSessionToken(user, sessionSecret), { maxAge: SESSION_MAX_AGE, secure }),
    );
    return redirectHome(null, headers);
  } catch (error) {
    console.error('[kakao-callback] 처리 중 오류:', error.message);
    return redirectHome('server', headers);
  }
};
