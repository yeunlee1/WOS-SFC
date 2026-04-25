// timeSync.js — clockSync.js의 thin wrapper (백워드 호환용)
//
// 신규 코드는 './clockSync'에서 직접 import 권장 (특히 getServerNow / startup / shutdown).
// 본 파일은 기존 import 경로 (`syncTime`, `startPeriodicSync`, `stopPeriodicSync`)를
// 그대로 작동시키기 위해 유지된다.

export { syncTime, startPeriodicSync, stopPeriodicSync } from './clockSync';
