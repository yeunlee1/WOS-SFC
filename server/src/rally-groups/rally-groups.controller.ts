import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { User } from '../users/users.entity';
import { RallyGroupsService } from './rally-groups.service';
import { RallyAdminGuard } from './guards/rally-admin.guard';
import { RallyMemberSelfOrAdminGuard } from './guards/rally-member-self-or-admin.guard';
import { CreateRallyGroupDto } from './dto/create-rally-group.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMarchOverrideDto } from './dto/update-march-override.dto';

@Controller('rally-groups')
@UseGuards(AuthGuard('jwt'))
export class RallyGroupsController {
  constructor(private readonly service: RallyGroupsService) {}

  @Post()
  @UseGuards(RallyAdminGuard)
  create(@Req() req: Request & { user: User }, @Body() dto: CreateRallyGroupDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get()
  listAll() {
    return this.service.listAll();
  }

  @Get('assignable-users')
  @UseGuards(RallyAdminGuard)
  listAssignableUsers() {
    return this.service.listAssignableUsers();
  }

  @Delete(':id')
  @UseGuards(RallyAdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/members')
  @UseGuards(RallyAdminGuard)
  addMember(@Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.service.addMember(id, dto.userId);
  }

  @Delete(':id/members/:memberId')
  @UseGuards(RallyAdminGuard)
  removeMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    return this.service.removeMember(id, memberId);
  }

  // 유일하게 관리자 전용이 아닌 라우트 — 본인 것은 스스로 고칠 수 있어야 한다.
  // 권한 검사는 컨트롤러 본문이 아니라 다른 라우트와 같은 자리(가드)에서 한다.
  // 진행 중(running) 그룹인지는 서비스가 막는다(409).
  @Patch(':id/members/:memberId/march-override')
  @UseGuards(RallyMemberSelfOrAdminGuard)
  updateMarchOverride(
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMarchOverrideDto,
  ) {
    return this.service.updateMarchOverride(memberId, dto.marchSecondsOverride ?? null);
  }

  @Post(':id/start')
  @UseGuards(RallyAdminGuard)
  startCountdown(@Param('id') id: string) {
    return this.service.startCountdown(id);
  }

  @Post(':id/stop')
  @UseGuards(RallyAdminGuard)
  stopCountdown(@Param('id') id: string) {
    return this.service.stopCountdown(id);
  }
}
