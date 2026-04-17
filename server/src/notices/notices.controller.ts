import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NoticesService } from './notices.service';
import { CreateNoticeDto } from './dto/create-notice.dto';

@Controller('notices')
@UseGuards(AuthGuard('jwt'))
export class NoticesController {
  constructor(private service: NoticesService) {}

  @Post()
  add(@Body() dto: CreateNoticeDto) {
    return this.service.add(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
