// ==========================================
// 챗봇 (Claude API)
// 주소: /.netlify/functions/chat   (POST 방식)
// 하는 일: 웹페이지에서 보낸 대화를 Claude에게 전달하고,
//          Claude가 쓰는 답을 글자가 만들어지는 대로 바로바로 돌려줘요(스트리밍).
// - API 키(CLAUDE_API_KEY)는 서버 안에서만 쓰여서 웹페이지를 보는 사람에게는 보이지 않아요.
//   (ANTHROPIC_API_KEY라는 이름은 다른 프로그램이 같은 이름을 쓰면 그쪽 값이 먼저 쓰여서,
//    이 사이트만의 이름인 CLAUDE_API_KEY를 써요)
// - Claude API는 쓴 만큼 요금이 나가요. 그래서 카카오 로그인한 사람만 쓸 수 있게 했어요.
// ==========================================
import Anthropic from '@anthropic-ai/sdk';
import { SESSION_COOKIE, requireEnv, parseCookies, readSessionToken } from '../lib/session.mjs';

const MODEL = 'claude-opus-5-5';
const MAX_MESSAGES = 30;        // 한 번에 보낼 수 있는 대화 개수
const MAX_CHARS = 4000;         // 메시지 하나의 최대 글자 수

const SYSTEM_PROMPT = `당신은 한 회사의 물리보안 담당자가 만든 개인 웹사이트의 도우미 챗봇입니다.
이 사이트에는 자기소개(물리보안 업무: CCTV, 출입통제, 주차관리 시스템), 보안 뉴스, 지역 날씨 페이지가 있습니다.
방문자의 질문에 한국어로, 쉽고 친절하게 답하세요. 전문용어를 쓰면 짧은 설명을 붙이세요.
답은 핵심부터 간결하게 쓰고, 필요할 때만 목록이나 짧은 문단을 쓰세요.
확실하지 않은 내용은 추측하지 말고 모른다고 말하세요. 실시간 정보(오늘 뉴스, 지금 날씨 등)는 알 수 없으니 사이트의 뉴스·지역 페이지를 안내하세요.`;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 웹페이지가 보낸 대화가 올바른 모양인지 확인해요
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) return null;
  const messages = [];
  for (let i = 0; i < input.length; i++) {
    const m = input[i];
    const role = i % 2 === 0 ? 'user' : 'assistant'; // 사용자 → Claude → 사용자 … 순서여야 해요
    if (!m || m.role !== role || typeof m.content !== 'string') return null;
    const content = m.content.trim();
    if (!content || content.length > MAX_CHARS) return null;
    messages.push({ role, content });
  }
  if (messages[messages.length - 1].role !== 'user') return null;
  return messages;
}

// 오류 종류 → 웹페이지에 알려 줄 짧은 이름
function errorCode(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'key';
  if (error instanceof Anthropic.PermissionDeniedError) return 'key';
  if (error instanceof Anthropic.RateLimitError) return 'limit';
  if (error instanceof Anthropic.APIConnectionError) return 'network';
  if (error instanceof Anthropic.APIError) return 'api';
  return 'server';
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // 1) 설정 확인
  let apiKey, sessionSecret;
  try {
    apiKey = requireEnv('CLAUDE_API_KEY');
    sessionSecret = requireEnv('SESSION_SECRET');
  } catch (error) {
    console.error('[chat] 설정 오류:', error.message);
    return json({ error: 'config' }, 500);
  }

  // 2) 카카오 로그인한 사람인지 확인
  const session = readSessionToken(parseCookies(req)[SESSION_COOKIE], sessionSecret);
  if (!session) return json({ error: 'login' }, 401);

  // 3) 보낸 대화 확인
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad' }, 400);
  }
  const messages = cleanMessages(body?.messages);
  if (!messages) return json({ error: 'bad' }, 400);

  // 4) Claude에게 보내고, 답을 받는 대로 한 줄씩(JSON) 웹페이지로 흘려보내요
  // 키와 주소를 직접 정해 줘요. 이렇게 하면 컴퓨터에 다른 Claude 설정(ANTHROPIC_BASE_URL,
  // ANTHROPIC_AUTH_TOKEN 등)이 있어도 섞이지 않고, 항상 내 키로 Anthropic 공식 서버에만 연결돼요.
  const client = new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com' });
  const encoder = new TextEncoder();

  const body$ = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const stream = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 8000,
            system: SYSTEM_PROMPT,
            messages,
            // 대화형 챗봇이라 빠른 답이 중요해서 생각의 깊이(effort)를 "low"로 했어요
            output_config: { effort: 'low' },
            // 안전 판단으로 답을 거절하면, 다른 Claude 모델이 이어서 답하도록 하는 설정
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: req.signal }, // 사용자가 페이지를 닫으면 요청도 멈춰요
        );

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            send({ t: 'text', v: event.delta.text });
          }
        }

        const final = await stream.finalMessage();
        send({ t: 'done', stop: final.stop_reason });
      } catch (error) {
        if (req.signal.aborted) return controller.close();
        console.error('[chat] Claude API 오류:', error?.status ?? '', error?.message);
        send({ t: 'error', code: errorCode(error) });
      }
      controller.close();
    },
  });

  return new Response(body$, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
