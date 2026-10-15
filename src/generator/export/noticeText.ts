import type { FormSchema } from '@contract/schema';
import { orgLabel } from '@contract/schema';

/** 내보내기 완료 화면의 "지사에 보낼 안내문" 기본 문구 (02-generator.md 2.6 ③) */
export function noticeText(s: FormSchema): string {
  const m = s.deadline ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.deadline) : null;
  const due = m ? `${Number(m[2])}월 ${Number(m[3])}일까지 ` : '';
  const parts = [`[${s.title || '양식'}] 첨부 파일을 작성해 ${due}회신 부탁드립니다.`, 'MS Excel 또는 한셀로 작성해 주세요.'];
  if (s.layout === 'collect') parts.push('보고서 시트에 자유롭게 작성해 주세요.');
  else parts.push('노란 칸은 꼭 채워 주시고, 칸 이름과 순서는 바꾸지 말아 주세요.', '참고 사항은 칸에 엑셀 메모로 달아 주시고, 계산이 필요하면 새 시트를 추가해 써 주세요.');
  if (s.org.mode === 'preset') parts.push(`파일에 ${orgLabel(s)}명이 미리 들어 있으니 자기 ${orgLabel(s)} 파일을 써 주세요.`);
  if (s.contact?.trim()) parts.push(`문의: ${s.contact.trim()}`);
  return parts.join(' ');
}
