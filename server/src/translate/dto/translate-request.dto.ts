import { IsIn, IsString, MaxLength } from 'class-validator';

export class TranslateRequestDto {
  @IsString()
  @MaxLength(10000)
  text: string;

  @IsIn(['ko', 'en', 'ja', 'zh'])
  targetLang: string;
}
