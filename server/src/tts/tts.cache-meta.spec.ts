// 캐시 무효화 판정이 "실제로 바뀐 것만" 지우는지 검증한다.
// 배경: 문구 키(march) 하나를 추가했더니 숫자 mp3 720개까지 함께 삭제되어
//       재생성 중 Google TTS 분당 할당량 초과로 509개가 유실된 사고가 있었다.
import {
  TTS_CACHE_META_VERSION,
  buildCacheMeta,
  buildCacheMetaFrom,
  planCacheInvalidation,
} from './tts.cache-meta';
import {
  GOOGLE_VOICES,
  LANGS,
  PHRASES,
  SPEAKING_RATE,
  TTS_NUM_MAX,
  TTS_NUM_MIN,
} from './tts.constants';

const NUMBER_FILES = LANGS.flatMap((lang) =>
  Array.from(
    { length: TTS_NUM_MAX - TTS_NUM_MIN + 1 },
    (_, i) => `${lang}-${i + TTS_NUM_MIN}.mp3`,
  ),
);
const PHRASE_FILES = LANGS.flatMap((lang) =>
  Object.keys(PHRASES).map((key) => `${lang}-${key}.mp3`),
);
const ALL_FILES = [...NUMBER_FILES, ...PHRASE_FILES];

const sorted = (list: readonly string[]) => [...list].sort();

function metaWithout(phraseKey: string) {
  const phrases = { ...PHRASES };
  delete phrases[phraseKey];
  return buildCacheMetaFrom({
    speakingRate: SPEAKING_RATE,
    voices: GOOGLE_VOICES,
    langs: LANGS,
    phrases,
  });
}

describe('TTS 캐시 메타 지문', () => {
  it('현재 메타는 version 과 원문 speakingRate·voices 를 함께 기록한다', () => {
    const meta = buildCacheMeta();
    expect(meta.version).toBe(TTS_CACHE_META_VERSION);
    expect(meta.speakingRate).toBe(SPEAKING_RATE);
    expect(meta.voices).toEqual(GOOGLE_VOICES);
    expect(Object.keys(meta.phrases).sort()).toEqual(sorted(LANGS));
  });

  it('SSML 템플릿 지문이 전역 해시에 포함된다 — 템플릿이 바뀌면 전량 무효화 대상이다', () => {
    const base = {
      speakingRate: SPEAKING_RATE,
      voices: GOOGLE_VOICES,
      langs: LANGS,
      phrases: PHRASES,
    };
    const a = buildCacheMetaFrom({ ...base, ssmlFingerprint: 'template-A' });
    const b = buildCacheMetaFrom({ ...base, ssmlFingerprint: 'template-B' });
    expect(a.global).not.toBe(b.global);
  });
});

describe('TTS 캐시 무효화 계획', () => {
  it('메타가 같으면 삭제 대상이 없다', () => {
    const current = buildCacheMeta();
    const plan = planCacheInvalidation(current, current, ALL_FILES);
    expect(plan.fullWipe).toBe(false);
    expect(plan.deleteFiles).toEqual([]);
  });

  // 사고 재현 방지 계약 — 이것이 깨지면 문구 한 줄 수정에 720개가 재생성된다.
  it('문구 키가 하나 추가돼도 숫자 mp3 는 삭제 대상이 아니다', () => {
    const plan = planCacheInvalidation(
      metaWithout('march'),
      buildCacheMeta(),
      ALL_FILES,
    );

    expect(plan.fullWipe).toBe(false);
    expect(plan.deleteFiles.filter((f) => NUMBER_FILES.includes(f))).toEqual(
      [],
    );
    expect(sorted(plan.deleteFiles)).toEqual(
      sorted(LANGS.map((lang) => `${lang}-march.mp3`)),
    );
  });

  it('한 문구의 텍스트만 바뀌면 그 문구 파일만 삭제한다', () => {
    const phrases = {
      ...PHRASES,
      start: { ...PHRASES.start, ko: '준비하세요. (변경)' },
    };
    const saved = buildCacheMetaFrom({
      speakingRate: SPEAKING_RATE,
      voices: GOOGLE_VOICES,
      langs: LANGS,
      phrases,
    });

    const plan = planCacheInvalidation(saved, buildCacheMeta(), ALL_FILES);

    expect(plan.fullWipe).toBe(false);
    expect(plan.deleteFiles).toEqual(['ko-start.mp3']);
  });

  it('speakingRate 가 바뀌면 전량 무효화된다', () => {
    const saved = buildCacheMetaFrom({
      speakingRate: SPEAKING_RATE + 0.1,
      voices: GOOGLE_VOICES,
      langs: LANGS,
      phrases: PHRASES,
    });

    const plan = planCacheInvalidation(saved, buildCacheMeta(), ALL_FILES);

    expect(plan.fullWipe).toBe(true);
    expect(sorted(plan.deleteFiles)).toEqual(sorted(ALL_FILES));
  });

  it('한 언어의 음성 설정이 바뀌면 그 언어만 전량 무효화된다', () => {
    const saved = buildCacheMetaFrom({
      speakingRate: SPEAKING_RATE,
      voices: {
        ...GOOGLE_VOICES,
        ko: { ...GOOGLE_VOICES.ko, name: 'ko-KR-Wavenet-C' },
      },
      langs: LANGS,
      phrases: PHRASES,
    });

    const plan = planCacheInvalidation(saved, buildCacheMeta(), ALL_FILES);

    expect(plan.fullWipe).toBe(false);
    expect(plan.deleteFiles.every((f) => f.startsWith('ko-'))).toBe(true);
    expect(plan.deleteFiles.length).toBe(ALL_FILES.length / LANGS.length);
  });

  it('허용 목록 밖 mp3 는 메타가 같아도 삭제한다 — 낡은 파일이 살아남지 않는다', () => {
    const current = buildCacheMeta();
    const plan = planCacheInvalidation(current, current, [
      ...ALL_FILES,
      'ko-999.mp3',
      'xx-1.mp3',
    ]);

    expect(plan.deleteFiles).toEqual(['ko-999.mp3', 'xx-1.mp3']);
  });

  it('메타가 없으면 전량 삭제한다 (첫 부팅·마이그레이션)', () => {
    const plan = planCacheInvalidation(null, buildCacheMeta(), ALL_FILES);
    expect(plan.fullWipe).toBe(true);
    expect(sorted(plan.deleteFiles)).toEqual(sorted(ALL_FILES));
  });

  // 운영 캐시에 남아 있는 구버전 메타(phrasesHash 단일 해시)로 부팅하는 경로.
  it('구버전(v1) 메타는 음성·속도가 같으면 문구 mp3 만 지운다', () => {
    const v1 = {
      speakingRate: SPEAKING_RATE,
      voices: GOOGLE_VOICES,
      phrasesHash: '696a0f25ee12',
    };

    const plan = planCacheInvalidation(v1, buildCacheMeta(), ALL_FILES);

    expect(plan.fullWipe).toBe(false);
    expect(sorted(plan.deleteFiles)).toEqual(sorted(PHRASE_FILES));
    expect(plan.deleteFiles.some((f) => NUMBER_FILES.includes(f))).toBe(false);
  });

  it('구버전(v1) 메타라도 speakingRate 가 다르면 전량 삭제한다', () => {
    const v1 = {
      speakingRate: SPEAKING_RATE + 0.1,
      voices: GOOGLE_VOICES,
      phrasesHash: '696a0f25ee12',
    };

    const plan = planCacheInvalidation(v1, buildCacheMeta(), ALL_FILES);

    expect(plan.fullWipe).toBe(true);
    expect(sorted(plan.deleteFiles)).toEqual(sorted(ALL_FILES));
  });

  it('구버전(v1) 메타의 음성이 다르면 전량 삭제한다', () => {
    const v1 = {
      speakingRate: SPEAKING_RATE,
      voices: {
        ...GOOGLE_VOICES,
        ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-C' },
      },
      phrasesHash: '696a0f25ee12',
    };

    const plan = planCacheInvalidation(v1, buildCacheMeta(), ALL_FILES);

    expect(plan.fullWipe).toBe(true);
  });
});
