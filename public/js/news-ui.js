// ==========================================
// 뉴스 카드 + 미리보기 창 (홈 화면과 뉴스 페이지에서 함께 써요)
// 쓰는 법: NewsUI.load({ q: '보안' }, { grid: 카드칸, status: 안내문칸, limit: 3 })
// ==========================================
window.NewsUI = (function () {
  const ERROR_TEXT = {
    config: '서버 설정(NEWS_API_KEY 환경 변수)이 비어 있어요.',
    key: 'newsapi.org API 키가 올바르지 않아요.',
    limit: '오늘 사용할 수 있는 뉴스 요청 횟수를 다 썼어요. 내일 다시 시도해 주세요.',
    empty: '검색어를 입력해 주세요.',
  };

  const ICON = {
    close: '<svg class="hi" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>',
    prev: '<svg class="hi" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>',
    next: '<svg class="hi" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>',
    external: '<svg class="hi" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>',
  };

  // 화면에 글자를 넣을 때는 textContent만 써서, 기사 내용에 이상한 코드가 있어도 실행되지 않게 해요
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // 언론사 이름 + 날짜 줄
  function makeMeta(a) {
    const meta = el('div', 'news-meta');
    if (a.source) meta.append(el('span', 'news-source', a.source));
    const date = formatDate(a.publishedAt);
    if (date) {
      const time = el('time', '', date);
      time.dateTime = a.publishedAt;
      meta.append(time);
    }
    return meta;
  }

  // 사진 칸 (사진이 없거나 못 불러오면 색 배경 + 언론사 첫 글자)
  function fillImage(box, a) {
    box.replaceChildren((a.source || '뉴스').charAt(0));
    if (!a.image) return;
    const img = el('img');
    img.src = a.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function () { img.remove(); };
    box.append(img);
  }

  // ===== 미리보기 창 (처음 필요할 때 한 번만 만들어요) =====
  let modal = null;
  let ui = {};
  let list = [];
  let index = 0;
  let lastFocus = null;

  function buildModal() {
    modal = el('dialog', 'news-modal');
    modal.setAttribute('aria-labelledby', 'news-modal-title');

    const scroll = el('div', 'modal-scroll');
    const hero = el('div', 'modal-hero');
    hero.setAttribute('aria-hidden', 'true');
    const close = el('button', 'modal-close');
    close.type = 'button';
    close.setAttribute('aria-label', '닫기');
    close.innerHTML = ICON.close;

    const body = el('div', 'modal-body');
    const metaSlot = el('div');
    const title = el('h2', 'modal-title');
    title.id = 'news-modal-title';
    const desc = el('p', 'modal-desc');
    const note = el('p', 'modal-note', '여기에는 기사 요약만 보여 드려요. 전체 내용은 아래 “기사 원문 보기”를 눌러 언론사 페이지에서 확인하세요.');
    body.append(metaSlot, title, desc, note);
    scroll.append(hero, body);

    const actions = el('div', 'modal-actions');
    const prev = el('button', 'modal-step');
    prev.type = 'button';
    prev.setAttribute('aria-label', '이전 기사');
    prev.innerHTML = ICON.prev;
    const count = el('span', 'modal-count');
    const next = el('button', 'modal-step');
    next.type = 'button';
    next.setAttribute('aria-label', '다음 기사');
    next.innerHTML = ICON.next;
    const link = el('a', 'btn btn-primary');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append('기사 원문 보기');
    link.insertAdjacentHTML('beforeend', ICON.external);
    actions.append(prev, count, next, link);

    modal.append(close, scroll, actions);
    document.body.append(modal);

    ui = { scroll, hero, metaSlot, title, desc, count, prev, next, link };

    close.addEventListener('click', function () { modal.close(); });
    prev.addEventListener('click', function () { show(index - 1); });
    next.addEventListener('click', function () { show(index + 1); });

    // 바깥 어두운 배경을 누르면 닫혀요
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.close();
    });
    // 키보드 ← → 로 이전·다음 기사 (Esc로 닫기는 브라우저가 해 줘요)
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    });
    // 닫히면 원래 누른 카드로 돌아가요
    modal.addEventListener('close', function () {
      if (lastFocus) lastFocus.focus();
    });
  }

  function show(i) {
    if (i < 0 || i >= list.length) return;
    index = i;
    const a = list[i];
    fillImage(ui.hero, a);
    ui.hero.style.background = ['var(--color-jobs-3)', 'var(--color-inspire)', 'var(--color-connect-3)'][i % 3];
    ui.metaSlot.replaceChildren(makeMeta(a));
    ui.title.textContent = a.title;
    ui.desc.textContent = a.description || '요약이 없는 기사예요.';
    ui.link.href = a.url;
    ui.count.textContent = (i + 1) + ' / ' + list.length;
    ui.prev.disabled = i === 0;
    ui.next.disabled = i === list.length - 1;
    ui.scroll.scrollTop = 0;
  }

  function open(articles, i, opener) {
    if (!modal) buildModal();
    list = articles;
    lastFocus = opener || null;
    show(i);
    if (!modal.open) modal.showModal();
    ui.link.focus();
  }

  // ===== 카드 =====
  function makeCard(a, i, articles) {
    const card = el('article', 'news-card');
    card.style.animationDelay = Math.min(i, 8) * 60 + 'ms'; // 차례로 나타나요

    const thumb = el('div', 'news-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    fillImage(thumb, a);

    const body = el('div', 'news-body');
    const title = el('h3', 'news-title');
    const btn = el('button', 'news-open', a.title);
    btn.type = 'button';
    btn.addEventListener('click', function () { open(articles, i, btn); });
    title.append(btn);

    body.append(makeMeta(a), title);
    if (a.description) body.append(el('p', 'news-desc', a.description));
    card.append(thumb, body);
    return card;
  }

  function showSkeleton(grid, n) {
    grid.replaceChildren();
    for (let i = 0; i < n; i++) {
      const card = el('div', 'news-card skeleton');
      card.setAttribute('aria-hidden', 'true');
      const body = el('div', 'news-body');
      body.append(el('div', 'bar short'), el('div', 'bar'), el('div', 'bar'));
      card.append(el('div', 'news-thumb'), body);
      grid.append(card);
    }
  }

  // 버튼을 빨리 여러 번 눌러도 마지막 결과만 보여 주려고 칸마다 번호를 매겨요
  const requestNo = new WeakMap();

  function load(params, opts) {
    const grid = opts.grid;
    const status = opts.status;
    const limit = opts.limit || 0;
    const label = opts.label || '';
    const myNo = (requestNo.get(grid) || 0) + 1;
    requestNo.set(grid, myNo);

    function setStatus(text, isError) {
      if (!status) return;
      status.className = 'news-status' + (isError ? ' error' : '');
      status.textContent = text;
    }

    setStatus(label ? '“' + label + '” 뉴스를 불러오는 중…' : '뉴스를 불러오는 중…');
    showSkeleton(grid, limit || 6);

    return fetch('/.netlify/functions/news?' + new URLSearchParams(params))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (requestNo.get(grid) !== myNo) return;
        grid.replaceChildren();
        if (data.error) {
          setStatus(ERROR_TEXT[data.error] || '뉴스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', true);
          return;
        }
        const articles = limit ? data.articles.slice(0, limit) : data.articles;
        if (!articles.length) {
          setStatus('“' + label + '”에 대한 뉴스가 없어요. 다른 검색어로 찾아보세요.');
          return;
        }
        setStatus(label ? '“' + label + '” 뉴스 ' + articles.length + '개' : '');
        articles.forEach(function (a, i) { grid.append(makeCard(a, i, articles)); });
      })
      .catch(function () {
        if (requestNo.get(grid) !== myNo) return;
        grid.replaceChildren();
        setStatus('뉴스는 서버를 실행했을 때만 볼 수 있어요.', true);
      });
  }

  return { load: load };
})();
