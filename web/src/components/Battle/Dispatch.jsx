import { useState } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api, formatTime, formatDateTime } from '../../api';

// Dispatch — 발송 타이밍 계산기
export default function Dispatch() {
  const { members } = useStore();
  const { t } = useI18n();

  // 집결원 추가 폼
  const [mName,   setMName]   = useState('');
  const [mNormal, setMNormal] = useState('');
  const [mPet,    setMPet]    = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // 도착 시각 입력 + 계산 결과
  const [arrivalTime, setArrivalTime] = useState('');
  const [results, setResults] = useState(null); // null = 미계산

  // 집결원 추가
  async function handleAddMember() {
    const name          = mName.trim();
    const normalSeconds = parseInt(mNormal, 10);
    const petSeconds    = parseInt(mPet, 10);

    if (!name)                              { alert('이름을 입력해주세요!'); return; }
    if (isNaN(normalSeconds) || normalSeconds < 0) { alert('일반 이동시간을 입력해주세요!'); return; }
    if (isNaN(petSeconds)    || petSeconds < 0)    { alert('펫버프 이동시간을 입력해주세요!'); return; }

    setAddLoading(true);
    try {
      await api.addMember({ name, normalSeconds, petSeconds });
      setMName(''); setMNormal(''); setMPet('');
      setResults(null); // 목록 변경 시 계산 초기화
    } catch (err) {
      console.error('집결원 추가 실패:', err);
      alert('집결원 추가에 실패했습니다.');
    } finally {
      setAddLoading(false);
    }
  }

  // 집결원 삭제
  async function handleDeleteMember(id) {
    await api.deleteMember(id);
    setResults(null);
  }

  // 발송 타이밍 계산
  function handleCalculate() {
    if (members.length === 0) { alert('집결원을 먼저 추가해주세요!'); return; }
    if (!arrivalTime)         { alert('상대 도착 예정 시각을 입력해주세요!'); return; }

    const [hours, mins] = arrivalTime.split(':').map(Number);
    const arrivalDate = new Date();
    arrivalDate.setHours(hours, mins, 0, 0);
    if (arrivalDate < new Date()) arrivalDate.setDate(arrivalDate.getDate() + 1);

    const now = new Date();
    const calculated = members.map((m) => {
      const normalDispatch = new Date(arrivalDate.getTime() - m.normalSeconds * 1000);
      const petDispatch    = new Date(arrivalDate.getTime() - m.petSeconds    * 1000);
      return { ...m, normalDispatch, petDispatch, isPast: normalDispatch < now };
    });

    calculated.sort((a, b) => a.normalDispatch - b.normalDispatch);
    setResults(calculated);
  }

  return (
    <section className="section">
      <h2 className="section-title">{t('dispatchTiming')}</h2>
      <p className="section-desc">{t('dispatchDesc')}</p>

      {/* 집결원 추가 폼 */}
      <div className="input-row">
        <input
          className="input"
          placeholder={t('memberNamePlaceholder')}
          value={mName}
          onChange={(e) => setMName(e.target.value)}
        />
        <input
          className="input input-short"
          type="number"
          min="0"
          placeholder={t('memberNormalPlaceholder')}
          value={mNormal}
          onChange={(e) => setMNormal(e.target.value)}
        />
        <input
          className="input input-short"
          type="number"
          min="0"
          placeholder={t('memberPetPlaceholder')}
          value={mPet}
          onChange={(e) => setMPet(e.target.value)}
        />
        <button className="btn btn-primary" onClick={handleAddMember} disabled={addLoading}>
          {t('memberAddBtn')}
        </button>
      </div>

      {/* 도착 시각 입력 + 계산 버튼 */}
      <div className="input-row" style={{ marginTop: '8px' }}>
        <label className="input-label">{t('arrivalLabel')}</label>
        <input
          className="input input-short"
          type="time"
          value={arrivalTime}
          onChange={(e) => setArrivalTime(e.target.value)}
        />
        <button className="btn btn-primary" onClick={handleCalculate}>
          {t('calcBtn')}
        </button>
      </div>

      {/* 집결원 목록 / 계산 결과 */}
      <div id="dispatch-result">
        {members.length === 0 ? (
          <p className="empty-message">{t('emptyDispatch')}</p>
        ) : results ? (
          // 계산 결과 표시
          results.map((r) => (
            <div key={r.id} className="member-card">
              <div className="member-info">
                <span className="member-name">{r.name}</span>
                <span className="member-times">
                  일반: {formatTime(r.normalSeconds)} / 펫: {formatTime(r.petSeconds)}
                </span>
              </div>
              <div className={`member-dispatch-time${r.isPast ? ' past' : ''}`}>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                  발송 시각
                </div>
                {formatDateTime(r.normalDispatch)}
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400, marginTop: '2px' }}>
                  펫: {formatDateTime(r.petDispatch)}
                </div>
              </div>
              <button className="btn btn-danger" onClick={() => handleDeleteMember(r.id)}>
                {t('delete')}
              </button>
            </div>
          ))
        ) : (
          // 계산 전 — 집결원 목록만 표시
          members.map((m) => (
            <div key={m.id} className="member-card">
              <div className="member-info">
                <span className="member-name">{m.name}</span>
                <span className="member-times">
                  일반: {formatTime(m.normalSeconds)} / 펫: {formatTime(m.petSeconds)}
                </span>
              </div>
              <div className="member-dispatch-time">— —</div>
              <button className="btn btn-danger" onClick={() => handleDeleteMember(m.id)}>
                {t('delete')}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
