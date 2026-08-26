// TTS 서비스가 allowlist 밖 입력을 파일시스템 접근 전에 차단하는지 검증한다.
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { once } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { TtsService } from './tts.service';

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
