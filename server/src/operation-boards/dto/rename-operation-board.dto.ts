// 작전판 저장본 이름 변경 요청을 검증한다.
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RenameOperationBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title: string;
}
