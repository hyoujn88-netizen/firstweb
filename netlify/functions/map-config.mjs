// ==========================================
// 카카오 지도 설정 알려 주기
// 주소: /.netlify/functions/map-config
// 하는 일: 웹페이지가 카카오 지도를 띄울 때 필요한 "JavaScript 키"를 알려 줘요.
// 참고: JavaScript 키는 원래 브라우저에서 쓰라고 만든 키라서 웹페이지에 보여도 괜찮아요.
//       (카카오 개발자 콘솔에 등록한 사이트 주소에서만 작동해요)
//       반대로 REST API 키·Client Secret은 절대 여기서 내보내면 안 돼요.
// ==========================================
import { requireEnv } from '../lib/session.mjs';

export default async () => {
  try {
    const kakaoJsKey = requireEnv('KAKAO_JAVASCRIPT_KEY');
    return new Response(JSON.stringify({ kakaoJsKey }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (error) {
    console.error('[map-config] 설정 오류:', error.message);
    return new Response(JSON.stringify({ error: 'config' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
