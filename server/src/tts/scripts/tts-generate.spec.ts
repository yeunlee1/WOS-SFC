// 사전 생성 스크립트가 서비스와 같은 캐시 메타·무효화 규칙을 쓰는지 검증한다.
// Google TTS 는 mock 이며 실제 운영 캐시(server/tts-cache)는 건드리지 않는다 — 임시 디렉터리 전용.
jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));

import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from './tts-generate';
import { TtsService } from '../tts.service';
import { cacheMetaPath, writeCacheMeta } from '../tts.cache-meta';
import {
  LANGS,
  PHRASES,
  SPEAKING_RATE,
  TTS_PREGEN_MAX,
} from '../tts.constants';

const EXPECTED_FILES =
  LANGS.length * (Object.keys(PHRASES).length + TTS_PREGEN_MAX);

describe('tts:generate 스크립트 ↔ 서비스 캐시 메타 정합', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'wos-tts-gen-'));
    (axios.post as jest.Mock).mockReset();
    (axios.post as jest.Mock).mockResolvedValue({
      data: { audioContent: Buffer.alloc(2048, 7).toString('base64') },
    });
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('스크립트가 끝나면 메타가 기록되고, 서버 부팅이 캐시를 지우지 않는다', async () => {
    const result = await main({ cacheDir, apiKey: 'test-key', silent: true });

    expect(result.failed).toBe(0);
    expect(result.created).toBe(EXPECTED_FILES);
    expect(existsSync(cacheMetaPath(cacheDir))).toBe(true);

    const before = readdirSync(cacheDir)
      .filter((f) => f.endsWith('.mp3'))
      .sort();
    expect(before.length).toBe(EXPECTED_FILES);

    const service = new TtsService({
      get: (key: string) =>
        key === 'TTS_CACHE_DIR'
          ? cacheDir
          : key === 'GOOGLE_TTS_API_KEY'
            ? ''
            : undefined,
    } as unknown as ConfigService);
    await (
      service as unknown as { validateAndCleanCache: () => Promise<void> }
    ).validateAndCleanCache();

    const after = readdirSync(cacheDir)
      .filter((f) => f.endsWith('.mp3'))
      .sort();
    expect(after).toEqual(before);
  }, 120000);

  it('스크립트도 서비스와 같은 무효화 규칙을 적용해 낡은 mp3 를 남기지 않는다', async () => {
    // 허용 목록 밖(구 TTS_NUM_MAX 시절) 잔재 파일
    writeFileSync(join(cacheDir, 'ko-999.mp3'), Buffer.alloc(1200));
    await writeCacheMeta(cacheDir, {
      version: 2,
      speakingRate: SPEAKING_RATE,
      voices: {},
      global: 'stale',
      langs: {},
      phrases: {},
    } as never);

    await main({ cacheDir, apiKey: 'test-key', silent: true });

    expect(existsSync(join(cacheDir, 'ko-999.mp3'))).toBe(false);
  }, 120000);

  it('API 키가 없으면 process.exit 대신 에러를 던진다', async () => {
    await expect(main({ cacheDir, apiKey: '', silent: true })).rejects.toThrow(
      /GOOGLE_TTS_API_KEY/,
    );
  });
});
