import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import axios from 'axios';
import { LANGS, GOOGLE_VOICES, PHRASES, TTS_PREGEN_MAX, getTtsText } from './tts.constants';

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

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly logger = new Logger(TtsService.name);
  private readonly apiKey: string;
  private readonly cacheDir: string;
  // Google TTS 무료 티어도 초당 요청 제한 있음 — 동시 3개로 제한
  private readonly semaphore = new Semaphore(3);
  // 동일 파일 중복 생성 방지 — 같은 키에 대한 요청을 하나의 Promise로 합침
  private readonly pendingFiles = new Map<string, Promise<string>>();

  constructor(private config: ConfigService) {
    this.apiKey  = this.config.get<string>('GOOGLE_TTS_API_KEY') || '';
    this.cacheDir = this.config.get<string>('TTS_CACHE_DIR')
      || path.join(process.cwd(), 'tts-cache');
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  // 서버 시작 시 사전 생성 (백그라운드 — startup 블로킹 없음)
  async onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_TTS_API_KEY 없음 — TTS 사전 생성 건너뜀');
      return;
    }
    // 핵심 파일(숫자 1~10 + 문구)이 모두 있으면 사전 생성 스킵
    // npm run tts:generate 로 미리 생성한 경우
    const alreadyReady = LANGS.every(lang =>
      [...Array.from({ length: 10 }, (_, i) => String(i + 1)),
       ...Object.keys(PHRASES)].every(k => this.fileExists(lang, k))
    );
    if (alreadyReady) {
      this.logger.log('TTS 캐시 확인 완료 — 사전 생성 스킵 (API 호출 없음)');
      return;
    }
    this.preGenerateAll().catch(e => this.logger.error('preGenerateAll 실패', e));
  }

  // 파일 경로 규칙: {cacheDir}/{lang}-{key}.mp3
  private filePath(lang: string, key: string): string {
    return path.join(this.cacheDir, `${lang}-${key}.mp3`);
  }

  // 파일 반환 — 없으면 생성, 동일 키 동시 요청은 하나의 Promise로 합침
  async ensureFile(lang: string, key: string, text: string): Promise<string> {
    const fp = this.filePath(lang, key);
    const exists = await fsPromises.access(fp).then(() => true).catch(() => false);
    if (exists) return fp;

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

  // Google TTS가 간혹 거의 빈 MP3(무음)를 반환하는 것을 감지하기 위한 최소 바이트.
  // 관찰값: 손상 파일 ≤900~3000 bytes / 정상 파일 3000+bytes.
  // 짧은 문자열의 정상 오디오도 2KB 이상 나오므로 1000 bytes 미만은 손상으로 간주.
  private static readonly MIN_MP3_BYTES = 1000;

  // 실제 파일 생성
  private async generateFile(lang: string, key: string, fp: string, text: string): Promise<string> {
    const tmpFp = `${fp}.tmp`;
    try {
      const buf = await this.fetchFromGoogleTts(lang, key, text);
      if (buf.length < TtsService.MIN_MP3_BYTES) {
        throw new Error(`TTS 응답이 비정상적으로 작음 (${buf.length} bytes) — 무음 가능성`);
      }
      await fsPromises.writeFile(tmpFp, buf);
      await fsPromises.rename(tmpFp, fp);
      return fp;
    } catch (e) {
      await fsPromises.unlink(tmpFp).catch(() => {});
      throw e;
    }
  }

  fileExists(lang: string, key: string): boolean {
    return fs.existsSync(this.filePath(lang, key));
  }

  getFilePath(lang: string, key: string): string {
    return this.filePath(lang, key);
  }

  // Google Cloud TTS REST API 호출
  // 숫자: SSML <say-as interpret-as="cardinal"> — "180" → "백팔십" (한국어 기준)
  // 문구: 일반 텍스트
  private async fetchFromGoogleTts(lang: string, key: string, text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error('GOOGLE_TTS_API_KEY 없음');

    const voice = GOOGLE_VOICES[lang] ?? GOOGLE_VOICES['ko'];
    const isNumber = /^\d+$/.test(key);

    // <prosody pitch="0st"> — Wavenet의 음정을 baseline으로 고정.
    // 같은 톤·볼륨·발음속도로 발화되어 숫자별 길이 편차와 음정 요동이 최소화된다.
    // Chirp3-HD에서는 무시되던 태그이며 Wavenet에서만 유효하다.
    const input = isNumber
      ? { ssml: `<speak><prosody pitch="0st" rate="1.0" volume="medium"><say-as interpret-as="cardinal">${text}</say-as></prosody></speak>` }
      : { ssml: `<speak><prosody pitch="0st" rate="1.0" volume="medium">${text}</prosody></speak>` };

    try {
      const res = await axios.post(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
        {
          input,
          voice: { languageCode: voice.languageCode, name: voice.name },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.5 },
        },
        { timeout: 10000 },
      );
      return Buffer.from(res.data.audioContent as string, 'base64');
    } catch (e) {
      this.logger.error(`Google TTS 호출 실패 [${lang}/${text}]: ${(e as Error).message}`);
      throw e;
    }
  }

  // 전체 사전 생성 — 1~10 순차, 문구+11~30 병렬, 31~600 백그라운드
  async preGenerateAll() {
    for (const lang of LANGS) {
      // 1단계: 1~10 순차 (즉시 필요)
      for (let i = 1; i <= 10; i++) {
        await this.ensureFile(lang, String(i), String(i)).catch(e =>
          this.logger.warn(`사전 생성 실패 [${lang}/${i}]: ${e.message}`)
        );
      }
      // 2단계: 문구 + 11~30 병렬 완료 보장
      const batch2 = [
        ...Object.entries(PHRASES).map(([key, map]) => ({ key, text: map[lang] || map['en'] })),
        ...Array.from({ length: 20 }, (_, i) => ({ key: String(i + 11), text: String(i + 11) })),
      ];
      await Promise.allSettled(
        batch2.map(({ key, text }) =>
          this.ensureFile(lang, key, text).catch(e =>
            this.logger.warn(`사전 생성 실패 [${lang}/${key}]: ${e.message}`)
          )
        )
      );
    }

    // 3단계: 31~600 백그라운드 (Google TTS 무료 티어 월 1,000,000자 — 7,000자 이내로 전부 가능)
    const batch3: Array<{ lang: string; key: string; text: string }> = [];
    for (const lang of LANGS) {
      for (let i = 31; i <= TTS_PREGEN_MAX; i++) {
        batch3.push({ lang, key: String(i), text: String(i) });
      }
    }
    Promise.allSettled(
      batch3.map(({ lang, key, text }) =>
        this.ensureFile(lang, key, text).catch(e =>
          this.logger.warn(`백그라운드 생성 실패 [${lang}/${key}]: ${e.message}`)
        )
      )
    ).then(() => this.logger.log(`TTS 사전 생성 완료 (1~${TTS_PREGEN_MAX}, 전 언어)`))
     .catch(() => {});
  }
}
