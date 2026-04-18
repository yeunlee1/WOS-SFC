// server/src/users/users.controller.ts
import { Controller, Get, Patch, Param, Body, UseGuards, NotFoundException, ForbiddenException, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UserRole } from './users.entity';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private service: UsersService) {}

  @Get(':nickname/role')
  async getRole(@Param('nickname') nickname: string) {
    const user = await this.service.findByNickname(nickname);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다');
    return { nickname: user.nickname, role: user.role };
  }

  // 역할 변경은 관리자(admin) 또는 개발자(developer)만 가능
  @Patch(':nickname/role')
  async setRole(
    @Param('nickname') nickname: string,
    @Body() body: { role: UserRole },
    @Request() req,
  ) {
    const callerRole: string = req.user?.role;
    if (callerRole !== 'admin' && callerRole !== 'developer') {
      throw new ForbiddenException('관리자만 역할을 변경할 수 있습니다');
    }
    const user = await this.service.setRole(nickname, body.role);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다');
    return { nickname: user.nickname, role: user.role };
  }
}
