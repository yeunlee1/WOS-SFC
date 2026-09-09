// 텍스트 해시 번역 캐시 테이블 접근이 단건·다건 조회와 저장을 예상한 쿼리 수로 하는지 검증한다.
import { In } from 'typeorm';
import { TranslationsService } from './translations.service';

describe('TranslationsService', () => {
  const repo = { findOneBy: jest.fn(), findBy: jest.fn(), save: jest.fn() };
  let service: TranslationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TranslationsService(repo as never);
  });

  it('get 은 있으면 translated, 없으면 null', async () => {
    repo.findOneBy.mockResolvedValueOnce({ cacheKey: 'k', translated: 'v' });
    await expect(service.get('k')).resolves.toBe('v');
    repo.findOneBy.mockResolvedValueOnce(null);
    await expect(service.get('k')).resolves.toBeNull();
  });

  it('getMany 는 In 조건 한 번으로 키→번역 맵을 돌려주고 빈 키 배열이면 조회하지 않는다', async () => {
    repo.findBy.mockResolvedValueOnce([
      { cacheKey: 'a', translated: 'A' },
      { cacheKey: 'c', translated: 'C' },
    ]);
    const result = await service.getMany(['a', 'b', 'c']);
    expect(repo.findBy).toHaveBeenCalledTimes(1);
    expect(repo.findBy).toHaveBeenCalledWith({ cacheKey: In(['a', 'b', 'c']) });
    expect(result).toEqual(new Map([['a', 'A'], ['c', 'C']]));

    await expect(service.getMany([])).resolves.toEqual(new Map());
    expect(repo.findBy).toHaveBeenCalledTimes(1);
  });

  it('set 은 키와 번역을 저장한다', async () => {
    await service.set('k', 'v');
    expect(repo.save).toHaveBeenCalledWith({ cacheKey: 'k', translated: 'v' });
  });
});
