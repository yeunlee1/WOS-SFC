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
import { UploadOrphanService } from './upload-orphan.service';

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
  constructor(
    private readonly adminService: AdminService,
    private readonly uploadOrphans: UploadOrphanService,
  ) {}

  // 참조 없는 업로드 파일을 찾아 보고만 한다. 디스크는 건드리지 않는다.
  // 1GB 한도는 uploads/ 전체 합산이라 게시판 이미지와 작전판 배경을 함께 본다 —
  // 한쪽만 회수할 수 있으면 다른 쪽 고아가 전체 업로드를 계속 막는다.
  // 응답은 폴더별로 나뉘어 있어 무엇을 지우게 되는지 먼저 확인할 수 있다.
  @Get('uploads/orphans')
  scanOrphanUploads() {
    return this.uploadOrphans.scan();
  }

  // 실제 삭제는 이 명시적 요청에서만 일어난다.
  @Delete('uploads/orphans')
  purgeOrphanUploads() {
    return this.uploadOrphans.purge();
  }

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
