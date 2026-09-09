// message_translations 조회가 쿼리 1회로 id→언어→번역 맵을 만들고, upsert 가 ON DUPLICATE KEY 로 저장하며 실패를 삼키는지 검증한다.
import { Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { MessageTranslationsService } from './message-translations.service';

function makeRepo() {
  const execute = jest.fn().mockResolvedValue({});
  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    execute,
  };
  const repo = {
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  return { repo, qb };
}

describe('MessageTranslationsService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('getForMessages', () => {
    it('id·언어 IN 조건 한 번으로 조회해 id→{lang:text} 맵을 만든다', async () => {
      const { repo } = makeRepo();
      repo.find.mockResolvedValueOnce([
        { messageId: 1, lang: 'en', text: 'Rally' },
        { messageId: 1, lang: 'ja', text: '集結' },
        { messageId: 3, lang: 'en', text: 'gg' },
      ]);
      const service = new MessageTranslationsService(repo as never);

      const result = await service.getForMessages([1, 2, 3], ['en', 'ja']);

      expect(repo.find).toHaveBeenCalledTimes(1);
      expect(repo.find).toHaveBeenCalledWith({
        where: { messageId: In([1, 2, 3]), lang: In(['en', 'ja']) },
      });
      expect(result).toEqual(
        new Map([
          [1, { en: 'Rally', ja: '集結' }],
          [3, { en: 'gg' }],
        ]),
      );
      expect(result.has(2)).toBe(false);
    });

    it('id 나 언어가 비면 조회하지 않는다', async () => {
      const { repo } = makeRepo();
      const service = new MessageTranslationsService(repo as never);
      await expect(service.getForMessages([], ['en'])).resolves.toEqual(new Map());
      await expect(service.getForMessages([1], [])).resolves.toEqual(new Map());
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('upsertMany', () => {
    it('INSERT … ON DUPLICATE KEY UPDATE 로 한 번에 저장한다', async () => {
      const { repo, qb } = makeRepo();
      const service = new MessageTranslationsService(repo as never);
      const rows = [
        { messageId: 1, lang: 'en' as const, text: 'Rally' },
        { messageId: 1, lang: 'ja' as const, text: '集結' },
      ];

      await service.upsertMany(rows);

      expect(repo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(qb.insert).toHaveBeenCalled();
      expect(qb.values).toHaveBeenCalledWith(rows);
      expect(qb.orUpdate).toHaveBeenCalledWith(['text'], ['message_id', 'lang']);
      expect(qb.execute).toHaveBeenCalledTimes(1);
    });

    it('빈 배열이면 쿼리를 내지 않는다', async () => {
      const { repo } = makeRepo();
      const service = new MessageTranslationsService(repo as never);
      await service.upsertMany([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('저장 실패는 경고만 남기고 던지지 않는다', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { repo, qb } = makeRepo();
      qb.execute.mockRejectedValueOnce(new Error('db down'));
      const service = new MessageTranslationsService(repo as never);

      await expect(
        service.upsertMany([{ messageId: 1, lang: 'en', text: 'x' }]),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('db down');
    });
  });
});
