// 채팅 히스토리가 최신 200개를 시간순으로 반환하는지 검증한다.
import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('최신 메시지 200개를 조회한 뒤 오래된 순으로 반환', async () => {
    const rows = [
      { id: 3, createdAt: new Date('2026-07-11T03:00:00Z') },
      { id: 2, createdAt: new Date('2026-07-11T02:00:00Z') },
      { id: 1, createdAt: new Date('2026-07-11T01:00:00Z') },
    ];
    const repo = {
      find: jest.fn().mockResolvedValue(rows),
    };
    const service = new ChatService(repo as never);

    const result = await service.getRecentMessages();

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC' },
        take: 200,
      }),
    );
    expect(result.map((message) => message.id)).toEqual([1, 2, 3]);
  });
});
