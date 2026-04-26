import { IsString, IsIn, MaxLength } from 'class-validator';

export class CreateAllianceNoticeDto {
  @IsString() @IsIn(['KOR', 'NSL', 'JKY', 'GPX', 'UFO'])
  alliance: string;

  @IsString() @IsIn(['discord', 'kakao', 'game'])
  source: string;

  @IsString() @MaxLength(200)
  title: string;

  @IsString() @MaxLength(2000)
  content: string;

  @IsString() @MaxLength(10)
  lang: string;
}
