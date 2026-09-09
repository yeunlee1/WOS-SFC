// POST /translate/batch 요청 — 대상 언어 하나와 항목(id, text) 최대 20건, 원문 합 2000자 이하.
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import type { Lang } from '../script-detect';
import { TARGET_LANGS } from '../script-detect';

export const TRANSLATE_BATCH_MAX_ITEMS = 20;
export const TRANSLATE_BATCH_MAX_ITEM_LENGTH = 500;
/** 항목 수 상한과 함께 이중 제한한다 — 20×500자를 다 채우면 출력 토큰 상한과 본문 50kb 에 걸린다(C 5절 D·L). */
export const TRANSLATE_BATCH_MAX_TOTAL_LENGTH = 2000;

export class TranslateBatchItemDto {
  @IsInt()
  id: number;

  @IsString()
  @MinLength(1)
  @MaxLength(TRANSLATE_BATCH_MAX_ITEM_LENGTH)
  text: string;
}

/** items 의 text 길이 합이 max 이하인지 검사하는 커스텀 데코레이터. */
function MaxTotalTextLength(max: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxTotalTextLength',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options,
      validator: {
        validate(value: unknown) {
          if (!Array.isArray(value)) return true;
          const total = value.reduce(
            (sum: number, item: unknown) =>
              sum +
              (typeof (item as { text?: unknown })?.text === 'string'
                ? ((item as { text: string }).text.length)
                : 0),
            0,
          );
          return total <= max;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} 의 원문 길이 합이 ${args.constraints[0]}자를 넘습니다`;
        },
      },
    });
  };
}

export class TranslateBatchDto {
  @IsIn(TARGET_LANGS)
  targetLang: Lang;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRANSLATE_BATCH_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => TranslateBatchItemDto)
  @MaxTotalTextLength(TRANSLATE_BATCH_MAX_TOTAL_LENGTH)
  items: TranslateBatchItemDto[];
}
