// ==========================================
// 배우 소개글 한국어 번역 (Claude API)
// 주소: /.netlify/functions/bio-ko?person=12345
// 하는 일: TMDB에서 배우의 영어 소개글을 가져와 Claude로 한국어로 번역해 돌려줘요.
// - 아무 글이나 번역해 주는 기능이 되지 않도록, 글 대신 "배우 번호"만 받아요.
// - Claude API는 쓴 만큼 요금이 나가서 카카오 로그인한 사람만 쓸 수 있어요.
// - 참고: TMDB 약관에는 TMDB 내용을 AI와 함께 쓰는 것을 막는 조항이 있어요.
//   사이트 주인이 그 위험을 알고 이 기능을 넣기로 했어요.
// ==========================================
import Anthropic from '@anthropic-ai/sdk';
import { SESSION_COOKIE, requireEnv, parseCookies, readSessionToken } from '../lib/session.mjs';

const MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = `You translate English biographies of film actors and filmmakers into natural, fluent Korean for a Korean movie website.
- Output only the Korean translation. No preface, notes, or quotation marks.
- Keep the paragraph breaks of the original.
- Write people's names in the Korean spelling commonly used in Korean media (e.g. Matt Damon → 맷 데이먼). If unsure, transliterate.
- For film and TV titles, use the official Korean release title when you are confident of it; otherwise keep the original title.
- Do not add, remove, or summarize information.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 같은 배우의 번역은 이 브라우저에서 1주일 동안 다시 써요 (요금 절약)
      'Cache-Control': status === 200 ? 'private, max-age=604800' : 'no-store',
    },
  });
}

export default async (req) => {
  // 1) 설정 확인
  let apiKey, sessionSecret, tmdbToken;
  try {
    apiKey = requireEnv('CLAUDE_API_KEY');
    sessionSecret = requireEnv('SESSION_SECRET');
    tmdbToken = requireEnv('TMDB_READ_ACCESS_TOKEN');
  } catch (error) {
    console.error('[bio-ko] 설정 오류:', error.message);
    return json({ error: 'config' }, 500);
  }

  // 2) 카카오 로그인한 사람인지 확인
  if (!readSessionToken(parseCookies(req)[SESSION_COOKIE], sessionSecret)) {
    return json({ error: 'login' }, 401);
  }

  // 3) 배우 번호 확인 → TMDB에서 영어 소개글 가져오기
  const id = new URL(req.url).searchParams.get('person');
  if (!id || !/^\d{1,9}$/.test(id)) return json({ error: 'bad' }, 400);

  let english;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/person/${id}?language=en-US`, {
      headers: { Authorization: 'Bearer ' + tmdbToken, accept: 'application/json' },
    });
    if (!res.ok) return json({ error: res.status === 404 ? 'notfound' : 'tmdb' }, 502);
    const p = await res.json();
    english = (p.biography || '').replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1').trim();
  } catch (error) {
    console.error('[bio-ko] TMDB 요청 실패:', error.message);
    return json({ error: 'network' }, 502);
  }
  if (!english) return json({ error: 'empty' }, 404);

  // 4) Claude로 번역
  // 키와 주소를 직접 정해서, 컴퓨터의 다른 Claude 설정과 섞이지 않게 해요
  const client = new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com' });
  try {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: english }],
      output_config: { effort: 'low' },          // 번역은 깊은 생각이 필요 없어서 빠르게
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                       // 안전 판단으로 거절하면 다른 모델이 이어서 처리
    });

    if (message.stop_reason === 'refusal') return json({ error: 'refusal' }, 422);
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) return json({ error: 'api' }, 502);
    return json({ text, truncated: message.stop_reason === 'max_tokens' });
  } catch (error) {
    console.error('[bio-ko] Claude API 오류:', error?.status ?? '', error?.message);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return json({ error: 'key' }, 502);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'limit' }, 429);
    if (error instanceof Anthropic.APIConnectionError) return json({ error: 'network' }, 502);
    return json({ error: 'api' }, 502);
  }
};
