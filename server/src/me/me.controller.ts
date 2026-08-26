import { Body, Controller, Get, Put, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from '../users/users.service';
import { RallyGroupsService } from '../rally-groups/rally-groups.service';
import { UpdateBattleSettingsDto } from './dto/update-battle-settings.dto';

@Controller('me')
@UseGuards(AuthGuard('jwt'))
export class MeController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rallyGroupsService: RallyGroupsService,
  ) {}

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

    // marchSeconds 변경 → 해당 유저가 속한 그룹 중 진행 중이 아닌 것만 순서 재계산.
    // 진행 중인 그룹은 reorderAllForUser가 건너뛴다 — 개인 설정 저장이 남의 카운트다운
    // 발사 시각과 호명 순서를 흔들면 안 된다. 건너뛴 그룹은 다음 시작 때 다시 정렬된다.
    await this.rallyGroupsService.reorderAllForUser(req.user.id);

    return { marchSeconds: normalized };
  }
}
