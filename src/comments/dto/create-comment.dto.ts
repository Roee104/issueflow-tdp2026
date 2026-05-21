import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsInt()
  @IsPositive()
  authorId: number;

  @IsString()
  @IsNotEmpty()
  content: string;
}
