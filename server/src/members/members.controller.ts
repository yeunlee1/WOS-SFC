// server/src/members/members.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';

@Controller('members')
@UseGuards(AuthGuard('jwt'))
export class MembersController {
  constructor(private service: MembersService) {}

  @Post()
  add(@Body() dto: CreateMemberDto) {
    return this.service.add(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
