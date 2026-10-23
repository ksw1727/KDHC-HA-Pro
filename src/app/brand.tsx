import slogan from '../assets/brand/slogan-ko.png';

/**
 * 한국지역난방공사 브랜드 슬로건 (슬로건 디자인 가이드라인 1.01 워드마크 원본).
 * 가이드라인 4.06: 흰 바탕·아주 연한 바탕에만 둔다. 색·비율을 바꾸지 않는다.
 */
export const SLOGAN_ALT = '깨끗한 에너지로 세상을 따뜻하게';
export function Slogan({ height, className }: { height?: number; className?: string }) {
  return <img src={slogan} alt={SLOGAN_ALT} style={height ? { height } : undefined} className={'block w-auto select-none ' + (className ?? '')} draggable={false} />;
}

/** 녹색 → 흰색 → 빨강 물결 (가이드라인 표지의 곡선 모티브) */
export function Swoosh({ h }: { h: number }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 1200 ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`swoosh-${h}`} x1="0" x2="1">
          <stop offset="0" stopColor="#37a137" stopOpacity=".22" />
          <stop offset=".5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#ed1c29" stopOpacity=".2" />
        </linearGradient>
      </defs>
      <path d={`M0 ${h * 0.75} C 300 ${h * 0.1}, 700 ${h * 1.1}, 1200 ${h * 0.3} L1200 ${h} L0 ${h} Z`} fill={`url(#swoosh-${h})`} />
    </svg>
  );
}
