// countdown.js — 실시간 공유 카운트다운

(function () {
  const LANG_MAP = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };

  const PHRASES = {
    start:  { ko: '카운트다운을 시작합니다.', en: 'Countdown starting.', ja: 'カウントダウンを開始します。', zh: '倒计时开始。' },
    stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
    finish: { ko: '시작!', en: 'Start!', ja: '始め!', zh: '开始!' },
  };

  let countdownInterval = null;
  let lastSpokenSecond = -1;
  let isActive = false;

  function getLang() {
    return window.currentUser?.language || 'ko';
  }

  function getLangCode() {
    return LANG_MAP[getLang()] || 'ko-KR';
  }

  // ── ElevenLabs TTS ──
  let currentAudio = null;

  function speakFallback(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = getLangCode();
    u.rate = 1.8;
    window.speechSynthesis.speak(u);
  }

  async function speak(text) {
    try {
      const result = await window.electronAPI.ttsSpeak(text);
      if (!result?.success) { speakFallback(text); return; }
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      currentAudio = new Audio('data:audio/mpeg;base64,' + result.audio);
      currentAudio.play().catch(() => speakFallback(text));
    } catch {
      speakFallback(text);
    }
  }

  function speakPhrase(key) {
    const lang = getLang();
    const text = PHRASES[key][lang] || PHRASES[key]['en'];
    speak(text);
  }

  function speakNumber(n) {
    speak(String(n));
  }

  function updateDisplay(remaining) {
    const el = document.getElementById('countdown-number');
    if (!el) return;
    if (!isActive) { el.textContent = '--'; return; }

    const secs = Math.max(0, Math.ceil(remaining));
    el.textContent = secs;

    // 색상
    el.className = '';
    if (secs <= 10) el.classList.add('countdown-danger');
    else if (secs <= 30) el.classList.add('countdown-warning');
  }

  function tick(startedAt, totalSeconds) {
    const now = Date.now() + (window.timeOffset || 0);
    const elapsed = (now - startedAt) / 1000;
    const remaining = totalSeconds - elapsed;

    if (remaining <= 0) {
      updateDisplay(0);
      stopInterval();
      speakPhrase('finish');
      return;
    }

    updateDisplay(remaining);

    const currentSecond = Math.ceil(remaining);
    if (currentSecond !== lastSpokenSecond) {
      lastSpokenSecond = currentSecond;
      speakNumber(currentSecond);
    }
  }

  function stopInterval() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function applyState(state) {
    stopInterval();
    lastSpokenSecond = -1;
    isActive = state.active;

    if (!state.active) {
      updateDisplay(null);
      return;
    }

    tick(state.startedAt, state.totalSeconds);
    countdownInterval = setInterval(() => tick(state.startedAt, state.totalSeconds), 200);
  }

  function initControls() {
    const role = window.currentUser?.role;
    const controls = document.getElementById('countdown-controls');
    if (controls && (role === 'admin' || role === 'developer')) {
      controls.style.display = 'flex';
    }

    const startBtn = document.getElementById('countdown-start-btn');
    const stopBtn = document.getElementById('countdown-stop-btn');
    const input = document.getElementById('countdown-input');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const seconds = parseInt(input?.value, 10);
        if (!seconds || seconds < 1) return;
        window.electronAPI.countdownStart(seconds);
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        window.electronAPI.countdownStop();
      });
    }
  }

  // 이전 상태 수신 플래그 (start/stop 멘트를 최초 수신에는 읽지 않음)
  let initialized = false;

  window.electronAPI.onCountdownState((state) => {
    const wasActive = isActive;

    if (initialized) {
      if (state.active && !wasActive) speakPhrase('start');
      else if (!state.active && wasActive) speakPhrase('stop');
    }

    applyState(state);
    initialized = true;
  });

  document.addEventListener('DOMContentLoaded', () => {
    // currentUser가 세팅된 후 initControls 호출 (auth.js의 initAppWithUser 이후)
    const checkUser = setInterval(() => {
      if (window.currentUser) {
        clearInterval(checkUser);
        initControls();
      }
    }, 200);
  });
})();
