import { IsInt, Min } from 'class-validator';

export class AddMemberDto {
  @IsInt()
  @Min(1)
  userId: number;
}
