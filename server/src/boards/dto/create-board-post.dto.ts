import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BOARD_UPLOAD_URL_PATTERN } from '../board-upload.options';

export class CreateBoardPostDto {
  @IsString() @IsIn(['KOR', 'NSL', 'JKY', 'GPX', 'UFO']) alliance: string;
  @IsString() @MaxLength(1000) content: string;
  @IsString() @IsOptional() @MaxLength(10) lang?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(BOARD_UPLOAD_URL_PATTERN, { each: true })
  imageUrls?: string[];
}
