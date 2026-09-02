import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import axios from 'axios';
import {
  LANGS,
  GOOGLE_VOICES,
  MIN_MP3_BYTES,
  PHRASES,
  TTS_KEYS,
  TTS_PREGEN_MAX,
  SPEAKING_RATE,
  getTtsText,
} from './tts.constants';
import { buildSsmlInput, reconcileCache } from './tts.cache-meta';

// ── 동시 Google TTS 호출 수 제한 ─────────────────────────────────────────
class Semaphore {
  private count: number;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) { this.count = max; }

  private acquire(): Promise<void> {
    if (this.count > 0) { this.count--; return Promise.resolve(); }
    return new Promise(resolve => this.queue.push(resolve));
  }

  private release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.count++;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

/** API 키가 없어 mp3 를 만들 수 없을 때. 컨트롤러는 이것을 404 로 바꾼다. */
export class TtsUnavailableError extends Error {}

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly logger = new Logger(TtsService.name);
  private readonly apiKey: string;
  private readonly cacheDir: string;
  private readonly allowedFilePaths: ReadonlyMap<string, string>;
  // Google TTS 무료 티어도 초당 요청 제한 있음 — 동시 3개로 제한
  private readonly semaphore = new Semaphore(3);
  // 동일 파일 중복 생성 방지 — 같은 키에 대한 요청을 하나의 Promise로 합침
  private readonly pendingFiles = new Map<string, Promise<void>>();

  constructor(private config: ConfigService) {
    this.apiKey  = this.config.get<string>('GOOGLE_TTS_API_KEY') || '';
    this.cacheDir = path.resolve(
      this.config.get<string>('TTS_CACHE_DIR') ||
        path.join(process.cwd(), 'tts-cache'),
    );
    this.allowedFilePaths = this.buildAllowedFilePaths();
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  // 서버 시작 시 사전 생성 (백그라운드 — startup 블로킹 없음)
  async onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_TTS_API_KEY 없음 — TTS 사전 생성 건너뜀');
      return;
    }

    // 바뀐 설정에 해당하는 mp3만 정리한다 (전량 삭제는 전역 설정이 바뀐 경우로 한정)
    await this.validateAndCleanCache();

    // 준비 판정 집합은 실제 사전 생성 집합(문구 + 1~TTS_PREGEN_MAX)과 같다.
    // 예전에는 1~10 + 문구만 보고 '완료'로 판정해 부분 캐시가 완료로 반올림됐다.
    const status = await this.collectCacheStatus();
    if (status.ready) {
      this.logger.log(
        `TTS 캐시 확인 완료 — ${status.total}개 모두 존재, 사전 생성 스킵 (API 호출 없음)`,
      );
      return;
    }

    this.logger.warn(
      `TTS 캐시 부분 준비 — ${status.total - status.missing.length}/${status.total} 존재, ` +
      `${status.missing.length}개 누락. 사전 생성 시작 ` +
      `(누락 예: ${status.missing.slice(0, 5).join(', ')})`,
    );
    this.preGenerateAll().catch(e => this.logger.error('preGenerateAll 실패', e));
  }

  private buildAllowedFilePaths(): ReadonlyMap<string, string> {
    const allowed = new Map<string, string>();
    for (const lang of LANGS) {
      for (const key of TTS_KEYS) {
        const filePath = this.resolveCacheFilePath(`${lang}-${key}.mp3`);
        allowed.set(this.fileLookupKey(lang, key), filePath);
      }
    }
    return allowed;
  }

  private resolveCacheFilePath(fileName: string): string {
    const filePath = path.resolve(this.cacheDir, fileName);
    const relative = path.relative(this.cacheDir, filePath);
    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      relative.includes(path.sep)
    ) {
      throw new Error('TTS 캐시 경로가 안전한 루트를 벗어났습니다');
    }
    return filePath;
  }

  private fileLookupKey(lang: string, key: string): string {
    return `${lang}\0${key}`;
  }

  // HTTP 입력에서 만든 문자열이 아니라 내부 allowlist가 보유한 경로만 반환한다.
  private filePath(lang: string, key: string): string {
    const filePath = this.allowedFilePaths.get(this.fileLookupKey(lang, key));
    if (!filePath) {
      throw new BadRequestException('허용되지 않은 TTS 파일입니다');
    }
    return filePath;
  }

  // ── 캐시 메타 자동 무효화 ────────────────────────────────────────────────
  // 판정과 삭제 규칙은 tts.cache-meta.ts 에 있다 (사전 생성 스크립트와 공용).
  // 전역 설정(speakingRate·SSML 템플릿)이 바뀌었을 때만 전량 삭제하고,
  // 음성 변경은 그 언어만, 문구 변경은 그 파일 하나만 무효화한다.
  private async validateAndCleanCache(): Promise<void> {
    const result = await reconcileCache(this.cacheDir);
    if (result.deleted === 0 && !result.metaChanged) return;

    const reason = result.reasons.join(', ') || '메타 형식 갱신';
    if (result.deleted === 0) {
      this.logger.log(`TTS 캐시 메타 갱신 — 삭제 없음 (${reason})`);
      return;
    }
    this.logger.log(
      `TTS 캐시 정리 — ${result.deleted}개 mp3 삭제` +
      `${result.fullWipe ? ' (전량 무효화)' : ' (부분 무효화)'} / 사유: ${reason}`,
    );
  }

  // 사전 생성 집합(문구 + 1~TTS_PREGEN_MAX, 전 언어)의 키 목록.
  private pregenKeys(): string[] {
    return [
      ...Object.keys(PHRASES),
      ...Array.from({ length: TTS_PREGEN_MAX }, (_, i) => String(i + 1)),
    ];
  }

  // 캐시 준비 상태 — 판정 집합이 실제 생성 집합과 같아야 부분 캐시가 '완료'로 새지 않는다.
  // 존재 여부만 본다. 무음·손상 파일은 요청 시 ensureFile 이 크기(MIN_MP3_BYTES)로 다시 거른다.
  private async collectCacheStatus(): Promise<{
    ready: boolean;
    total: number;
    missing: string[];
  }> {
    const present = new Set(
      (await fsPromises.readdir(this.cacheDir).catch(() => [] as string[]))
        .filter((f) => f.endsWith('.mp3')),
    );

    const keys = this.pregenKeys();
    const missing: string[] = [];
    for (const lang of LANGS) {
      for (const key of keys) {
        if (!present.has(`${lang}-${key}.mp3`)) missing.push(`${lang}/${key}`);
      }
    }

    return {
      ready: missing.length === 0,
      total: LANGS.length * keys.length,
      missing,
    };
  }

  // 파일 반환 — 없거나 손상(< MIN_MP3_BYTES) 파일이면 재생성.
  // 동일 키 동시 요청은 하나의 Promise로 합침.
  //
  // 기존 파일 크기 검증이 필요한 이유:
  //   Google TTS가 간혹 거의 빈 MP3(무음)를 반환해 800~900 bytes 파일이 캐시에 남음.
  //   generateFile 쪽 가드(MIN_MP3_BYTES)가 추가되기 이전에 생성된 파일 또는
  //   디스크 쓰기 중 중단된 파일이 그대로 유지되어 영구적으로 해당 숫자가
  //   "재생은 되지만 소리가 안 나는" 상태가 된다. exists + size >= MIN 두 조건으로
  //   한 번 걸러낸 뒤 못 통과하면 재생성.
  async ensureFile(lang: string, key: string, text: string): Promise<void> {
    const fp = this.filePath(lang, key);
    const healthy = await fsPromises.lstat(fp)
      .then((st) => st.isFile() && st.size >= MIN_MP3_BYTES)
      .catch(() => false);
    if (healthy) return;
    // 키가 없으면 생성 경로에 들어가지 않는다 — 들어가면 재시도 3회·1.5초 지연 뒤 500 이 반복된다.
    if (!this.apiKey) {
      throw new TtsUnavailableError(
        `[${lang}/${key}] 캐시에 없고 GOOGLE_TTS_API_KEY 가 없어 생성할 수 없다`,
      );
    }
    // 손상 파일이 있으면 삭제 (재생성 경로로 진입) — race-safe: ENOENT 무시
    await fsPromises.unlink(fp).catch(() => {});

    const lockKey = `${lang}-${key}`;
    if (this.pendingFiles.has(lockKey)) {
      return this.pendingFiles.get(lockKey)!;
    }

    const promise = this.semaphore
      .run(() => this.generateFile(lang, key, fp, text))
      .finally(() => this.pendingFiles.delete(lockKey));

    this.pendingFiles.set(lockKey, promise);
    return promise;
  }

  async prepareAudio(
    lang: string,
    key: string,
    text: string,
  ): Promise<fs.Stats> {
    await this.ensureFile(lang, key, text);
    const fp = this.filePath(lang, key);
    const stat = await fsPromises.lstat(fp);
    if (!stat.isFile()) {
      throw new Error('TTS 캐시 파일이 일반 파일이 아닙니다');
    }
    return stat;
  }

  createAudioStream(lang: string, key: string): fs.ReadStream {
    return fs.createReadStream(this.filePath(lang, key));
  }

  // 손상(무음) 판정 기준은 tts.constants.ts 의 MIN_MP3_BYTES — 사전 생성 스크립트와 공용.

  // Google TTS 무음 반환에 대한 최대 재시도 횟수.
  // 관찰된 결함: Chirp3-HD/Wavenet 모델이 짧은 1음절 cardinal SSML 합성에서
  // 간헐적으로 거의 빈 MP3를 반환. 모델 stochastic 특성이라 재호출 시 정상 응답 확률 높음.
  private static readonly MAX_TTS_RETRIES = 3;

  // 실제 파일 생성 — 무음 응답 시 재시도(exponential backoff).
  // 모든 시도 실패 시 throw → ensureFile이 에러 전파, 캐시에 손상 파일 저장되지 않음.
  private async generateFile(lang: string, key: string, fp: string, text: string): Promise<void> {
    const tmpFp = this.resolveCacheFilePath(`${path.basename(fp)}.tmp`);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= TtsService.MAX_TTS_RETRIES; attempt++) {
      try {
        const buf = await this.fetchFromGoogleTts(lang, key, text);
        if (buf.length < MIN_MP3_BYTES) {
          lastError = new Error(
            `TTS 응답 ${buf.length} bytes — 무음 가능성 (attempt ${attempt}/${TtsService.MAX_TTS_RETRIES})`,
          );
          this.logger.warn(
            `[${lang}/${key}] 무음 의심 ${buf.length}b — 재시도 ${attempt}/${TtsService.MAX_TTS_RETRIES}`,
          );
          if (attempt < TtsService.MAX_TTS_RETRIES) {
            // exponential backoff: 500ms, 1000ms, 1500ms (Google TTS rate limit 배려)
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
          continue;
        }
        await fsPromises.writeFile(tmpFp, buf);
        await fsPromises.rename(tmpFp, fp);
        return;
      } catch (e) {
        lastError = e as Error;
        await fsPromises.unlink(tmpFp).catch(() => {});
        if (attempt < TtsService.MAX_TTS_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    throw lastError ?? new Error(`[${lang}/${key}] 생성 실패 (${TtsService.MAX_TTS_RETRIES}회 재시도 소진)`);
  }

  // Google Cloud TTS REST API 호출
  // 숫자: SSML <say-as interpret-as="cardinal"> — "180" → "백팔십" (한국어 기준)
  // 문구: 일반 텍스트
  private async fetchFromGoogleTts(lang: string, key: string, text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error('GOOGLE_TTS_API_KEY 없음');

    const voice = GOOGLE_VOICES[lang] ?? GOOGLE_VOICES['ko'];

    // SSML 템플릿은 tts.cache-meta.ts 에 있다 — 사전 생성 스크립트와 반드시 같은 문자열을 쓰고,
    // 템플릿이 바뀌면 캐시 전역 지문이 바뀌어 전량 무효화된다.
    const input = buildSsmlInput(key, text);

    try {
      const res = await axios.post(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
        {
          input,
          voice: { languageCode: voice.languageCode, name: voice.name },
          audioConfig: { audioEncoding: 'MP3', speakingRate: SPEAKING_RATE },
        },
        { timeout: 10000 },
      );
      return Buffer.from(res.data.audioContent as string, 'base64');
    } catch (e) {
      this.logger.error(`Google TTS 호출 실패 [${lang}/${text}]: ${(e as Error).message}`);
      throw e;
    }
  }

  // 전체 사전 생성 — 1~10 순차, 문구+11~30 병렬, 31~TTS_PREGEN_MAX 백그라운드
  //
  // 실패를 삼키지 않는다: 개별 실패는 warn 으로 남기고, 끝나면 실제 캐시를 다시 세어
  // 누락이 있으면 error 로 요약한다. 예전에는 실패 건수와 무관하게 '완료' 로그를 찍어
  // Google TTS 분당 할당량 초과로 수백 개가 유실돼도 정상으로 보였다.
  async preGenerateAll() {
    const failures: string[] = [];
    const generate = async (lang: string, key: string, text: string) => {
      try {
        await this.ensureFile(lang, key, text);
      } catch (e) {
        failures.push(`${lang}/${key}`);
        this.logger.warn(`사전 생성 실패 [${lang}/${key}]: ${(e as Error).message}`);
      }
    };

    for (const lang of LANGS) {
      // 1단계: 1~10 순차 (즉시 필요)
      for (let i = 1; i <= 10; i++) {
        await generate(lang, String(i), String(i));
      }
      // 2단계: 문구 + 11~30 병렬 완료 보장
      const batch2 = [
        ...Object.entries(PHRASES).map(([key, map]) => ({ key, text: map[lang] || map['en'] })),
        ...Array.from({ length: 20 }, (_, i) => ({ key: String(i + 11), text: String(i + 11) })),
      ];
      await Promise.all(batch2.map(({ key, text }) => generate(lang, key, text)));
    }

    // 3단계: 31~TTS_PREGEN_MAX 백그라운드 (Google TTS 무료 티어 월 1,000,000자 — 7,000자 이내로 전부 가능)
    const batch3: Array<{ lang: string; key: string; text: string }> = [];
    for (const lang of LANGS) {
      for (let i = 31; i <= TTS_PREGEN_MAX; i++) {
        batch3.push({ lang, key: String(i), text: String(i) });
      }
    }
    void Promise.all(
      batch3.map(({ lang, key, text }) => generate(lang, key, text)),
    )
      .then(() => this.reportPreGenerateResult(failures))
      .catch(() => {});
  }

  // 사전 생성 결과 요약 — 카운터가 아니라 실제 캐시 파일을 다시 세어 보고한다.
  private async reportPreGenerateResult(failures: readonly string[]): Promise<void> {
    const status = await this.collectCacheStatus();
    if (failures.length === 0 && status.ready) {
      this.logger.log(
        `TTS 사전 생성 완료 — ${status.total}개 전부 준비됨 (1~${TTS_PREGEN_MAX}, 전 언어)`,
      );
      return;
    }
    this.logger.error(
      `TTS 사전 생성 미완료 — 생성 실패 ${failures.length}건, ` +
      `캐시 누락 ${status.missing.length}/${status.total}개. ` +
      `누락 예: ${status.missing.slice(0, 10).join(', ')}. ` +
      `분당 할당량 초과가 반복되면 개발 PC 에서 npm run tts:generate 로 만든 server/tts-cache 를 볼륨에 옮기거나, ` +
      `컨테이너에서 npm run tts:generate:prod 를 실행하라.`,
    );
  }
}
