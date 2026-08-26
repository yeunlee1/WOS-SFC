// TTS 서비스가 allowlist 밖 입력을 파일시스템 접근 전에 차단하는지 검증한다.
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { once } from 'events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { TtsService } from './tts.service';
import {
  buildCacheMeta,
  buildCacheMetaFrom,
  writeCacheMeta,
} from './tts.cache-meta';
import {
  GOOGLE_VOICES,
  LANGS,
  PHRASES,
  SPEAKING_RATE,
  TTS_PREGEN_MAX,
} from './tts.constants';

describe('TtsService cache path', () => {
  let cacheDir: string;
  let service: TtsService;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'wos-tts-'));
    service = new TtsService({
      get: (key: string) =>
        key === 'TTS_CACHE_DIR'
          ? cacheDir
          : key === 'GOOGLE_TTS_API_KEY'
            ? ''
            : undefined,
    } as unknown as ConfigService);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('유효한 키는 cache root의 직접 자식 경로만 사용한다', () => {
    const filePath = (
      service as unknown as { filePath: (lang: string, key: string) => string }
    ).filePath('ko', '1');

    expect(dirname(filePath)).toBe(cacheDir);
    expect(relative(cacheDir, filePath)).toBe('ko-1.mp3');
  });

  // march 가 allowlist 에 없으면 filePath 가 BadRequestException 을 던져
  // 캐시 미스 시 Google TTS 생성 경로로 진입조차 못 한다.
  it.each(['ko', 'en', 'ja', 'zh'])(
    '%s-march.mp3 가 allowlist 경로로 해석되어 생성 경로에 진입할 수 있다',
    (lang) => {
      const filePath = (
        service as unknown as { filePath: (l: string, k: string) => string }
      ).filePath(lang, 'march');

      expect(dirname(filePath)).toBe(cacheDir);
      expect(relative(cacheDir, filePath)).toBe(`${lang}-march.mp3`);
    },
  );

  it.each([
    ['../ko', '1'],
    ['ko', '../1'],
    ['ko', '..\\1'],
    ['ko', '__proto__'],
    ['ko', '001'],
  ])('allowlist 밖 입력 %s/%s는 FS 접근 전에 거부한다', async (lang, key) => {
    await expect(service.ensureFile(lang, key, 'text')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('일반 파일인 기존 캐시만 열어 스트림으로 반환한다', async () => {
    const filePath = join(cacheDir, 'ko-1.mp3');
    writeFileSync(filePath, Buffer.alloc(1200));

    const stat = await service.prepareAudio('ko', '1', '1');
    const stream = service.createAudioStream('ko', '1');

    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(1200);
    stream.resume();
    await once(stream, 'close');
  });
});

// 부팅 시 캐시 무효화·준비 판정이 실제 파일에 어떻게 작용하는지 검증한다.
// 실제 운영 캐시(server/tts-cache, mp3 796개)를 절대 건드리지 않도록 임시 디렉터리만 쓴다.
describe('TtsService 캐시 무효화와 준비 판정', () => {
  let cacheDir: string;

  const makeService = () =>
    new TtsService({
      get: (key: string) =>
        key === 'TTS_CACHE_DIR'
          ? cacheDir
          : key === 'GOOGLE_TTS_API_KEY'
            ? ''
            : undefined,
    } as unknown as ConfigService);

  const numberKeys = Array.from({ length: TTS_PREGEN_MAX }, (_, i) =>
    String(i + 1),
  );
  const phraseKeys = Object.keys(PHRASES);
  const allNames = LANGS.flatMap((lang) =>
    [...phraseKeys, ...numberKeys].map((key) => `${lang}-${key}.mp3`),
  );

  const writeMp3 = (name: string) =>
    writeFileSync(join(cacheDir, name), Buffer.alloc(1200));
  const listMp3 = () =>
    readdirSync(cacheDir)
      .filter((f) => f.endsWith('.mp3'))
      .sort();

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'wos-tts-meta-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('사전 생성 스크립트가 쓴 메타로 부팅하면 mp3 가 하나도 삭제되지 않는다', async () => {
    await writeCacheMeta(cacheDir, buildCacheMeta());
    allNames.forEach(writeMp3);

    const service = makeService();
    await (
      service as unknown as { validateAndCleanCache: () => Promise<void> }
    ).validateAndCleanCache();

    expect(listMp3()).toEqual([...allNames].sort());
  });

  it('문구 키만 늘어난 메타로 부팅해도 숫자 mp3 는 살아남는다', async () => {
    const phrasesWithoutMarch = { ...PHRASES };
    delete phrasesWithoutMarch.march;
    await writeCacheMeta(
      cacheDir,
      buildCacheMetaFrom({
        speakingRate: SPEAKING_RATE,
        voices: GOOGLE_VOICES,
        langs: LANGS,
        phrases: phrasesWithoutMarch,
      }),
    );
    allNames.forEach(writeMp3);

    const service = makeService();
    await (
      service as unknown as { validateAndCleanCache: () => Promise<void> }
    ).validateAndCleanCache();

    const remaining = listMp3();
    const numberFiles = LANGS.flatMap((lang) =>
      numberKeys.map((key) => `${lang}-${key}.mp3`),
    );
    expect(remaining).toEqual(expect.arrayContaining([...numberFiles].sort()));
    expect(remaining.length).toBe(allNames.length - LANGS.length);
    LANGS.forEach((lang) =>
      expect(remaining).not.toContain(`${lang}-march.mp3`),
    );
  });

  it('부분 캐시(1~10 + 문구)는 준비 완료로 판정되지 않는다', async () => {
    LANGS.forEach((lang) => {
      for (let i = 1; i <= 10; i++) writeMp3(`${lang}-${i}.mp3`);
      phraseKeys.forEach((key) => writeMp3(`${lang}-${key}.mp3`));
    });

    const service = makeService();
    const status = await (
      service as unknown as {
        collectCacheStatus: () => Promise<{
          ready: boolean;
          total: number;
          missing: string[];
        }>;
      }
    ).collectCacheStatus();

    expect(status.total).toBe(allNames.length);
    expect(status.ready).toBe(false);
    expect(status.missing.length).toBe(LANGS.length * (TTS_PREGEN_MAX - 10));
  });

  it('생성 집합 전체가 있으면 준비 완료로 판정된다', async () => {
    allNames.forEach(writeMp3);

    const service = makeService();
    const status = await (
      service as unknown as {
        collectCacheStatus: () => Promise<{
          ready: boolean;
          total: number;
          missing: string[];
        }>;
      }
    ).collectCacheStatus();

    expect(status.ready).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.total).toBe(allNames.length);
  });
});
