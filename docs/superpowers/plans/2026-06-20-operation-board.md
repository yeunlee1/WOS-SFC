# Operation Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate real-time operation board tab with SVG drawing tools, session-only draw permissions, saved board snapshots, image backgrounds, operation-tab presence, and shared global chat.

**Architecture:** Add a focused NestJS `OperationBoardsModule` for saved snapshots and image upload, plus a Socket.IO gateway for live SVG element synchronization and session permissions. Add a React operation board tab using a small Zustand slice, SVG canvas components, existing socket singleton, and existing chat message flow.

**Tech Stack:** NestJS 11, TypeORM, MySQL, Socket.IO, React 18, Zustand, Vite, Vitest, Jest.

---

## File Structure

### Backend files

- Create `server/src/operation-boards/operation-board.entity.ts`.
  - Stores saved board snapshots in `operation_boards`.
- Create `server/src/operation-boards/dto/save-operation-board.dto.ts`.
  - Validates title, background metadata, and bounded element JSON.
- Create `server/src/operation-boards/dto/rename-operation-board.dto.ts`.
  - Validates saved board title changes.
- Create `server/src/operation-boards/operation-board-upload.options.ts`.
  - Provides Multer image upload restrictions for operation board backgrounds.
- Create `server/src/operation-boards/operation-boards.service.ts`.
  - Owns list, get, save, rename, delete, and response formatting.
- Create `server/src/operation-boards/operation-boards.controller.ts`.
  - Owns REST API and role checks for snapshot management.
- Create `server/src/operation-boards/operation-boards.gateway.ts`.
  - Owns live board state, tab presence, session draw permissions, and event broadcasts.
- Create `server/src/operation-boards/operation-boards.module.ts`.
  - Wires entity, controller, service, gateway.
- Create `server/src/operation-boards/operation-boards.service.spec.ts`.
  - Unit tests for save/list/rename/delete and payload bounds.
- Create `server/src/operation-boards/operation-boards.gateway.spec.ts`.
  - Unit tests for permission and presence behavior.
- Modify `server/src/app.module.ts`.
  - Register `OperationBoard` entity and `OperationBoardsModule`.
  - Add `/operation-boards/*path` to static serving exclusions.

### Frontend files

- Create `web/src/components/OperationBoard/operationBoardTypes.js`.
  - Centralizes board element helpers and constants.
- Create `web/src/components/OperationBoard/useOperationBoardSocket.js`.
  - Joins/leaves operation tab and subscribes to operation board events.
- Create `web/src/components/OperationBoard/OperationBoardTab.jsx`.
  - Top-level layout for canvas, toolbar, saved boards, side panel, and chat toggle.
- Create `web/src/components/OperationBoard/OperationBoardCanvas.jsx`.
  - SVG editor layer for grid, background image, paths, shapes, arrows, text, and markers.
- Create `web/src/components/OperationBoard/OperationBoardToolbar.jsx`.
  - Tool, color, width, marker, clear, upload, and save controls.
- Create `web/src/components/OperationBoard/OperationBoardSidePanel.jsx`.
  - Collapsible participants and shared chat panel container.
- Create `web/src/components/OperationBoard/OperationBoardParticipants.jsx`.
  - Shows operation-tab participants and admin draw-permission toggles.
- Create `web/src/components/OperationBoard/OperationBoardChatPanel.jsx`.
  - Reuses global `chat:history`, `chat:message`, and `chat:system` events.
- Create `web/src/components/OperationBoard/OperationBoardSavedList.jsx`.
  - Lists saved boards and exposes admin rename/delete/load controls.
- Create `web/src/components/OperationBoard/__tests__/operationBoardTypes.spec.js`.
  - Tests element bounds and helper behavior.
- Create `web/src/components/OperationBoard/__tests__/OperationBoardTab.spec.jsx`.
  - Tests tool visibility and permission gating.
- Modify `web/src/App.jsx`.
  - Add `operation` active tab rendering.
- Modify `web/src/components/Layout/IconRail.jsx`.
  - Add operation board rail button.
- Modify `web/src/components/Layout/Header.jsx`.
  - Add breadcrumb label support for operation tab.
- Modify `web/src/components/Layout/CommandPalette.jsx`.
  - Add operation tab navigation command.
- Modify `web/src/i18n/index.jsx`.
  - Add Korean and fallback labels for operation board UI.
- Modify `web/src/api/index.js`.
  - Add REST helpers for operation boards and background upload.
- Modify `web/style.css`.
  - Add operation board layout, SVG canvas, toolbar, side panel, and responsive styles.

---

### Task 1: Backend Entity And DTO Contract

**Files:**
- Create: `server/src/operation-boards/operation-board.entity.ts`
- Create: `server/src/operation-boards/dto/save-operation-board.dto.ts`
- Create: `server/src/operation-boards/dto/rename-operation-board.dto.ts`
- Create: `server/src/operation-boards/operation-boards.service.spec.ts`

- [ ] **Step 1: Write the failing DTO/entity-focused service tests**

Add `server/src/operation-boards/operation-boards.service.spec.ts`.

```ts
// 작전판 저장 서비스의 스냅샷 계약을 검증한다.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsService } from './operation-boards.service';

function makeRepo() {
  const rows: OperationBoard[] = [];
  return {
    rows,
    create: jest.fn((value) => ({ id: rows.length + 1, ...value })),
    save: jest.fn(async (value) => {
      const existing = rows.find((row) => row.id === value.id);
      if (existing) Object.assign(existing, value);
      else rows.push(value);
      return value;
    }),
    find: jest.fn(async () => [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())),
    findOneBy: jest.fn(async ({ id }) => rows.find((row) => row.id === id) ?? null),
    delete: jest.fn(async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    }),
  };
}

describe('OperationBoardsService', () => {
  async function setup() {
    const repo = makeRepo();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperationBoardsService,
        { provide: getRepositoryToken(OperationBoard), useValue: repo },
      ],
    }).compile();
    return { service: moduleRef.get(OperationBoardsService), repo };
  }

  it('saves a bounded operation board snapshot for admin users', async () => {
    const { service } = await setup();
    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'adminKo', role: 'admin' },
      {
        title: '서쪽 협공',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements: [{ id: 'e1', type: 'text', x: 10, y: 20, text: '1진입' }],
      },
    );
    expect(saved.title).toBe('서쪽 협공');
    expect(saved.elements).toHaveLength(1);
    expect(saved.createdByNick).toBe('adminKo');
  });

  it('rejects save attempts from member users', async () => {
    const { service } = await setup();
    await expect(
      service.saveSnapshot(
        { id: 2, nickname: 'memberKo', role: 'member' },
        { title: '권한 없음', backgroundType: 'grid', backgroundImageUrl: null, elements: [] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects oversized element payloads', async () => {
    const { service } = await setup();
    const elements = Array.from({ length: 501 }, (_, index) => ({
      id: `e${index}`,
      type: 'text',
      x: index,
      y: index,
      text: 'x',
    }));
    await expect(
      service.saveSnapshot(
        { id: 1, nickname: 'devKo', role: 'developer' },
        { title: '너무 큼', backgroundType: 'grid', backgroundImageUrl: null, elements },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames and deletes only existing snapshots', async () => {
    const { service } = await setup();
    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'devKo', role: 'developer' },
      { title: '초안', backgroundType: 'grid', backgroundImageUrl: null, elements: [] },
    );
    const renamed = await service.rename(saved.id, { id: 1, nickname: 'devKo', role: 'developer' }, { title: '최종' });
    expect(renamed.title).toBe('최종');
    await service.remove(saved.id, { id: 1, nickname: 'devKo', role: 'developer' });
    await expect(service.getOne(saved.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- operation-boards.service.spec.ts`

Expected: FAIL because `OperationBoard` and `OperationBoardsService` do not exist.

- [ ] **Step 3: Add entity and DTOs**

Create `server/src/operation-boards/operation-board.entity.ts`.

```ts
// 작전판 저장본을 보관하는 TypeORM 엔티티다.
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OperationBoardBackgroundType = 'grid' | 'image';

@Entity('operation_boards')
export class OperationBoard {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 80 })
  title: string;

  @Column({ name: 'background_type', type: 'varchar', length: 16, default: 'grid' })
  backgroundType: OperationBoardBackgroundType;

  @Column({ name: 'background_image_url', type: 'varchar', length: 255, nullable: true })
  backgroundImageUrl: string | null;

  @Column({ name: 'elements_json', type: 'json' })
  elementsJson: unknown[];

  @Column({ name: 'created_by_user_id', type: 'int' })
  createdByUserId: number;

  @Column({ name: 'created_by_nick', length: 50 })
  createdByNick: string;

  @Column({ name: 'updated_by_user_id', type: 'int' })
  updatedByUserId: number;

  @Column({ name: 'updated_by_nick', length: 50 })
  updatedByNick: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

Create `server/src/operation-boards/dto/save-operation-board.dto.ts`.

```ts
// 작전판 저장 요청의 입력 범위를 검증한다.
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class SaveOperationBoardDto {
  @IsString()
  @MaxLength(80)
  title: string;

  @IsIn(['grid', 'image'])
  backgroundType: 'grid' | 'image';

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(255)
  backgroundImageUrl: string | null;

  @IsArray()
  elements: unknown[];
}
```

Create `server/src/operation-boards/dto/rename-operation-board.dto.ts`.

```ts
// 작전판 저장본 이름 변경 요청을 검증한다.
import { IsString, MaxLength } from 'class-validator';

export class RenameOperationBoardDto {
  @IsString()
  @MaxLength(80)
  title: string;
}
```

- [ ] **Step 4: Add minimal service implementation**

Create `server/src/operation-boards/operation-boards.service.ts`.

```ts
// 작전판 저장본의 조회와 관리를 담당한다.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationBoard } from './operation-board.entity';
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';

type ActingUser = { id: number; nickname: string; role: string };

const ADMIN_ROLES = ['admin', 'developer'];
const MAX_ELEMENTS = 500;
const MAX_ELEMENTS_BYTES = 250_000;

function assertAdmin(user: ActingUser): void {
  if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException();
}

function assertElementsBounded(elements: unknown[]): void {
  if (elements.length > MAX_ELEMENTS) {
    throw new BadRequestException(`작전판 요소는 최대 ${MAX_ELEMENTS}개까지 저장할 수 있습니다.`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(elements), 'utf8');
  if (bytes > MAX_ELEMENTS_BYTES) {
    throw new BadRequestException('작전판 저장 데이터가 너무 큽니다.');
  }
}

@Injectable()
export class OperationBoardsService {
  constructor(
    @InjectRepository(OperationBoard)
    private readonly repo: Repository<OperationBoard>,
  ) {}

  async list() {
    const rows = await this.repo.find({ order: { updatedAt: 'DESC' }, take: 50 });
    return rows.map((row) => this.format(row));
  }

  async getOne(id: number) {
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    return this.format(row);
  }

  async saveSnapshot(user: ActingUser, dto: SaveOperationBoardDto) {
    assertAdmin(user);
    assertElementsBounded(dto.elements);
    const now = new Date();
    const row = this.repo.create({
      title: dto.title.trim(),
      backgroundType: dto.backgroundType,
      backgroundImageUrl: dto.backgroundType === 'image' ? dto.backgroundImageUrl : null,
      elementsJson: dto.elements,
      createdByUserId: user.id,
      createdByNick: user.nickname,
      updatedByUserId: user.id,
      updatedByNick: user.nickname,
      createdAt: now,
      updatedAt: now,
    });
    return this.format(await this.repo.save(row));
  }

  async rename(id: number, user: ActingUser, dto: RenameOperationBoardDto) {
    assertAdmin(user);
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    row.title = dto.title.trim();
    row.updatedByUserId = user.id;
    row.updatedByNick = user.nickname;
    row.updatedAt = new Date();
    return this.format(await this.repo.save(row));
  }

  async remove(id: number, user: ActingUser) {
    assertAdmin(user);
    const result = await this.repo.delete(id);
    if (!result.affected) throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
  }

  private format(row: OperationBoard) {
    return {
      id: row.id,
      title: row.title,
      backgroundType: row.backgroundType,
      backgroundImageUrl: row.backgroundImageUrl,
      elements: row.elementsJson ?? [],
      createdByUserId: row.createdByUserId,
      createdByNick: row.createdByNick,
      updatedByUserId: row.updatedByUserId,
      updatedByNick: row.updatedByNick,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- operation-boards.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/operation-boards/operation-board.entity.ts server/src/operation-boards/dto/save-operation-board.dto.ts server/src/operation-boards/dto/rename-operation-board.dto.ts server/src/operation-boards/operation-boards.service.ts server/src/operation-boards/operation-boards.service.spec.ts
git commit -m "feat: add operation board snapshot model"
```

### Task 2: Backend REST API And Upload

**Files:**
- Create: `server/src/operation-boards/operation-board-upload.options.ts`
- Create: `server/src/operation-boards/operation-boards.controller.ts`
- Create: `server/src/operation-boards/operation-boards.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/src/operation-boards/operation-boards.service.spec.ts`

- [ ] **Step 1: Add upload option tests**

Append this test block to `server/src/operation-boards/operation-boards.service.spec.ts`.

```ts
describe('OPERATION_BOARD_UPLOAD_LIMITS', () => {
  it('keeps operation board background uploads image-only and bounded', async () => {
    const mod = await import('./operation-board-upload.options');
    expect(mod.OPERATION_BOARD_BACKGROUND_LIMITS.fileSize).toBe(8 * 1024 * 1024);
    expect(mod.OPERATION_BOARD_BACKGROUND_LIMITS.files).toBe(1);
    expect(mod.OPERATION_BOARD_BACKGROUND_LIMITS.fields).toBe(0);
    expect(mod.OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- operation-boards.service.spec.ts`

Expected: FAIL because `operation-board-upload.options` does not exist.

- [ ] **Step 3: Add upload options**

Create `server/src/operation-boards/operation-board-upload.options.ts`.

```ts
// 작전판 배경 이미지 업로드용 multer 옵션을 제공한다.
import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

export const OPERATION_BOARD_BACKGROUND_DIR = join(
  process.cwd(),
  '..',
  'uploads',
  'operation-boards',
);

export const OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE: Readonly<
  Record<string, string>
> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES = Object.keys(
  OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE,
);

export const OPERATION_BOARD_BACKGROUND_LIMITS: NonNullable<MulterOptions['limits']> = {
  fileSize: 8 * 1024 * 1024,
  files: 1,
  fields: 0,
  parts: 1,
  fieldNameSize: 100,
};

export const OPERATION_BOARD_BACKGROUND_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      if (!existsSync(OPERATION_BOARD_BACKGROUND_DIR)) {
        mkdirSync(OPERATION_BOARD_BACKGROUND_DIR, { recursive: true });
      }
      cb(null, OPERATION_BOARD_BACKGROUND_DIR);
    },
    filename: (req, file, cb) => {
      const ext =
        OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE[file.mimetype] ?? '.bin';
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new BadRequestException('이미지 파일만 업로드 가능합니다'), false);
    }
    cb(null, true);
  },
  limits: OPERATION_BOARD_BACKGROUND_LIMITS,
};
```

- [ ] **Step 4: Add controller and module**

Create `server/src/operation-boards/operation-boards.controller.ts`.

```ts
// 작전판 저장본 REST API를 제공한다.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';
import { OPERATION_BOARD_BACKGROUND_UPLOAD_OPTIONS } from './operation-board-upload.options';
import { OperationBoardsService } from './operation-boards.service';

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
  @UseInterceptors(FileInterceptor('file', OPERATION_BOARD_BACKGROUND_UPLOAD_OPTIONS))
  uploadBackground(
    @Req() req: Request & { user: User },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!['admin', 'developer'].includes(req.user.role)) throw new BadRequestException('권한이 없습니다');
    if (!file) throw new BadRequestException('파일이 없습니다');
    return { url: `/uploads/operation-boards/${file.filename}` };
  }
}
```

Create `server/src/operation-boards/operation-boards.module.ts`.

```ts
// 작전판 저장본과 실시간 협업 기능을 묶는 모듈이다.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsController } from './operation-boards.controller';
import { OperationBoardsService } from './operation-boards.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperationBoard])],
  controllers: [OperationBoardsController],
  providers: [OperationBoardsService],
  exports: [OperationBoardsService],
})
export class OperationBoardsModule {}
```

- [ ] **Step 5: Register module and entity**

Modify `server/src/app.module.ts`.

```ts
import { OperationBoard } from './operation-boards/operation-board.entity';
import { OperationBoardsModule } from './operation-boards/operation-boards.module';
```

Add `OperationBoard` to the `entities` array.

```ts
entities: [User, Message, Notice, Rally, Member, BoardPost, Translation, AllianceNotice, RallyGroup, RallyGroupMember, OperationBoard],
```

Add `/operation-boards/*path` to the static exclusions.

```ts
'/operation-boards/*path',
```

Add `OperationBoardsModule` to imports after `RallyGroupsModule`.

```ts
OperationBoardsModule,
```

- [ ] **Step 6: Run backend verification**

Run: `npm test -- operation-boards.service.spec.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/operation-boards server/src/app.module.ts
git commit -m "feat: add operation board REST API"
```

### Task 3: Backend Live Gateway For Presence And Permissions

**Files:**
- Create: `server/src/operation-boards/operation-boards.gateway.ts`
- Create: `server/src/operation-boards/operation-boards.gateway.spec.ts`
- Modify: `server/src/operation-boards/operation-boards.module.ts`

- [ ] **Step 1: Write failing gateway tests**

Create `server/src/operation-boards/operation-boards.gateway.spec.ts`.

```ts
// 작전판 실시간 게이트웨이의 세션 권한과 참여자 상태를 검증한다.
import { OperationBoardsGateway } from './operation-boards.gateway';

function makeServer() {
  return { emit: jest.fn() } as any;
}

function makeSocket(id: string, user: any) {
  return {
    id,
    data: { user },
    emit: jest.fn(),
  } as any;
}

describe('OperationBoardsGateway', () => {
  it('lets admin draw without a session grant', () => {
    const gateway = new OperationBoardsGateway({ verifySocketUser: jest.fn() } as any);
    gateway.server = makeServer();
    const admin = makeSocket('s1', { id: 1, nickname: 'adminKo', alliance: 'KOR', role: 'admin' });
    gateway.handleOperationJoin(admin, { chatOpen: false });
    const ack = gateway.handleElementAdd(admin, { id: 'e1', type: 'text', x: 1, y: 2, text: 'A' });
    expect(ack).toEqual({ ok: true });
    expect(gateway.server.emit).toHaveBeenCalledWith('operation:element:add', expect.objectContaining({ id: 'e1' }));
  });

  it('rejects member draw events until admin grants permission', () => {
    const gateway = new OperationBoardsGateway({ verifySocketUser: jest.fn() } as any);
    gateway.server = makeServer();
    const member = makeSocket('s2', { id: 2, nickname: 'memberKo', alliance: 'KOR', role: 'member' });
    gateway.handleOperationJoin(member, { chatOpen: false });
    expect(gateway.handleElementAdd(member, { id: 'e1', type: 'text', x: 1, y: 2, text: 'A' })).toEqual({ ok: false });
    gateway.grantDrawForTest('memberKo', true);
    expect(gateway.handleElementAdd(member, { id: 'e2', type: 'text', x: 1, y: 2, text: 'B' })).toEqual({ ok: true });
  });

  it('removes member draw permission when the member leaves the operation tab', () => {
    const gateway = new OperationBoardsGateway({ verifySocketUser: jest.fn() } as any);
    gateway.server = makeServer();
    const member = makeSocket('s2', { id: 2, nickname: 'memberKo', alliance: 'KOR', role: 'member' });
    gateway.handleOperationJoin(member, { chatOpen: true });
    gateway.grantDrawForTest('memberKo', true);
    gateway.handleOperationLeave(member);
    gateway.handleOperationJoin(member, { chatOpen: false });
    expect(gateway.handleElementAdd(member, { id: 'e3', type: 'text', x: 1, y: 2, text: 'C' })).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- operation-boards.gateway.spec.ts`

Expected: FAIL because gateway does not exist.

- [ ] **Step 3: Implement gateway**

Create `server/src/operation-boards/operation-boards.gateway.ts`.

```ts
// 작전판 실시간 참여자, 권한, 요소 동기화를 담당한다.
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type OperationUser = {
  id: number;
  nickname: string;
  alliance: string;
  role: string;
};

type Participant = OperationUser & {
  socketId: string;
  canDraw: boolean;
  chatOpen: boolean;
};

const ADMIN_ROLES = ['admin', 'developer'];
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

@WebSocketGateway({ cors: { origin: WEB_ORIGIN, credentials: true } })
export class OperationBoardsGateway implements OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private participants = new Map<string, Participant>();
  private drawGrants = new Set<string>();
  private elements: unknown[] = [];
  private background = { type: 'grid', imageUrl: null as string | null };

  constructor(private readonly realtimeGateway: RealtimeGateway) {}

  @SubscribeMessage('operation:join')
  handleOperationJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatOpen?: boolean } = {},
  ) {
    const user = this.getUser(client);
    if (!user) return { ok: false };
    const canDraw = this.canDraw(user);
    this.participants.set(client.id, {
      ...user,
      socketId: client.id,
      canDraw,
      chatOpen: !!body.chatOpen,
    });
    client.emit('operation:state', {
      elements: this.elements,
      background: this.background,
      participants: this.getParticipants(),
      canDraw,
    });
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:leave')
  handleOperationLeave(@ConnectedSocket() client: Socket) {
    const participant = this.participants.get(client.id);
    this.participants.delete(client.id);
    if (participant && !ADMIN_ROLES.includes(participant.role)) {
      const stillPresent = this.getParticipants().some((p) => p.nickname === participant.nickname);
      if (!stillPresent) this.drawGrants.delete(participant.nickname);
    }
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:chat-open')
  handleChatOpen(@ConnectedSocket() client: Socket, @MessageBody() body: { chatOpen: boolean }) {
    const participant = this.participants.get(client.id);
    if (!participant) return { ok: false };
    participant.chatOpen = !!body.chatOpen;
    participant.canDraw = this.canDraw(participant);
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:permission:update')
  handlePermissionUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { nickname: string; canDraw: boolean },
  ) {
    const actor = this.getUser(client);
    if (!actor || !ADMIN_ROLES.includes(actor.role)) return { ok: false };
    if (body.canDraw) this.drawGrants.add(body.nickname);
    else this.drawGrants.delete(body.nickname);
    for (const participant of this.participants.values()) {
      participant.canDraw = this.canDraw(participant);
    }
    this.broadcastPresence();
    this.server.emit('operation:permission:update', {
      nickname: body.nickname,
      canDraw: body.canDraw,
    });
    return { ok: true };
  }

  @SubscribeMessage('operation:element:add')
  handleElementAdd(@ConnectedSocket() client: Socket, @MessageBody() element: unknown) {
    const user = this.getUser(client);
    if (!user || !this.canDraw(user)) return { ok: false };
    this.elements = [...this.elements, element].slice(-500);
    this.server.emit('operation:element:add', element);
    return { ok: true };
  }

  @SubscribeMessage('operation:element:remove')
  handleElementRemove(@ConnectedSocket() client: Socket, @MessageBody() body: { id: string }) {
    const user = this.getUser(client);
    if (!user || !this.canDraw(user)) return { ok: false };
    this.elements = this.elements.filter((element: any) => element?.id !== body.id);
    this.server.emit('operation:element:remove', body);
    return { ok: true };
  }

  @SubscribeMessage('operation:clear')
  handleClear(@ConnectedSocket() client: Socket) {
    const user = this.getUser(client);
    if (!user || !this.canDraw(user)) return { ok: false };
    this.elements = [];
    this.server.emit('operation:clear');
    return { ok: true };
  }

  @SubscribeMessage('operation:background:update')
  handleBackgroundUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { type: 'grid' | 'image'; imageUrl: string | null },
  ) {
    const user = this.getUser(client);
    if (!user || !ADMIN_ROLES.includes(user.role)) return { ok: false };
    this.background = { type: body.type, imageUrl: body.type === 'image' ? body.imageUrl : null };
    this.server.emit('operation:background:update', this.background);
    return { ok: true };
  }

  handleDisconnect(client: Socket) {
    this.handleOperationLeave(client);
  }

  grantDrawForTest(nickname: string, canDraw: boolean) {
    if (canDraw) this.drawGrants.add(nickname);
    else this.drawGrants.delete(nickname);
  }

  private getUser(client: Socket): OperationUser | null {
    const dataUser = client.data?.user;
    if (dataUser) return dataUser;
    const user = (this.realtimeGateway as any).getUserFromSocket?.(client);
    if (!user) return null;
    return {
      id: user.id ?? 0,
      nickname: user.nickname,
      alliance: user.alliance ?? user.allianceName ?? '',
      role: user.role ?? 'member',
    };
  }

  private canDraw(user: Pick<OperationUser, 'nickname' | 'role'>): boolean {
    return ADMIN_ROLES.includes(user.role) || this.drawGrants.has(user.nickname);
  }

  private getParticipants() {
    return Array.from(this.participants.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      alliance: p.alliance,
      role: p.role,
      canDraw: this.canDraw(p),
      chatOpen: p.chatOpen,
    }));
  }

  private broadcastPresence() {
    this.server.emit('operation:presence', this.getParticipants());
  }
}
```

- [ ] **Step 4: Register gateway**

Modify `server/src/operation-boards/operation-boards.module.ts`.

```ts
import { forwardRef, Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { OperationBoardsGateway } from './operation-boards.gateway';
```

Update module imports and providers.

```ts
imports: [TypeOrmModule.forFeature([OperationBoard]), forwardRef(() => RealtimeModule)],
providers: [OperationBoardsService, OperationBoardsGateway],
```

- [ ] **Step 5: Run gateway verification**

Run: `npm test -- operation-boards.gateway.spec.ts`

Expected: PASS.

Run: `npm test -- operation-boards`

Expected: PASS for operation board tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/operation-boards/operation-boards.gateway.ts server/src/operation-boards/operation-boards.gateway.spec.ts server/src/operation-boards/operation-boards.module.ts
git commit -m "feat: add operation board realtime gateway"
```

### Task 4: Frontend API, Types, And Store Helpers

**Files:**
- Create: `web/src/components/OperationBoard/operationBoardTypes.js`
- Create: `web/src/components/OperationBoard/__tests__/operationBoardTypes.spec.js`
- Modify: `web/src/api/index.js`

- [ ] **Step 1: Write failing helper tests**

Create `web/src/components/OperationBoard/__tests__/operationBoardTypes.spec.js`.

```js
// 작전판 요소 생성 헬퍼의 기본 계약을 검증한다.
import { describe, expect, it } from 'vitest';
import {
  createOperationElement,
  OPERATION_BOARD_TOOLS,
  sanitizeOperationElements,
} from '../operationBoardTypes';

describe('operationBoardTypes', () => {
  it('creates stable SVG text and marker elements', () => {
    const text = createOperationElement('text', { x: 10, y: 20, text: '1진입', color: '#fff' });
    expect(text.type).toBe('text');
    expect(text.text).toBe('1진입');
    const marker = createOperationElement('marker', { x: 30, y: 40, marker: '🔥' });
    expect(marker.marker).toBe('🔥');
  });

  it('limits operation board elements before saving', () => {
    const elements = Array.from({ length: 505 }, (_, index) =>
      createOperationElement('text', { x: index, y: index, text: 'x' }),
    );
    expect(sanitizeOperationElements(elements)).toHaveLength(500);
  });

  it('includes first-phase drawing tools', () => {
    expect(OPERATION_BOARD_TOOLS.map((tool) => tool.id)).toEqual([
      'pen',
      'text',
      'line',
      'rect',
      'ellipse',
      'arrow',
      'marker',
      'erase',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run OperationBoard`

Expected: FAIL because `operationBoardTypes` does not exist.

- [ ] **Step 3: Add operation board type helpers**

Create `web/src/components/OperationBoard/operationBoardTypes.js`.

```js
// 작전판 SVG 요소 생성과 저장 전 정리를 담당한다.
export const OPERATION_BOARD_TOOLS = [
  { id: 'pen', label: '펜' },
  { id: 'text', label: '텍스트' },
  { id: 'line', label: '직선' },
  { id: 'rect', label: '사각형' },
  { id: 'ellipse', label: '원' },
  { id: 'arrow', label: '화살표' },
  { id: 'marker', label: '마커' },
  { id: 'erase', label: '지우개' },
];

export const OPERATION_MARKERS = ['🔥', '⚠', '🎯', '🛡', '➡', '⭐'];

export function createOperationElement(type, payload) {
  return {
    id: payload.id || `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    color: payload.color || '#7dd3fc',
    width: payload.width || 3,
    x: Number(payload.x ?? 0),
    y: Number(payload.y ?? 0),
    x2: Number(payload.x2 ?? payload.x ?? 0),
    y2: Number(payload.y2 ?? payload.y ?? 0),
    points: payload.points || [],
    text: String(payload.text ?? ''),
    marker: payload.marker || '🎯',
  };
}

export function sanitizeOperationElements(elements) {
  return elements.slice(-500).map((element) => ({
    ...element,
    text: typeof element.text === 'string' ? element.text.slice(0, 120) : '',
  }));
}

export function canUseOperationTools(user, canDraw) {
  return user?.role === 'admin' || user?.role === 'developer' || !!canDraw;
}

export function canManageOperationBoard(user) {
  return user?.role === 'admin' || user?.role === 'developer';
}
```

- [ ] **Step 4: Add API helpers**

Modify `web/src/api/index.js` inside `export const api = { ... }`.

```js
  listOperationBoards: () => apiFetch('/operation-boards'),
  getOperationBoard: (id) => apiFetch(`/operation-boards/${id}`),
  saveOperationBoard: (data) => apiFetch('/operation-boards', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  renameOperationBoard: (id, data) => apiFetch(`/operation-boards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deleteOperationBoard: (id) => apiFetch(`/operation-boards/${id}`, {
    method: 'DELETE',
  }),
```

Add this function near `uploadBoardImage`.

```js
  uploadOperationBoardBackground: async (file) => {
    async function doUpload() {
      const form = new FormData();
      form.append('file', file);
      return fetch('/operation-boards/background', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
    }
    let res = await doUpload();
    if (res.status === 401) {
      const refreshRes = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refreshRes.ok) res = await doUpload();
      else {
        window.dispatchEvent(new Event('auth:expired'));
        throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
      }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try { errMsg = JSON.parse(errText).message || errMsg; } catch { /* 무시 */ }
      throw new Error(errMsg);
    }
    return res.json();
  },
```

- [ ] **Step 5: Run frontend helper tests**

Run: `npm test -- --run OperationBoard`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/OperationBoard/operationBoardTypes.js web/src/components/OperationBoard/__tests__/operationBoardTypes.spec.js web/src/api/index.js
git commit -m "feat: add operation board frontend helpers"
```

### Task 5: Frontend Operation Board Tab And SVG Canvas

**Files:**
- Create: `web/src/components/OperationBoard/OperationBoardCanvas.jsx`
- Create: `web/src/components/OperationBoard/OperationBoardToolbar.jsx`
- Create: `web/src/components/OperationBoard/OperationBoardTab.jsx`
- Create: `web/src/components/OperationBoard/__tests__/OperationBoardTab.spec.jsx`

- [ ] **Step 1: Write failing tab tests**

Create `web/src/components/OperationBoard/__tests__/OperationBoardTab.spec.jsx`.

```jsx
// 작전판 탭의 권한별 도구 노출을 검증한다.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationBoardTab from '../OperationBoardTab';
import { useStore } from '../../../store';

vi.mock('../useOperationBoardSocket', () => ({
  useOperationBoardSocket: () => ({
    connected: true,
    canDraw: false,
    participants: [],
    elements: [],
    background: { type: 'grid', imageUrl: null },
    emitElement: vi.fn(),
    emitClear: vi.fn(),
    emitPermission: vi.fn(),
    emitBackground: vi.fn(),
  }),
}));

describe('OperationBoardTab', () => {
  beforeEach(() => {
    useStore.setState({ user: { id: 1, nickname: 'memberKo', role: 'member', allianceName: 'KOR' } });
  });

  it('renders view-only state for members without draw permission', () => {
    render(<OperationBoardTab />);
    expect(screen.getByText('작전판')).toBeInTheDocument();
    expect(screen.getByText('보기 전용')).toBeInTheDocument();
  });

  it('shows admin management controls for developer users', () => {
    useStore.setState({ user: { id: 2, nickname: 'devKo', role: 'developer', allianceName: 'KOR' } });
    render(<OperationBoardTab />);
    expect(screen.getByText('저장')).toBeInTheDocument();
    expect(screen.getByText('배경')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run OperationBoardTab`

Expected: FAIL because component files do not exist.

- [ ] **Step 3: Add toolbar component**

Create `web/src/components/OperationBoard/OperationBoardToolbar.jsx`.

```jsx
// 작전판 도구 선택과 관리 버튼을 렌더링한다.
import { OPERATION_BOARD_TOOLS, OPERATION_MARKERS } from './operationBoardTypes';

export default function OperationBoardToolbar({
  activeTool,
  setActiveTool,
  color,
  setColor,
  width,
  setWidth,
  marker,
  setMarker,
  canDraw,
  canManage,
  onClear,
  onSave,
  onUploadBackground,
}) {
  return (
    <div className="operation-toolbar">
      <div className="operation-toolbar-tools" aria-label="작전판 도구">
        {OPERATION_BOARD_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={'operation-tool-btn' + (activeTool === tool.id ? ' active' : '')}
            onClick={() => setActiveTool(tool.id)}
            disabled={!canDraw}
            title={tool.label}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!canDraw} aria-label="색상" />
      <input type="range" min="1" max="12" value={width} onChange={(e) => setWidth(Number(e.target.value))} disabled={!canDraw} aria-label="굵기" />
      <select value={marker} onChange={(e) => setMarker(e.target.value)} disabled={!canDraw} aria-label="마커">
        {OPERATION_MARKERS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <button type="button" onClick={onClear} disabled={!canDraw}>전체 지우기</button>
      {canManage && (
        <>
          <label className="operation-upload-btn">
            배경
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onUploadBackground} hidden />
          </label>
          <button type="button" onClick={onSave}>저장</button>
        </>
      )}
      {!canDraw && <span className="operation-readonly-pill">보기 전용</span>}
    </div>
  );
}
```

- [ ] **Step 4: Add SVG canvas component**

Create `web/src/components/OperationBoard/OperationBoardCanvas.jsx`.

```jsx
// 작전판 SVG 캔버스와 요소 렌더링을 담당한다.
import { useState } from 'react';
import { createOperationElement } from './operationBoardTypes';

function renderElement(element) {
  if (element.type === 'path') {
    const d = element.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' ');
    return <path key={element.id} d={d} fill="none" stroke={element.color} strokeWidth={element.width} strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (element.type === 'line' || element.type === 'arrow') {
    return <line key={element.id} x1={element.x} y1={element.y} x2={element.x2} y2={element.y2} stroke={element.color} strokeWidth={element.width} markerEnd={element.type === 'arrow' ? 'url(#operation-arrow)' : undefined} />;
  }
  if (element.type === 'rect') {
    return <rect key={element.id} x={Math.min(element.x, element.x2)} y={Math.min(element.y, element.y2)} width={Math.abs(element.x2 - element.x)} height={Math.abs(element.y2 - element.y)} fill="none" stroke={element.color} strokeWidth={element.width} />;
  }
  if (element.type === 'ellipse') {
    return <ellipse key={element.id} cx={(element.x + element.x2) / 2} cy={(element.y + element.y2) / 2} rx={Math.abs(element.x2 - element.x) / 2} ry={Math.abs(element.y2 - element.y) / 2} fill="none" stroke={element.color} strokeWidth={element.width} />;
  }
  if (element.type === 'text') {
    return <text key={element.id} x={element.x} y={element.y} fill={element.color} fontSize="22" fontWeight="700">{element.text}</text>;
  }
  if (element.type === 'marker') {
    return <text key={element.id} x={element.x} y={element.y} fontSize="28">{element.marker}</text>;
  }
  return null;
}

export default function OperationBoardCanvas({
  elements,
  background,
  activeTool,
  color,
  width,
  marker,
  canDraw,
  onElement,
  onRemoveElement,
}) {
  const [draft, setDraft] = useState(null);

  function pointFromEvent(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * 1200),
      y: Math.round(((event.clientY - rect.top) / rect.height) * 700),
    };
  }

  function handlePointerDown(event) {
    if (!canDraw) return;
    const point = pointFromEvent(event);
    if (activeTool === 'text') {
      const text = window.prompt('텍스트를 입력하세요');
      if (text) onElement(createOperationElement('text', { ...point, text, color, width }));
      return;
    }
    if (activeTool === 'marker') {
      onElement(createOperationElement('marker', { ...point, marker, color, width }));
      return;
    }
    if (activeTool === 'erase') return;
    setDraft(createOperationElement(activeTool === 'pen' ? 'path' : activeTool, {
      ...point,
      x2: point.x,
      y2: point.y,
      points: [[point.x, point.y]],
      color,
      width,
    }));
  }

  function handlePointerMove(event) {
    if (!draft) return;
    const point = pointFromEvent(event);
    if (draft.type === 'path') {
      setDraft({ ...draft, points: [...draft.points, [point.x, point.y]] });
    } else {
      setDraft({ ...draft, x2: point.x, y2: point.y });
    }
  }

  function handlePointerUp() {
    if (!draft) return;
    onElement(draft);
    setDraft(null);
  }

  function handleElementClick(event, element) {
    if (activeTool !== 'erase' || !canDraw) return;
    event.stopPropagation();
    onRemoveElement(element.id);
  }

  return (
    <div className="operation-canvas-shell">
      <svg
        className="operation-canvas"
        viewBox="0 0 1200 700"
        role="img"
        aria-label="실시간 작전판"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <defs>
          <pattern id="operation-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(125,211,252,.16)" strokeWidth="1" />
          </pattern>
          <marker id="operation-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
          </marker>
        </defs>
        <rect width="1200" height="700" fill="url(#operation-grid)" />
        {background?.type === 'image' && background.imageUrl && (
          <image href={background.imageUrl} x="0" y="0" width="1200" height="700" preserveAspectRatio="xMidYMid meet" />
        )}
        {[...elements, draft].filter(Boolean).map((element) => (
          <g key={element.id} onClick={(event) => handleElementClick(event, element)}>
            {renderElement(element)}
          </g>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 5: Add tab component**

Create `web/src/components/OperationBoard/OperationBoardTab.jsx`.

```jsx
// 실시간 작전판 탭의 전체 화면을 구성한다.
import { useState } from 'react';
import { useStore } from '../../store';
import { api } from '../../api';
import { canManageOperationBoard, canUseOperationTools, sanitizeOperationElements } from './operationBoardTypes';
import OperationBoardCanvas from './OperationBoardCanvas';
import OperationBoardToolbar from './OperationBoardToolbar';
import { useOperationBoardSocket } from './useOperationBoardSocket';

export default function OperationBoardTab() {
  const user = useStore((s) => s.user);
  const socketState = useOperationBoardSocket();
  const [activeTool, setActiveTool] = useState('pen');
  const [color, setColor] = useState('#7dd3fc');
  const [width, setWidth] = useState(3);
  const [marker, setMarker] = useState('🎯');

  const canManage = canManageOperationBoard(user);
  const canDraw = canUseOperationTools(user, socketState.canDraw);

  async function handleSave() {
    const title = window.prompt('저장본 이름을 입력하세요', '새 작전판');
    if (!title) return;
    await api.saveOperationBoard({
      title,
      backgroundType: socketState.background.type,
      backgroundImageUrl: socketState.background.imageUrl,
      elements: sanitizeOperationElements(socketState.elements),
    });
  }

  async function handleUploadBackground(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const uploaded = await api.uploadOperationBoardBackground(file);
    socketState.emitBackground({ type: 'image', imageUrl: uploaded.url });
  }

  return (
    <section className="operation-board-tab">
      <header className="operation-board-head">
        <div>
          <h2>작전판</h2>
          <p>실시간으로 작전 표시를 공유합니다.</p>
        </div>
        <span className="operation-status-pill">{canDraw ? '그리기 가능' : '보기 전용'}</span>
      </header>
      <OperationBoardToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        color={color}
        setColor={setColor}
        width={width}
        setWidth={setWidth}
        marker={marker}
        setMarker={setMarker}
        canDraw={canDraw}
        canManage={canManage}
        onClear={socketState.emitClear}
        onSave={handleSave}
        onUploadBackground={handleUploadBackground}
      />
      <OperationBoardCanvas
        elements={socketState.elements}
        background={socketState.background}
        activeTool={activeTool}
        color={color}
        width={width}
        marker={marker}
        canDraw={canDraw}
        onElement={socketState.emitElement}
        onRemoveElement={socketState.emitRemoveElement}
      />
    </section>
  );
}
```

- [ ] **Step 6: Run tab tests**

Run: `npm test -- --run OperationBoardTab`

Expected: PASS after `useOperationBoardSocket` exists in Task 6. For now this can remain failing until Task 6 if the hook is not yet created.

- [ ] **Step 7: Commit after Task 6 makes tests pass**

Do not commit Task 5 alone if tests still fail. Commit with Task 6.

### Task 6: Frontend Socket Hook, Participants, Shared Chat, And Saved List

**Files:**
- Create: `web/src/components/OperationBoard/useOperationBoardSocket.js`
- Create: `web/src/components/OperationBoard/OperationBoardParticipants.jsx`
- Create: `web/src/components/OperationBoard/OperationBoardChatPanel.jsx`
- Create: `web/src/components/OperationBoard/OperationBoardSavedList.jsx`
- Create: `web/src/components/OperationBoard/OperationBoardSidePanel.jsx`
- Modify: `web/src/components/OperationBoard/OperationBoardTab.jsx`

- [ ] **Step 1: Add socket hook**

Create `web/src/components/OperationBoard/useOperationBoardSocket.js`.

```js
// 작전판 소켓 이벤트 구독과 emit 함수를 제공한다.
import { useCallback, useEffect, useState } from 'react';
import { getSocket } from '../../api';

const EMPTY_BACKGROUND = { type: 'grid', imageUrl: null };

export function useOperationBoardSocket(chatOpen = false) {
  const [elements, setElements] = useState([]);
  const [background, setBackground] = useState(EMPTY_BACKGROUND);
  const [participants, setParticipants] = useState([]);
  const [canDraw, setCanDraw] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    setConnected(socket.connected);

    function handleConnect() {
      setConnected(true);
      socket.emit('operation:join', { chatOpen });
    }
    function handleState(state) {
      setElements(state.elements || []);
      setBackground(state.background || EMPTY_BACKGROUND);
      setParticipants(state.participants || []);
      setCanDraw(!!state.canDraw);
    }
    function handlePresence(next) { setParticipants(next || []); }
    function handleAdd(element) { setElements((prev) => [...prev, element]); }
    function handleRemove(body) { setElements((prev) => prev.filter((element) => element.id !== body.id)); }
    function handleClear() { setElements([]); }
    function handleBackground(next) { setBackground(next || EMPTY_BACKGROUND); }

    socket.on('connect', handleConnect);
    socket.on('operation:state', handleState);
    socket.on('operation:presence', handlePresence);
    socket.on('operation:element:add', handleAdd);
    socket.on('operation:element:remove', handleRemove);
    socket.on('operation:clear', handleClear);
    socket.on('operation:background:update', handleBackground);
    socket.emit('operation:join', { chatOpen });

    return () => {
      socket.emit('operation:leave');
      socket.off('connect', handleConnect);
      socket.off('operation:state', handleState);
      socket.off('operation:presence', handlePresence);
      socket.off('operation:element:add', handleAdd);
      socket.off('operation:element:remove', handleRemove);
      socket.off('operation:clear', handleClear);
      socket.off('operation:background:update', handleBackground);
    };
  }, [chatOpen]);

  const emitElement = useCallback((element) => getSocket()?.emit('operation:element:add', element), []);
  const emitRemoveElement = useCallback((id) => getSocket()?.emit('operation:element:remove', { id }), []);
  const emitClear = useCallback(() => getSocket()?.emit('operation:clear'), []);
  const emitPermission = useCallback((nickname, nextCanDraw) => {
    getSocket()?.emit('operation:permission:update', { nickname, canDraw: nextCanDraw });
  }, []);
  const emitBackground = useCallback((next) => getSocket()?.emit('operation:background:update', next), []);
  const emitChatOpen = useCallback((nextOpen) => getSocket()?.emit('operation:chat-open', { chatOpen: nextOpen }), []);

  return {
    connected,
    elements,
    background,
    participants,
    canDraw,
    emitElement,
    emitRemoveElement,
    emitClear,
    emitPermission,
    emitBackground,
    emitChatOpen,
  };
}
```

- [ ] **Step 2: Add participants panel**

Create `web/src/components/OperationBoard/OperationBoardParticipants.jsx`.

```jsx
// 작전판 탭 참여자와 세션 그리기 권한을 표시한다.
import { useStore } from '../../store';

const ADMIN_ROLES = ['admin', 'developer'];

export default function OperationBoardParticipants({ participants, onPermission }) {
  const user = useStore((s) => s.user);
  const canManage = ADMIN_ROLES.includes(user?.role);
  return (
    <section className="operation-panel-section">
      <h3>작전판 참여자 · {participants.length}</h3>
      <div className="operation-participant-list">
        {participants.length === 0 && <span className="operation-muted">현재 작전판을 보고 있는 인원이 없습니다.</span>}
        {participants.map((participant) => {
          const isAdmin = ADMIN_ROLES.includes(participant.role);
          return (
            <div key={participant.nickname} className="operation-participant-row">
              <span className="operation-participant-name">[{participant.alliance}] {participant.nickname}</span>
              <span className="operation-badge">{participant.role}</span>
              <span className="operation-badge">{participant.chatOpen ? '채팅 열림' : '채팅 닫힘'}</span>
              <label className="operation-draw-toggle">
                <input
                  type="checkbox"
                  checked={participant.canDraw}
                  disabled={!canManage || isAdmin}
                  onChange={(event) => onPermission(participant.nickname, event.target.checked)}
                />
                그리기
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add shared chat panel**

Create `web/src/components/OperationBoard/OperationBoardChatPanel.jsx`.

```jsx
// 작전판 안에서 기존 전체 채팅을 공유해서 보여준다.
import ChatDock from '../Chat/ChatDock';

export default function OperationBoardChatPanel({ onClose }) {
  return (
    <div className="operation-chat-panel">
      <ChatDock onClose={onClose} />
    </div>
  );
}
```

- [ ] **Step 4: Add saved list**

Create `web/src/components/OperationBoard/OperationBoardSavedList.jsx`.

```jsx
// 작전판 저장본 목록과 관리 동작을 제공한다.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';

const ADMIN_ROLES = ['admin', 'developer'];

export default function OperationBoardSavedList({ onLoad }) {
  const user = useStore((s) => s.user);
  const canManage = ADMIN_ROLES.includes(user?.role);
  const [boards, setBoards] = useState([]);

  async function refresh() {
    setBoards(await api.listOperationBoards());
  }

  useEffect(() => { refresh().catch(() => setBoards([])); }, []);

  async function rename(board) {
    const title = window.prompt('새 이름', board.title);
    if (!title) return;
    await api.renameOperationBoard(board.id, { title });
    await refresh();
  }

  async function remove(board) {
    if (!window.confirm('저장본을 삭제하시겠습니까?')) return;
    await api.deleteOperationBoard(board.id);
    await refresh();
  }

  return (
    <section className="operation-panel-section">
      <h3>저장본</h3>
      <div className="operation-saved-list">
        {boards.length === 0 && <span className="operation-muted">저장된 작전판이 없습니다.</span>}
        {boards.map((board) => (
          <div key={board.id} className="operation-saved-row">
            <button type="button" onClick={() => onLoad(board)}>{board.title}</button>
            {canManage && (
              <>
                <button type="button" onClick={() => rename(board)}>이름</button>
                <button type="button" onClick={() => remove(board)}>삭제</button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add side panel**

Create `web/src/components/OperationBoard/OperationBoardSidePanel.jsx`.

```jsx
// 작전판의 접이식 참여자·채팅 패널을 제공한다.
import OperationBoardChatPanel from './OperationBoardChatPanel';
import OperationBoardParticipants from './OperationBoardParticipants';
import OperationBoardSavedList from './OperationBoardSavedList';

export default function OperationBoardSidePanel({
  open,
  chatOpen,
  participants,
  onPermission,
  onToggleOpen,
  onToggleChat,
  onLoadSaved,
}) {
  return (
    <aside className={'operation-side-panel' + (open ? ' is-open' : '')}>
      <button type="button" className="operation-side-toggle" onClick={onToggleOpen}>
        {open ? '패널 닫기' : '패널 열기'}
      </button>
      {open && (
        <>
          <OperationBoardParticipants participants={participants} onPermission={onPermission} />
          <OperationBoardSavedList onLoad={onLoadSaved} />
          <button type="button" className="operation-chat-toggle" onClick={onToggleChat}>
            {chatOpen ? '채팅 닫기' : '채팅 열기'}
          </button>
          {chatOpen && <OperationBoardChatPanel onClose={onToggleChat} />}
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 6: Wire side panel into tab**

Modify `web/src/components/OperationBoard/OperationBoardTab.jsx`.

```jsx
import OperationBoardSidePanel from './OperationBoardSidePanel';
```

Add local state.

```jsx
const [sideOpen, setSideOpen] = useState(true);
const [chatOpen, setChatOpen] = useState(false);
```

Change hook call.

```jsx
const socketState = useOperationBoardSocket(chatOpen);
```

Add handlers.

```jsx
function handleToggleChat() {
  const next = !chatOpen;
  setChatOpen(next);
  socketState.emitChatOpen(next);
}

function handleLoadSaved(board) {
  socketState.emitBackground({
    type: board.backgroundType,
    imageUrl: board.backgroundImageUrl,
  });
  board.elements.forEach(socketState.emitElement);
}
```

Add panel after `OperationBoardCanvas`.

```jsx
<OperationBoardSidePanel
  open={sideOpen}
  chatOpen={chatOpen}
  participants={socketState.participants}
  onPermission={socketState.emitPermission}
  onToggleOpen={() => setSideOpen((value) => !value)}
  onToggleChat={handleToggleChat}
  onLoadSaved={handleLoadSaved}
/>
```

- [ ] **Step 7: Run frontend operation board tests**

Run: `npm test -- --run OperationBoard`

Expected: PASS.

- [ ] **Step 8: Commit Task 5 and Task 6 together**

```bash
git add web/src/components/OperationBoard
git commit -m "feat: add operation board tab"
```

### Task 7: Navigation, Labels, And Styles

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/components/Layout/IconRail.jsx`
- Modify: `web/src/components/Layout/Header.jsx`
- Modify: `web/src/components/Layout/CommandPalette.jsx`
- Modify: `web/src/i18n/index.jsx`
- Modify: `web/style.css`

- [ ] **Step 1: Wire operation tab**

Modify `web/src/App.jsx`.

```jsx
import OperationBoardTab from './components/OperationBoard/OperationBoardTab';
```

Add tab rendering.

```jsx
{activeTab === 'operation' && <OperationBoardTab />}
```

- [ ] **Step 2: Add operation rail button**

Modify `web/src/components/Layout/IconRail.jsx`.

```js
const tabs = [
  { id: 'battle', icon: '⚔', tooltip: t('tabBattle') },
  { id: 'operation', icon: '✦', tooltip: t('tabOperation') },
  { id: 'community', icon: '◫', tooltip: t('tabCommunity') },
  { id: 'chat', icon: '✉', tooltip: t('tabChat') },
];
```

- [ ] **Step 3: Add header breadcrumb key**

Modify `web/src/components/Layout/Header.jsx`.

```js
const TAB_KEYS = [
  { id: 'battle', key: 'tabBattle' },
  { id: 'operation', key: 'tabOperation' },
  { id: 'community', key: 'tabCommunity' },
  { id: 'chat', key: 'tabChat' },
  { id: 'admin', key: 'tabAdmin' },
];
```

- [ ] **Step 4: Add command palette item**

Modify `web/src/components/Layout/CommandPalette.jsx` in the nav items array.

```js
{ id: 'operation', icon: '✦', i18nKey: 'tabOperation' },
```

- [ ] **Step 5: Add i18n labels**

Modify `web/src/i18n/index.jsx` so every language object includes these keys.

```js
tabOperation: '작전판',
operationBoard: '작전판',
```

For non-Korean language entries, use readable fallbacks.

```js
tabOperation: 'Ops Board',
operationBoard: 'Ops Board',
```

- [ ] **Step 6: Add styles**

Append to `web/style.css`.

```css
.operation-board-tab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  min-height: 100%;
  padding: 24px;
  box-sizing: border-box;
}
.operation-board-head,
.operation-toolbar,
.operation-side-panel,
.operation-canvas-shell {
  background: rgba(12, 26, 46, 0.58);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
}
.operation-board-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
}
.operation-board-head h2 {
  margin: 0 0 4px;
  font-size: 18px;
}
.operation-board-head p {
  margin: 0;
  color: var(--text-2);
  font-size: 13px;
}
.operation-status-pill,
.operation-readonly-pill,
.operation-badge {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-2);
}
.operation-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  flex-wrap: wrap;
}
.operation-toolbar-tools {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.operation-tool-btn,
.operation-toolbar button,
.operation-upload-btn,
.operation-side-toggle,
.operation-chat-toggle,
.operation-saved-row button {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(8, 18, 34, 0.72);
  color: var(--text-1);
  padding: 7px 10px;
  cursor: pointer;
}
.operation-tool-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.operation-canvas-shell {
  min-height: 560px;
  overflow: hidden;
}
.operation-canvas {
  width: 100%;
  height: 100%;
  min-height: 560px;
  display: block;
  touch-action: none;
}
.operation-side-panel {
  grid-row: 3;
  grid-column: 2;
  padding: 12px;
  overflow: auto;
}
.operation-side-panel:not(.is-open) {
  width: 52px;
  padding: 8px;
}
.operation-panel-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.operation-panel-section h3 {
  margin: 0;
  font-size: 14px;
}
.operation-participant-list,
.operation-saved-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.operation-participant-row,
.operation-saved-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
}
.operation-participant-name {
  flex: 1;
  min-width: 120px;
}
.operation-muted {
  color: var(--text-3);
  font-size: 13px;
}
.operation-chat-panel .chat-dock {
  position: static;
  width: 100%;
  height: 420px;
  transform: none;
}
@media (max-width: 980px) {
  .operation-board-tab {
    grid-template-columns: 1fr;
  }
  .operation-side-panel {
    grid-column: 1;
  }
}
```

- [ ] **Step 7: Run frontend tests and build**

Run: `npm test -- --run`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/App.jsx web/src/components/Layout/IconRail.jsx web/src/components/Layout/Header.jsx web/src/components/Layout/CommandPalette.jsx web/src/i18n/index.jsx web/style.css
git commit -m "feat: wire operation board navigation"
```

### Task 8: Full Verification And Manual Test Checklist

**Files:**
- No new files.
- Verify all backend and frontend changes.

- [ ] **Step 1: Run backend tests**

Run: `npm test`

Expected: all server unit tests pass.

- [ ] **Step 2: Run backend e2e**

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 3: Run backend build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Run frontend tests**

Run: `npm test -- --run`

Expected: all web tests pass.

- [ ] **Step 5: Run frontend build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Run Git hygiene checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run high-confidence secret scan.

```powershell
$patterns = @('ghp_[A-Za-z0-9_]{20,}','github_pat_[A-Za-z0-9_]{20,}','sk-ant-api[0-9A-Za-z_-]{20,}','sk-proj-[A-Za-z0-9_-]{20,}','sk-[A-Za-z0-9]{32,}','AIza[0-9A-Za-z_-]{30,}','AKIA[0-9A-Z]{16}','-----BEGIN (RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----')
$files = @()
$files += git ls-files
$files += git ls-files --others --exclude-standard
$findings = @()
foreach ($file in ($files | Sort-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  $item = Get-Item -LiteralPath $file
  if ($item.Length -gt 2MB) { continue }
  foreach ($pattern in $patterns) {
    $matches = Select-String -LiteralPath $file -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      $findings += [pscustomobject]@{ File = $file; Line = $match.LineNumber; Pattern = $pattern }
    }
  }
}
if ($findings.Count -eq 0) { 'No high-confidence secret findings in tracked or unignored files.'; exit 0 }
$findings | Format-Table -AutoSize
exit 1
```

Expected: `No high-confidence secret findings in tracked or unignored files.`

- [ ] **Step 7: Manual operation board validation**

Start backend and frontend.

```powershell
$env:PORT='3002'
$env:WEB_ORIGIN='http://localhost:5174'
Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','start:prod') -WorkingDirectory 'C:\WOS\wos-sfc-helper\server' -WindowStyle Hidden
$env:VITE_API_TARGET='http://localhost:3002'
Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev','--','--host','127.0.0.1','--port','5174') -WorkingDirectory 'C:\WOS\wos-sfc-helper\web' -WindowStyle Hidden
```

Expected manual checks.

- Open `http://localhost:5174`.
- Log in as `developer` or `admin`.
- Open `작전판` tab.
- Draw pen, text, rectangle, ellipse, arrow, marker.
- Toggle chat panel and send a message.
- Confirm the same message appears in full chat.
- Open another browser session as member.
- Confirm member appears in operation participants.
- Confirm member is view-only before grant.
- Grant draw permission from admin session.
- Confirm member tools become usable.
- Revoke draw permission.
- Confirm member draw events stop working.
- Upload image background as admin.
- Save snapshot.
- Reload page and open saved snapshot.

- [ ] **Step 8: Final commit if verification made changes**

If verification required fixes, commit them.

```bash
git add server/src/operation-boards server/src/app.module.ts web/src/components/OperationBoard web/src/App.jsx web/src/api/index.js web/src/components/Layout/IconRail.jsx web/src/components/Layout/Header.jsx web/src/components/Layout/CommandPalette.jsx web/src/i18n/index.jsx web/style.css
git commit -m "fix: stabilize operation board verification"
```

## Self-Review

- Spec coverage.
  - Separate `작전판` tab is covered by Tasks 5 and 7.
  - SVG drawing tools are covered by Tasks 4 and 5.
  - Session-only draw permissions are covered by Task 3 and Task 6.
  - Saved snapshots and image backgrounds are covered by Tasks 1 and 2.
  - Existing shared chat is covered by Task 6.
  - Operation-tab presence is covered by Task 3 and Task 6.
  - Tests and verification are covered by Tasks 1 through 8.
- Placeholder scan.
  - No placeholder tokens or unspecified testing steps remain.
- Type consistency.
  - `backgroundType` and frontend `background.type` intentionally map at API boundaries.
  - Socket events use the `operation:*` prefix consistently.
