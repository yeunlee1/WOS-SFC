// auth.js — 로그인/회원가입 UI 로직

(function () {
  const LANGUAGES = [
    { value: 'ko', label: '🇰🇷 한국어' },
    { value: 'en', label: '🇺🇸 English' },
    { value: 'ja', label: '🇯🇵 日本語' },
    { value: 'zh', label: '🇨🇳 中文' },
    { value: 'ru', label: '🇷🇺 Русский' },
    { value: 'other', label: '기타' },
  ];

  // 현재 모드: 'login' | 'signup'
  let mode = 'login';

  function showAuthModal() {
    document.getElementById('auth-modal').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    renderForm();
  }

  function hideAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  }

  function setError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg;
  }

  function renderForm() {
    const box = document.getElementById('auth-modal-box');
    setError('');

    if (mode === 'login') {
      box.innerHTML = `
        <h2>⚔️ WOS SFC</h2>
        <p class="auth-subtitle">로그인</p>
        <input type="text" id="auth-nickname" placeholder="닉네임" maxlength="50" />
        <input type="password" id="auth-password" placeholder="비밀번호" maxlength="100" />
        <p id="auth-error" class="auth-error"></p>
        <button id="auth-submit-btn" class="btn btn-primary">로그인</button>
        <p class="auth-switch">계정이 없으신가요? <a href="#" id="auth-switch-link">회원가입</a></p>
      `;
      document.getElementById('auth-submit-btn').onclick = handleLogin;
      document.getElementById('auth-switch-link').onclick = (e) => {
        e.preventDefault(); mode = 'signup'; renderForm();
      };
    } else {
      const langOptions = LANGUAGES.map(l =>
        `<option value="${l.value}">${l.label}</option>`
      ).join('');
      box.innerHTML = `
        <h2>⚔️ WOS SFC</h2>
        <p class="auth-subtitle">회원가입</p>
        <input type="text" id="auth-name" placeholder="이름" maxlength="100" />
        <input type="text" id="auth-nickname" placeholder="닉네임" maxlength="50" />
        <input type="password" id="auth-password" placeholder="비밀번호 (6자 이상)" maxlength="100" />
        <input type="text" id="auth-alliance" placeholder="동맹명 (예: KOR)" maxlength="100" />
        <select id="auth-role">
          <option value="member">일반 인원</option>
          <option value="admin">관리자</option>
          <option value="developer">개발자</option>
        </select>
        <input type="date" id="auth-birthdate" placeholder="생년월일" />
        <select id="auth-language">${langOptions}</select>
        <p class="auth-server-question">서버가 어디입니까?</p>
        <input type="text" id="auth-server-code" placeholder="답변 입력" maxlength="10" />
        <p id="auth-error" class="auth-error"></p>
        <button id="auth-submit-btn" class="btn btn-primary">가입하기</button>
        <p class="auth-switch">이미 계정이 있으신가요? <a href="#" id="auth-switch-link">로그인</a></p>
      `;
      document.getElementById('auth-submit-btn').onclick = handleSignup;
      document.getElementById('auth-switch-link').onclick = (e) => {
        e.preventDefault(); mode = 'login'; renderForm();
      };
    }
  }

  async function handleLogin() {
    const nickname = document.getElementById('auth-nickname').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!nickname || !password) { setError('닉네임과 비밀번호를 입력하세요'); return; }

    const btn = document.getElementById('auth-submit-btn');
    btn.disabled = true; btn.textContent = '처리 중...';

    const result = await window.electronAPI.login({ nickname, password });
    if (result.success) {
      hideAuthModal();
      initAppWithUser(result.user);
    } else {
      setError(Array.isArray(result.error) ? result.error.join(', ') : result.error);
      btn.disabled = false; btn.textContent = '로그인';
    }
  }

  async function handleSignup() {
    const data = {
      name:         document.getElementById('auth-name').value.trim(),
      nickname:     document.getElementById('auth-nickname').value.trim(),
      password:     document.getElementById('auth-password').value,
      allianceName: document.getElementById('auth-alliance').value.trim(),
      role:         document.getElementById('auth-role').value,
      birthDate:    document.getElementById('auth-birthdate').value,
      language:     document.getElementById('auth-language').value,
      serverCode:   document.getElementById('auth-server-code').value.trim(),
    };

    if (!data.name || !data.nickname || !data.password || !data.allianceName || !data.birthDate) {
      setError('모든 항목을 입력하세요'); return;
    }
    if (data.password.length < 6) { setError('비밀번호는 6자 이상이어야 합니다'); return; }

    const btn = document.getElementById('auth-submit-btn');
    btn.disabled = true; btn.textContent = '처리 중...';

    const result = await window.electronAPI.signup(data);
    if (result.success) {
      hideAuthModal();
      initAppWithUser(result.user);
    } else {
      setError(Array.isArray(result.error) ? result.error.join(', ') : result.error);
      btn.disabled = false; btn.textContent = '가입하기';
    }
  }

  function initAppWithUser(user) {
    // 다른 JS 파일에서 참조하는 전역 유저 정보 세팅
    window.currentUser = {
      nickname:    user.nickname,
      alliance:    user.allianceName,
      role:        user.role,
      language:    user.language,
      allianceCode: '2677',
    };

    // 시간 동기화 + 소켓 연결
    window.electronAPI.connectAlliance().then((result) => {
      if (result && result.timeOffset !== undefined) {
        window.timeOffset = result.timeOffset;
      }
    });
    window.electronAPI.socketConnect();

    // 유저 정보 헤더 표시
    const allianceBadge = document.getElementById('user-alliance-badge');
    if (allianceBadge) {
      allianceBadge.textContent = user.allianceName || '';
    }
    document.getElementById('user-nickname').textContent = user.nickname;
    document.getElementById('user-role-badge').textContent = user.role;
    document.getElementById('user-info').style.display = '';

    // 로그아웃 버튼
    document.getElementById('logout-btn').onclick = async () => {
      await window.electronAPI.logout();
      window.currentUser = null;
      showAuthModal();
    };
  }

  // ── 개발용 빠른 로그인 ──
  const DEV_ACCOUNTS = [
    { label: '👑 관리자 (한국)', nickname: 'dev_admin_ko', password: 'devpass123', role: 'admin',   language: 'ko', allianceName: 'KOR', name: '관리자', birthDate: '1990-01-01' },
    { label: '🇨🇳 멤버 (중국)',  nickname: 'dev_member_zh', password: 'devpass123', role: 'member', language: 'zh', allianceName: 'KOR', name: '중국멤버', birthDate: '1990-01-01' },
    { label: '🇺🇸 멤버 (영어)',  nickname: 'dev_member_en', password: 'devpass123', role: 'member', language: 'en', allianceName: 'KOR', name: 'EnMember', birthDate: '1990-01-01' },
    { label: '🇯🇵 멤버 (일본)',  nickname: 'dev_member_ja', password: 'devpass123', role: 'member', language: 'ja', allianceName: 'KOR', name: '日本メンバー', birthDate: '1990-01-01' },
  ];

  async function devLogin(account) {
    // 로그인 시도 → 실패 시 가입 후 재로그인
    let result = await window.electronAPI.login({ nickname: account.nickname, password: account.password });
    if (!result.success) {
      await window.electronAPI.signup({
        nickname: account.nickname, password: account.password,
        name: account.name, allianceName: account.allianceName,
        role: account.role, birthDate: account.birthDate,
        language: account.language, serverCode: '2677',
      });
      result = await window.electronAPI.login({ nickname: account.nickname, password: account.password });
    }
    if (result.success) {
      hideAuthModal();
      initAppWithUser(result.user);
    }
  }

  function renderDevButtons() {
    const existing = document.getElementById('dev-login-panel');
    if (existing) return;
    const panel = document.createElement('div');
    panel.id = 'dev-login-panel';
    panel.innerHTML = `<p style="color:#64748b;font-size:0.7rem;margin:0.5rem 0 0.3rem;text-align:center;">🛠 DEV 빠른 로그인</p>`;
    DEV_ACCOUNTS.forEach(acc => {
      const btn = document.createElement('button');
      btn.textContent = acc.label;
      btn.className = 'btn dev-login-btn';
      btn.onclick = () => devLogin(acc);
      panel.appendChild(btn);
    });
    document.getElementById('auth-modal').appendChild(panel);
  }

  // 앱 시작 시 auth 모달 표시
  window.addEventListener('DOMContentLoaded', () => {
    showAuthModal();
    renderDevButtons();
  });

  window.showAuthModal = showAuthModal;
})();
