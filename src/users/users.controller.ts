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

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':userId/mentions')
  getMentions(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    return this.mentionsService.getMentionsForUser(userId, page, pageSize);
  }

  @Get(':userId')
  findOne(@Param('userId', ParseIntPipe) userId: number) {
    return this.usersService.findById(userId);
  }

  @Post()
  @Public()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch('update/:userId')
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: { userId: number },
  ) {
    return this.usersService.update(userId, dto, currentUser.userId);
  }

  @Delete(':userId')
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() currentUser: { userId: number },
  ) {
    return this.usersService.remove(userId, currentUser.userId);
  }
}
