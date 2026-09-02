# syntax=docker/dockerfile:1

# 역할 — NestJS 서버와 Vite 로 빌드한 웹 정적 파일을 하나의 실행 이미지로 묶는 멀티스테이지 빌드.
#
# 왜 컨테이너가 하나인가
#   server/src/app.module.ts 의 ServeStaticModule 이
#   rootPath = join(__dirname, '..', '..', 'web', 'dist') 로 웹 빌드를 직접 서빙한다.
#   컴파일된 app.module.js 는 /app/server/dist 에 놓이므로 그 경로는 /app/web/dist 가 된다.
#   즉 웹을 별도 컨테이너나 프록시로 서빙할 필요가 없고, 앱과 API 가 같은 origin 을 쓴다.
#   (web/src/api/index.js 의 VITE_API_URL 기본값이 '/' 라 같은 origin 전제와 맞는다.)
#
# 네이티브 모듈 bcrypt 함정을 어떻게 처리했는가 — 아래는 저장소를 직접 열어 확인한 사실이다.
#   - 운영 의존성 중 네이티브 모듈은 bcrypt@6.0.0 하나뿐이다.
#     (node_modules 전체에서 build/Release/*.node 는 0건, prebuilds/ 를 가진 패키지도 bcrypt 뿐.
#      루트 package.json 의 allowScripts 에 함께 적힌 unrs-resolver 는
#      `npm ls unrs-resolver --omit=dev` 가 비어 있어 devDependency 전용이다 — 최종 이미지에 없다.)
#   - bcrypt 6 은 node-addon-api(N-API) 기반이고
#     prebuilds/linux-x64 와 prebuilds/linux-arm64 각각에
#     bcrypt.glibc.node 와 bcrypt.musl.node 가 둘 다 들어 있다.
#     따라서 실제 위험은 "Node 메이저 버전 불일치"보다 "libc·CPU 아키텍처 불일치"와
#     "호스트 node_modules 를 그대로 복사해 넣는 것"이다.
#   그래서 세 가지로 막는다.
#     1) 모든 스테이지가 ARG NODE_VERSION 하나를 공유한다 — 같은 Debian(glibc) 베이스,
#        같은 Node 버전이 강제된다. Alpine(musl)과 절대 섞이지 않는다.
#     2) 호스트 node_modules 는 .dockerignore 로 차단하고 이미지 안에서 npm ci 를 새로 돌린다.
#        운영 의존성을 설치하는 deps 스테이지가 최종 이미지와 같은 베이스를 쓰므로
#        복사해 넣는 node_modules 의 플랫폼이 실행 환경과 항상 일치한다.
#     3) prebuild 가 없는 플랫폼에서는 node-gyp-build 가 소스 컴파일로 넘어가므로
#        설치 스테이지에만 python3/make/g++ 를 둔다. 최종 이미지에는 남지 않는다.
#
# Node 버전은 루트 package.json 의 engines("^20.19.0 || >=22.12.0")를 따른다.
# 기본값 22 는 >=22.12.0 쪽을 만족한다. 20 계열로 맞추려면
#   docker build --build-arg NODE_VERSION=20.19-bookworm-slim .
# 처럼 넘긴다(20.18 이하는 engines 를 만족하지 않는다).
ARG NODE_VERSION=22-bookworm-slim


# ---------------------------------------------------------------------------
# 1) deps — 최종 이미지에 넣을 운영 의존성만 설치한다.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# prebuild 가 없는 플랫폼에서만 쓰이는 컴파일 도구. 이 스테이지 밖으로 나가지 않는다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# npm workspaces(web, server) 구성이라 루트 lockfile 과 두 workspace 의 package.json 이
# 모두 있어야 npm ci 가 성립한다.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --omit=dev


# ---------------------------------------------------------------------------
# 2) builder — devDependencies 까지 설치해 서버와 웹을 빌드한다.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci

COPY . .

# 루트 build 스크립트 = server(nest build → server/dist) 다음 web(vite build → web/dist).
# nest build 는 tsconfig.build.json 을 쓰고 그 파일이 test 와 *.spec.ts 를 제외하므로
# 산출물이 dist/ 바로 아래에 평평하게 떨어진다(dist/production.js, dist/app.module.js).
# server/package.json 의 start:prod 가 `node dist/production` 인 것과 같은 전제다.
RUN npm run build


# ---------------------------------------------------------------------------
# 3) runner — 실행 이미지. 빌드 도구도 devDependencies 도 없다.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# TTS_CACHE_DIR 을 여기서 못 박는 이유 —
# server/src/tts/tts.service.ts 는 TTS_CACHE_DIR 이 비면
# path.resolve(path.join(process.cwd(), 'tts-cache')) 로 떨어진다.
# 그러면 캐시 위치가 작업 디렉터리에 따라 달라져 볼륨 마운트 지점과 어긋날 수 있다.
ENV NODE_ENV=production \
    PORT=3001 \
    TTS_CACHE_DIR=/app/server/tts-cache

# deps 스테이지의 /app 전체(node_modules, 루트/워크스페이스 package.json, lockfile)를 가져온다.
# 워크스페이스 심볼릭 링크까지 함께 와야 하므로 node_modules 만 따로 집지 않는다.
COPY --from=deps /app/ ./

# 빌드 산출물
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# 마이그레이션 SQL 과 기동 스크립트
COPY server/migrations ./server/migrations
COPY deploy/entrypoint.sh deploy/wait-for-db.js ./deploy/

# 저장소를 Windows 에서 관리하므로 셸 스크립트에 CRLF 가 섞이면
# `#!/bin/sh^M` 이 되어 exec 이 실패한다. 줄끝을 강제로 정리한다.
RUN sed -i 's/\r$//' ./deploy/entrypoint.sh \
 && chmod +x ./deploy/entrypoint.sh

# 쓰기가 일어나는 두 경로만 비루트 사용자 소유로 만든다.
# 이름 있는 볼륨은 처음 붙을 때 이미지 쪽 디렉터리의 소유권을 그대로 물려받으므로
# 여기서 미리 node 소유로 만들어 두어야 컨테이너가 볼륨에 쓸 수 있다.
#   - /app/uploads        : server/src/storage-paths.ts 의 UPLOAD_ROOT.
#                           UPLOAD_ROOT = join(__dirname,'..','..','uploads') 이고
#                           storage-paths.js 가 /app/server/dist 에 놓이므로 /app/uploads 다.
#   - /app/server/tts-cache : 위 TTS_CACHE_DIR.
RUN mkdir -p /app/uploads /app/server/tts-cache \
 && chown node:node /app/uploads /app/server/tts-cache

USER node

# process.cwd() 가 /app/server 가 되어 server/package.json 의 스크립트를
# `npm run <이름>` 으로 바로 부를 수 있다(마이그레이션 실행에 필요).
WORKDIR /app/server

EXPOSE 3001

# /time 은 DB 를 건드리지 않고 즉시 응답하는 라우트라 "HTTP 서버가 살아 있는가"만 본다.
# DB 연결까지 보증하지는 않는다 — 저장소에 DB 를 확인하는 헬스 라우트가 없다.
# @Throttle 로 분당 90회 제한이 걸려 있으나 15초 간격이면 분당 4회라 여유가 크다.
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/time').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["node", "dist/production.js"]
