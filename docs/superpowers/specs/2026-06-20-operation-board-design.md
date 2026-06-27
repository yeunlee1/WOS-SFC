# 작전판 실시간 협업 기능 설계

## 목표

작전판은 연맹원이 같은 화면을 보면서 실시간으로 작전을 설명하고 이해할 수 있게 하는 별도 탭이다. 캐치마인드처럼 한 명이 선, 도형, 텍스트, 마커를 배치하면 작전판 탭에 접속한 다른 사용자가 즉시 같은 내용을 본다.

## 사용자 경험

왼쪽 메뉴에 `작전판` 탭을 추가한다. 탭의 중심에는 큰 캔버스가 있고, 상단에는 도구 막대가 있으며, 우측에는 접고 펼칠 수 있는 사이드 패널이 있다.

캔버스 기본 배경은 빈 격자다. `admin`과 `developer`는 이미지 배경을 업로드할 수 있고, 업로드된 이미지는 격자 대신 작전판 배경으로 사용된다. 사용자는 배경 위에 펜 선, 텍스트, 도형, 화살표, 이모티콘 마커를 올릴 수 있다.

우측 패널은 참여자와 채팅을 함께 다룬다. 참여자 섹션에는 현재 작전판 탭을 보고 있는 사용자만 표시한다. 채팅 섹션은 기존 전체 채팅과 같은 메시지를 공유하며, 작전판에서 보낸 메시지도 전체 채팅에 나타난다. 패널을 접으면 캔버스가 넓어지고, 접힌 상태에서 새 메시지가 오면 알림 표시를 보여준다.

## 권한

모든 로그인 사용자는 작전판을 볼 수 있다.

`admin`과 `developer`는 항상 그리기, 배경 업로드, 저장, 이름 변경, 삭제가 가능하다.

일반 사용자는 기본적으로 보기 전용이다. `admin` 또는 `developer`가 작전판 참여자 목록에서 사용자별 `그리기 허용` 토글을 켜면 그 세션 동안만 편집할 수 있다. 토글을 끄면 도구가 즉시 비활성화되고 서버도 이후 그리기 이벤트를 거부한다.

일반 사용자의 그리기 권한은 저장하지 않는다. 사용자가 작전판을 나가거나 소켓 연결이 끊기면 해당 세션 권한은 회수된다. 새 세션에서는 다시 보기 전용으로 시작한다.

서버는 클라이언트 UI 상태를 신뢰하지 않는다. 모든 그리기, 텍스트, 도형, 지우기, 배경 변경, 저장 이벤트에서 서버가 역할과 세션 권한을 다시 검사한다.

## 도구

1차 구현에 포함할 도구는 다음과 같다.

- 펜.
- 텍스트.
- 직선.
- 사각형.
- 원.
- 화살표.
- 이모티콘 또는 마커 스탬프.
- 지우개.
- 전체 지우기.
- 색상 선택.
- 선 굵기 선택.
- 선택 요소 삭제.

도형, 화살표, 텍스트, 마커는 좌표와 스타일을 가진 요소로 저장한다. 펜 선은 point 배열을 가진 path 요소로 저장한다. 지우개는 요소 단위 삭제를 우선하고, 자유형 픽셀 지우기는 1차 범위에서 제외한다.

## 실시간 동기화

작전판은 Socket.IO를 사용한다. 사용자가 작전판 탭에 들어오면 `operation:join`을 보내고, 탭을 벗어나거나 연결이 끊기면 서버가 `operation:leave` 상태로 정리한다.

서버는 현재 작전판 세션 상태를 메모리에 유지한다.

- 현재 보드 ID.
- 현재 요소 목록.
- 현재 배경.
- 작전판 탭 참여자 목록.
- 일반 사용자별 임시 그리기 권한.
- 사용자별 채팅 패널 열림 여부.

주요 실시간 이벤트는 다음과 같다.

- `operation:presence`.
- `operation:permission:update`.
- `operation:element:add`.
- `operation:element:update`.
- `operation:element:remove`.
- `operation:clear`.
- `operation:background:update`.
- `operation:snapshot:saved`.
- `operation:board:loaded`.

늦게 접속한 사용자는 `operation:join` 응답으로 현재 요소 목록, 배경, 권한 상태, 참여자 목록을 받는다.

## 저장

저장은 자동 저장이 아니라 명시적 저장이다. `admin` 또는 `developer`가 저장 버튼을 누르면 그 순간의 작전판 전체 상태를 DB에 저장한다.

저장본에는 다음 데이터가 포함된다.

- 제목.
- 배경 타입.
- 배경 이미지 URL.
- 요소 JSON.
- 생성자.
- 수정자.
- 생성 시각.
- 수정 시각.

저장본 생성, 이름 변경, 삭제는 `admin`과 `developer`만 가능하다. 일반 사용자는 저장본을 볼 수는 있지만 관리할 수 없다.

채팅 내역은 저장본에 포함하지 않는다. 작전판 채팅은 기존 전체 채팅을 공유하는 표시 방식일 뿐이며, 작전판 저장 데이터와 분리한다.

## DB 변경

구현에는 새 저장 테이블이 필요하다.

`operation_boards` 테이블을 추가한다.

- `id`.
- `title`.
- `backgroundType`.
- `backgroundImageUrl`.
- `elementsJson`.
- `createdByUserId`.
- `createdByNick`.
- `updatedByUserId`.
- `updatedByNick`.
- `createdAt`.
- `updatedAt`.

일반 사용자 세션 권한과 현재 참여자 목록은 DB에 저장하지 않는다. 이 데이터는 서버 메모리 상태로 관리한다.

이미지 배경 파일은 기존 업로드 정책과 맞춰 `uploads/operation-boards` 아래에 저장한다. 허용 MIME은 `image/jpeg`, `image/png`, `image/webp`로 제한한다.

## 프론트엔드 구성

새 컴포넌트 구조는 다음처럼 분리한다.

- `OperationBoardTab`.
- `OperationBoardCanvas`.
- `OperationBoardToolbar`.
- `OperationBoardSidePanel`.
- `OperationBoardParticipants`.
- `OperationBoardChatPanel`.
- `OperationBoardSavedList`.
- `operationBoardStore`.
- `operationBoardSocket`.

캔버스는 SVG 기반 편집 레이어로 구현한다. 펜 선은 SVG path, 직선과 화살표는 line과 marker, 사각형은 rect, 원은 ellipse, 텍스트와 이모티콘 마커는 SVG text 요소로 표현한다. 배경 격자와 배경 이미지는 SVG 아래쪽 레이어에 배치한다.

## 백엔드 구성

백엔드는 새 모듈을 추가한다.

- `OperationBoardsModule`.
- `OperationBoardsController`.
- `OperationBoardsService`.
- `OperationBoard` entity.
- `OperationBoardsGateway` 또는 기존 realtime gateway의 작전판 이벤트 확장.

REST API는 저장본 목록, 단일 저장본 조회, 저장, 이름 변경, 삭제, 배경 이미지 업로드를 담당한다. Socket.IO gateway는 실시간 참여자, 권한, 요소 변경 이벤트를 담당한다.

## 보안과 제한

배경 이미지 업로드는 파일 크기와 MIME을 제한한다. 저장 요소 JSON은 최대 크기를 제한해 과도한 payload를 막는다. Socket.IO 그리기 이벤트는 rate limit을 적용한다.

모든 쓰기 API와 쓰기 이벤트는 역할을 검사한다. 일반 사용자의 그리기 이벤트는 세션 권한이 있을 때만 허용한다. 저장, 삭제, 이름 변경, 배경 업로드는 `admin`과 `developer`만 허용한다.

## 테스트

서버 테스트는 권한 검증, 저장본 CRUD, 이미지 업로드 제한, 세션 권한 부여와 회수, 권한 없는 그리기 이벤트 거부를 포함한다.

프론트 테스트는 작전판 탭 렌더링, 도구 선택, 권한에 따른 도구 비활성화, 참여자 목록 표시, 채팅 토글, 저장 버튼 노출 조건을 포함한다.

수동 검증은 두 브라우저 세션을 열어 실시간 그리기, 권한 부여와 회수, 작전판 탭 참여자 목록, 채팅 공유, 저장본 불러오기를 확인한다.

## 제외 범위

1차에서는 자유형 픽셀 지우기, 버전 히스토리, 저장본별 채팅 보관, 권한 로그, 복잡한 레이어 패널, 다중 작전방 동시 운영을 제외한다.

다중 작전방은 저장본을 불러오는 단일 현재 작전판 모델이 안정화된 뒤 확장한다.
