// useReadyProbe.js — 서버의 ready 협상 probe 응답 hook.
//
// 서버 ReadyNegotiationService가 카운트다운 시작 시 모든 클라이언트에 'time:probe'
// emit → 본 hook이 즉시 ack { t: Date.now() } 응답. 서버는 모든 ack의 RTT를
// 측정해 startedAt을 미래로 결정 → 모든 디바이스 동시 TTS 발화.
//
// 모듈 분리: 협상 로직은 서버 측에 격리, 클라이언트는 단순 응답만 책임.

import { useEffect } from 'react';
import { connectSocket } from '../api';

export function useReadyProbe(user) {
  useEffect(() => {
    if (!user) return;
    const socket = connectSocket();

    const handler = (_msg, ack) => {
      if (typeof ack === 'function') {
        try {
          ack({ t: Date.now() });
        } catch {
          // ack 호출 실패 (이미 응답 등) — 무시
        }
      }
    };

    socket.on('time:probe', handler);
    return () => {
      socket.off('time:probe', handler);
    };
  }, [user]);
}
