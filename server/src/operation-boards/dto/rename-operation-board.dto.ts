// 작전판 저장본 이름 변경 요청을 검증한다.
import { IsString, MaxLength } from 'class-validator';

export class RenameOperationBoardDto {
  @IsString()
  @MaxLength(80)
  title: string;
}
