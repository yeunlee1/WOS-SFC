import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api, formatTime, playBeep } from '../../api';

// RallyTimer — 실시간 집결 타이머 (최대 6개)
export default function RallyTimer() {
  const { rallies, timeOffset } = useStore();
  const { t } = useI18n();

  // Map<id, { remainMs, ratio }>
  const [tickMap, setTickMap] = useState(new Map());

  // 종료 알림 발송 여부 추적 (메모리 내)
  const alertedRef = useRef(new Set());

  // 입력 폼 상태
  const [name, setName]     = useState('');
  const [minutes, setMin]   = useState('');
  const [seconds, setSec]   = useState('');
  const [loading, setLoading] = useState(false);

  // 200ms interval — 모든 집결의 남은 시간 갱신
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now() + timeOffset;
      const next = new Map();

      rallies.forEach((r) => {
        const remainMs = r.endTimeUTC - now;
        const ratio    = remainMs / (r.totalSeconds * 1000);
        next.set(r.id, { remainMs, ratio });

        // 종료 비프음 (한 번만)
        if (remainMs <= 0 && !alertedRef.current.has(r.id)) {
          alertedRef.current.add(r.id);
          playBeep(1000, 300);
          setTimeout(() => playBeep(1000, 300), 400);
          setTimeout(() => playBeep(1200, 500), 800);
        }
      });

      setTickMap(next);
    }, 200);

    return () => clearInterval(id);
  }, [rallies, timeOffset]);

  // 집결 추가
  async function handleAdd() {
    if (rallies.length >= 6) {
      alert('최대 6개까지만 추적할 수 있어요!');
      return;
    }
    const totalSeconds = (parseInt(minutes) || 0) * 60 + (parseInt(seconds) || 0);
    if (totalSeconds <= 0) { alert('시간을 입력해주세요!'); return; }

    const rallyName  = name.trim() || '집결';
    const endTimeUTC = Date.now() + timeOffset + totalSeconds * 1000;

    setLoading(true);
    try {
      await api.addRally({ name: rallyName, endTimeUTC, totalSeconds });
      setName(''); setMin(''); setSec('');
    } finally {
      setLoading(false);
    }
  }

  // 집결 삭제
  async function handleDelete(id) {
    await api.deleteRally(id);
    alertedRef.current.delete(id);
  }

  // 활성 집결만 표시 (3초 여유)
  const now = Date.now() + timeOffset;
  const active = rallies.filter((r) => r.endTimeUTC > now - 3000);

  return (
    <section className="section">
      <h2 className="section-title">{t('rallyTimer')}</h2>
      <p className="section-desc">{t('rallyTimerDesc')}</p>

      {/* 입력 폼 */}
      <div className="input-row">
        <input
          className="input"
          placeholder={t('rallyNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <input
          className="input input-short"
          type="number"
          min="0"
          placeholder={t('rallyMinPlaceholder')}
          value={minutes}
          onChange={(e) => setMin(e.target.value)}
        />
        <input
          className="input input-short"
          type="number"
          min="0"
          placeholder={t('rallySecPlaceholder')}
          value={seconds}
          onChange={(e) => setSec(e.target.value)}
        />
        <button className="btn btn-primary" onClick={handleAdd} disabled={loading}>
          {t('rallyAdd')}
        </button>
      </div>

      {/* 집결 카드 목록 */}
      <div id="rally-list">
        {active.length === 0 ? (
          <p className="empty-message">{t('emptyRally')}</p>
        ) : (
          active.map((r) => {
            const tick     = tickMap.get(r.id) ?? { remainMs: r.endTimeUTC - now, ratio: 1 };
            const remainMs = tick.remainMs;
            const ratio    = tick.ratio;
            const remainSec = Math.max(0, Math.floor(remainMs / 1000));
            const finished  = remainMs <= 0;

            const cardClass    = finished || ratio < 0.2 ? 'rally-card danger'
                               : ratio < 0.5             ? 'rally-card warning'
                               :                           'rally-card';
            const countClass   = finished || ratio < 0.2 ? 'rally-countdown danger'
                               : ratio < 0.5             ? 'rally-countdown warning'
                               :                           'rally-countdown';
            const barClass     = finished || ratio < 0.2 ? 'rally-progress-bar danger'
                               : ratio < 0.5             ? 'rally-progress-bar warning'
                               :                           'rally-progress-bar';
            const barWidth     = `${Math.min(100, Math.max(0, ratio * 100))}%`;

            return (
              <div key={r.id} className={cardClass}>
                <div className="rally-card-header">
                  <span className="rally-name">{r.name}</span>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(r.id)}
                  >
                    {t('delete')}
                  </button>
                </div>
                <div className={countClass}>
                  {finished ? '도착!' : formatTime(remainSec)}
                </div>
                <div className="rally-progress">
                  <div className={barClass} style={{ width: barWidth }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
