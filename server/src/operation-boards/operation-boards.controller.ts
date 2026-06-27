// 작전판 저장본 REST API를 제공한다.
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { User } from '../users/users.entity';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { OPERATION_BOARD_BACKGROUND_UPLOAD_OPTIONS } from './operation-board-upload.options';
import { OperationBoardsService } from './operation-boards.service';

const OPERATION_BOARD_ADMIN_ROLES = ['admin', 'developer'];

class OperationBoardBackgroundUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    if (!req.user || !OPERATION_BOARD_ADMIN_ROLES.includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}

@Controller('operation-boards')
@UseGuards(AuthGuard('jwt'))
export class OperationBoardsController {
  constructor(private readonly service: OperationBoardsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.getOne(id);
  }

  @Post()
  save(@Req() req: Request & { user: User }, @Body() dto: SaveOperationBoardDto) {
    return this.service.saveSnapshot(req.user, dto);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: User },
    @Body() dto: RenameOperationBoardDto,
  ) {
    return this.service.rename(id, req.user, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: User }) {
    return this.service.remove(id, req.user);
  }

  @Post('background')
  @UseGuards(new OperationBoardBackgroundUploadGuard())
  @UseInterceptors(FileInterceptor('file', OPERATION_BOARD_BACKGROUND_UPLOAD_OPTIONS))
  uploadBackground(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('파일이 없습니다');
    }
    return { url: `/uploads/operation-boards/${file.filename}` };
  }
}
