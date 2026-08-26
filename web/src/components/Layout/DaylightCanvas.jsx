// 백야(daylight) 테마 전용 배경 캔버스 — 밝은 하늘에 뜬 햇빛 입자와 눈 반짝임을 그린다.
import { useEffect, useRef } from 'react';

/**
 * DaylightCanvas — Daylight(백야) 테마 전용 햇빛 입자 배경.
 *
 * 부모(App.jsx)에서 `theme === 'daylight'` 일 때만 마운트해야 함.
 * 다른 테마 cleanup 보장: theme 전환 시 unmount 되어 raf/리스너 정리됨.
 *
 * frost의 SnowCanvas와 다른 점:
 *  - 아래로 떨어지지 않고 위로 천천히 떠오른다 (설원에 반사된 빛 먼지).
 *  - 입자 색이 흰색+글레이셔 블루라 밝은 배경 위에서 "반짝임"으로 읽힌다.
 *    흰 배경에 흰 점만 찍으면 안 보이므로, 파란 입자를 섞고 alpha를 낮게 유지한다.
 *  - prefers-reduced-motion을 존중한다. reduce면 raf를 아예 돌리지 않고
 *    정지된 한 프레임만 그린다 (배경이 사라지지 않게 하되 움직임은 멈춘다).
 *  - 입자 수를 frost(80/180)보다 적게 잡는다. 라이트 배경에서는 입자가 많으면
 *    지저분해 보이고, Linear 라이트의 절제된 인상과 충돌한다.
 */
export default function DaylightCanvas() {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    let raf = null;
    const motes = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = cv.width = window.innerWidth * dpr;
      h = cv.height = window.innerHeight * dpr;
      cv.style.width = window.innerWidth + 'px';
      cv.style.height = window.innerHeight + 'px';
    }

    function init() {
      motes.length = 0;
      const dpr = window.devicePixelRatio || 1;
      // 모바일 34, 데스크톱 72 — 저사양 부담을 줄이고 라이트 배경의 정갈함을 유지.
      const count = window.innerWidth < 760 ? 34 : 72;
      for (let i = 0; i < count; i++) {
        // 3개 중 1개는 글레이셔 블루 — 흰 배경에서 흰 입자만으로는 보이지 않는다.
        const blue = i % 3 === 0;
        motes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: (0.7 + Math.random() * 1.9) * dpr,
          vy: -(0.10 + Math.random() * 0.32), // 위로 떠오름
          vx: -0.10 + Math.random() * 0.20,
          alpha: blue ? 0.14 + Math.random() * 0.22 : 0.34 + Math.random() * 0.42,
          blue,
          drift: Math.random() * Math.PI * 2,
          driftSpd: 0.004 + Math.random() * 0.012,
          // 반짝임 위상 — 밝기를 사인파로 흔들어 눈결정 반사처럼 보이게 한다.
          twinkle: Math.random() * Math.PI * 2,
          twinkleSpd: 0.01 + Math.random() * 0.03,
        });
      }
    }

    function drawFrame(animate) {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        if (animate) {
          m.drift += m.driftSpd;
          m.twinkle += m.twinkleSpd;
          m.x += m.vx + Math.sin(m.drift) * 0.22;
          m.y += m.vy;
          if (m.y < -4) {
            m.y = h + 4;
            m.x = Math.random() * w;
          }
          if (m.x < -4) m.x = w + 4;
          if (m.x > w + 4) m.x = -4;
        }
        // 정지 상태(reduce)에서는 twinkle을 곱하지 않아 밝기가 고정된다.
        const a = animate ? m.alpha * (0.55 + 0.45 * Math.sin(m.twinkle)) : m.alpha;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = m.blue
          ? 'rgba(43, 127, 217, ' + a + ')'
          : 'rgba(255, 255, 255, ' + a + ')';
        ctx.shadowBlur = m.blue ? 0 : 6;
        ctx.shadowColor = 'rgba(120, 175, 235, 0.55)';
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function tick() {
      drawFrame(true);
      raf = requestAnimationFrame(tick);
    }

    resize();
    init();
    if (reduce) {
      drawFrame(false); // 정지된 한 프레임만 — 배경은 남기고 움직임만 없앤다
    } else {
      tick();
    }

    function onResize() {
      resize();
      init();
      if (reduce) drawFrame(false);
    }
    window.addEventListener('resize', onResize);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className="daylight-canvas" aria-hidden />;
}
