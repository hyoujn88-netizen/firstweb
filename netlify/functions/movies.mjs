// ==========================================
// 영화 정보 가져오기 (TMDB = The Movie Database)
// 주소: /.netlify/functions/movies            → 최신 인기 영화 100편 (한국 기준)
//       /.netlify/functions/movies?id=12345   → 영화 1편의 자세한 정보 (감독·배우·예고편 등)
// 하는 일: TMDB에 영화 정보를 요청해서 웹페이지에 필요한 내용만 골라 돌려줘요.
// 토큰(TMDB_READ_ACCESS_TOKEN)은 이 서버 코드 안에서만 쓰여서 웹페이지에는 보이지 않아요.
// ==========================================
import { requireEnv } from '../lib/session.mjs';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
// TMDB는 한 번에 20편씩 줘요. 5번이면 100편이지만, 겹치는 영화를 빼면 모자랄 수 있어서
// 한 번 더(6번, 120편) 받아 앞에서부터 100편만 써요
const PAGES = 6;

function json(data, status = 200, maxAge = 3600) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 인기 순위는 자주 바뀌지 않아서 1시간 동안 같은 결과를 다시 써요
      'Cache-Control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

// TMDB 오류 → 웹페이지에 알려 줄 짧은 이름
class TmdbError extends Error {
  constructor(status) {
    super('TMDB ' + status);
    this.code = status === 401 ? 'key' : status === 404 ? 'notfound' : status === 429 ? 'limit' : 'api';
  }
}

async function tmdb(path, params, token) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token, accept: 'application/json' } });
  if (!res.ok) throw new TmdbError(res.status);
  return res.json();
}

const img = (path, size) => (path ? IMG + size + path : null);
const year = (date) => (date ? date.slice(0, 4) : '');
const rating = (m) => (m.vote_count >= 10 ? Math.round(m.vote_average * 10) / 10 : null); // 평가가 너무 적으면 점수 숨김

// ===== 인기 영화 100편 =====
async function popular(token) {
  const [genreData, ...pages] = await Promise.all([
    tmdb('/genre/movie/list', { language: 'ko' }, token),
    ...Array.from({ length: PAGES }, (_, i) =>
      tmdb('/movie/popular', { language: 'ko-KR', region: 'KR', page: String(i + 1) }, token)),
  ]);
  const genreName = new Map(genreData.genres.map((g) => [g.id, g.name]));

  // 페이지 사이에 순위가 바뀌면 같은 영화가 두 번 나올 수 있어서 한 번만 남겨요
  const seen = new Set();
  const movies = [];
  for (const page of pages) {
    for (const m of page.results) {
      if (m.adult || seen.has(m.id)) continue;
      seen.add(m.id);
      movies.push({
        id: m.id,
        title: m.title,
        originalTitle: m.original_title !== m.title ? m.original_title : '',
        overview: m.overview || '',
        release: m.release_date || '',
        year: year(m.release_date),
        rating: rating(m),
        votes: m.vote_count,
        genres: (m.genre_ids || []).map((id) => genreName.get(id)).filter(Boolean),
        poster: img(m.poster_path, 'w342'),
        backdrop: img(m.backdrop_path, 'w1280'),
      });
    }
  }
  return {
    movies: movies.slice(0, 100).map((m, i) => ({ rank: i + 1, ...m })),
    genres: genreData.genres.map((g) => g.name),
  };
}

// ===== 영화 1편 자세히 =====
async function detail(id, token) {
  const m = await tmdb(`/movie/${id}`, {
    language: 'ko-KR',
    append_to_response: 'credits,videos',
    include_video_language: 'ko,en', // 한국어 예고편이 없으면 영어 예고편
  }, token);

  const director = (m.credits?.crew || []).find((c) => c.job === 'Director');
  const cast = (m.credits?.cast || []).slice(0, 10).map((c) => ({
    id: c.id,
    name: c.name,
    character: c.character || '',
    photo: img(c.profile_path, 'w185'),
  }));
  // 유튜브 예고편 하나 고르기 (한국어 → 영어, 공식 예고편 먼저)
  const videos = (m.videos?.results || []).filter((v) => v.site === 'YouTube' && /^[\w-]{6,20}$/.test(v.key));
  const score = (v) => (v.iso_639_1 === 'ko' ? 0 : 2) + (v.type === 'Trailer' ? 0 : 1) - (v.official ? 0.5 : 0);
  const trailer = videos.sort((a, b) => score(a) - score(b))[0];

  return {
    id: m.id,
    title: m.title,
    originalTitle: m.original_title !== m.title ? m.original_title : '',
    tagline: m.tagline || '',
    overview: m.overview || '',
    release: m.release_date || '',
    runtime: m.runtime || null,
    rating: rating(m),
    votes: m.vote_count,
    genres: (m.genres || []).map((g) => g.name),
    countries: (m.production_countries || []).map((c) => c.iso_3166_1),
    director: director ? director.name : '',
    cast,
    trailer: trailer ? trailer.key : null,
    poster: img(m.poster_path, 'w500'),
    backdrop: img(m.backdrop_path, 'w1280'),
  };
}

// ===== 배우 1명 자세히 =====
const DEPARTMENT = { Acting: '배우', Directing: '감독', Writing: '각본', Production: '제작', Sound: '음악', Camera: '촬영', Editing: '편집' };

function age(birthday, deathday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  const end = deathday ? new Date(deathday) : new Date();
  let a = end.getFullYear() - b.getFullYear();
  if (end.getMonth() < b.getMonth() || (end.getMonth() === b.getMonth() && end.getDate() < b.getDate())) a--;
  return a;
}

async function person(id, token) {
  // 한국어 정보 + 영어 정보(영어 이름, 한국어 소개가 없을 때 대신 보여 줄 영어 소개)를 함께 받아요
  const [ko, en] = await Promise.all([
    tmdb(`/person/${id}`, { language: 'ko-KR', append_to_response: 'movie_credits' }, token),
    tmdb(`/person/${id}`, { language: 'en-US' }, token),
  ]);

  // 출연작: 같은 영화가 여러 번(다른 배역) 나오면 한 번만, 인기 많은 순으로 12편
  const seen = new Set();
  const movies = (ko.movie_credits?.cast || [])
    .filter((c) => !c.adult && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 12)
    .map((c) => ({
      id: c.id,
      title: c.title,
      character: c.character || '',
      year: year(c.release_date),
      release: c.release_date || '',
      rating: rating(c),
      poster: img(c.poster_path, 'w185'),
    }));

  // 소개글 속 *영화 제목* 같은 별표 꾸밈 기호는 빼고 글자만 남겨요
  const plain = (s) => (s || '').replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1').trim();
  const bioKo = plain(ko.biography);
  return {
    id: ko.id,
    name: ko.name,
    englishName: en.name && en.name !== ko.name ? en.name : '',
    photo: img(ko.profile_path, 'w342'),
    job: DEPARTMENT[ko.known_for_department] || ko.known_for_department || '',
    birthday: ko.birthday || '',
    deathday: ko.deathday || '',
    age: age(ko.birthday, ko.deathday),
    birthplace: ko.place_of_birth || '',
    biography: bioKo || plain(en.biography),
    biographyLang: bioKo ? 'ko' : (en.biography ? 'en' : ''),
    movieCount: seen.size,
    movies,
  };
}

export default async (req) => {
  let token;
  try {
    token = requireEnv('TMDB_READ_ACCESS_TOKEN');
  } catch (error) {
    console.error('[movies] 설정 오류:', error.message);
    return json({ error: 'config' }, 500);
  }

  const params = new URL(req.url).searchParams;
  const idParam = params.get('id');
  const personParam = params.get('person');
  try {
    if (personParam !== null) {
      if (!/^\d{1,9}$/.test(personParam)) return json({ error: 'bad' }, 400);
      return json(await person(personParam, token), 200, 86400); // 배우 정보는 하루 동안 다시 써요
    }
    if (idParam !== null) {
      if (!/^\d{1,9}$/.test(idParam)) return json({ error: 'bad' }, 400);
      return json(await detail(idParam, token), 200, 86400); // 영화 정보는 하루 동안 다시 써요
    }
    return json(await popular(token));
  } catch (error) {
    console.error('[movies] 요청 실패:', error.message);
    return json({ error: error.code || 'network' }, error.code === 'notfound' ? 404 : 502);
  }
};
