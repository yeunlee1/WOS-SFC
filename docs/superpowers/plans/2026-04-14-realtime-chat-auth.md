# 실시간 채팅 + 회원가입/로그인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NestJS + PostgreSQL 백엔드를 새로 구축하고, Electron 앱의 기존 서버코드 로그인을 계정 기반 회원가입/로그인으로 교체하며 실시간 채팅 탭을 추가한다.

**Architecture:** Electron renderer → IPC → main.js → HTTP(axios) / Socket.io → NestJS 서버 → PostgreSQL. 렌더러는 직접 외부 연결 없음 (CSP 유지). 기존 Firebase 기능(공지/집결/게시판)은 변경 없음.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, @nestjs/jwt, passport-jwt, bcrypt, @nestjs/websockets, socket.io, socket.io-client(main.js용), axios

---

## 파일 구조 (신규/변경)

```
wos-sfc-helper/
├── server/                          # NestJS 백엔드 (신규)
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.entity.ts
│   │   │   └── users.service.ts
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── jwt.strategy.ts
│   │   │   └── dto/
│   │   │       ├── signup.dto.ts
│   │   │       └── login.dto.ts
│   │   └── chat/
│   │       ├── chat.module.ts
│   │       ├── chat.gateway.ts
│   │       ├── chat.service.ts
│   │       └── message.entity.ts
│   ├── test/
│   │   ├── auth.service.spec.ts
│   │   └── chat.service.spec.ts
│   ├── .env
│   ├── tsconfig.json
│   └── package.json
├── src/
│   ├── main.js                      # 변경: auth/chat IPC 핸들러 추가
│   ├── preload.js                   # 변경: auth/chat API 노출
│   └── renderer/
│       ├── index.html               # 변경: auth 모달 교체, 채팅 탭 추가
│       └── js/
│           ├── auth.js              # 신규: 로그인/회원가입 UI
│           └── chat.js              # 신규: 채팅 UI
```

---

## Task 1: NestJS 프로젝트 초기화

**Files:**
- Create: `server/` (NestJS 프로젝트 전체)

- [ ] **Step 1: NestJS CLI 전역 설치 및 프로젝트 생성**

```bash
cd C:/WOS/wos-sfc-helper
npm install -g @nestjs/cli
nest new server --package-manager npm --skip-git
```

선택지 나오면 `npm` 선택.

- [ ] **Step 2: 추가 의존성 설치**

```bash
cd server
npm install @nestjs/typeorm typeorm pg @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt @nestjs/websockets @nestjs/platform-socket.io socket.io class-validator class-transformer
npm install -D @types/passport-jwt @types/bcrypt
```

- [ ] **Step 3: server/.env 생성**

```
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=wos_user
DATABASE_PASSWORD=wos_pass
DATABASE_NAME=wos_db
JWT_SECRET=wos_jwt_secret_change_in_production
PORT=3001
```

- [ ] **Step 4: PostgreSQL DB 생성**

```bash
# PostgreSQL psql 에서 실행
psql -U postgres
CREATE USER wos_user WITH PASSWORD 'wos_pass';
CREATE DATABASE wos_db OWNER wos_user;
\q
```

- [ ] **Step 5: 서버 기동 확인**

```bash
cd server
npm run start:dev
```

Expected: `Application is running on: http://localhost:3001`

- [ ] **Step 6: 커밋**

```bash
cd ..
git add server/
git commit -m "chore: NestJS 백엔드 프로젝트 초기화"
```

---

## Task 2: User 엔티티 + TypeORM 설정

**Files:**
- Create: `server/src/users/users.entity.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: User 엔티티 작성**

`server/src/users/users.entity.ts`:
```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'member' | 'developer';
export const LANGUAGES = ['ko', 'en', 'ja', 'zh', 'ru', 'other'] as const;
export type Language = typeof LANGUAGES[number];

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  nickname: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash: string;

  @Column({ name: 'alliance_name', length: 100 })
  allianceName: string;

  @Column({ type: 'enum', enum: ['admin', 'member', 'developer'] })
  role: UserRole;

  @Column({ name: 'birth_date', type: 'date' })
  birthDate: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 20 })
  language: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: app.module.ts — TypeORM 연결 설정**

`server/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from './users/users.entity';
import { Message } from './chat/message.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT, 10),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities: [User, Message],
      synchronize: true, // 개발용: 자동 테이블 생성
    }),
    UsersModule,
    AuthModule,
    ChatModule,
  ],
})
export class AppModule {}
```

```bash
npm install @nestjs/config
```

- [ ] **Step 3: 서버 재기동 후 테이블 자동 생성 확인**

```bash
npm run start:dev
```

Expected: TypeORM이 `users` 테이블 자동 생성, 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add server/src/
git commit -m "feat: User 엔티티 + TypeORM PostgreSQL 연결"
```

---

## Task 3: Message 엔티티

**Files:**
- Create: `server/src/chat/message.entity.ts`

- [ ] **Step 1: Message 엔티티 작성**

`server/src/chat/message.entity.ts`:
```typescript
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/users.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: 서버 재기동 — messages 테이블 생성 확인**

```bash
npm run start:dev
```

Expected: `messages` 테이블 자동 생성.

- [ ] **Step 3: 커밋**

```bash
git add server/src/chat/message.entity.ts
git commit -m "feat: Message 엔티티 추가"
```

---

## Task 4: Users 모듈 + 서비스

**Files:**
- Create: `server/src/users/users.module.ts`
- Create: `server/src/users/users.service.ts`

- [ ] **Step 1: Users 서비스 작성**

`server/src/users/users.service.ts`:
```typescript
import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, Language } from './users.entity';
import * as bcrypt from 'bcrypt';

export interface CreateUserDto {
  nickname: string;
  password: string;
  allianceName: string;
  role: UserRole;
  birthDate: string;
  name: string;
  language: Language;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const exists = await this.usersRepo.findOne({ where: { nickname: dto.nickname } });
    if (exists) throw new ConflictException('이미 사용 중인 닉네임입니다');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.usersRepo.create({
      nickname: dto.nickname,
      passwordHash,
      allianceName: dto.allianceName,
      role: dto.role,
      birthDate: dto.birthDate,
      name: dto.name,
      language: dto.language,
    });
    return this.usersRepo.save(user);
  }

  async findByNickname(nickname: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { nickname } });
  }
}
```

- [ ] **Step 2: Users 모듈 작성**

`server/src/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 3: 유닛 테스트 작성**

`server/test/auth.service.spec.ts` (부분):
```typescript
import { UsersService } from '../src/users/users.service';

describe('UsersService', () => {
  it('닉네임 중복 시 ConflictException', async () => {
    const mockRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 1, nickname: 'tester' }),
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new UsersService(mockRepo as any);
    await expect(
      service.create({
        nickname: 'tester', password: 'pw', allianceName: 'KOR',
        role: 'member', birthDate: '1990-01-01', name: '테스터', language: 'ko',
      })
    ).rejects.toThrow('이미 사용 중인 닉네임입니다');
  });
});
```

- [ ] **Step 4: 테스트 실행**

```bash
cd server && npm run test
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add server/src/users/ server/test/
git commit -m "feat: Users 모듈 + 서비스 (bcrypt 해시, 중복 닉네임 검사)"
```

---

## Task 5: Auth 모듈 — 회원가입

**Files:**
- Create: `server/src/auth/dto/signup.dto.ts`
- Create: `server/src/auth/auth.service.ts`
- Create: `server/src/auth/auth.controller.ts`
- Create: `server/src/auth/auth.module.ts`

- [ ] **Step 1: SignupDto 작성**

`server/src/auth/dto/signup.dto.ts`:
```typescript
import { IsString, IsEnum, IsDateString, MinLength, IsIn } from 'class-validator';
import { UserRole, LANGUAGES, Language } from '../../users/users.entity';

export class SignupDto {
  @IsString() nickname: string;
  @IsString() @MinLength(6) password: string;
  @IsString() allianceName: string;
  @IsEnum(['admin', 'member', 'developer']) role: UserRole;
  @IsDateString() birthDate: string;
  @IsString() name: string;
  @IsIn(LANGUAGES) language: Language;
  @IsString() serverCode: string; // 반드시 '2677'
}
```

- [ ] **Step 2: LoginDto 작성**

`server/src/auth/dto/login.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() nickname: string;
  @IsString() @MinLength(6) password: string;
}
```

- [ ] **Step 3: Auth 서비스 작성**

`server/src/auth/auth.service.ts`:
```typescript
import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

const SERVER_CODE = '2677';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    if (dto.serverCode !== SERVER_CODE) {
      throw new ForbiddenException('서버 코드가 올바르지 않습니다');
    }
    const user = await this.usersService.create({
      nickname: dto.nickname,
      password: dto.password,
      allianceName: dto.allianceName,
      role: dto.role,
      birthDate: dto.birthDate,
      name: dto.name,
      language: dto.language,
    });
    const token = this.jwtService.sign({ sub: user.id, nickname: user.nickname, role: user.role });
    return { token, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByNickname(dto.nickname);
    if (!user) throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
    const token = this.jwtService.sign({ sub: user.id, nickname: user.nickname, role: user.role });
    return { token, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
  }
}
```

- [ ] **Step 4: Auth 컨트롤러 작성**

`server/src/auth/auth.controller.ts`:
```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

- [ ] **Step 5: Auth 모듈 작성**

`server/src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'wos_jwt_secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 6: main.ts에 ValidationPipe 활성화**

`server/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors({ origin: '*' }); // Electron 로컬 연결 허용
  await app.listen(process.env.PORT ?? 3001);
  console.log(`Server running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();
```

- [ ] **Step 7: 회원가입/로그인 API 테스트**

```bash
npm run start:dev
```

```bash
# 회원가입 테스트 — 잘못된 서버코드
curl -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"nickname":"tester","password":"pass123","allianceName":"KOR","role":"member","birthDate":"1990-01-01","name":"테스터","language":"ko","serverCode":"wrong"}'
```
Expected: `403 Forbidden` + "서버 코드가 올바르지 않습니다"

```bash
# 회원가입 테스트 — 올바른 서버코드
curl -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"nickname":"tester","password":"pass123","allianceName":"KOR","role":"member","birthDate":"1990-01-01","name":"테스터","language":"ko","serverCode":"2677"}'
```
Expected: `201` + `{ token: "...", user: { nickname: "tester", ... } }`

```bash
# 로그인 테스트
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"nickname":"tester","password":"pass123"}'
```
Expected: `201` + `{ token: "...", user: { ... } }`

- [ ] **Step 8: 커밋**

```bash
git add server/src/auth/
git commit -m "feat: Auth 회원가입/로그인 API (서버코드 검증, JWT 발급)"
```

---

## Task 6: Chat 모듈 — Socket.io 게이트웨이

**Files:**
- Create: `server/src/chat/chat.service.ts`
- Create: `server/src/chat/chat.gateway.ts`
- Create: `server/src/chat/chat.module.ts`

- [ ] **Step 1: JWT Strategy 추가 (Socket.io 인증용)**

`server/src/auth/jwt.strategy.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'wos_jwt_secret',
    });
  }

  async validate(payload: { sub: number; nickname: string; role: string }) {
    const user = await this.usersService.findByNickname(payload.nickname);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

`server/src/auth/auth.module.ts`에 JwtStrategy 추가:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'wos_jwt_secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 2: Chat 서비스 작성**

`server/src/chat/chat.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../users/users.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
  ) {}

  async saveMessage(user: User, content: string): Promise<Message> {
    const msg = this.messagesRepo.create({ user, content });
    return this.messagesRepo.save(msg);
  }

  async getRecentMessages(): Promise<Message[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return this.messagesRepo.find({
      where: { createdAt: MoreThan(sevenDaysAgo) },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async deleteOldMessages(): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await this.messagesRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < :date', { date: sevenDaysAgo })
      .execute();
  }
}
```

- [ ] **Step 3: Chat 게이트웨이 작성**

`server/src/chat/chat.gateway.ts`:
```typescript
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // socket.id → user 닉네임
  private connectedUsers = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) { client.disconnect(); return; }
      const payload = this.jwtService.verify(token);
      const user = await this.usersService.findByNickname(payload.nickname);
      if (!user) { client.disconnect(); return; }

      // 유저 정보를 소켓에 저장
      (client as any).user = user;
      this.connectedUsers.set(client.id, user.nickname);

      // 최근 메시지 전송
      const history = await this.chatService.getRecentMessages();
      client.emit('chat:history', history.map(m => ({
        id: m.id,
        nickname: m.user.nickname,
        allianceName: m.user.allianceName,
        content: m.content,
        createdAt: m.createdAt,
      })));

      // 입장 알림
      this.server.emit('chat:system', `${user.nickname}님이 입장했습니다`);
      this.server.emit('chat:online', Array.from(this.connectedUsers.values()));
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const nickname = this.connectedUsers.get(client.id);
    if (nickname) {
      this.connectedUsers.delete(client.id);
      this.server.emit('chat:system', `${nickname}님이 퇴장했습니다`);
      this.server.emit('chat:online', Array.from(this.connectedUsers.values()));
    }
  }

  @SubscribeMessage('chat:message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() content: string,
  ) {
    const user = (client as any).user;
    if (!user || !content?.trim()) return;
    const msg = await this.chatService.saveMessage(user, content.trim());
    this.server.emit('chat:message', {
      id: msg.id,
      nickname: user.nickname,
      allianceName: user.allianceName,
      content: msg.content,
      createdAt: msg.createdAt,
    });
  }
}
```

- [ ] **Step 4: Chat 모듈 작성**

`server/src/chat/chat.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Message]), AuthModule, UsersModule],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
```

- [ ] **Step 5: 서버 재기동 확인**

```bash
npm run start:dev
```

Expected: 에러 없이 기동, `WebSocket Gateway initialized` 로그 출력.

- [ ] **Step 6: 커밋**

```bash
git add server/src/chat/ server/src/auth/jwt.strategy.ts server/src/auth/auth.module.ts
git commit -m "feat: Socket.io 채팅 게이트웨이 (JWT 인증, 7일 기록)"
```

---

## Task 7: Electron main.js — auth/chat IPC 핸들러

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: axios + socket.io-client 설치**

```bash
cd C:/WOS/wos-sfc-helper
npm install axios socket.io-client
```

- [ ] **Step 2: main.js 상단에 auth/chat 변수 추가**

기존 `let mainWindow;` 바로 아래에 추가:
```javascript
// ── Auth / Chat ──
const axios = require('axios');
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
let authToken = null;
let currentUser = null;
let chatSocket = null;
```

- [ ] **Step 3: main.js — 회원가입 IPC 핸들러 추가**

파일 끝(마지막 `ipcMain.handle` 블록 뒤)에 추가:
```javascript
// ── 회원가입 ──
ipcMain.handle('auth-signup', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/auth/signup`, data);
    authToken = res.data.token;
    currentUser = res.data.user;
    return { success: true, user: currentUser };
  } catch (e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
});

// ── 로그인 ──
ipcMain.handle('auth-login', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/auth/login`, data);
    authToken = res.data.token;
    currentUser = res.data.user;
    return { success: true, user: currentUser };
  } catch (e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
});

// ── 로그아웃 ──
ipcMain.handle('auth-logout', async () => {
  if (chatSocket) { chatSocket.disconnect(); chatSocket = null; }
  authToken = null;
  currentUser = null;
  return { success: true };
});

// ── 채팅 소켓 연결 ──
ipcMain.handle('chat-connect', async () => {
  if (!authToken) return { success: false, error: '로그인 필요' };
  if (chatSocket?.connected) return { success: true };

  chatSocket = io(SERVER_URL, { auth: { token: authToken } });

  chatSocket.on('chat:history', (messages) => {
    mainWindow.webContents.send('chat-history', messages);
  });
  chatSocket.on('chat:message', (msg) => {
    mainWindow.webContents.send('chat-message', msg);
  });
  chatSocket.on('chat:system', (text) => {
    mainWindow.webContents.send('chat-system', text);
  });
  chatSocket.on('chat:online', (users) => {
    mainWindow.webContents.send('chat-online', users);
  });

  return { success: true };
});

// ── 메시지 전송 ──
ipcMain.handle('chat-send', async (event, content) => {
  if (!chatSocket?.connected) return { success: false, error: '채팅 미연결' };
  chatSocket.emit('chat:message', content);
  return { success: true };
});
```

- [ ] **Step 4: 커밋**

```bash
git add src/main.js
git commit -m "feat: main.js auth/chat IPC 핸들러 추가"
```

---

## Task 8: preload.js — auth/chat API 노출

**Files:**
- Modify: `src/preload.js`

- [ ] **Step 1: preload.js에 auth/chat 노출 추가**

기존 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 객체 안 끝부분에 추가:
```javascript
  // ── Auth ──
  signup:  (data)   => ipcRenderer.invoke('auth-signup', data),
  login:   (data)   => ipcRenderer.invoke('auth-login', data),
  logout:  ()       => ipcRenderer.invoke('auth-logout'),

  // ── Chat ──
  chatConnect: ()        => ipcRenderer.invoke('chat-connect'),
  chatSend:    (content) => ipcRenderer.invoke('chat-send', content),
  onChatHistory: (cb) => ipcRenderer.on('chat-history', (_, data) => cb(data)),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_, data) => cb(data)),
  onChatSystem:  (cb) => ipcRenderer.on('chat-system',  (_, text) => cb(text)),
  onChatOnline:  (cb) => ipcRenderer.on('chat-online',  (_, data) => cb(data)),
```

- [ ] **Step 2: 커밋**

```bash
git add src/preload.js
git commit -m "feat: preload.js auth/chat IPC 브릿지 추가"
```

---

## Task 9: renderer — auth.js (로그인/회원가입 UI)

**Files:**
- Create: `src/renderer/js/auth.js`

- [ ] **Step 1: auth.js 작성**

`src/renderer/js/auth.js`:
```javascript
// auth.js — 로그인/회원가입 UI 로직

(function () {
  const LANGUAGES = [
    { value: 'ko', label: '🇰🇷 한국어' },
    { value: 'en', label: '🇺🇸 English' },
    { value: 'ja', label: '🇯🇵 日本語' },
    { value: 'zh', label: '🇨🇳 中文' },
    { value: 'ru', label: '🇷🇺 Русский' },
    { value: 'other', label: '기타' },
  ];

  // 현재 모드: 'login' | 'signup'
  let mode = 'login';

  function showAuthModal() {
    document.getElementById('auth-modal').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    renderForm();
  }

  function hideAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  }

  function setError(msg) {
    document.getElementById('auth-error').textContent = msg;
  }

  function renderForm() {
    const box = document.getElementById('auth-modal-box');
    setError('');

    if (mode === 'login') {
      box.innerHTML = `
        <h2>⚔️ WOS SFC</h2>
        <p class="auth-subtitle">로그인</p>
        <input type="text" id="auth-nickname" placeholder="닉네임" maxlength="50" />
        <input type="password" id="auth-password" placeholder="비밀번호" maxlength="100" />
        <p id="auth-error" class="auth-error"></p>
        <button id="auth-submit-btn" class="btn btn-primary">로그인</button>
        <p class="auth-switch">계정이 없으신가요? <a href="#" id="auth-switch-link">회원가입</a></p>
      `;
      document.getElementById('auth-submit-btn').onclick = handleLogin;
      document.getElementById('auth-switch-link').onclick = (e) => {
        e.preventDefault(); mode = 'signup'; renderForm();
      };
    } else {
      const langOptions = LANGUAGES.map(l =>
        `<option value="${l.value}">${l.label}</option>`
      ).join('');
      box.innerHTML = `
        <h2>⚔️ WOS SFC</h2>
        <p class="auth-subtitle">회원가입</p>
        <input type="text" id="auth-name" placeholder="이름" maxlength="100" />
        <input type="text" id="auth-nickname" placeholder="닉네임" maxlength="50" />
        <input type="password" id="auth-password" placeholder="비밀번호 (6자 이상)" maxlength="100" />
        <input type="text" id="auth-alliance" placeholder="동맹명 (예: KOR)" maxlength="100" />
        <select id="auth-role">
          <option value="member">일반 인원</option>
          <option value="admin">관리자</option>
          <option value="developer">개발자</option>
        </select>
        <input type="date" id="auth-birthdate" placeholder="생년월일" />
        <select id="auth-language">${langOptions}</select>
        <p class="auth-server-question">서버가 어디입니까?</p>
        <input type="text" id="auth-server-code" placeholder="답변 입력" maxlength="10" />
        <p id="auth-error" class="auth-error"></p>
        <button id="auth-submit-btn" class="btn btn-primary">가입하기</button>
        <p class="auth-switch">이미 계정이 있으신가요? <a href="#" id="auth-switch-link">로그인</a></p>
      `;
      document.getElementById('auth-submit-btn').onclick = handleSignup;
      document.getElementById('auth-switch-link').onclick = (e) => {
        e.preventDefault(); mode = 'login'; renderForm();
      };
    }
  }

  async function handleLogin() {
    const nickname = document.getElementById('auth-nickname').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!nickname || !password) { setError('닉네임과 비밀번호를 입력하세요'); return; }

    const btn = document.getElementById('auth-submit-btn');
    btn.disabled = true; btn.textContent = '처리 중...';

    const result = await window.electronAPI.login({ nickname, password });
    if (result.success) {
      hideAuthModal();
      initAppWithUser(result.user);
    } else {
      setError(Array.isArray(result.error) ? result.error.join(', ') : result.error);
      btn.disabled = false; btn.textContent = '로그인';
    }
  }

  async function handleSignup() {
    const data = {
      name:       document.getElementById('auth-name').value.trim(),
      nickname:   document.getElementById('auth-nickname').value.trim(),
      password:   document.getElementById('auth-password').value,
      allianceName: document.getElementById('auth-alliance').value.trim(),
      role:       document.getElementById('auth-role').value,
      birthDate:  document.getElementById('auth-birthdate').value,
      language:   document.getElementById('auth-language').value,
      serverCode: document.getElementById('auth-server-code').value.trim(),
    };

    if (!data.name || !data.nickname || !data.password || !data.allianceName || !data.birthDate) {
      setError('모든 항목을 입력하세요'); return;
    }
    if (data.password.length < 6) { setError('비밀번호는 6자 이상이어야 합니다'); return; }

    const btn = document.getElementById('auth-submit-btn');
    btn.disabled = true; btn.textContent = '처리 중...';

    const result = await window.electronAPI.signup(data);
    if (result.success) {
      hideAuthModal();
      initAppWithUser(result.user);
    } else {
      setError(Array.isArray(result.error) ? result.error.join(', ') : result.error);
      btn.disabled = false; btn.textContent = '가입하기';
    }
  }

  function initAppWithUser(user) {
    // 유저 정보 헤더 표시
    document.getElementById('user-nickname').textContent = user.nickname;
    document.getElementById('user-role-badge').textContent = user.role;
    document.getElementById('user-info').style.display = '';

    // 로그아웃 버튼
    document.getElementById('logout-btn').onclick = async () => {
      await window.electronAPI.logout();
      showAuthModal();
    };
  }

  // 앱 시작 시 auth 모달 표시
  window.addEventListener('DOMContentLoaded', () => {
    showAuthModal();
  });

  window.showAuthModal = showAuthModal;
})();
```

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/js/auth.js
git commit -m "feat: auth.js 로그인/회원가입 UI"
```

---

## Task 10: renderer — chat.js (채팅 탭 UI)

**Files:**
- Create: `src/renderer/js/chat.js`

- [ ] **Step 1: chat.js 작성**

`src/renderer/js/chat.js`:
```javascript
// chat.js — 실시간 채팅 UI

(function () {
  let initialized = false;

  async function initChat() {
    if (initialized) return;
    initialized = true;

    const result = await window.electronAPI.chatConnect();
    if (!result.success) {
      document.getElementById('chat-messages').innerHTML =
        `<p class="empty-message">채팅 서버 연결 실패: ${result.error}</p>`;
      return;
    }

    window.electronAPI.onChatHistory((messages) => {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      messages.forEach(appendMessage);
      scrollToBottom();
    });

    window.electronAPI.onChatMessage((msg) => {
      appendMessage(msg);
      scrollToBottom();
    });

    window.electronAPI.onChatSystem((text) => {
      const container = document.getElementById('chat-messages');
      const el = document.createElement('p');
      el.className = 'chat-system-msg';
      el.textContent = text;
      container.appendChild(el);
      scrollToBottom();
    });

    window.electronAPI.onChatOnline((users) => {
      const el = document.getElementById('chat-online-list');
      el.innerHTML = users.map(u => `<span class="chat-online-user">${u}</span>`).join('');
      document.getElementById('chat-online-count').textContent = users.length;
    });
  }

  function appendMessage(msg) {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-message';
    const time = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <span class="chat-alliance">[${msg.allianceName}]</span>
      <span class="chat-nickname">${msg.nickname}</span>
      <span class="chat-time">${time}</span>
      <p class="chat-content">${escapeHtml(msg.content)}</p>
    `;
    container.appendChild(el);
  }

  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setupSendButton() {
    const btn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');

    async function sendMessage() {
      const content = input.value.trim();
      if (!content) return;
      input.value = '';
      await window.electronAPI.chatSend(content);
    }

    btn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  // 채팅 탭 클릭 시 초기화
  document.addEventListener('DOMContentLoaded', () => {
    setupSendButton();
    const chatTabBtn = document.querySelector('[data-tab="chat"]');
    if (chatTabBtn) {
      chatTabBtn.addEventListener('click', initChat);
    }
  });
})();
```

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/js/chat.js
git commit -m "feat: chat.js 실시간 채팅 UI"
```

---

## Task 11: index.html — auth 모달 교체 + 채팅 탭 추가

**Files:**
- Modify: `src/renderer/index.html`

- [ ] **Step 1: 기존 alliance-modal을 auth-modal로 교체**

`index.html`에서 `<div id="alliance-modal" ...>...</div>` 블록 전체를 교체:
```html
<!-- ── Auth 모달 ── -->
<div id="auth-modal" class="auth-modal" style="display:none">
  <div id="auth-modal-box" class="auth-modal-box">
    <!-- auth.js가 동적으로 렌더링 -->
  </div>
</div>
```

- [ ] **Step 2: 탭 네비게이션에 채팅 탭 추가**

`<nav class="tab-nav">` 안에 기존 탭들 뒤에 추가:
```html
<button class="tab-btn" data-tab="chat">💬 채팅</button>
```

- [ ] **Step 3: 채팅 탭 패널 추가**

`<main class="tab-content">` 안 마지막 `</section>` 뒤에 추가:
```html
<!-- ══ 채팅 ══ -->
<section id="chat" class="tab-panel">
  <div class="chat-layout">
    <div class="chat-header">
      <h2>💬 동맹 채팅</h2>
      <span class="chat-online-badge">
        <span id="chat-online-count">0</span>명 접속 중
      </span>
    </div>
    <div id="chat-online-list" class="chat-online-list"></div>
    <div id="chat-messages" class="chat-messages">
      <p class="empty-message">채팅 탭을 열면 연결됩니다</p>
    </div>
    <div class="chat-input-area">
      <input type="text" id="chat-input" placeholder="메시지 입력... (Enter 전송)" maxlength="500" />
      <button id="chat-send-btn" class="btn btn-primary">전송</button>
    </div>
  </div>
</section>
```

- [ ] **Step 4: script 태그에 auth.js, chat.js 추가**

`</body>` 바로 위 script 태그들 뒤에 추가:
```html
<script src="js/auth.js"></script>
<script src="js/chat.js"></script>
```

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/index.html
git commit -m "feat: index.html auth 모달 교체 + 채팅 탭 추가"
```

---

## Task 12: style.css — auth/chat 스타일 추가

**Files:**
- Modify: `src/renderer/style.css`

- [ ] **Step 1: style.css 끝에 auth/chat 스타일 추가**

```css
/* ── Auth Modal ── */
.auth-modal {
  position: fixed; inset: 0; background: rgba(0,0,0,0.8);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.auth-modal-box {
  background: #1e1e3a; border: 1px solid #3a3a6a; border-radius: 12px;
  padding: 2rem; width: 360px; display: flex; flex-direction: column; gap: 0.75rem;
}
.auth-modal-box h2 { text-align: center; color: #e2e8f0; margin: 0 0 0.5rem; }
.auth-subtitle { text-align: center; color: #94a3b8; margin: 0; font-size: 0.9rem; }
.auth-modal-box input, .auth-modal-box select {
  padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #3a3a6a;
  background: #0f0f23; color: #e2e8f0; font-size: 0.9rem; width: 100%; box-sizing: border-box;
}
.auth-error { color: #f87171; font-size: 0.85rem; min-height: 1.2rem; margin: 0; }
.auth-switch { text-align: center; color: #94a3b8; font-size: 0.85rem; margin: 0; }
.auth-switch a { color: #60a5fa; text-decoration: none; }
.auth-server-question { color: #fbbf24; font-size: 0.85rem; margin: 0.25rem 0 0; font-weight: 600; }

/* ── Chat ── */
.chat-layout {
  display: flex; flex-direction: column; height: calc(100vh - 120px); gap: 0.5rem; padding: 1rem;
}
.chat-header { display: flex; align-items: center; justify-content: space-between; }
.chat-online-badge { background: #1e3a5f; color: #60a5fa; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; }
.chat-online-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chat-online-user { background: #1e3a2a; color: #4ade80; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; }
.chat-messages { flex: 1; overflow-y: auto; background: #0f0f23; border: 1px solid #2a2a4a; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.chat-message { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem; }
.chat-alliance { color: #94a3b8; font-size: 0.75rem; }
.chat-nickname { color: #60a5fa; font-weight: 600; font-size: 0.85rem; }
.chat-time { color: #64748b; font-size: 0.7rem; }
.chat-content { width: 100%; margin: 0; color: #e2e8f0; font-size: 0.9rem; }
.chat-system-msg { color: #94a3b8; font-size: 0.8rem; text-align: center; font-style: italic; }
.chat-input-area { display: flex; gap: 0.5rem; }
.chat-input-area input { flex: 1; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #3a3a6a; background: #0f0f23; color: #e2e8f0; }
```

- [ ] **Step 2: 커밋**

```bash
git add src/renderer/style.css
git commit -m "feat: auth/chat 스타일 추가"
```

---

## Task 13: 전체 동작 검증

- [ ] **Step 1: NestJS 서버 기동**

```bash
cd C:/WOS/wos-sfc-helper/server
npm run start:dev
```

Expected: `Server running on port 3001`, `WebSocket Gateway initialized`

- [ ] **Step 2: Electron 앱 기동**

```bash
cd C:/WOS/wos-sfc-helper
npm start
```

Expected: Auth 모달이 먼저 표시됨

- [ ] **Step 3: 회원가입 흐름 검증**

1. "회원가입" 클릭
2. 모든 항목 입력
3. "서버가 어디입니까?" → `2677` 입력
4. "가입하기" 클릭
5. Expected: 앱 본체 표시, 헤더에 닉네임/역할 표시

- [ ] **Step 4: 로그인 흐름 검증**

1. 로그아웃 후 재기동
2. 닉네임 + 비밀번호 입력
3. Expected: 앱 본체 표시

- [ ] **Step 5: 채팅 검증**

1. "채팅" 탭 클릭
2. Expected: 이전 채팅 기록 로드, 입장 메시지 표시
3. 메시지 입력 후 Enter
4. Expected: 메시지 전송, 화면에 표시

- [ ] **Step 6: 잘못된 서버코드 검증**

1. 회원가입 시 "서버가 어디입니까?" → `1234` 입력
2. Expected: "서버 코드가 올바르지 않습니다" 에러 메시지

- [ ] **Step 7: 최종 커밋**

```bash
git add .
git commit -m "feat: 실시간 채팅 + 회원가입/로그인 전체 구현 완료"
```

---

## 주의사항

- **PostgreSQL**이 로컬에 설치되어 있어야 함. 없으면 [공식 다운로드](https://www.postgresql.org/download/) 또는 Docker 사용.
- **NestJS 서버와 Electron 앱을 별도 터미널**에서 동시에 실행해야 함.
- 기존 Firebase 기능(공지/집결/게시판/온라인 상태)은 변경 없이 유지됨.
- 프로덕션 배포 시 `synchronize: true` → `synchronize: false` + 마이그레이션으로 변경 필요.
