import {
  Controller, Post, Delete, Param, Body,
  UseGuards, Request, ParseIntPipe, ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AllianceNoticesService } from './alliance-notices.service';
import { CreateAllianceNoticeDto } from './dto/create-alliance-notice.dto';

@Controller('alliance-notices')
@UseGuards(AuthGuard('jwt'))
export class AllianceNoticesController {
  constructor(private service: AllianceNoticesService) {}

  @Post()
  add(@Body() dto: CreateAllianceNoticeDto, @Request() req) {
    const user = req.user;
    // 해당 연맹의 admin/developer만 작성 가능
    if (user.role !== 'admin' && user.role !== 'developer') {
      throw new ForbiddenException('관리자만 공지를 작성할 수 있습니다');
    }
    if (user.allianceName !== dto.alliance) {
      throw new ForbiddenException('자신의 연맹 공지만 작성할 수 있습니다');
    }
    return this.service.add(dto, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.remove(id, req.user);
  }
}
