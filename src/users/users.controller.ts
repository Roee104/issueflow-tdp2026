/**
 * Controller for user management and mention feed endpoints.
 *
 * Route ordering is intentional — GET ':userId/mentions' is declared before
 * GET ':userId' to prevent NestJS from capturing 'mentions' as a userId value.
 *
 * POST /users is marked @Public — no JWT required, allowing new users to register
 * without an existing account. All other endpoints require authentication.
 */
import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { MentionsService } from '../mentions/mentions.service';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly mentionsService: MentionsService,
  ) {}

  /** Returns all active (non-deleted) users without password fields. */
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  /**
   * Returns a paginated feed of comments in which the user was @mentioned.
   * Declared before GET ':userId' to prevent 'mentions' being captured as a userId.
   *
   * @param userId - The user whose mention feed to retrieve
   * @param page - Page number (1-indexed, defaults to 1)
   * @param pageSize - Results per page (defaults to 10)
   * @returns Paginated result with { data, total, page }
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  @Get(':userId/mentions')
  getMentions(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    return this.mentionsService.getMentionsForUser(userId, page, pageSize);
  }

  /**
   * Returns a single active user by ID without password field.
   *
   * @param userId - The user to retrieve
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  @Get(':userId')
  findOne(@Param('userId', ParseIntPipe) userId: number) {
    return this.usersService.findById(userId);
  }

  /**
   * Creates a new user. Marked @Public — no JWT required for registration.
   * Password is hashed before persistence and never returned in the response.
   *
   * @param dto - User details including plaintext password
   * @returns The created user without password field
   * @throws ConflictException if username or email already exists
   */
  @Post()
  @Public()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  /**
   * Updates a user's fullName and/or role.
   *
   * @param userId - The user to update
   * @param dto - Fields to update (all optional)
   * @param currentUser - The authenticated user (for audit logging)
   * @throws NotFoundException if the user does not exist or is soft-deleted
   */
  @Patch('update/:userId')
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: { userId: number },
  ) {
    return this.usersService.update(userId, dto, currentUser.userId);
  }

  /**
   * Soft-deletes a user. Their token is immediately rejected by JwtAuthGuard
   * on the next request since findByIdInternal filters isDeleted=false.
   *
   * @param userId - The user to soft-delete
   * @param currentUser - The authenticated user (for audit logging)
   * @throws NotFoundException if the user does not exist or is already soft-deleted
   */
  @Delete(':userId')
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() currentUser: { userId: number },
  ) {
    return this.usersService.remove(userId, currentUser.userId);
  }
}
