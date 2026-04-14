# Firebase → NestJS+MySQL 전체 통합 리팩토링

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firebase를 완전히 제거하고 공지/집결/집결원/게시판/온라인/번역캐시 모든 기능을 NestJS+MySQL+Socket.io로 통합한다.

**Architecture:** NestJS에 각 기능별 모듈(Notice, Rally, Member, Board, Translation)을 추가하고, 하나의 RealtimeGateway(Socket.io)가 모든 실시간 푸시를 담당한다. main.js의 Firebase IPC 핸들러를 axios REST + Socket.io IPC로 교체한다.

**Tech Stack:** NestJS 10, TypeORM, MySQL2, Socket.io, Electron, axios

**워크트리 경로:** `C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth`
**서버 경로:** `C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth/server`

---

## 파일 구조 (변경/생성 대상)

### NestJS 서버 (신규 생성)
- `server/src/notices/notice.entity.ts` — Notice 엔티티
- `server/src/notices/notices.service.ts` — CRUD + broadcast
- `server/src/notices/notices.controller.ts` — REST POST/DELETE
- `server/src/notices/notices.module.ts`
- `server/src/rallies/rally.entity.ts`
- `server/src/rallies/rallies.service.ts`
- `server/src/rallies/rallies.controller.ts`
- `server/src/rallies/rallies.module.ts`
- `server/src/members/member.entity.ts`
- `server/src/members/members.service.ts`
- `server/src/members/members.controller.ts`
- `server/src/members/members.module.ts`
- `server/src/boards/board-post.entity.ts`
- `server/src/boards/boards.service.ts`
- `server/src/boards/boards.controller.ts`
- `server/src/boards/boards.module.ts`
- `server/src/translations/translation.entity.ts`
- `server/src/translations/translations.service.ts`
- `server/src/translations/translations.controller.ts`
- `server/src/translations/translations.module.ts`
- `server/src/realtime/realtime.gateway.ts` — 모든 실시간 푸시 담당
- `server/src/realtime/realtime.module.ts`

### NestJS 서버 (수정)
- `server/src/app.module.ts` — 새 모듈 등록 + 엔티티 추가
- `server/src/app.controller.ts` — GET /time 추가
- `server/src/users/users.controller.ts` — 역할 조회/변경 엔드포인트 추가
- `server/src/users/users.service.ts` — findByNickname, setRole 추가

### Electron (수정)
- `src/main.js` — Firebase 코드 제거, REST+Socket.io IPC 교체
- `src/preload.js` — IPC 채널명 정리
- `src/renderer/js/auth.js` — connectAlliance → 시간동기화만
- `src/renderer/js/noticeboard.js` — firebaseId → id
- `src/renderer/js/rally-timer.js` — firebaseId → id
- `src/renderer/js/community.js` — firebaseId → id
- `src/renderer/js/online.js` — setOnline 제거 (서버 자동 추적)

### 패키지
- `package.json` (워크트리 루트) — firebase 패키지 제거

---

## Socket.io 실시간 이벤트 설계

### 서버 → 클라이언트 (push)
| 이벤트 | 페이로드 | 트리거 |
|--------|---------|--------|
| `notices:updated` | `Notice[]` | notice 추가/삭제 후 |
| `rallies:updated` | `Rally[]` | rally 추가/삭제 후 |
| `members:updated` | `Member[]` | member 추가/삭제 후 |
| `board:updated:KOR` 등 | `BoardPost[]` | 게시글 추가/삭제 후 |
| `online:updated` | `OnlineUser[]` | 소켓 접속/해제 후 |

### IPC 채널 (main.js → renderer, 기존과 동일 유지)
| 채널 | 기존 | 변경 |
|------|------|------|
| `notices-updated` | Firebase onSnapshot | Socket.io 이벤트 |
| `rallies-updated` | Firebase onSnapshot | Socket.io 이벤트 |
| `members-updated` | Firebase onSnapshot | Socket.io 이벤트 |
| `board-updated-{alliance}` | Firebase onSnapshot | Socket.io 이벤트 |
| `online-updated` | Firebase onSnapshot | Socket.io 이벤트 |

---

## Task 1: Notice 모듈 (NestJS)

**Files:**
- Create: `server/src/notices/notice.entity.ts`
- Create: `server/src/notices/notices.service.ts`
- Create: `server/src/notices/notices.controller.ts`
- Create: `server/src/notices/notices.module.ts`

- [ ] **Step 1: notice.entity.ts 생성**

```typescript
// server/src/notices/notice.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('notices')
export class Notice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 20 })
  source: string; // 'discord' | 'kakao' | 'game'

  @Column({ length: 200, default: '공지' })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'author_nick', length: 50, default: '' })
  authorNick: string;

  @Column({ length: 10, default: 'ko' })
  lang: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: notices.service.ts 생성**

```typescript
// server/src/notices/notices.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notice } from './notice.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class NoticesService {
  constructor(
    @InjectRepository(Notice) private repo: Repository<Notice>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findAll(): Promise<Notice[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async add(data: Partial<Notice>): Promise<Notice> {
    const notice = this.repo.create(data);
    const saved = await this.repo.save(notice);
    await this.gateway.broadcastNotices();
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
    await this.gateway.broadcastNotices();
  }
}
```

- [ ] **Step 3: notices.controller.ts 생성**

```typescript
// server/src/notices/notices.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NoticesService } from './notices.service';

@Controller('notices')
@UseGuards(AuthGuard('jwt'))
export class NoticesController {
  constructor(private service: NoticesService) {}

  @Post()
  add(@Body() body: { source: string; title: string; content: string; authorNick?: string; lang?: string }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 4: notices.module.ts 생성**

```typescript
// server/src/notices/notices.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notice } from './notice.entity';
import { NoticesService } from './notices.service';
import { NoticesController } from './notices.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Notice]), forwardRef(() => RealtimeModule)],
  providers: [NoticesService],
  controllers: [NoticesController],
  exports: [NoticesService],
})
export class NoticesModule {}
```

- [ ] **Step 5: 커밋**

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth/server
git add src/notices/
git commit -m "feat: Notice 모듈 추가 (entity + service + controller)"
```

---

## Task 2: Rally 모듈 (NestJS)

**Files:**
- Create: `server/src/rallies/rally.entity.ts`
- Create: `server/src/rallies/rallies.service.ts`
- Create: `server/src/rallies/rallies.controller.ts`
- Create: `server/src/rallies/rallies.module.ts`

- [ ] **Step 1: rally.entity.ts 생성**

```typescript
// server/src/rallies/rally.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('rallies')
export class Rally {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, default: '집결' })
  name: string;

  @Column({ name: 'end_time_utc', type: 'bigint' })
  endTimeUTC: number; // Unix ms

  @Column({ name: 'total_seconds' })
  totalSeconds: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: rallies.service.ts 생성**

```typescript
// server/src/rallies/rallies.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rally } from './rally.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class RalliesService {
  constructor(
    @InjectRepository(Rally) private repo: Repository<Rally>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findAll(): Promise<Rally[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async add(data: Partial<Rally>): Promise<Rally> {
    const rally = this.repo.create(data);
    const saved = await this.repo.save(rally);
    await this.gateway.broadcastRallies();
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
    await this.gateway.broadcastRallies();
  }
}
```

- [ ] **Step 3: rallies.controller.ts 생성**

```typescript
// server/src/rallies/rallies.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RalliesService } from './rallies.service';

@Controller('rallies')
@UseGuards(AuthGuard('jwt'))
export class RalliesController {
  constructor(private service: RalliesService) {}

  @Post()
  add(@Body() body: { name: string; endTimeUTC: number; totalSeconds: number }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 4: rallies.module.ts 생성**

```typescript
// server/src/rallies/rallies.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rally } from './rally.entity';
import { RalliesService } from './rallies.service';
import { RalliesController } from './rallies.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Rally]), forwardRef(() => RealtimeModule)],
  providers: [RalliesService],
  controllers: [RalliesController],
  exports: [RalliesService],
})
export class RalliesModule {}
```

- [ ] **Step 5: 커밋**

```bash
git add src/rallies/
git commit -m "feat: Rally 모듈 추가"
```

---

## Task 3: Member 모듈 (NestJS)

**Files:**
- Create: `server/src/members/member.entity.ts`
- Create: `server/src/members/members.service.ts`
- Create: `server/src/members/members.controller.ts`
- Create: `server/src/members/members.module.ts`

- [ ] **Step 1: member.entity.ts 생성**

```typescript
// server/src/members/member.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('members')
export class Member {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 100, default: '' })
  role: string;

  @Column({ length: 100, default: '' })
  notes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: members.service.ts 생성**

```typescript
// server/src/members/members.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Member } from './member.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(Member) private repo: Repository<Member>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findAll(): Promise<Member[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async add(data: Partial<Member>): Promise<Member> {
    const member = this.repo.create(data);
    const saved = await this.repo.save(member);
    await this.gateway.broadcastMembers();
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
    await this.gateway.broadcastMembers();
  }
}
```

- [ ] **Step 3: members.controller.ts 생성**

```typescript
// server/src/members/members.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MembersService } from './members.service';

@Controller('members')
@UseGuards(AuthGuard('jwt'))
export class MembersController {
  constructor(private service: MembersService) {}

  @Post()
  add(@Body() body: { name: string; role?: string; notes?: string }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 4: members.module.ts 생성**

```typescript
// server/src/members/members.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from './member.entity';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Member]), forwardRef(() => RealtimeModule)],
  providers: [MembersService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
```

- [ ] **Step 5: 커밋**

```bash
git add src/members/
git commit -m "feat: Member 모듈 추가"
```

---

## Task 4: Board 모듈 (NestJS)

**Files:**
- Create: `server/src/boards/board-post.entity.ts`
- Create: `server/src/boards/boards.service.ts`
- Create: `server/src/boards/boards.controller.ts`
- Create: `server/src/boards/boards.module.ts`

- [ ] **Step 1: board-post.entity.ts 생성**

```typescript
// server/src/boards/board-post.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('board_posts')
export class BoardPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  alliance: string; // 'KOR' | 'NSL' | 'JKY' | 'GPX' | 'UFO'

  @Column({ length: 50 })
  nickname: string;

  @Column({ name: 'user_alliance', length: 100 })
  userAlliance: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ length: 10, default: 'ko' })
  lang: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: boards.service.ts 생성**

```typescript
// server/src/boards/boards.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardPost } from './board-post.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const BOARD_ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(BoardPost) private repo: Repository<BoardPost>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findByAlliance(alliance: string): Promise<BoardPost[]> {
    return this.repo.find({
      where: { alliance },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async findAllGrouped(): Promise<Record<string, BoardPost[]>> {
    const result: Record<string, BoardPost[]> = {};
    for (const a of BOARD_ALLIANCES) {
      result[a] = await this.findByAlliance(a);
    }
    return result;
  }

  async add(data: Partial<BoardPost>): Promise<BoardPost> {
    const post = this.repo.create(data);
    const saved = await this.repo.save(post);
    await this.gateway.broadcastBoard(saved.alliance);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const post = await this.repo.findOneBy({ id });
    if (!post) return;
    const alliance = post.alliance;
    await this.repo.delete(id);
    await this.gateway.broadcastBoard(alliance);
  }
}
```

- [ ] **Step 3: boards.controller.ts 생성**

```typescript
// server/src/boards/boards.controller.ts
import { Controller, Post, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BoardsService } from './boards.service';

@Controller('boards')
@UseGuards(AuthGuard('jwt'))
export class BoardsController {
  constructor(private service: BoardsService) {}

  @Post()
  add(@Body() body: { alliance: string; nickname: string; userAlliance: string; content: string; lang?: string }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 4: boards.module.ts 생성**

```typescript
// server/src/boards/boards.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardPost } from './board-post.entity';
import { BoardsService } from './boards.service';
import { BoardsController } from './boards.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([BoardPost]), forwardRef(() => RealtimeModule)],
  providers: [BoardsService],
  controllers: [BoardsController],
  exports: [BoardsService],
})
export class BoardsModule {}
```

- [ ] **Step 5: 커밋**

```bash
git add src/boards/
git commit -m "feat: Board 모듈 추가"
```

---

## Task 5: Translation 모듈 (NestJS)

**Files:**
- Create: `server/src/translations/translation.entity.ts`
- Create: `server/src/translations/translations.service.ts`
- Create: `server/src/translations/translations.controller.ts`
- Create: `server/src/translations/translations.module.ts`

- [ ] **Step 1: translation.entity.ts 생성**

```typescript
// server/src/translations/translation.entity.ts
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('translations')
export class Translation {
  @PrimaryColumn({ name: 'cache_key', length: 255 })
  cacheKey: string;

  @Column({ type: 'text' })
  translated: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 2: translations.service.ts 생성**

```typescript
// server/src/translations/translations.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Translation } from './translation.entity';

@Injectable()
export class TranslationsService {
  constructor(
    @InjectRepository(Translation) private repo: Repository<Translation>,
  ) {}

  async get(cacheKey: string): Promise<string | null> {
    const t = await this.repo.findOneBy({ cacheKey });
    return t ? t.translated : null;
  }

  async set(cacheKey: string, translated: string): Promise<void> {
    await this.repo.save({ cacheKey, translated });
  }
}
```

- [ ] **Step 3: translations.controller.ts 생성**

```typescript
// server/src/translations/translations.controller.ts
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TranslationsService } from './translations.service';

@Controller('translations')
@UseGuards(AuthGuard('jwt'))
export class TranslationsController {
  constructor(private service: TranslationsService) {}

  @Get(':key')
  get(@Param('key') key: string) {
    return this.service.get(key);
  }

  @Post()
  set(@Body() body: { cacheKey: string; translated: string }) {
    return this.service.set(body.cacheKey, body.translated);
  }
}
```

- [ ] **Step 4: translations.module.ts 생성**

```typescript
// server/src/translations/translations.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Translation } from './translation.entity';
import { TranslationsService } from './translations.service';
import { TranslationsController } from './translations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Translation])],
  providers: [TranslationsService],
  controllers: [TranslationsController],
})
export class TranslationsModule {}
```

- [ ] **Step 5: 커밋**

```bash
git add src/translations/
git commit -m "feat: Translation 캐시 모듈 추가"
```

---

## Task 6: RealtimeGateway (Socket.io 통합 브로드캐스터)

**Files:**
- Create: `server/src/realtime/realtime.gateway.ts`
- Create: `server/src/realtime/realtime.module.ts`

- [ ] **Step 1: realtime.gateway.ts 생성**

```typescript
// server/src/realtime/realtime.gateway.ts
import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Inject, forwardRef } from '@nestjs/common';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { MembersService } from '../members/members.service';
import { BoardsService } from '../boards/boards.service';

interface OnlineUser {
  nickname: string;
  alliance: string;
  role: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // socketId → OnlineUser
  private onlineMap = new Map<string, OnlineUser>();

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => NoticesService)) private noticesService: NoticesService,
    @Inject(forwardRef(() => RalliesService)) private ralliesService: RalliesService,
    @Inject(forwardRef(() => MembersService)) private membersService: MembersService,
    @Inject(forwardRef(() => BoardsService)) private boardsService: BoardsService,
  ) {}

  private getUserFromSocket(client: Socket): OnlineUser | null {
    try {
      const token = client.handshake.auth?.token;
      if (!token) return null;
      const payload = this.jwtService.verify(token);
      return {
        nickname: payload.nickname,
        alliance: payload.allianceName || '',
        role: payload.role || 'member',
      };
    } catch {
      return null;
    }
  }

  async handleConnection(client: Socket) {
    const user = this.getUserFromSocket(client);
    if (!user) { client.disconnect(); return; }

    this.onlineMap.set(client.id, user);
    this.broadcastOnline();

    // 초기 데이터 전송
    const [notices, rallies, members, boards] = await Promise.all([
      this.noticesService.findAll(),
      this.ralliesService.findAll(),
      this.membersService.findAll(),
      this.boardsService.findAllGrouped(),
    ]);

    client.emit('notices:updated', notices.map(this.formatNotice));
    client.emit('rallies:updated', rallies.map(this.formatRally));
    client.emit('members:updated', members.map(this.formatMember));
    for (const [alliance, posts] of Object.entries(boards)) {
      client.emit(`board:updated:${alliance}`, posts.map(this.formatBoardPost));
    }
  }

  handleDisconnect(client: Socket) {
    this.onlineMap.delete(client.id);
    this.broadcastOnline();
  }

  broadcastOnline() {
    const users = Array.from(this.onlineMap.values());
    this.server.emit('online:updated', users);
  }

  async broadcastNotices() {
    const notices = await this.noticesService.findAll();
    this.server.emit('notices:updated', notices.map(this.formatNotice));
  }

  async broadcastRallies() {
    const rallies = await this.ralliesService.findAll();
    this.server.emit('rallies:updated', rallies.map(this.formatRally));
  }

  async broadcastMembers() {
    const members = await this.membersService.findAll();
    this.server.emit('members:updated', members.map(this.formatMember));
  }

  async broadcastBoard(alliance: string) {
    const posts = await this.boardsService.findByAlliance(alliance);
    this.server.emit(`board:updated:${alliance}`, posts.map(this.formatBoardPost));
  }

  private formatNotice(n: any) {
    return {
      id: n.id,
      source: n.source,
      title: n.title,
      content: n.content,
      authorNick: n.authorNick,
      lang: n.lang,
      createdAt: n.createdAt instanceof Date
        ? n.createdAt.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
        : String(n.createdAt),
    };
  }

  private formatRally(r: any) {
    return {
      id: r.id,
      name: r.name,
      endTimeUTC: Number(r.endTimeUTC),
      totalSeconds: r.totalSeconds,
    };
  }

  private formatMember(m: any) {
    return { id: m.id, name: m.name, role: m.role, notes: m.notes };
  }

  private formatBoardPost(p: any) {
    return {
      id: p.id,
      alliance: p.alliance,
      nickname: p.nickname,
      userAlliance: p.userAlliance,
      content: p.content,
      lang: p.lang,
      createdAt: p.createdAt instanceof Date
        ? p.createdAt.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
        : String(p.createdAt),
    };
  }
}
```

- [ ] **Step 2: realtime.module.ts 생성**

```typescript
// server/src/realtime/realtime.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { NoticesModule } from '../notices/notices.module';
import { RalliesModule } from '../rallies/rallies.module';
import { MembersModule } from '../members/members.module';
import { BoardsModule } from '../boards/boards.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET'),
      }),
    }),
    forwardRef(() => NoticesModule),
    forwardRef(() => RalliesModule),
    forwardRef(() => MembersModule),
    forwardRef(() => BoardsModule),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
```

- [ ] **Step 3: 커밋**

```bash
git add src/realtime/
git commit -m "feat: RealtimeGateway — 통합 실시간 브로드캐스터"
```

---

## Task 7: AppModule + AppController 업데이트

**Files:**
- Modify: `server/src/app.module.ts`
- Modify: `server/src/app.controller.ts`

- [ ] **Step 1: app.module.ts — 새 엔티티/모듈 등록**

`server/src/app.module.ts`를 다음으로 교체:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { User } from './users/users.entity';
import { Message } from './chat/message.entity';
import { Notice } from './notices/notice.entity';
import { Rally } from './rallies/rally.entity';
import { Member } from './members/member.entity';
import { BoardPost } from './boards/board-post.entity';
import { Translation } from './translations/translation.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { NoticesModule } from './notices/notices.module';
import { RalliesModule } from './rallies/rallies.module';
import { MembersModule } from './members/members.module';
import { BoardsModule } from './boards/boards.module';
import { TranslationsModule } from './translations/translations.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT', 3306),
        username: configService.get<string>('DATABASE_USER'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
        entities: [User, Message, Notice, Rally, Member, BoardPost, Translation],
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    UsersModule,
    AuthModule,
    ChatModule,
    NoticesModule,
    RalliesModule,
    MembersModule,
    BoardsModule,
    TranslationsModule,
    RealtimeModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 2: app.controller.ts — GET /time 추가**

`server/src/app.controller.ts`를 다음으로 교체:

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('time')
  getTime() {
    return { serverTime: Date.now() };
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app.module.ts src/app.controller.ts
git commit -m "feat: AppModule 신규 모듈 등록 + GET /time 엔드포인트"
```

---

## Task 8: UsersController — 역할 조회/변경 엔드포인트

**Files:**
- Modify: `server/src/users/users.service.ts`
- Modify: `server/src/users/users.module.ts` (controller 등록)
- Create: `server/src/users/users.controller.ts`

- [ ] **Step 1: users.service.ts — findByNickname, setRole 추가**

기존 `users.service.ts`의 끝에 다음 메서드 추가:

```typescript
async findByNickname(nickname: string): Promise<User | null> {
  return this.usersRepository.findOneBy({ nickname });
}

async setRole(nickname: string, role: UserRole): Promise<void> {
  await this.usersRepository.update({ nickname }, { role });
}
```

(import에 `UserRole` 추가: `import { User, UserRole } from './users.entity';`)

- [ ] **Step 2: users.controller.ts 생성**

```typescript
// server/src/users/users.controller.ts
import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UserRole } from './users.entity';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private service: UsersService) {}

  @Get(':nickname/role')
  async getRole(@Param('nickname') nickname: string) {
    const user = await this.service.findByNickname(nickname);
    return { role: user?.role ?? 'member' };
  }

  @Patch(':nickname/role')
  async setRole(
    @Param('nickname') nickname: string,
    @Body() body: { role: UserRole },
  ) {
    await this.service.setRole(nickname, body.role);
    return { success: true };
  }
}
```

- [ ] **Step 3: users.module.ts — controller 등록**

`users.module.ts`의 `controllers` 배열에 `UsersController` 추가:

```typescript
import { UsersController } from './users.controller';
// ...
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
```

- [ ] **Step 4: 커밋**

```bash
git add src/users/
git commit -m "feat: UsersController — 역할 조회/변경 엔드포인트"
```

---

## Task 9: main.js — Firebase 제거 + REST/Socket.io IPC 교체

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: main.js 전체를 다음으로 교체**

```javascript
// main.js — Electron 메인 프로세스
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// ── Claude API ──
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Auth / 실시간 ──
const axios = require('axios');
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
let authToken = null;
let mainSocket = null; // 단일 소켓 (chat + realtime 통합)

let mainWindow;

// ── 창 생성 ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    title: 'WOS SFC 전투 보조',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--inspect') || process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────
// IPC 핸들러
// ─────────────────────────────────────────────

// ── 번역 (Claude Haiku) ──
const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文(简体)' };

ipcMain.handle('translate-to', async (event, text, targetLang) => {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Translate the following text to ${targetName}. Output only the translated text, no explanations:\n\n${text}` }],
    });
    return { success: true, result: message.content[0].text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── 시간 동기화 (connectAlliance 대체) ──
ipcMain.handle('connect-alliance', async () => {
  try {
    const localBefore = Date.now();
    const res = await axios.get(`${SERVER_URL}/time`);
    const serverTime = res.data.serverTime;
    const timeOffset = serverTime - Math.round((localBefore + Date.now()) / 2);
    return { success: true, timeOffset };
  } catch (e) {
    return { success: true, timeOffset: 0 };
  }
});

// ── 회원가입 ──
ipcMain.handle('auth-signup', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/auth/signup`, data);
    authToken = res.data.token;
    return { success: true, user: res.data.user };
  } catch (e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
});

// ── 로그인 ──
ipcMain.handle('auth-login', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/auth/login`, data);
    authToken = res.data.token;
    return { success: true, user: res.data.user };
  } catch (e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
});

// ── 로그아웃 ──
ipcMain.handle('auth-logout', async () => {
  if (mainSocket) { mainSocket.disconnect(); mainSocket = null; }
  authToken = null;
  return { success: true };
});

// ── 소켓 연결 (로그인 후 한 번 호출) ──
ipcMain.handle('socket-connect', async () => {
  if (!authToken) return { success: false, error: '로그인 필요' };
  if (mainSocket?.connected) return { success: true };

  mainSocket = io(SERVER_URL, { auth: { token: authToken } });

  // ── 채팅 이벤트 ──
  mainSocket.on('chat:history', (msgs) => mainWindow.webContents.send('chat-history', msgs));
  mainSocket.on('chat:message', (msg) => mainWindow.webContents.send('chat-message', msg));
  mainSocket.on('chat:system', (text) => mainWindow.webContents.send('chat-system', text));
  mainSocket.on('chat:online', (users) => mainWindow.webContents.send('chat-online', users));

  // ── 실시간 데이터 이벤트 ──
  mainSocket.on('notices:updated', (data) => mainWindow.webContents.send('notices-updated', data));
  mainSocket.on('rallies:updated', (data) => mainWindow.webContents.send('rallies-updated', data));
  mainSocket.on('members:updated', (data) => mainWindow.webContents.send('members-updated', data));
  mainSocket.on('online:updated', (data) => mainWindow.webContents.send('online-updated', data));
  ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'].forEach((a) => {
    mainSocket.on(`board:updated:${a}`, (data) => mainWindow.webContents.send(`board-updated-${a}`, data));
  });

  return { success: true };
});

// ── 채팅 메시지 전송 ──
ipcMain.handle('chat-send', async (event, content) => {
  if (!mainSocket?.connected) return { success: false, error: '소켓 미연결' };
  mainSocket.emit('chat:message', content);
  return { success: true };
});

// ── 공지 CRUD ──
ipcMain.handle('api-add-notice', async (event, data) => {
  try {
    await axios.post(`${SERVER_URL}/notices`, data, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-notice', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/notices/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 집결 타이머 CRUD ──
ipcMain.handle('api-add-rally', async (event, data) => {
  try {
    await axios.post(`${SERVER_URL}/rallies`, data, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-rally', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/rallies/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 집결원 CRUD ──
ipcMain.handle('api-add-member', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/members`, data, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true, id: res.data.id };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-member', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/members/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 번역 캐시 ──
ipcMain.handle('api-get-translation', async (event, cacheKey) => {
  try {
    const res = await axios.get(`${SERVER_URL}/translations/${encodeURIComponent(cacheKey)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return res.data;
  } catch { return null; }
});

ipcMain.handle('api-set-translation', async (event, cacheKey, translated) => {
  try {
    await axios.post(`${SERVER_URL}/translations`, { cacheKey, translated }, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true };
  } catch { return { success: false }; }
});

// ── 연맹 게시판 CRUD ──
ipcMain.handle('api-add-board-post', async (event, alliance, data) => {
  try {
    await axios.post(`${SERVER_URL}/boards`, { ...data, alliance }, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-board-post', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/boards/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 유저 역할 조회 ──
ipcMain.handle('api-get-user-role', async (event, nickname) => {
  try {
    const res = await axios.get(`${SERVER_URL}/users/${nickname}/role`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true, role: res.data.role };
  } catch { return { success: true, role: 'member' }; }
});

// ── 유저 역할 변경 ──
ipcMain.handle('api-set-user-role', async (event, nickname, role) => {
  try {
    await axios.patch(`${SERVER_URL}/users/${nickname}/role`, { role }, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
```

- [ ] **Step 2: 커밋**

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth
git add src/main.js
git commit -m "feat: main.js — Firebase 제거, REST+Socket.io IPC 교체"
```

---

## Task 10: preload.js 업데이트

**Files:**
- Modify: `src/preload.js`

- [ ] **Step 1: preload.js 전체를 다음으로 교체**

```javascript
// preload.js — 보안 브릿지 (메인 ↔ 렌더러)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 번역 ──
  translateTo: (text, lang) => ipcRenderer.invoke('translate-to', text, lang),

  // ── 시간 동기화 (auth.js에서 로그인 후 호출) ──
  connectAlliance: () => ipcRenderer.invoke('connect-alliance'),

  // ── 공지 ──
  addNotice:    (data) => ipcRenderer.invoke('api-add-notice', data),
  deleteNotice: (id)   => ipcRenderer.invoke('api-delete-notice', id),

  // ── 집결 타이머 ──
  addRally:    (data) => ipcRenderer.invoke('api-add-rally', data),
  deleteRally: (id)   => ipcRenderer.invoke('api-delete-rally', id),

  // ── 집결원 ──
  addMember:    (data) => ipcRenderer.invoke('api-add-member', data),
  deleteMember: (id)   => ipcRenderer.invoke('api-delete-member', id),

  // ── 번역 캐시 ──
  getTranslation: (key)        => ipcRenderer.invoke('api-get-translation', key),
  setTranslation: (key, value) => ipcRenderer.invoke('api-set-translation', key, value),

  // ── 온라인 (서버 자동 추적, 더 이상 IPC 불필요) ──
  getUserRole: (nickname) => ipcRenderer.invoke('api-get-user-role', nickname),
  setUserRole: (nickname, role) => ipcRenderer.invoke('api-set-user-role', nickname, role),

  // ── 연맹 게시판 ──
  addBoardPost:    (alliance, data) => ipcRenderer.invoke('api-add-board-post', alliance, data),
  deleteBoardPost: (id)             => ipcRenderer.invoke('api-delete-board-post', id),

  // ── 소켓 연결 ──
  socketConnect: () => ipcRenderer.invoke('socket-connect'),

  // ── 실시간 이벤트 수신 ──
  onNoticesUpdated: (cb) => ipcRenderer.on('notices-updated', (_, data) => cb(data)),
  onRalliesUpdated: (cb) => ipcRenderer.on('rallies-updated', (_, data) => cb(data)),
  onMembersUpdated: (cb) => ipcRenderer.on('members-updated', (_, data) => cb(data)),
  onOnlineUpdated:  (cb) => ipcRenderer.on('online-updated',  (_, data) => cb(data)),
  onBoardUpdated:   (alliance, cb) => ipcRenderer.on(`board-updated-${alliance}`, (_, data) => cb(data)),

  // ── Auth ──
  signup:  (data) => ipcRenderer.invoke('auth-signup', data),
  login:   (data) => ipcRenderer.invoke('auth-login', data),
  logout:  ()     => ipcRenderer.invoke('auth-logout'),

  // ── Chat ──
  chatConnect: ()        => ipcRenderer.invoke('socket-connect'), // 동일 소켓 재사용
  chatSend:    (content) => ipcRenderer.invoke('chat-send', content),
  onChatHistory: (cb) => ipcRenderer.on('chat-history', (_, data) => cb(data)),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_, data) => cb(data)),
  onChatSystem:  (cb) => ipcRenderer.on('chat-system',  (_, text) => cb(text)),
  onChatOnline:  (cb) => ipcRenderer.on('chat-online',  (_, data) => cb(data)),
});
```

- [ ] **Step 2: 커밋**

```bash
git add src/preload.js
git commit -m "feat: preload.js — Firebase IPC 제거, API 브릿지 업데이트"
```

---

## Task 11: auth.js — socketConnect 호출 추가

**Files:**
- Modify: `src/renderer/js/auth.js`

- [ ] **Step 1: initAppWithUser 함수에서 connectAlliance 호출 부분 수정**

`auth.js`의 `initAppWithUser` 함수에서 `connectAlliance` 호출을 다음으로 교체:

```javascript
// 시간 동기화 + 소켓 연결
window.electronAPI.connectAlliance().then((result) => {
  if (result && result.timeOffset !== undefined) {
    window.timeOffset = result.timeOffset;
  }
});
window.electronAPI.socketConnect();
```

(기존: `window.electronAPI.connectAlliance('2677').then(...)` → 인자 제거 + socketConnect 추가)

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/js/auth.js
git commit -m "feat: auth.js — socketConnect 호출 추가"
```

---

## Task 12: noticeboard.js — firebaseId → id

**Files:**
- Modify: `src/renderer/js/noticeboard.js`

- [ ] **Step 1: firebaseId를 id로 전체 교체**

`noticeboard.js`에서 `firebaseId` → `id` (replace_all):

변경 대상 위치:
- `n.firebaseId` → `n.id` (렌더링 시 data-id 값)
- `_detailNoticeId` 변수 — 타입이 string → number가 되지만 동작에 문제 없음
- `notices.find((n) => n.firebaseId === noticeId)` → `notices.find((n) => String(n.id) === String(noticeId))`

구체적 교체:
1. `data-id="${escapeHtml(n.firebaseId)}"` → `data-id="${n.id}"`
2. `n.firebaseId === noticeId` → `String(n.id) === String(noticeId)`
3. `document.getElementById('notice-detail-delete').addEventListener(...)` 내 `deleteNotice(_detailNoticeId)` — 이미 `_detailNoticeId` 사용하므로 변경 없음 (id 값이 들어가면 됨)

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/js/noticeboard.js
git commit -m "fix: noticeboard.js — firebaseId → id"
```

---

## Task 13: rally-timer.js — firebaseId → id

**Files:**
- Modify: `src/renderer/js/rally-timer.js`

- [ ] **Step 1: firebaseId를 id로 전체 교체**

`rally-timer.js`에서 `r.firebaseId` → `r.id` 전체 교체:

변경 위치:
1. `rallyTimers[rally.firebaseId]` → `rallyTimers[rally.id]`
2. `data-id="${r.firebaseId}"` → `data-id="${r.id}"`
3. `countdown-${r.firebaseId}` → `countdown-${r.id}`
4. `progress-${r.firebaseId}` → `progress-${r.id}`
5. `btn.dataset.deleteRally` 이벤트 위임 부분 — `firebaseId` → `id` 참조 변경
6. `[data-id="${rally.firebaseId}"]` → `[data-id="${rally.id}"]`
7. `document.getElementById('countdown-${rally.firebaseId}')` → `document.getElementById('countdown-${rally.id}')`
8. `data-delete-rally="${r.firebaseId}"` → `data-delete-rally="${r.id}"`

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/js/rally-timer.js
git commit -m "fix: rally-timer.js — firebaseId → id"
```

---

## Task 14: community.js — firebaseId → id + deleteBoardPost 시그니처 변경

**Files:**
- Modify: `src/renderer/js/community.js`

- [ ] **Step 1: firebaseId → id 전체 교체 + deleteBoardPost 인자 변경**

`community.js`에서:
1. `p.firebaseId` → `p.id` (모든 참조)
2. `bpc-${escBHtml(p.firebaseId)}` → `bpc-${p.id}`
3. `bpo-${escBHtml(p.firebaseId)}` → `bpo-${p.id}`
4. `data-id="${escBHtml(p.firebaseId)}"` → `data-id="${p.id}"`
5. `deleteBoardPost(card.dataset.alliance, card.dataset.id)` → `deleteBoardPost(card.dataset.id)` (alliance 인자 제거, 서버에서 자동 처리)
6. `bpc-${p.firebaseId}` → `bpc-${p.id}` (비동기 번역 함수 내부)
7. `bpo-${p.firebaseId}` → `bpo-${p.id}` (비동기 번역 함수 내부)

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/js/community.js
git commit -m "fix: community.js — firebaseId → id, deleteBoardPost 시그니처 수정"
```

---

## Task 15: package.json — Firebase 패키지 제거

**Files:**
- Modify: `package.json` (워크트리 루트)

- [ ] **Step 1: firebase 패키지 제거**

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth
npm uninstall firebase
```

Expected: `package.json`에서 `"firebase": "..."` 라인 제거됨

- [ ] **Step 2: .env에서 Firebase 환경변수 제거**

`src/.env` 또는 루트 `.env`에서 다음 라인 제거:
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json .env
git commit -m "chore: Firebase 패키지 + 환경변수 제거"
```

---

## Task 16: 정적 검증

- [ ] **Step 1: NestJS tsc 검증**

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth/server
npx tsc --noEmit
```

Expected: 에러 0개

- [ ] **Step 2: 파일 구조 확인**

```bash
ls src/notices/ src/rallies/ src/members/ src/boards/ src/translations/ src/realtime/
```

Expected: 각 디렉터리에 entity, service, controller, module 파일 존재

- [ ] **Step 3: 오류 수정 후 최종 커밋**

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth
git add -A
git commit -m "chore: 정적 검증 통과 — Firebase→NestJS 통합 완료"
```

---

## 검증 체크리스트 (런타임)

Task 16 완료 후 수동 검증:

1. MySQL 실행 확인: `mysql -u wos_user -p wos_pass wos_db`
2. NestJS 서버 기동: `cd server && npm run start:dev`
   - Expected: `Server running on port 3001`, 테이블 auto-sync 로그
3. Electron 앱 기동: `npm start` (워크트리 루트)
   - Expected: 로그인 모달 표시
4. 회원가입 → 로그인 → 공지 추가 → 다른 클라이언트에서 실시간 수신 확인
5. 집결 타이머 추가/삭제 실시간 동기화 확인
6. 채팅 탭 → 메시지 전송 확인
7. DevTools Console에 Firebase 관련 에러 없음 확인
