// 작전판 저장 요청의 입력 범위를 검증한다.
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SaveOperationBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title: string;

  @IsIn(['grid', 'image'])
  backgroundType: 'grid' | 'image';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  backgroundImageUrl: string | null;

  @IsArray()
  @ArrayMaxSize(500)
  elements: unknown[];
}
