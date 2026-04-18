import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateBoardPostDto {
  @IsString() @MaxLength(50) alliance: string;
  @IsString() @MaxLength(50) nickname: string;
  @IsString() @MaxLength(100) userAlliance: string;
  @IsString() @MaxLength(1000) content: string;
  @IsString() @IsOptional() @MaxLength(10) lang?: string;
}
