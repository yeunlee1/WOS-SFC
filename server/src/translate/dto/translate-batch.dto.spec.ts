// 배치 번역 DTO 가 항목 수·항목 길이·원문 합계 상한과 중첩 검증을 지키는지 검증한다(C 5절 D·K·L).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  TRANSLATE_BATCH_MAX_ITEMS,
  TRANSLATE_BATCH_MAX_ITEM_LENGTH,
  TRANSLATE_BATCH_MAX_TOTAL_LENGTH,
  TranslateBatchDto,
} from './translate-batch.dto';

async function errorsFor(payload: unknown) {
  const dto = plainToInstance(TranslateBatchDto, payload as object);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function items(count: number, textLength = 5) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, text: '가'.repeat(textLength) }));
}

describe('TranslateBatchDto', () => {
  it('상한 상수', () => {
    expect(TRANSLATE_BATCH_MAX_ITEMS).toBe(20);
    expect(TRANSLATE_BATCH_MAX_ITEM_LENGTH).toBe(500);
    expect(TRANSLATE_BATCH_MAX_TOTAL_LENGTH).toBe(2000);
  });

  it('정상 요청은 통과하고 항목이 클래스로 변환된다', async () => {
    const dto = plainToInstance(TranslateBatchDto, {
      targetLang: 'en',
      items: [{ id: 100, text: '집결' }, { id: 101, text: '10분 뒤 SFC 집결 갑니다' }],
    });
    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual([]);
    expect(dto.items[0].constructor.name).toBe('TranslateBatchItemDto');
  });

  it('21건은 400 사유(arrayMaxSize)다', async () => {
    const errors = await errorsFor({ targetLang: 'en', items: items(21) });
    expect(errors.map((e) => e.property)).toContain('items');
    expect(JSON.stringify(errors)).toContain('arrayMaxSize');
  });

  it('0건은 거부한다', async () => {
    const errors = await errorsFor({ targetLang: 'en', items: [] });
    expect(errors.map((e) => e.property)).toContain('items');
  });

  it('원문 합 2001자는 거부하고 2000자는 통과한다', async () => {
    const over = await errorsFor({ targetLang: 'en', items: [...items(4, 500), { id: 5, text: '가' }] });
    expect(JSON.stringify(over)).toContain('2000');
    const exact = await errorsFor({ targetLang: 'en', items: items(4, 500) });
    expect(exact).toEqual([]);
  });

  it('항목 하나가 501자면 거부한다', async () => {
    const errors = await errorsFor({ targetLang: 'en', items: [{ id: 1, text: '가'.repeat(501) }] });
    expect(JSON.stringify(errors)).toContain('maxLength');
  });

  it('항목의 빈 문자열·정수 아닌 id·여분 필드는 거부한다', async () => {
    expect(await errorsFor({ targetLang: 'en', items: [{ id: 1, text: '' }] })).not.toEqual([]);
    expect(await errorsFor({ targetLang: 'en', items: [{ id: '1', text: 'a' }] })).not.toEqual([]);
    expect(await errorsFor({ targetLang: 'en', items: [{ id: 1.5, text: 'a' }] })).not.toEqual([]);
    expect(await errorsFor({ targetLang: 'en', items: [{ id: 1, text: 'a', extra: 1 }] })).not.toEqual([]);
  });

  it('targetLang 은 다섯 언어만 허용한다', async () => {
    expect(await errorsFor({ targetLang: 'other', items: items(1) })).not.toEqual([]);
    expect(await errorsFor({ targetLang: 'ru', items: items(1) })).toEqual([]);
  });
});
