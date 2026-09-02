// tts.cache-meta.ts — TTS 캐시 무효화 메타의 생성·기록과 삭제 대상 판정 (서비스·사전 생성 스크립트 공용)
//
// 왜 이 모듈이 따로 있는가:
//   과거에는 PHRASES 전체를 뭉갠 해시 하나(phrasesHash)로 캐시 유효성을 판단했고,
//   불일치하면 캐시 디렉터리의 mp3 를 전부 지웠다. 문구 키 하나(march)를 추가했더니
//   문구와 아무 관계가 없는 숫자 mp3 720개까지 지워졌고, 재생성 중 Google TTS
//   분당 할당량을 넘겨 509개가 유실됐다.
//
//   그래서 무효화 범위를 세 계층으로 나눈다.
//     global  — speakingRate 와 SSML 템플릿. 모든 mp3 의 발화 방식을 바꾸므로 전량 무효화.
//     langs   — 언어별 음성(GOOGLE_VOICES). 그 언어의 mp3 만 무효화.
//     phrases — 언어·키별 문구 텍스트. 그 파일 하나만 무효화. 숫자 mp3 는 영향받지 않는다.
//
//   또한 서비스와 tts:generate 스크립트가 서로 다른 메타를 쓰면 사전 생성이 무의미해지므로
//   메타 생성·기록·정리 로직을 이 한 곳에만 둔다.

import { createHash } from 'crypto';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import {
  GOOGLE_VOICES,
  LANGS,
  PHRASES,
  SPEAKING_RATE,
  TTS_KEYS,
} from './tts.constants';

export const TTS_CACHE_META_FILENAME = 'cache.meta.json';

// 메타 스키마 버전. 구조가 바뀌면 올린다 — 구버전은 아래 마이그레이션 규칙으로 처리한다.
export const TTS_CACHE_META_VERSION = 2;

export interface TtsVoice {
  languageCode: string;
  name: string;
}

export interface TtsCacheMeta {
  version: number;
  // 원문도 함께 남긴다 — 사람이 읽을 수 있어야 하고, 구버전 메타와 직접 대조할 수 있어야 한다.
  speakingRate: number;
  voices: Record<string, TtsVoice>;
  global: string;
  langs: Record<string, string>;
  phrases: Record<string, Record<string, string>>;
}

export interface TtsCacheMetaInput {
  speakingRate: number;
  voices: Record<string, TtsVoice>;
  langs: readonly string[];
  phrases: Record<string, Record<string, string>>;
  /** 테스트용 주입구. 생략하면 실제 SSML 템플릿에서 계산한 지문을 쓴다. */
  ssmlFingerprint?: string;
}

export interface CacheInvalidationPlan {
  /** 삭제할 파일명(디렉터리 제외). 정렬되어 있다. */
  deleteFiles: string[];
  fullWipe: boolean;
  reasons: string[];
}

function sha12(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Google TTS 로 보낼 SSML 입력을 만든다.
 * 숫자는 say-as cardinal, 문구는 일반 텍스트로 감싼다.
 * prosody pitch="0st" 로 Wavenet 음정을 baseline 에 고정한다.
 *
 * 서비스와 사전 생성 스크립트가 반드시 같은 문자열을 써야 한다 —
 * 갈라지면 같은 키의 mp3 가 실행 경로에 따라 다르게 발음된다.
 */
export function buildSsmlInput(key: string, text: string): { ssml: string } {
  const isNumber = /^\d+$/.test(key);
  const body = isNumber
    ? `<say-as interpret-as="cardinal">${text}</say-as>`
    : text;
  return {
    ssml: `<speak><prosody pitch="0st" rate="1.0" volume="medium">${body}</prosody></speak>`,
  };
}

// 템플릿 자체를 지문에 넣는다 — 위 문자열을 고치면 지문이 바뀌어 전량 무효화된다.
const DEFAULT_SSML_FINGERPRINT = sha12([
  buildSsmlInput('1', '1').ssml,
  buildSsmlInput('start', 'SAMPLE').ssml,
]);

export function buildCacheMetaFrom(input: TtsCacheMetaInput): TtsCacheMeta {
  const ssml = input.ssmlFingerprint ?? DEFAULT_SSML_FINGERPRINT;
  const langs: Record<string, string> = {};
  const phrases: Record<string, Record<string, string>> = {};

  for (const lang of input.langs) {
    langs[lang] = sha12(input.voices[lang] ?? input.voices['ko'] ?? null);

    const perKey: Record<string, string> = {};
    for (const [key, byLang] of Object.entries(input.phrases)) {
      // getTtsText 와 같은 폴백 규칙 — 해당 언어가 없으면 en 을 쓴다.
      perKey[key] = sha12(byLang[lang] || byLang['en'] || '');
    }
    phrases[lang] = perKey;
  }

  return {
    version: TTS_CACHE_META_VERSION,
    speakingRate: input.speakingRate,
    voices: { ...input.voices },
    global: sha12({ speakingRate: input.speakingRate, ssml }),
    langs,
    phrases,
  };
}

/** 현재 소스의 상수로 메타를 만든다. */
export function buildCacheMeta(): TtsCacheMeta {
  return buildCacheMetaFrom({
    speakingRate: SPEAKING_RATE,
    voices: GOOGLE_VOICES,
    langs: LANGS,
    phrases: PHRASES,
  });
}

let allowedFileNames: Set<string> | null = null;

/** 캐시 디렉터리에 존재해도 되는 mp3 파일명 전체. */
export function allowedCacheFileNames(): ReadonlySet<string> {
  if (!allowedFileNames) {
    allowedFileNames = new Set(
      LANGS.flatMap((lang) => TTS_KEYS.map((key) => `${lang}-${key}.mp3`)),
    );
  }
  return allowedFileNames;
}

interface LegacyV1Meta {
  speakingRate: number;
  voices: Record<string, TtsVoice>;
  phrasesHash: string;
}

function asV2(saved: unknown): TtsCacheMeta | null {
  if (!saved || typeof saved !== 'object') return null;
  const m = saved as Partial<TtsCacheMeta>;
  if (m.version !== TTS_CACHE_META_VERSION) return null;
  if (typeof m.global !== 'string' || !m.langs || !m.phrases) return null;
  return m as TtsCacheMeta;
}

function asV1(saved: unknown): LegacyV1Meta | null {
  if (!saved || typeof saved !== 'object') return null;
  const m = saved as Partial<LegacyV1Meta>;
  if (typeof m.phrasesHash !== 'string') return null;
  return m as LegacyV1Meta;
}

/**
 * 어떤 mp3 를 지워야 하는지 판정한다. 파일시스템을 건드리지 않는 순수 함수다.
 *
 * @param saved       디스크에 있던 메타(파싱 결과). 없으면 null.
 * @param current     현재 소스 기준 메타.
 * @param existingMp3 캐시 디렉터리에 실제로 있는 mp3 파일명 목록.
 */
export function planCacheInvalidation(
  saved: unknown,
  current: TtsCacheMeta,
  existingMp3: readonly string[],
): CacheInvalidationPlan {
  const allowed = allowedCacheFileNames();
  const existing = new Set(existingMp3);
  const reasons: string[] = [];
  const doomed = new Set<string>();

  // 1) 허용 목록 밖 파일은 메타가 무엇이든 남기지 않는다.
  //    (TTS_NUM_MAX 축소, 문구 키 삭제 등으로 생긴 잔재)
  const orphans = existingMp3.filter((f) => !allowed.has(f));
  if (orphans.length > 0) {
    orphans.forEach((f) => doomed.add(f));
    reasons.push(`허용 목록 밖 mp3 ${orphans.length}개`);
  }

  const wipeAll = (reason: string): CacheInvalidationPlan => {
    reasons.push(reason);
    return { deleteFiles: [...existingMp3].sort(), fullWipe: true, reasons };
  };

  const v2 = asV2(saved);
  if (v2) {
    // 2) 전역 설정 변경 — 모든 mp3 가 옛 설정으로 만들어진 것이므로 전량 무효화.
    if (v2.global !== current.global) {
      return wipeAll('전역 설정(speakingRate·SSML 템플릿) 변경');
    }

    for (const lang of Object.keys(current.langs)) {
      // 3) 언어별 음성 변경 — 그 언어의 숫자까지 다시 만들어야 한다.
      if (v2.langs?.[lang] !== current.langs[lang]) {
        reasons.push(`${lang} 음성 설정 변경`);
        existingMp3
          .filter((f) => f.startsWith(`${lang}-`))
          .forEach((f) => doomed.add(f));
        continue; // 언어 전체를 지우므로 문구 개별 비교는 불필요
      }

      // 4) 문구 텍스트 변경 — 그 파일 하나만. 숫자 mp3 는 여기서 절대 건드리지 않는다.
      const savedPhrases = v2.phrases?.[lang] ?? {};
      for (const [key, hash] of Object.entries(current.phrases[lang])) {
        if (savedPhrases[key] === hash) continue;
        const name = `${lang}-${key}.mp3`;
        if (existing.has(name)) {
          doomed.add(name);
          reasons.push(`${lang}/${key} 문구 변경`);
        }
      }
    }

    return { deleteFiles: [...doomed].sort(), fullWipe: false, reasons };
  }

  const v1 = asV1(saved);
  if (v1) {
    // 5) 구버전 메타 마이그레이션.
    //    v1 은 문구를 단일 해시로만 남겨 "어느 문구가 바뀌었는지"를 알 수 없다.
    //    하지만 speakingRate 와 음성이 그대로임을 확인하면 숫자 mp3 는 여전히 유효하다.
    //    ※ v1 에는 SSML 템플릿 지문이 없다. 이 마이그레이션은 템플릿이 그대로라는
    //      전제에서만 안전하므로, 템플릿을 바꾸는 변경과 같은 배포에 섞지 마라.
    if (v1.speakingRate !== current.speakingRate) {
      return wipeAll('v1 메타 — speakingRate 불일치');
    }
    if (JSON.stringify(v1.voices) !== JSON.stringify(current.voices)) {
      return wipeAll('v1 메타 — 음성 설정 불일치');
    }

    reasons.push('v1 메타 마이그레이션 — 문구 mp3 만 재생성 (숫자 mp3 보존)');
    for (const lang of Object.keys(current.phrases)) {
      for (const key of Object.keys(current.phrases[lang])) {
        const name = `${lang}-${key}.mp3`;
        if (existing.has(name)) doomed.add(name);
      }
    }
    return { deleteFiles: [...doomed].sort(), fullWipe: false, reasons };
  }

  return wipeAll(
    saved ? '메타 형식을 알 수 없음' : '메타 없음 — 첫 부팅 또는 마이그레이션',
  );
}

export function cacheMetaPath(cacheDir: string): string {
  return path.join(cacheDir, TTS_CACHE_META_FILENAME);
}

export async function readCacheMeta(cacheDir: string): Promise<unknown> {
  try {
    return JSON.parse(
      await fsPromises.readFile(cacheMetaPath(cacheDir), 'utf8'),
    );
  } catch {
    return null; // 없거나 파싱 실패 → 호출자가 전량 무효화로 처리한다
  }
}

export async function writeCacheMeta(
  cacheDir: string,
  meta: TtsCacheMeta,
): Promise<void> {
  await fsPromises.writeFile(
    cacheMetaPath(cacheDir),
    JSON.stringify(meta, null, 2),
    'utf8',
  );
}

export interface CacheReconcileResult {
  deleted: number;
  fullWipe: boolean;
  reasons: string[];
  metaChanged: boolean;
}

/**
 * 캐시 디렉터리를 현재 설정과 맞춘다 — 무효한 mp3 삭제 + 메타 갱신.
 * 서버 부팅과 tts:generate 스크립트가 같은 이 함수를 쓴다.
 */
export async function reconcileCache(
  cacheDir: string,
): Promise<CacheReconcileResult> {
  const current = buildCacheMeta();
  const saved = await readCacheMeta(cacheDir);
  const files = await fsPromises.readdir(cacheDir).catch(() => [] as string[]);
  const mp3s = files.filter((f) => f.endsWith('.mp3'));

  const plan = planCacheInvalidation(saved, current, mp3s);
  const metaChanged = JSON.stringify(saved) !== JSON.stringify(current);

  for (const name of plan.deleteFiles) {
    await fsPromises.unlink(path.join(cacheDir, name)).catch(() => {});
  }
  if (metaChanged) await writeCacheMeta(cacheDir, current);

  return {
    deleted: plan.deleteFiles.length,
    fullWipe: plan.fullWipe,
    reasons: plan.reasons,
    metaChanged,
  };
}
