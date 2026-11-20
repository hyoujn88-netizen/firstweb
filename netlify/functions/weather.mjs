// ==========================================
// 날씨 가져오기
// 주소: /.netlify/functions/weather?lat=37.5665&lon=126.978
// 하는 일: openweathermap.org에서 "현재 날씨"와 "5일 예보(3시간 간격)"를 받아
//          웹페이지가 쓰기 좋게 정리해서 돌려줘요.
// API 키는 이 서버 코드 안에서만 쓰여서, 웹페이지를 보는 사람에게는 보이지 않아요.
// ==========================================
import { requireEnv } from '../lib/session.mjs';

const BASE = 'https://api.openweathermap.org/data/2.5/';
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 같은 요청은 10분 동안 다시 쓰기 (날씨는 자주 바뀌지 않고, 요청 횟수도 아껴요)
      'Cache-Control': status === 200 ? 'public, max-age=600' : 'no-store',
    },
  });
}

// 그 지역 시간으로 바꾸기 (tz = 세계 표준시와의 차이, 초 단위)
function local(dt, tz) {
  const d = new Date((dt + tz) * 1000);
  return {
    key: d.toISOString().slice(0, 10), // 날짜별로 묶을 때 쓰는 값 (예: 2026-11-20)
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    day: d.getUTCDay(),
    month: d.getUTCMonth() + 1,
    date: d.getUTCDate(),
  };
}
const hhmm = (t) => String(t.hour).padStart(2, '0') + ':' + String(t.minute).padStart(2, '0');
const round = (n) => Math.round(n);

export default async (req) => {
  let apiKey;
  try {
    apiKey = requireEnv('WHEATHER_API_KEY');
  } catch (error) {
    console.error('[weather] 설정 오류:', error.message);
    return json({ error: 'config' }, 500);
  }

  // 위도(lat)·경도(lon)가 올바른 숫자인지 확인
  const params = new URL(req.url).searchParams;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'bad' }, 400);
  }

  const query = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    units: 'metric', // 섭씨(℃)
    lang: 'kr',      // 날씨 설명을 한국어로
    appid: apiKey,
  });

  try {
    const [nowRes, fcRes] = await Promise.all([
      fetch(BASE + 'weather?' + query),
      fetch(BASE + 'forecast?' + query),
    ]);
    const now = await nowRes.json();
    const fc = await fcRes.json();

    if (!nowRes.ok || !fcRes.ok) {
      const status = nowRes.ok ? fcRes.status : nowRes.status;
      console.error('[weather] openweathermap 오류:', status, (nowRes.ok ? fc : now).message);
      const code = status === 401 ? 'key' : status === 429 ? 'limit' : 'api';
      return json({ error: code }, 502);
    }

    const tz = now.timezone || 0;

    // ===== 현재 날씨 =====
    const current = {
      place: now.name || '',
      temp: round(now.main.temp),
      feels: round(now.main.feels_like),
      humidity: now.main.humidity,
      wind: Math.round(now.wind.speed * 10) / 10,
      clouds: now.clouds?.all ?? null,
      description: now.weather[0].description,
      main: now.weather[0].main,   // Clear, Clouds, Rain, Snow … (배경색 고를 때 써요)
      icon: now.weather[0].icon,   // 아이콘 이름 (끝 글자 d=낮, n=밤)
      sunrise: hhmm(local(now.sys.sunrise, tz)),
      sunset: hhmm(local(now.sys.sunset, tz)),
      updated: hhmm(local(now.dt, tz)),
    };

    // ===== 시간별 예보 (앞으로 24시간, 3시간 간격 8개) =====
    const hourly = fc.list.slice(0, 8).map((item) => {
      const t = local(item.dt, tz);
      return {
        label: t.hour + '시',
        temp: round(item.main.temp),
        icon: item.weather[0].icon,
        description: item.weather[0].description,
        pop: Math.round((item.pop || 0) * 100), // 비·눈 올 확률(%)
      };
    });

    // ===== 날짜별 예보 (3시간 간격 예보를 하루 단위로 묶기) =====
    const todayKey = local(now.dt, tz).key;
    const byDay = new Map();
    for (const item of fc.list) {
      const t = local(item.dt, tz);
      if (!byDay.has(t.key)) byDay.set(t.key, { t, items: [] });
      byDay.get(t.key).items.push({ item, hour: t.hour });
    }
    const daily = [...byDay.values()].map(({ t, items }) => {
      const temps = items.map((x) => x.item.main.temp);
      if (t.key === todayKey) temps.push(now.main.temp); // 오늘은 지금 기온도 넣어요
      // 대표 날씨: 낮 12시에 가장 가까운 예보
      const mid = items.reduce((a, b) => (Math.abs(b.hour - 12) < Math.abs(a.hour - 12) ? b : a));
      return {
        label: t.key === todayKey ? '오늘' : DAYS[t.day] + '요일',
        date: t.month + '/' + t.date,
        min: round(Math.min(...temps)),
        max: round(Math.max(...temps)),
        icon: mid.item.weather[0].icon.replace('n', 'd'), // 하루 대표는 낮 아이콘으로
        description: mid.item.weather[0].description,
        pop: Math.round(Math.max(...items.map((x) => x.item.pop || 0)) * 100),
        partial: items.length < 4, // 예보가 일부 시간만 있는 날 (5일 예보의 마지막 날 등)
      };
    });

    return json({ current, hourly, daily });
  } catch (error) {
    console.error('[weather] 요청 실패:', error.message);
    return json({ error: 'network' }, 502);
  }
};
