// server/src/boards/boards.controller.ts
import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { BoardsService } from './boards.service';
import { CreateBoardPostDto } from './dto/create-board-post.dto';
import { BOARD_UPLOAD_OPTIONS } from './board-upload.options';

@Controller('boards')
@UseGuards(AuthGuard('jwt'))
export class BoardsController {
  constructor(private service: BoardsService) {}

  @Post()
  add(@Body() dto: CreateBoardPostDto) {
    return this.service.add(dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', BOARD_UPLOAD_OPTIONS))
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('파일이 없습니다');
    return { url: `/uploads/boards/${file.filename}` };
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
