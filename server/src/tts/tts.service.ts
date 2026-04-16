import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

const CACHE_DIR = path.join(process.cwd(), 'tts-cache');

const LANGS = ['ko', 'en', 'ja', 'zh'];

const PHRASES: Record<string, Record<string, string>> = {
  start:  { ko: '카운트다운을 시작합니다.', en: 'Countdown starting.', ja: 'カウントダウンを開始します。', zh: '倒计时开始。' },
  stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
  finish: { ko: '시작!', en: 'Start!', ja: '始め!', zh: '开始!' },
};

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly apiKey: string;
  private readonly voiceId: string;

  constructor(private config: ConfigService) {
    this.apiKey  = this.config.get<string>('ELEVENLABS_API_KEY') || '';
    this.voiceId = this.config.get<string>('ELEVENLABS_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL';
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // 서버 시작 시 백그라운드 사전 생성
  async onModuleInit() {
    if (!this.apiKey) return;
    this.preGenerateAll().catch(() => {/* 실패 무시 */});
  }

  // 파일 경로 규칙: tts-cache/{lang}-{key}.mp3
  private filePath(lang: string, key: string): string {
    return path.join(CACHE_DIR, `${lang}-${key}.mp3`);
  }

  // 오디오 파일 반환 (디스크 캐시 우선)
  async getAudioBuffer(lang: string, key: string, text: string): Promise<Buffer> {
    const fp = this.filePath(lang, key);
    if (fs.existsSync(fp)) return fs.readFileSync(fp);

    const buf = await this.fetchFromElevenLabs(text);
    fs.writeFileSync(fp, buf);
    return buf;
  }

  // 파일 경로 반환 (존재하면 바로, 없으면 생성 후)
  async ensureFile(lang: string, key: string, text: string): Promise<string> {
    const fp = this.filePath(lang, key);
    if (!fs.existsSync(fp)) {
      const buf = await this.fetchFromElevenLabs(text);
      fs.writeFileSync(fp, buf);
    }
    return fp;
  }

  fileExists(lang: string, key: string): boolean {
    return fs.existsSync(this.filePath(lang, key));
  }

  getFilePath(lang: string, key: string): string {
    return this.filePath(lang, key);
  }

  // ElevenLabs 호출
  private async fetchFromElevenLabs(text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY 없음');
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
      },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  // 모든 숫자 + 문구 사전 생성 (1~180초 + 문구)
  async preGenerateAll() {
    for (const lang of LANGS) {
      // 1단계: 1~10 순차 (가장 빨리 필요)
      for (let i = 1; i <= 10; i++) {
        await this.ensureFile(lang, String(i), String(i)).catch(() => {});
      }
      // 2단계: 문구 + 11~30 병렬
      const batch2 = [
        ...Object.entries(PHRASES).map(([key, map]) => ({ key, text: map[lang] || map['en'] })),
        ...Array.from({ length: 20 }, (_, i) => ({ key: String(i + 11), text: String(i + 11) })),
      ];
      await Promise.allSettled(batch2.map(({ key, text }) => this.ensureFile(lang, key, text)));
      // 3단계: 31~180 백그라운드
      Promise.allSettled(
        Array.from({ length: 150 }, (_, i) => ({ key: String(i + 31), text: String(i + 31) }))
          .map(({ key, text }) => this.ensureFile(lang, key, text))
      );
    }
  }
}
