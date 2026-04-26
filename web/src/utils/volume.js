// volume.js — 슬라이더 선형 값을 인간 청각에 맞는 amp로 변환
//
// 인간 청각은 로그 스케일이라 amp 0.5는 50% 음량으로 들리지 않고 거의 80~90%처럼
// 들린다. 선형 슬라이더(1~100)를 amp(0~1)로 그대로 매핑하면 1%로 내려도 -40 dB라
// 여전히 또렷하게 들리고, 50%면 -6 dB로 100%와 체감 거의 같다.
//
// cubic(^3) 매핑으로 perceptual 스케일에 가깝게 보정:
//   slider   1%  →  amp 0.000001  (-120 dB, 사실상 무음)
//   slider  10%  →  amp 0.001     ( -60 dB, 매우 작음)
//   slider  50%  →  amp 0.125     ( -18 dB, 적당히 작음)
//   slider 100%  →  amp 1.0       (   0 dB, 원본)

/** 슬라이더 선형 값(0~1)을 perceptual amp(0~1)로 변환 */
export function perceptualVolume(linear) {
  const v = Math.max(0, Math.min(1, Number(linear) || 0));
  return v * v * v;
}
