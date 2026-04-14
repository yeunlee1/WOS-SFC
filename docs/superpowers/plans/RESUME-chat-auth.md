# 이어서 할 작업 — 카운트다운 TTS 언어팩

**브랜치**: `master`
**최근 커밋**: `b0ee72d fix: online.js ALLIANCE_COLORS 누락 정의 추가`

---

## ✅ 완료된 작업

- Firebase → NestJS+MySQL+Socket.io 전환 (PR #3 머지)
- 채팅 자동번역 (서버 DB 캐시 방식)
- 실시간 공유 카운트다운 + 언어별 TTS
- 개발용 빠른 로그인 버튼 (관리자 4개국)
- online.js ALLIANCE_COLORS 누락 버그 수정

---

## 🔧 진행 중 — Windows TTS 언어팩 설치

카운트다운 TTS가 한국어 음성만 설치되어 있어서 영어/중국어/일본어는 안 읽힘.

### 설치 방법
Windows 설정 → 시간 및 언어 → 언어 및 지역 → 언어 추가:
- English (United States)
- 中文(中国)
- 日本語

각 언어 → 언어 옵션 → **텍스트 음성 변환 다운로드**

### 설치 확인
앱 재시작 후 DevTools 콘솔:
```js
speechSynthesis.getVoices().map(v => v.lang + ' ' + v.name)
```
4개 이상 나오면 완료.

---

## 📋 다음 작업 후보

- [ ] 카운트다운 TTS 언어별 동작 최종 검증
- [ ] 전투 기능 추가 (사용자가 결정 예정)
- [ ] 웹앱/모바일 전환 여부 결정 (논의 중)
