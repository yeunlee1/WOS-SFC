/**
 * TTS 파일 사전 생성 스크립트
 *
 * 실행:  cd server && npm run tts:generate
 *
 * 처음 한 번만 실행하면 이후 서버 재시작 시 Google TTS API를 전혀 호출하지 않는다.
 * 생성 위치: server/tts-cache/{lang}-{key}.mp3
 *
 * 서버와 같은 캐시 메타(cache.meta.json)를 남긴다 — 남기지 않으면 다음 부팅에서
 * "메타 없음"으로 판정되어 방금 만든 파일이 전부 삭제된다.
 * 무효화 판정·SSML 템플릿·무음 판정 기준도 모두 서버와 공유한다.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import axios from 'axios';
import * as dotenv from 'dotenv';
import {
  LANGS,
  GOOGLE_VOICES,
  MIN_MP3_BYTES,
  PHRASES,
  SPEAKING_RATE,
  TTS_PREGEN_MAX,
} from '../tts.constants';
import { buildSsmlInput, reconcileCache } from '../tts.cache-meta';

export interface GenerateOptions {
  /** 생략하면 TTS_CACHE_DIR 환경변수 → cwd/tts-cache 순으로 정한다. */
  cacheDir?: string;
  /** 생략하면 GOOGLE_TTS_API_KEY 환경변수를 쓴다. */
  apiKey?: string;
  /** 진행 출력을 끈다(테스트용). */
  silent?: boolean;
}

export interface GenerateResult {
  created: number;
  skipped: number;
  failed: number;
  total: number;
}

// ── Google TTS 호출 ────────────────────────────────────────────────────────
async function fetchAudio(
  apiKey: string,
  lang: string,
  key: string,
  text: string,
  attempt = 1,
): Promise<Buffer> {
  const voice = GOOGLE_VOICES[lang] ?? GOOGLE_VOICES['ko'];
  // SSML·speakingRate 는 tts.cache-meta / tts.constants 에서 가져온다.
  // 여기서 값을 다시 적으면 서버가 만든 mp3 와 발음이 갈라지고 메타가 거짓이 된다.
  const input = buildSsmlInput(key, text);

  try {
    const res = await axios.post(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        input,
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: { audioEncoding: 'MP3', speakingRate: SPEAKING_RATE },
      },
      { timeout: 15000 },
    );
    return Buffer.from(res.data.audioContent as string, 'base64');
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    // 429(레이트 리밋) / 5xx(서버 에러) → 지수 백오프 재시도 (최대 5회)
    if (
      (status === 429 || (status !== undefined && status >= 500)) &&
      attempt < 5
    ) {
      const waitMs = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, waitMs));
      return fetchAudio(apiKey, lang, key, text, attempt + 1);
    }
    throw e;
  }
}

// ── 단일 파일 생성 (이미 있으면 스킵) ─────────────────────────────────────
async function ensureFile(
  cacheDir: string,
  apiKey: string,
  lang: string,
  key: string,
  text: string,
): Promise<'skipped' | 'created'> {
  const fp = path.join(cacheDir, `${lang}-${key}.mp3`);
  const exists = await fsPromises
    .access(fp)
    .then(() => true)
    .catch(() => false);
  if (exists) return 'skipped';

  const tmpFp = `${fp}.tmp`;
  try {
    const buf = await fetchAudio(apiKey, lang, key, text);
    // 무음 응답을 성공으로 세지 않는다 — 서버의 판정 기준과 같은 값을 쓴다.
    if (buf.length < MIN_MP3_BYTES) {
      throw new Error(`TTS 응답 ${buf.length} bytes — 무음 가능성`);
    }
    await fsPromises.writeFile(tmpFp, buf);
    await fsPromises.rename(tmpFp, fp);
    return 'created';
  } catch (e) {
    await fsPromises.unlink(tmpFp).catch(() => {});
    throw e;
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────
export async function main(
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  dotenv.config({ path: path.join(__dirname, '../../../.env') });

  const apiKey = options.apiKey ?? process.env.GOOGLE_TTS_API_KEY ?? '';
  const cacheDir = path.resolve(
    options.cacheDir ??
      process.env.TTS_CACHE_DIR ??
      path.join(process.cwd(), 'tts-cache'),
  );
  const say = (msg: string) => {
    if (!options.silent) console.log(msg);
  };

  if (!apiKey) {
    throw new Error('GOOGLE_TTS_API_KEY가 .env에 없습니다.');
  }

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  // 서버 부팅과 같은 규칙으로 먼저 정리한다. 이걸 건너뛰면 낡은 설정으로 만든 mp3가
  // "이미 있음"으로 스킵된 뒤 새 메타가 기록되어 영구히 살아남는다.
  const reconciled = await reconcileCache(cacheDir);
  if (reconciled.deleted > 0) {
    say(
      `\n🧹  낡은 캐시 ${reconciled.deleted}개 삭제 (${reconciled.reasons.join(', ')})`,
    );
  }

  // 생성할 항목 목록 조립
  type Item = { lang: string; key: string; text: string };
  const items: Item[] = [];

  for (const lang of LANGS) {
    // 문구
    for (const [key, map] of Object.entries(PHRASES)) {
      items.push({ lang, key, text: map[lang] || map['en'] });
    }
    // 숫자 1~TTS_PREGEN_MAX
    for (let i = 1; i <= TTS_PREGEN_MAX; i++) {
      items.push({ lang, key: String(i), text: String(i) });
    }
  }

  const total = items.length;
  say(`\n🎙  TTS 파일 생성 시작`);
  say(
    `   대상: ${LANGS.join(', ')} × (문구 ${Object.keys(PHRASES).length}개 + 숫자 1~${TTS_PREGEN_MAX})`,
  );
  say(`   총 ${total}개 파일 → ${cacheDir}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  // 동시 3개 제한 (API 과부하 방지)
  const CONCURRENCY = 3;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const item = items[idx++];
      try {
        const result = await ensureFile(
          cacheDir,
          apiKey,
          item.lang,
          item.key,
          item.text,
        );
        if (result === 'created') {
          created++;
          const done = created + skipped + failed;
          if (!options.silent) {
            process.stdout.write(
              `\r   진행: ${done}/${total} (생성 ${created} / 스킵 ${skipped} / 실패 ${failed})`,
            );
          }
        } else {
          skipped++;
        }
      } catch (e) {
        failed++;
        if (!options.silent) {
          console.error(
            `\n   ❌  실패 [${item.lang}/${item.key}]: ${(e as Error).message}`,
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const done = created + skipped + failed;
  if (!options.silent) {
    process.stdout.write(
      `\r   진행: ${done}/${total} (생성 ${created} / 스킵 ${skipped} / 실패 ${failed})\n\n`,
    );
  }

  if (failed > 0) {
    say(
      `⚠️   ${failed}개 실패. 재실행하면 성공한 파일은 스킵되고 실패한 것만 재시도합니다.`,
    );
  } else {
    say(
      `✅  완료! 이제 서버를 재시작하면 API 호출 없이 바로 음성이 재생됩니다.`,
    );
  }

  return { created, skipped, failed, total };
}

// CLI 로 직접 실행할 때만 동작한다.
// import 만으로 실행되면 실제 캐시 디렉터리에 Google TTS 호출이 나가므로 반드시 가드한다.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
