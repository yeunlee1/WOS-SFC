import { IsString, IsIn, IsOptional, MaxLength } from 'class-validator';

export class CreateNoticeDto {
  @IsString() @IsIn(['discord', 'kakao', 'game']) source: string;
  @IsString() @MaxLength(200) title: string;
  @IsString() @MaxLength(2000) content: string;
  @IsString() @IsOptional() @MaxLength(50) authorNick?: string;
  @IsString() @IsOptional() @MaxLength(10) lang?: string;
}
