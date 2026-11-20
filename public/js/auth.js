// ==========================================
// 카카오 로그인 표시 (모든 페이지에서 함께 써요)
// 페이지 안의 <div id="auth"> 칸을 로그인 상태에 맞춰 채워요.
// ==========================================
(function () {
  const box = document.getElementById('auth');
  if (!box) return;

  // 로그인 중 문제가 생기면 서버가 주소 뒤에 ?login_error=종류 를 붙여 돌려보내요
  const ERROR_TEXT = {
    denied: '카카오 로그인을 취소했어요.',
    state: '로그인 요청이 올바르지 않아요. 다시 시도해 주세요.',
    token: '카카오 인증에 실패했어요. 키와 Redirect URI 설정을 확인해 주세요.',
    profile: '카카오에서 사용자 정보를 받지 못했어요.',
    config: '서버 설정(환경 변수)이 비어 있어요.',
    kakao: '카카오 로그인 중 오류가 났어요.',
    server: '서버에서 오류가 났어요. 잠시 후 다시 시도해 주세요.',
  };

  const params = new URLSearchParams(location.search);
  const errorCode = params.get('login_error');
  if (errorCode) {
    // 새로고침해도 오류가 다시 뜨지 않게 주소에서 지워요
    history.replaceState(null, '', location.pathname + location.hash);
  }

  // 화면에 글자를 넣을 때는 textContent만 써서, 닉네임에 이상한 코드가 있어도 실행되지 않게 해요
  function el(tag, props) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    return node;
  }

  function showMessage(text) {
    if (text) box.append(el('p', { className: 'auth-message', textContent: text }));
  }

  function renderLoggedOut() {
    const link = el('a', { className: 'btn-kakao', href: '/.netlify/functions/kakao-login' });
    link.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.48 3 2 6.58 2 11c0 2.84 1.86 5.33 4.66 6.75l-.95 3.48c-.08.3.26.54.52.37l4.15-2.75c.53.06 1.07.09 1.62.09 5.52 0 10-3.58 10-8S17.52 3 12 3z"/></svg>';
    link.append('카카오 로그인');
    box.append(link);
  }

  function renderLoggedIn(user) {
    const who = el('div', { className: 'auth-user' });
    if (user.profileImage) {
      who.append(el('img', { className: 'auth-avatar', src: user.profileImage, alt: '', referrerPolicy: 'no-referrer' }));
    }
    who.append(el('span', { textContent: user.nickname + '님' }));

    const form = el('form', { method: 'post', action: '/.netlify/functions/logout' });
    form.append(el('button', { type: 'submit', className: 'btn-logout', textContent: '로그아웃' }));

    box.append(who, form);
  }

  fetch('/.netlify/functions/me', { cache: 'no-store', credentials: 'same-origin' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      box.replaceChildren();
      if (data.error === 'config') showMessage(ERROR_TEXT.config);
      else showMessage(ERROR_TEXT[errorCode] || (errorCode ? '로그인 중 오류가 났어요.' : ''));
      if (data.loggedIn) renderLoggedIn(data.user);
      else renderLoggedOut();
    })
    .catch(function () {
      // 파일을 더블클릭해서 열었을 때처럼 서버 없이 볼 때
      box.replaceChildren();
      showMessage('로그인 기능은 서버를 실행했을 때만 쓸 수 있어요.');
      renderLoggedOut();
    });
})();
