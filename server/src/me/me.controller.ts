import { Body, Controller, Get, Put, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from '../users/users.service';
import { UpdateBattleSettingsDto } from './dto/update-battle-settings.dto';

@Controller('me')
@UseGuards(AuthGuard('jwt'))
export class MeController {
  constructor(private readonly usersService: UsersService) {}

  @Get('battle-settings')
  async getBattleSettings(@Req() req: any) {
    const u = req.user;
    return { marchSeconds: u.marchSeconds ?? null };
  }

  @Put('battle-settings')
  async saveBattleSettings(@Req() req: any, @Body() dto: UpdateBattleSettingsDto) {
    const value = dto.marchSeconds;
    // 명시적 검증: null 또는 1~180 정수
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < 1 || value > 180) {
        throw new BadRequestException('marchSeconds는 1~180 사이의 정수 또는 null이어야 합니다');
      }
    }
    const normalized = value ?? null;
    await this.usersService.updateMarchSeconds(req.user.id, normalized);
    return { marchSeconds: normalized };
  }
}
