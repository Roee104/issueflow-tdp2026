/**
 * Data Transfer Object for creating a comment on a ticket.
 * authorId is provided in the request body per the API contract —
 * it is not extracted from the JWT to allow flexibility in authorship recording.
 */
import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsInt()
  @IsPositive()
  authorId: number;

  @IsString()
  @IsNotEmpty()
  content: string;
}
