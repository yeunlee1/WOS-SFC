import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import axios from 'axios';
import { LANGS, LANG_CODES, PHRASES, TTS_NUM_MAX, getTtsText } from './tts.constants';

// ── 동시 ElevenLabs 호출 수 제한 (rate limit 대응) ──────────────────────
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
  private readonly voiceId: string;
  private readonly cacheDir: string;
  // 동시 ElevenLabs 호출 3개로 제한 (Starter 플랜 기준)
  private readonly semaphore = new Semaphore(3);
  // 동일 파일 중복 생성 방지 — 같은 키에 대한 요청을 하나의 Promise로 합침
  private readonly pendingFiles = new Map<string, Promise<string>>();

  constructor(private config: ConfigService) {
    this.apiKey  = this.config.get<string>('ELEVENLABS_API_KEY') || '';
    this.voiceId = this.config.get<string>('ELEVENLABS_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL';
    // I3: 환경변수로 캐시 경로 주입 가능 (컨테이너 볼륨 마운트 대응)
    this.cacheDir = this.config.get<string>('TTS_CACHE_DIR')
      || path.join(process.cwd(), 'tts-cache');
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  // 서버 시작 시 사전 생성 (1~30 완전 완료 보장, 31~600 백그라운드)
  async onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn('ELEVENLABS_API_KEY 없음 — TTS 사전 생성 건너뜀');
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
    // I4: async 파일 존재 확인
    const exists = await fsPromises.access(fp).then(() => true).catch(() => false);
    if (exists) return fp;

    // 동일 파일에 대한 중복 ElevenLabs 호출 방지
    const lockKey = `${lang}-${key}`;
    if (this.pendingFiles.has(lockKey)) {
      return this.pendingFiles.get(lockKey)!;
    }

    const promise = this.semaphore
      .run(() => this.generateFile(lang, fp, text))
      .finally(() => this.pendingFiles.delete(lockKey));

    this.pendingFiles.set(lockKey, promise);
    return promise;
  }

  // 실제 파일 생성
  private async generateFile(lang: string, fp: string, text: string): Promise<string> {
    // 생성 중 서버 재시작으로 인한 partial file 방지: 임시 파일에 먼저 쓰기
    const tmpFp = `${fp}.tmp`;
    try {
      const buf = await this.fetchFromElevenLabs(lang, text);
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

  // ElevenLabs 호출 — language_code로 언어 강제 지정, timeout 10s
  private async fetchFromElevenLabs(lang: string, text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY 없음');
    const languageCode = LANG_CODES[lang] ?? 'ko';
    try {
      const res = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
        {
          text,
          model_id: 'eleven_multilingual_v2',
          language_code: languageCode,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        },
        {
          headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 10000, // M2: 10초 타임아웃
        },
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (e) {
      // M3: 에러 로깅 (API 키 만료·쿼터 초과 감지)
      this.logger.error(`ElevenLabs 호출 실패 [${lang}/${text}]: ${(e as Error).message}`);
      throw e;
    }
  }

  // 전체 사전 생성 — 1~30 완전 완료 보장, 31~600 백그라운드 (startup 블로킹 없음)
  async preGenerateAll() {
    for (const lang of LANGS) {
      // 1단계: 1~10 순차 (즉시 필요)
      for (let i = 1; i <= 10; i++) {
        await this.ensureFile(lang, String(i), String(i)).catch(e =>
          this.logger.warn(`사전 생성 실패 [${lang}/${i}]: ${e.message}`)
        );
      }
      // 2단계: 문구 + 11~30 병렬 완료 보장 (concurrency=3 세마포어 적용)
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

    // 3단계: 31~600 백그라운드 (서버 startup 블로킹 없음, concurrency=3 세마포어 적용)
    const batch3: Array<{ lang: string; key: string; text: string }> = [];
    for (const lang of LANGS) {
      for (let i = 31; i <= TTS_NUM_MAX; i++) {
        batch3.push({ lang, key: String(i), text: String(i) });
      }
    }
    Promise.allSettled(
      batch3.map(({ lang, key, text }) =>
        this.ensureFile(lang, key, text).catch(e =>
          this.logger.warn(`백그라운드 생성 실패 [${lang}/${key}]: ${e.message}`)
        )
      )
    ).then(() => this.logger.log('TTS 사전 생성 완료 (1~600, 전 언어)'))
     .catch(() => {});
  }
}
