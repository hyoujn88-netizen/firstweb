// ==========================================
// 지금 로그인한 사람 정보 알려 주기
// 주소: /.netlify/functions/me
// 하는 일: 웹페이지가 물어보면 로그인 여부와 닉네임·프로필 사진을 알려 줘요.
// ==========================================
import { SESSION_COOKIE, requireEnv, parseCookies, readSessionToken } from '../lib/session.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  try {
    const secret = requireEnv('SESSION_SECRET');
    const session = readSessionToken(parseCookies(req)[SESSION_COOKIE], secret);
    if (!session) return json({ loggedIn: false });

    const { id, nickname, profileImage } = session;
    return json({ loggedIn: true, user: { id, nickname, profileImage } });
  } catch (error) {
    console.error('[me] 설정 오류:', error.message);
    return json({ loggedIn: false, error: 'config' }, 500);
  }
};
