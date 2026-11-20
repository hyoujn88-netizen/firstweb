// ==========================================
// 뉴스 가져오기
// 주소: /.netlify/functions/news?q=검색어   (검색어로 찾은 한국어 뉴스)
//       /.netlify/functions/news?top=us     (미국 주요 뉴스)
// 하는 일: newsapi.org에 뉴스를 요청해서 웹페이지에 필요한 내용만 골라 돌려줘요.
// API 키는 이 서버 코드 안에서만 쓰여서, 웹페이지를 보는 사람에게는 보이지 않아요.
// ==========================================
import { requireEnv } from '../lib/session.mjs';

const PAGE_SIZE = 24; // 한 번에 보여 줄 뉴스 개수

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 같은 요청은 5분 동안 다시 쓰기 (무료 요금제의 하루 요청 횟수를 아끼려고)
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    },
  });
}

// http/https 주소만 통과시켜요 (이상한 주소가 링크·그림에 들어가지 않게)
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export default async (req) => {
  let apiKey;
  try {
    apiKey = requireEnv('NEWS_API_KEY');
  } catch (error) {
    console.error('[news] 설정 오류:', error.message);
    return json({ error: 'config' }, 500);
  }

  const params = new URL(req.url).searchParams;
  const api = new URL('https://newsapi.org/v2/');

  if (params.get('top') === 'us') {
    // 미국 주요 뉴스 (한국(kr)은 요청해도 결과가 0개라서 쓰지 않아요)
    api.pathname += 'top-headlines';
    api.searchParams.set('country', 'us');
  } else {
    // 검색어로 한국어 뉴스 찾기 (최신순)
    const q = (params.get('q') || '보안').trim().slice(0, 100);
    if (!q) return json({ error: 'empty' }, 400);
    api.pathname += 'everything';
    api.searchParams.set('q', q);
    api.searchParams.set('language', 'ko');
    api.searchParams.set('sortBy', 'publishedAt');
  }
  api.searchParams.set('pageSize', String(PAGE_SIZE));

  try {
    const res = await fetch(api, {
      headers: { 'X-Api-Key': apiKey, 'User-Agent': 'firstweb-news/1.0' },
    });
    const data = await res.json();

    if (data.status !== 'ok') {
      console.error('[news] newsapi 오류:', res.status, data.code, data.message);
      const code = data.code === 'rateLimited' ? 'limit'
        : (data.code === 'apiKeyInvalid' || data.code === 'apiKeyMissing') ? 'key'
        : 'api';
      return json({ error: code }, 502);
    }

    const articles = (data.articles || [])
      .filter((a) => a.title && a.title !== '[Removed]' && safeUrl(a.url))
      .map((a) => ({
        title: a.title,
        description: a.description || '',
        url: safeUrl(a.url),
        image: safeUrl(a.urlToImage),
        source: a.source?.name || '',
        publishedAt: a.publishedAt || '',
      }));

    return json({ articles });
  } catch (error) {
    console.error('[news] 요청 실패:', error.message);
    return json({ error: 'network' }, 502);
  }
};
