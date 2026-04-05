// translator.js — 선택된 언어로 번역 (Claude AI)

const translateInput = document.getElementById('translate-input');
const translateBtn = document.getElementById('translate-btn');
const translateOutput = document.getElementById('translate-output');
const translateCopyBtn = document.getElementById('translate-copy-btn');
const translateHint = document.getElementById('translate-hint');

let lastTranslation = '';

// 번역 힌트 텍스트 갱신 (언어가 바뀔 때마다)
function updateTranslateHint() {
  const lang = getCurrentLang();
  const langInfo = SUPPORTED_LANGS.find((l) => l.code === lang);
  if (translateHint && langInfo) {
    translateHint.textContent = `${langInfo.flag} ${langInfo.label} 로 번역해요 (Claude AI)`;
  }
}

updateTranslateHint();

// ─── 번역 버튼 클릭 ───
translateBtn.addEventListener('click', doTranslate);

translateInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) doTranslate();
});

async function doTranslate() {
  const text = translateInput.value.trim();
  if (!text) return;

  const targetLang = getCurrentLang();

  translateBtn.disabled = true;
  translateBtn.textContent = t('translating');
  translateOutput.innerHTML = '<span class="loading-dots"></span>';
  translateCopyBtn.style.display = 'none';

  // 캐시 확인
  const cached = getCachedTranslation(text, targetLang);
  if (cached) {
    lastTranslation = cached;
    translateOutput.textContent = cached;
    translateCopyBtn.style.display = 'block';
    translateBtn.disabled = false;
    translateBtn.textContent = t('translateBtn');
    return;
  }

  try {
    const result = await window.electronAPI.translateTo(text, targetLang);

    if (result.success) {
      lastTranslation = result.result;
      cacheTranslation(text, targetLang, result.result);
      translateOutput.textContent = result.result;
      translateCopyBtn.style.display = 'block';
    } else {
      translateOutput.innerHTML = `<span style="color: var(--accent)">오류: ${result.error}</span>`;
    }
  } catch (e) {
    translateOutput.innerHTML = `<span style="color: var(--accent)">연결 오류. .env 파일의 API 키를 확인해주세요.</span>`;
    console.error('번역 오류:', e);
  } finally {
    translateBtn.disabled = false;
    translateBtn.textContent = t('translateBtn');
  }
}

// ─── 번역 결과 복사 ───
translateCopyBtn.addEventListener('click', () => {
  if (!lastTranslation) return;

  navigator.clipboard.writeText(lastTranslation).then(() => {
    const original = translateCopyBtn.textContent;
    translateCopyBtn.textContent = t('copied');
    setTimeout(() => {
      translateCopyBtn.textContent = t('copyBtn');
    }, 1500);
  });
});
