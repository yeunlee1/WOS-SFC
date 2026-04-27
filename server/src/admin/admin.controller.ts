import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsEnum, IsNotEmpty } from 'class-validator';
import { Request } from 'express';
import { AdminService } from './admin.service';
import type { AssignableRole } from './admin.service';
import { DeveloperGuard } from './developer.guard';
import { User } from '../users/users.entity';

class ChangeRoleDto {
  @IsEnum(['admin', 'member'])
  @IsNotEmpty()
  role: AssignableRole;
}

class SetLeaderDto {
  @IsBoolean()
  isLeader: boolean;
}

@UseGuards(AuthGuard('jwt'), DeveloperGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  getUsers() {
    return this.adminService.getUsers();
  }

  @Patch('users/:id/role')
  changeRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ChangeRoleDto,
  ) {
    return this.adminService.changeRole(id, body.role);
  }

  @Patch('users/:id/leader')
  setLeader(@Param('id', ParseIntPipe) id: number, @Body() body: SetLeaderDto) {
    return this.adminService.setLeader(id, body.isLeader);
  }

  @Delete('users/:id')
  banUser(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: User },
  ) {
    return this.adminService.banUser(id, req.user.id);
  }
}
