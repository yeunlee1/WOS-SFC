// TTS 컨트롤러가 비정규 경로 입력을 서비스 호출 전에 거부하는지 검증한다.
import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TtsController } from './tts.controller';
import { TtsService, TtsUnavailableError } from './tts.service';

function responseMock() {
  const response = {
    status: jest.fn(),
    send: jest.fn(),
    json: jest.fn(),
    end: jest.fn(),
    setHeader: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.send.mockReturnValue(response);
  response.json.mockReturnValue(response);
  response.end.mockReturnValue(response);
  return response;
}

describe('TtsController path validation', () => {
  const service = {
    prepareAudio: jest.fn(),
    createAudioStream: jest.fn(),
  };
  let controller: TtsController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new TtsController(service as unknown as TtsService);
  });

  it('지원하지 않는 언어는 400으로 거부한다', async () => {
    const response = responseMock();

    await controller.serve(
      '../ko',
      '1',
      { headers: {} } as Request,
      response as unknown as Response,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(service.prepareAudio).not.toHaveBeenCalled();
    expect(service.createAudioStream).not.toHaveBeenCalled();
  });

  it.each(['../1', '..\\1', '__proto__', '001'])(
    '비정규 키 %s는 404로 거부한다',
    async (key) => {
      const response = responseMock();

      await controller.serve(
        'ko',
        key,
        { headers: {} } as Request,
        response as unknown as Response,
      );

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(service.prepareAudio).not.toHaveBeenCalled();
      expect(service.createAudioStream).not.toHaveBeenCalled();
    },
  );

  it('내부 오류 세부정보를 공개 응답에 포함하지 않는다', async () => {
    service.prepareAudio.mockRejectedValue(new Error('C:\\secret\\path'));
    const response = responseMock();

    await controller.serve(
      'ko',
      '1',
      { headers: {} } as Request,
      response as unknown as Response,
    );

    expect(service.prepareAudio).toHaveBeenCalledWith('ko', '1', '1');
    expect(service.createAudioStream).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({ error: 'audio unavailable' });
  });

  it('ETag가 일치하는 304 응답에서는 파일 스트림을 열지 않는다', async () => {
    const mtime = new Date('2026-07-11T00:00:00.000Z');
    const stat = { size: 1200, mtimeMs: mtime.getTime(), mtime };
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toFixed(0)}"`;
    service.prepareAudio.mockResolvedValue(stat);
    const response = responseMock();

    await controller.serve(
      'ko',
      '1',
      { headers: { 'if-none-match': etag } } as unknown as Request,
      response as unknown as Response,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    expect(response.end).toHaveBeenCalled();
    expect(service.createAudioStream).not.toHaveBeenCalled();
  });
  it('TTS 를 쓸 수 없으면 404 로 답하고 500 을 내지 않는다', async () => {
    service.prepareAudio.mockRejectedValue(new TtsUnavailableError('키 없음'));
    const response = responseMock();

    await controller.serve(
      'ko',
      '1',
      { headers: {} } as Request,
      response as unknown as Response,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({ error: 'audio unavailable' });
    expect(service.createAudioStream).not.toHaveBeenCalled();
  });
});
