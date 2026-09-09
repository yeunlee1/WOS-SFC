// 채팅 히스토리 조회와 보존 정리 옵트인 스케줄을 검증한다.
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, type ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Message } from './message.entity';
import {
  CHAT_HISTORY_DAYS,
  ChatService,
  MESSAGE_RETENTION_FIRST_RUN_MS,
  MESSAGE_RETENTION_INTERVAL_MS,
  parseRetentionDays,
} from './chat.service';

function makeSelectQb(rows: unknown[]) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('ChatService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('getRecentMessages (A-P1·T2)', () => {
    it('QueryBuilder 로 조인·필요 컬럼만·limit(200) 한 번에 조회하고 오래된 순으로 돌려준다', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-10T12:00:00Z'));
      const rows = [
        { id: 3, createdAt: new Date('2026-09-10T03:00:00Z') },
        { id: 2, createdAt: new Date('2026-09-10T02:00:00Z') },
        { id: 1, createdAt: new Date('2026-09-10T01:00:00Z') },
      ];
      const qb = makeSelectQb(rows);
      const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb), find: jest.fn() };
      const service = new ChatService(repo as never, { get: () => undefined } as unknown as ConfigService);

      const result = await service.getRecentMessages();

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('m');
      expect(repo.find).not.toHaveBeenCalled();
      expect(qb.innerJoin).toHaveBeenCalledWith('m.user', 'u');
      const selected: string[] = qb.select.mock.calls[0][0];
      for (const column of ['m.id', 'm.content', 'm.createdAt', 'u.nickname', 'u.allianceName', 'u.language']) {
        expect(selected).toContain(column);
      }
      expect(selected.some((c) => /password/i.test(c))).toBe(false);
      expect(qb.where).toHaveBeenCalledWith('m.createdAt > :since', {
        since: new Date(Date.now() - CHAT_HISTORY_DAYS * 86_400_000),
      });
      expect(CHAT_HISTORY_DAYS).toBe(7);
      expect(qb.orderBy).toHaveBeenCalledWith('m.createdAt', 'DESC');
      expect(qb.limit).toHaveBeenCalledWith(200);
      expect(qb.take).not.toHaveBeenCalled();
      expect(qb.getMany).toHaveBeenCalledTimes(1);
      expect(result.map((message) => message.id)).toEqual([1, 2, 3]);
    });
  });

  describe('saveMessage (A-P2)', () => {
    it('insert 한 번으로 저장하고 SELECT 재조회 없이 반환 객체를 만든다', async () => {
      const repo = {
        insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 42 }] }),
        save: jest.fn(),
        create: jest.fn(),
      };
      const service = new ChatService(repo as never, { get: () => undefined } as unknown as ConfigService);
      const user = { id: 7, nickname: 'n', allianceName: 'KOR', language: 'ko', role: 'member' };
      const before = Date.now();

      const saved = await service.saveMessage(user as never, 'hello');

      expect(repo.insert).toHaveBeenCalledTimes(1);
      expect(repo.insert).toHaveBeenCalledWith({
        userId: 7,
        content: 'hello',
        createdAt: expect.any(Date),
      });
      expect(repo.save).not.toHaveBeenCalled();
      expect(saved).toMatchObject({ id: 42, content: 'hello', userId: 7 });
      expect(saved.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.user).toBe(user);
    });
  });

  describe('deleteOldMessages (A-A7)', () => {
    it('LIMIT 1000 씩 반복 삭제하고 합계를 돌려준다', async () => {
      const repo = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ affectedRows: 1000 })
          .mockResolvedValueOnce({ affectedRows: 1000 })
          .mockResolvedValueOnce({ affectedRows: 300 }),
      };
      const service = new ChatService(repo as never, { get: () => undefined } as unknown as ConfigService);

      await expect(service.deleteOldMessages(7)).resolves.toBe(2300);

      expect(repo.query).toHaveBeenCalledTimes(3);
      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toMatch(/DELETE FROM `?messages`? WHERE `?created_at`? < \? LIMIT 1000/);
      expect(params).toEqual([expect.any(Date)]);
    });

    it('삭제 대상이 0이면 한 번만 돌고 0 이다', async () => {
      const repo = { query: jest.fn().mockResolvedValueOnce({ affectedRows: 0 }) };
      const service = new ChatService(repo as never, { get: () => undefined } as unknown as ConfigService);
      await expect(service.deleteOldMessages(7)).resolves.toBe(0);
      expect(repo.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('보존 정리 옵트인', () => {
    function makeService(retentionDays?: string) {
      const repo = {
        find: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(12),
        createQueryBuilder: jest.fn(),
      };
      const config = {
        get: jest.fn((key: string) =>
          key === 'CHAT_RETENTION_DAYS' ? retentionDays : undefined,
        ),
      };
      return new ChatService(
        repo as never,
        config as unknown as ConfigService,
      );
    }

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    describe('parseRetentionDays', () => {
      it.each([undefined, null, '', '   ', '0', '-1', '-7', 'abc', '1.5', '7일'])(
        '유효하지 않은 값 %p 은 비활성(null)이다',
        (raw) => {
          expect(parseRetentionDays(raw)).toBeNull();
        },
      );

      it.each([
        ['1', 1],
        ['7', 7],
        ['30', 30],
      ])('유효한 값 %p 은 %p 일로 해석한다', (raw, expected) => {
        expect(parseRetentionDays(raw)).toBe(expected);
      });
    });

    it('CHAT_RETENTION_DAYS가 없으면 타이머를 걸지 않고 삭제도 하지 않는다', async () => {
      jest.useFakeTimers();
      const service = makeService(undefined);
      const cleanup = jest
        .spyOn(service, 'deleteOldMessages')
        .mockResolvedValue(0);

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(
        MESSAGE_RETENTION_FIRST_RUN_MS + MESSAGE_RETENTION_INTERVAL_MS * 5,
      );

      expect(cleanup).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('비활성이면 조용히 꺼져 있지 않고 경고를 남긴다', () => {
      jest.useFakeTimers();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const service = makeService(undefined);

      service.onModuleInit();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('CHAT_RETENTION_DAYS');
      expect(message).toContain('누적');
    });

    it.each(['', '0', '-1', 'abc', '1.5'])(
      '잘못된 값 %p 이면 안전하게 비활성이다',
      async (raw) => {
        jest.useFakeTimers();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        const service = makeService(raw);
        const cleanup = jest
          .spyOn(service, 'deleteOldMessages')
          .mockResolvedValue(0);

        service.onModuleInit();
        await jest.advanceTimersByTimeAsync(
          MESSAGE_RETENTION_FIRST_RUN_MS + MESSAGE_RETENTION_INTERVAL_MS,
        );

        expect(cleanup).not.toHaveBeenCalled();
      },
    );

    it('설정하면 첫 실행 뒤 주기적으로 정리한다', async () => {
      jest.useFakeTimers();
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const service = makeService('7');
      const cleanup = jest
        .spyOn(service, 'deleteOldMessages')
        .mockResolvedValue(3);

      service.onModuleInit();
      expect(cleanup).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_FIRST_RUN_MS);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(7);

      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_INTERVAL_MS);
      expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it('삭제 전 대상 건수와 실제 삭제 건수를 모두 로그로 남긴다', async () => {
      jest.useFakeTimers();
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const service = makeService('7');
      jest.spyOn(service, 'countOldMessages').mockResolvedValue(12);
      jest.spyOn(service, 'deleteOldMessages').mockResolvedValue(12);

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_FIRST_RUN_MS);

      const messages = log.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes('대상') && m.includes('12'))).toBe(
        true,
      );
      expect(messages.some((m) => m.includes('삭제') && m.includes('12'))).toBe(
        true,
      );
    });

    it('모듈이 내려가면 타이머를 정리한다', async () => {
      jest.useFakeTimers();
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const service = makeService('7');
      const cleanup = jest
        .spyOn(service, 'deleteOldMessages')
        .mockResolvedValue(0);

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_FIRST_RUN_MS);
      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_INTERVAL_MS * 3);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('정리가 실패해도 다음 주기를 계속 돈다', async () => {
      jest.useFakeTimers();
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const service = makeService('7');
      const cleanup = jest
        .spyOn(service, 'deleteOldMessages')
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue(0);

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_FIRST_RUN_MS);
      await jest.advanceTimersByTimeAsync(MESSAGE_RETENTION_INTERVAL_MS);
      service.onModuleDestroy();

      expect(cleanup).toHaveBeenCalledTimes(2);
    });
  });

  // ChatModule은 ConfigModule을 import하지 않는다. TtsModule/TtsService와 같은 구조로,
  // app.module.ts의 ConfigModule.forRoot({ isGlobal: true })에 의존한다.
  // 그 전제가 깨지면 서버가 부팅 자체를 못 하므로 배선을 테스트로 고정한다.
  describe('DI 배선', () => {
    @Module({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(Message),
          useValue: {
            find: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    })
    class ChatLikeModule {}

    it('ConfigModule을 import하지 않는 기능 모듈에서도 ConfigService가 주입된다', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true }), ChatLikeModule],
      }).compile();

      expect(moduleRef.get(ChatService, { strict: false })).toBeInstanceOf(
        ChatService,
      );
      await moduleRef.close();
    });
  });
});
