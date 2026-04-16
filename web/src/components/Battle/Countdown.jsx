import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket } from '../../api';

// ── TTS 설정 (countdown.js 로직 그대로) ──
const LANG_MAP = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };

const PHRASES = {
  start:  { ko: '카운트다운을 시작합니다.', en: 'Countdown starting.', ja: 'カウントダウンを開始します。', zh: '倒计时开始。' },
  stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
  finish: { ko: '시작!', en: 'Start!', ja: '始め!', zh: '开始!' },
};

const VOICE_PREF = {
  'ko-KR': ['Google 한국의', 'Microsoft Heami', 'Yuna'],
  'en-US': ['Google US English', 'Microsoft David', 'Microsoft Zira', 'Samantha'],
  'ja-JP': ['Google 日本語', 'Microsoft Haruka', 'Kyoko'],
  'zh-CN': ['Google 普通话', 'Microsoft Huihui', 'Tingting'],
};

function getBestVoice(langCode) {
  const voices = window.speechSynthesis?.getVoices() || [];
  const prefs = VOICE_PREF[langCode] || [];
  for (const pref of prefs) {
    const v = voices.find((v) => v.name.includes(pref));
    if (v) return v;
  }
  const prefix = langCode.split('-')[0];
  return voices.find((v) => v.lang.startsWith(prefix)) || null;
}

function speak(text, langCode) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang  = langCode;
  u.rate  = 1.8;
  const voice = getBestVoice(langCode);
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

// Countdown — 실시간 공유 카운트다운 (TTS 포함)
export default function Countdown() {
  const { countdown, timeOffset, user } = useStore();
  const { t, lang } = useI18n();

  // 남은 초 (소수점 유지 — 표시는 ceil)
  const [remaining, setRemaining]   = useState(null);
  const intervalRef  = useRef(null);
  const lastSpokenRef = useRef(-1);
  const initializedRef = useRef(false);

  // 입력값
  const [inputSec, setInputSec] = useState('');

  const langCode = LANG_MAP[lang] || 'ko-KR';

  // voices 사전 로드
  useEffect(() => {
    if (window.speechSynthesis) {
      const load = () => window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', load);
      load();
      return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
    }
  }, []);

  // countdown 상태 변경 감지 → interval 재설정
  useEffect(() => {
    clearInterval(intervalRef.current);
    lastSpokenRef.current = -1;

    const { active, startedAt, totalSeconds } = countdown;

    if (initializedRef.current) {
      // 이전 상태와 비교해 멘트 (React에서는 prev state로 처리)
      // active → start / !active → stop (이미 컴포넌트 마운트 후)
    }

    if (!active) {
      setRemaining(null);
      return;
    }

    function tick() {
      const now     = Date.now() + timeOffset;
      const elapsed = (now - startedAt) / 1000;
      const rem     = totalSeconds - elapsed;

      if (rem <= 0) {
        setRemaining(0);
        clearInterval(intervalRef.current);
        speak(PHRASES.finish[lang] || PHRASES.finish.en, langCode);
        return;
      }

      setRemaining(rem);

      const currentSec = Math.ceil(rem);
      if (currentSec !== lastSpokenRef.current) {
        lastSpokenRef.current = currentSec;
        speak(String(currentSec), langCode);
      }
    }

    tick();
    intervalRef.current = setInterval(tick, 200);
    return () => clearInterval(intervalRef.current);
  }, [countdown, timeOffset, lang, langCode]);

  // start/stop 멘트 — countdown.active 토글 감지
  const prevActiveRef = useRef(countdown.active);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevActiveRef.current  = countdown.active;
      return;
    }
    if (countdown.active && !prevActiveRef.current) {
      speak(PHRASES.start[lang] || PHRASES.start.en, langCode);
    } else if (!countdown.active && prevActiveRef.current) {
      speak(PHRASES.stop[lang] || PHRASES.stop.en, langCode);
    }
    prevActiveRef.current = countdown.active;
  }, [countdown.active]);

  // 관리자/개발자 여부
  const isAdmin = user?.role === 'admin' || user?.role === 'developer';

  // 표시 색상
  const secs     = remaining !== null ? Math.max(0, Math.ceil(remaining)) : null;
  const dispClass = secs === null     ? 'countdown-number'
                  : secs <= 10        ? 'countdown-number countdown-danger'
                  : secs <= 30        ? 'countdown-number countdown-warning'
                  :                     'countdown-number';

  function handleStart() {
    const s = parseInt(inputSec, 10);
    if (!s || s < 1) return;
    getSocket()?.emit('countdown:start', s);
  }

  function handleStop() {
    getSocket()?.emit('countdown:stop');
  }

  return (
    <section className="section">
      <h2 className="section-title">⏳ 카운트다운</h2>

      <div className="countdown-display">
        <span id="countdown-number" className={dispClass}>
          {secs !== null ? secs : '--'}
        </span>
      </div>

      {isAdmin && (
        <div id="countdown-controls" className="input-row" style={{ marginTop: '8px' }}>
          <input
            className="input input-short"
            type="number"
            min="1"
            placeholder={t('countdownSeconds')}
            value={inputSec}
            onChange={(e) => setInputSec(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
          />
          <button className="btn btn-primary" onClick={handleStart}>
            {t('countdownStart')}
          </button>
          <button className="btn btn-danger" onClick={handleStop}>
            {t('countdownStop')}
          </button>
        </div>
      )}
    </section>
  );
}
