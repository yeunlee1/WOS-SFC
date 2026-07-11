<!-- PR 본문 자동 채워짐. 항목을 비워도 머지는 가능하지만 가능한 한 채울 것. -->

## Summary

<!-- 1~3 문장으로 무엇을 / 왜 변경했는지 -->

## 변경 사항

<!-- 핵심 파일 + 변경 내용 -->

-

## Test plan

<!-- 검증 방법 체크리스트 -->

- [ ] `cd web && npm test -- --run` (Vitest 통과)
- [ ] `cd web && npm run build` (빌드 통과)
- [ ] `cd server && npm test -- --runInBand` (Jest 단위 테스트 통과)
- [ ] `cd server && npm run build` (빌드 통과)
- [ ] 선택 사항. 로컬 MySQL과 테스트 환경변수를 준비한 경우 `cd server && npm run test:e2e -- --runInBand --forceExit`
- [ ] 수동 확인 (해당 시)

## 보안·의존성 영향

<!-- 해당 없음도 확인한 뒤 체크 -->

- [ ] `npm audit` 결과를 확인했거나 의존성 변경이 없음
- [ ] 인증, 권한, 개인정보, 파일 업로드, CORS, 외부 API 영향을 검토했거나 해당 없음
- [ ] 비밀값이 코드, 로그, 문서, 테스트 데이터에 포함되지 않음

## 영향 범위

<!-- 어떤 페이지 / 기능에 영향? 회귀 가능성? -->

-

## 관련

<!-- 이슈/PR 링크, Phase, 디자인 레퍼런스 등 -->

-
