/**
 * Users module — manages user accounts including creation, updates, and soft delete.
 *
 * Imports MentionsModule to wire MentionsService into UsersController,
 * which hosts the GET /users/:userId/mentions endpoint.
 *
 * Exports UsersService so AuthModule can inject it into AuthService
 * (for login via findByUsernameInternal) and JwtAuthGuard
 * (for the soft-delete check via findByIdInternal).
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MentionsModule } from '../mentions/mentions.module';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), MentionsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
