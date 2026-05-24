/**
 * Data Transfer Object for updating a comment.
 * Only content can be updated — authorId and ticketId are immutable after creation.
 */
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCommentDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
