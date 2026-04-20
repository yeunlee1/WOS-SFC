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
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { User } from '../users/users.entity';
import { RallyGroupsService } from './rally-groups.service';
import { RallyAdminGuard } from './guards/rally-admin.guard';
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

  @Patch(':id/members/:memberId/march-override')
  async updateMarchOverride(
    @Param('id') _id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMarchOverrideDto,
    @Req() req: Request & { user: User },
  ) {
    const role = req.user.role;
    if (role !== 'admin' && role !== 'developer') {
      const memberUserId = await this.service.getMemberUserId(memberId);
      if (memberUserId !== req.user.id) throw new ForbiddenException();
    }
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
