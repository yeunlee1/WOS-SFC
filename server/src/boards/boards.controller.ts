// server/src/boards/boards.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BoardsService } from './boards.service';
import { CreateBoardPostDto } from './dto/create-board-post.dto';

@Controller('boards')
@UseGuards(AuthGuard('jwt'))
export class BoardsController {
  constructor(private service: BoardsService) {}

  @Post()
  add(@Body() dto: CreateBoardPostDto) {
    return this.service.add(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
