import type { Mark, Role } from './sheetModel';

export interface RoleStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;            // pt
  color?: string;           // 글자색 (#RRGGBB)
  fill?: string;            // 배경색
  align?: 'left' | 'center' | 'right';
  border: boolean;
  locked: boolean;          // 시트 보호 시 잠금 여부
}

/** role별 스타일 하나의 표. 생성 미리보기·빈 양식·같은 틀 시트가 공유한다 (02-generator.md 4절). */
export const ROLE_STYLES: Record<Role, RoleStyle> = {
  title:          { bold: true, size: 14, border: false, locked: true },
  guide:          { size: 10, color: '#6B7480', border: false, locked: true },
  label:          { bold: true, fill: '#EEF2F7', border: true, locked: true },
  header:         { bold: true, fill: '#EEF2F7', align: 'center', border: true, locked: true },
  input:          { fill: '#FFFFFF', border: true, locked: false },
  example:        { italic: true, color: '#9AA3AE', border: true, locked: false },
  fixed:          { border: true, locked: true },
  'locked-value': { color: '#8A95A2', border: true, locked: true },
  'row-number':   { color: '#8A95A2', align: 'center', border: true, locked: true },
  'auto-header':  { bold: true, fill: '#CFEADF', color: '#0F6E56', align: 'center', border: true, locked: true },
  'auto-value':   { fill: '#E5F4EE', color: '#0F6E56', border: true, locked: true },
  calc:           { fill: '#F3F7FD', color: '#174A96', border: true, locked: true },   // 계산 칸 (엑셀 수식)
  'other-input':  { fill: '#EDEFF2', color: '#A0A8B3', border: true, locked: true },   // 빈칸채우기: 다른 제출처 칸
};

/** 필수 칸 강조 */
export const REQUIRED_INPUT_FILL = '#FFF5D1';
export const REQUIRED_HEADER_FILL = '#E3EBFA';

/** aggregate 표시 */
export const MARK_STYLES: Record<Mark, Partial<RoleStyle> & { strike?: boolean }> = {
  'auto-fixed': { fill: '#DCEBFB' },
  error: { fill: '#FFF2B3' },
  muted: { color: '#A0A8B3' },
  strike: { strike: true },
};

export const BORDER_COLOR = '#D9DFE7';

/** 한 칸의 최종 스타일 (role + 필수 + 표시). */
export function cellStyle(role: Role, required?: boolean, mark?: Mark): RoleStyle & { strike?: boolean } {
  const base: RoleStyle & { strike?: boolean } = { ...ROLE_STYLES[role] };
  if (required && role === 'input') base.fill = REQUIRED_INPUT_FILL;
  if (required && role === 'header') base.fill = REQUIRED_HEADER_FILL;
  if (mark) Object.assign(base, MARK_STYLES[mark]);
  return base;
}
