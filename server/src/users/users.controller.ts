// server/src/users/users.controller.ts
import { Controller, Get, Patch, Param, Body, UseGuards, NotFoundException, ForbiddenException, Request, Inject, forwardRef } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(
    private service: UsersService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  @Get(':nickname/role')
  async getRole(@Param('nickname') nickname: string) {
    const user = await this.service.findByNickname(nickname);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다');
    return { nickname: user.nickname, role: user.role };
  }

  // 레거시 역할 변경은 developer만 허용하고 developer 역할 자체는 부여할 수 없다.
  @Patch(':nickname/role')
  async setRole(
    @Param('nickname') nickname: string,
    @Body() dto: UpdateRoleDto,
    @Request() req,
  ) {
    const callerRole: string = req.user?.role;
    if (callerRole !== 'developer') {
      throw new ForbiddenException('개발자만 역할을 변경할 수 있습니다');
    }
    const user = await this.service.setRole(nickname, dto.role);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다');
    this.realtimeGateway.kickUser(user.nickname);
    return { nickname: user.nickname, role: user.role };
  }
}
