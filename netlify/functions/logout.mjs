// ==========================================
// 로그아웃
// 주소: /.netlify/functions/logout
// 하는 일: 이 사이트의 로그인 쿠키를 지우고 첫 화면으로 돌려보내요.
// (카카오 계정 자체의 로그인은 그대로 남아 있어요)
// ==========================================
import { SESSION_COOKIE, isHttps, clearCookie, redirectHome } from '../lib/session.mjs';

export default async (req) => {
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, { secure: isHttps(req) }));
  return redirectHome(null, headers);
};
