import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe, Request, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NoticesService } from './notices.service';
import { CreateNoticeDto } from './dto/create-notice.dto';

@Controller('notices')
@UseGuards(AuthGuard('jwt'))
export class NoticesController {
  constructor(private service: NoticesService) {}

  @Post()
  add(@Body() dto: CreateNoticeDto, @Request() req: any) {
    const user = req.user;
    if (user.role !== 'admin' && user.role !== 'developer') {
      throw new ForbiddenException('관리자만 공지를 작성할 수 있습니다');
    }
    if (user.allianceName !== 'KOR') {
      throw new ForbiddenException('KOR 연맹의 관리자만 서버 공지를 작성할 수 있습니다');
    }
    return this.service.add({ ...dto, authorNick: user.nickname });
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
