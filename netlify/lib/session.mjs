// ==========================================
// 로그인 기능에서 함께 쓰는 도구 모음
// (이 폴더는 Netlify 서버 기능이 아니라, 서버 기능들이 불러다 쓰는 부품이에요)
// ==========================================
import crypto from 'node:crypto';

// 브라우저에 저장할 쿠키 이름
export const SESSION_COOKIE = 'kakao_session';   // 로그인 상태
export const STATE_COOKIE = 'kakao_oauth_state'; // 로그인 요청 위조 방지용 임시 값

// 로그인 유지 기간: 7일 (초 단위)
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// .env(배포 후에는 Netlify 환경 변수)에서 값을 꺼내요. 비어 있으면 오류를 내요.
// 오류 메시지에는 변수 "이름"만 들어가고, 값은 절대 넣지 않아요.
export function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`환경 변수 ${name} 이(가) 비어 있어요.`);
  }
  return value.trim();
}

// 요청이 https로 왔는지 확인 (배포 사이트는 https, 내 컴퓨터 테스트는 http)
export function isHttps(req) {
  return new URL(req.url).protocol === 'https:';
}

// 브라우저가 보낸 쿠키를 { 이름: 값 } 형태로 바꿔요
export function parseCookies(req) {
  const header = req.headers.get('cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

// 쿠키 한 개를 만드는 문자열을 만들어요
//  - HttpOnly: 웹페이지의 자바스크립트가 쿠키를 훔쳐 볼 수 없게 막아요
//  - SameSite=Lax: 다른 사이트에서 몰래 보낸 요청에는 쿠키가 따라가지 않게 해요
//  - Secure: https에서만 쿠키를 보내요 (배포 사이트에서만 켜요)
export function makeCookie(name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// 쿠키를 지우는 문자열 (유효 기간을 0으로)
export function clearCookie(name, { secure }) {
  return makeCookie(name, '', { maxAge: 0, secure });
}

// ---------- 로그인 상태(세션) 토큰 ----------
// 사용자 정보에 SESSION_SECRET으로 "서명"을 붙여요.
// 서명이 있으면 누군가 쿠키 내용을 몰래 바꿔도 바로 알아챌 수 있어요.

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(user, secret) {
  const payload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE, // 만료 시각
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

// 토큰이 진짜이고 아직 유효하면 사용자 정보를, 아니면 null을 돌려줘요
export function readSessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null; // 서명이 다름 = 위조되었거나 다른 비밀 값으로 만든 토큰
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null; // 만료됨
    return payload;
  } catch {
    return null;
  }
}

// 첫 화면으로 돌려보내는 응답 (오류가 있으면 주소 뒤에 오류 종류를 붙여요)
export function redirectHome(errorCode, extraHeaders = new Headers()) {
  const location = errorCode ? `/?login_error=${encodeURIComponent(errorCode)}` : '/';
  extraHeaders.set('Location', location);
  extraHeaders.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers: extraHeaders });
}
