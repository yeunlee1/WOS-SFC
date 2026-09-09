// 채팅 번역 배치 API가 계약 픽스처와 같은 요청·응답 형태를 지키고 429를 보존하는지 검증한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as apiModule from '../index';

const { api } = apiModule;

const fixtures = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../docs/contracts/chat-events.json',
    ),
    'utf8',
  ),
);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('api.translateBatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('요청 본문이 픽스처 translate:batch:request와 같은 형태다', async () => {
    const request = fixtures['translate:batch:request'];
    const fetchMock = vi.fn(async () =>
      jsonResponse(fixtures['translate:batch:response']),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.translateBatch(request.targetLang, request.items);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/translate/batch');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(request);
  });

  it('응답 { translated, skipped, failed } 를 그대로 돌려준다', async () => {
    const response = fixtures['translate:batch:response'];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response)));

    await expect(api.translateBatch('en', [{ id: 100, text: '집결' }])).resolves.toEqual(
      response,
    );
  });

  it('429는 status와 retryAfterMs를 보존한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(fixtures['translate:429'], 429)),
    );

    await expect(
      api.translateBatch('en', [{ id: 1, text: 'x' }]),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 12000 });
  });

  it('AbortSignal을 fetch에 전달한다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(fixtures['translate:batch:response']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await api.translateBatch('en', [{ id: 1, text: 'x' }], {
      signal: controller.signal,
    });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  // B-1·B-6·C-10: 채팅 단건 경로와 로컬 캐시 읽기·쓰기는 제거한다.
  it('translateChatMessage 단건 경로는 더 이상 export되지 않는다', () => {
    expect(apiModule.translateChatMessage).toBeUndefined();
  });
});
