# WOS SFC 전투 보조

WOS SFC 연맹 운영을 위한 실시간 웹 애플리케이션입니다. 전투 카운트, 랠리 그룹, 채팅과 공지, 작전 보드, 번역과 TTS 기능을 한 화면에서 제공합니다.

## 기술 구성

| 경로                 | 역할                             | 주요 기술                                  |
| -------------------- | -------------------------------- | ------------------------------------------ |
| `web/`               | 브라우저 UI                      | React 18, Vite, Vitest, Socket.IO Client   |
| `server/`            | REST API와 WebSocket 서버        | NestJS 11, TypeORM, MySQL, Jest, Socket.IO |
| `server/migrations/` | 기존 DB에 적용하는 수동 SQL 패치 | MySQL SQL                                  |
| `docs/`              | 기능 설계와 구현 계획            | Markdown                                   |
| `.github/`           | PR 템플릿, CI, 보안 자동화       | GitHub Actions, Dependabot                 |

루트 `package-lock.json`이 두 npm workspace의 의존성을 함께 고정합니다. 설치 명령은 저장소 루트에서 실행하십시오.

## 요구 사항

- Node.js 20.19 이상 또는 지원되는 Node.js 22.12 이상과 npm.
- MySQL 8.x.
- 개발 서버용 포트 3001과 5173.

## 환경변수

루트 [.env.example](.env.example)은 변수 이름과 비밀이 아닌 기본값만 담습니다. 서버를 실행하기 전에 파일을 `server/.env`로 복사하고 빈 값을 채우십시오.

```powershell
Copy-Item .env.example server/.env
```

| 이름                 | 용도                                  | 필수 여부                                      |
| -------------------- | ------------------------------------- | ---------------------------------------------- |
| `NODE_ENV`           | 실행 환경 구분                        | `start:prod`가 `production`으로 강제           |
| `PORT`               | NestJS 포트                           | 선택, 기본값 3001                              |
| `WEB_ORIGIN`         | HTTP와 WebSocket CORS 허용 origin     | 운영 필수, 개발 기본값 `http://localhost:5173` |
| `DATABASE_HOST`      | MySQL 호스트                          | 필수                                           |
| `DATABASE_PORT`      | MySQL 포트                            | 선택, 기본값 3306                              |
| `DATABASE_USER`      | MySQL 사용자                          | 필수                                           |
| `DATABASE_PASSWORD`  | MySQL 비밀번호                        | 필수                                           |
| `DATABASE_NAME`      | MySQL 데이터베이스                    | 필수                                           |
| `TYPEORM_SYNC`       | 개발용 TypeORM 스키마 동기화          | 선택, 기본값 `false`                           |
| `JWT_SECRET`         | access·refresh JWT 서명 키            | 필수                                           |
| `SERVER_CODE`        | 저장소 밖에서 관리하는 가입 초대 코드 | 필수                                           |
| `ANTHROPIC_API_KEY`  | 번역 API                              | 번역 기능 사용 시 필수                         |
| `GOOGLE_TTS_API_KEY` | Google TTS 생성 API                   | TTS 생성 기능 사용 시 필수                     |
| `TTS_CACHE_DIR`      | 생성한 TTS 파일 보관 경로             | 선택                                           |
| `VITE_API_TARGET`    | Vite 개발 프록시 대상                 | 선택, 기본값 `http://localhost:3001`           |
| `VITE_API_URL`       | 브라우저 API 기준 URL                 | 선택, 기본값 `/`                               |

`VITE_API_TARGET`은 현재 `vite.config.js`가 `process.env`에서 읽습니다. 기본값을 바꿀 때는 Vite 실행 전에 셸 환경변수로 설정하십시오.

```powershell
$env:VITE_API_TARGET='http://localhost:3002'
npm --workspace web run dev
```

브라우저 코드에서 읽는 `VITE_API_URL`은 필요할 때 `web/.env.local`에 둘 수 있습니다. 비밀값은 `VITE_` 변수에 넣지 마십시오. Vite가 해당 값을 브라우저 번들에 포함합니다.

## 설치

```powershell
npm ci
```

`npm ci`는 루트 lockfile을 기준으로 `web`과 `server` workspace를 설치합니다.

## 데이터베이스 준비

MySQL 데이터베이스와 전용 사용자를 만든 뒤 `server/.env`에 접속 정보를 넣으십시오. 이 저장소는 빈 데이터베이스를 재현할 수 있는 초기 마이그레이션을 아직 제공하지 않습니다.

`server/migrations/001_users_nullable_pii.sql`과 `002_dev_accounts_camelcase_rename.sql`은 이미 존재하는 `users` 테이블을 `ALTER` 또는 `UPDATE`하는 패치입니다. 두 파일만 실행해 전체 스키마를 만들 수 없습니다. 적용 전 대상 DB, 백업, 조건, 예상 변경 행을 확인하십시오.

폐기 가능한 로컬 개발 DB에서는 `TYPEORM_SYNC=true`로 엔티티 기반 테이블을 만들 수 있습니다. 운영 모드에서는 애플리케이션이 이 설정을 무시하고 동기화를 끕니다. 운영 배포 전에는 현재 엔티티 전체를 재현하는 검토된 초기 마이그레이션이 필요합니다.

## 개발 실행

터미널 두 개에서 서버와 웹을 각각 실행하십시오.

```powershell
npm --workspace server run start:dev
```

```powershell
npm --workspace web run dev
```

- 웹 UI는 `http://localhost:5173`에서 열립니다.
- API는 `http://localhost:3001`을 사용합니다.

## 테스트와 빌드

```powershell
npm --workspace web test -- --run
npm --workspace web run build
npm --workspace server test -- --runInBand
npm --workspace server run build
```

서버 e2e 테스트는 `AppModule`을 시작하므로 MySQL과 서버 환경변수가 필요합니다. CI는 DB가 없는 환경에서 e2e를 실행하지 않습니다. 로컬 환경을 준비한 경우 다음 명령으로 확인하십시오.

```powershell
npm --workspace server run test:e2e -- --runInBand --forceExit
```

## 보안

- `.env`, JWT 키, 회원가입 코드, DB 자격 증명, 외부 API 키를 커밋하지 마십시오.
- 과거 빠른 로그인에 쓰인 레거시 개발 계정은 인증 경로에서 격리됩니다. 다시 사용하려면 DB 자격 증명을 먼저 회전한 뒤 격리 목록을 검토하십시오.
- 의존성을 바꾼 PR에서는 `npm audit` 결과와 인증·권한·개인정보 영향을 확인하십시오.
- 취약점 세부, 인증정보, 악용 절차를 공개 Issue에 올리지 마십시오.

현재 전용 보안 메일과 GitHub 비공개 취약점 신고 기능은 설정되어 있지 않습니다. 민감한 문제는 저장소 소유자 [@yeunlee1](https://github.com/yeunlee1)에게 GitHub 프로필의 비공개 연락 수단으로 먼저 전달하십시오. 비공개 연락 수단이 없으면 취약점 세부를 제외한 연락 요청만 Issue에 남기십시오.

## 라이선스

이 공개 저장소에는 아직 별도 `LICENSE` 파일이 없습니다. 사용·배포·재배포 권한은 저장소 소유자에게 확인하십시오.
