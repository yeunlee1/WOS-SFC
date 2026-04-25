import { IsString, MaxLength } from 'class-validator';

export class SetTranslationDto {
  @IsString()
  @MaxLength(500)
  cacheKey: string;

  @IsString()
  @MaxLength(20000)
  translated: string;
}
