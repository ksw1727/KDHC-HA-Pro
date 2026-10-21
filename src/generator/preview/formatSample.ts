import type { Field } from '@contract/schema';
import { DATE_EXAMPLE, PATTERN_INFO } from '@contract/fieldTypes';

/** 숫자를 서식(쉼표·소수·단위)대로 글자로. 엑셀 numFmt와 같은 결과를 화면에서 보여주기 위함. */
/** 정리 안내에 쓰는 '아무렇게나 들어온 값' 예시 (패턴마다 다름. 사업자번호에 휴대폰 번호가 나오던 것) */
const RAW_EXAMPLE: Record<'phone' | 'mobile' | 'bizno', string> & Record<string, string> = { phone: '0212345678', mobile: '01012345678', bizno: '1234567891' };

export function formatNumber(n: number, field: Pick<Field, 'decimals' | 'thousands' | 'unit'>): string {
  const d = Math.max(0, Math.min(4, field.decimals ?? 0));
  const s = n.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    useGrouping: field.thousands !== false,
  });
  return s + (field.unit?.trim() ?? '');
}

function sampleNumber(field: Field): number {
  const unit = field.unit?.trim();
  let n = unit === '원' ? 120000 : unit === '%' ? 12.5 : 1000;
  if (field.max != null && n > field.max) n = field.max;
  if (field.min != null && n < field.min) n = field.min;
  return n;
}

/** 미리보기·서식 패널에 보여줄 예시 값. 같은 항목이면 늘 같은 값. */
export function formatSample(field: Field, index = 0): string {
  switch (field.type) {
    case 'number':
      return formatNumber(sampleNumber(field) * (index === 0 ? 1 : 1 + index * 0.25), field);
    case 'date':
      return DATE_EXAMPLE[field.dateFormat ?? 'yyyy-mm-dd'];
    case 'select':
      return field.options?.[index % Math.max(1, field.options.length)] ?? '';
    case 'pattern':
      return field.pattern ? PATTERN_INFO[field.pattern].example : '';
    case 'memo':
      return '여러 줄 메모';
    case 'calc':
      return formatNumber(1234.5, field);
    case 'text': {
      if (/이름|성명/.test(field.label)) return ['김민수', '이서연', '박지훈'][index % 3];
      if (/담당/.test(field.label)) return ['홍길동', '정다은', '윤성호'][index % 3];
      return '예시';
    }
  }
}

/** 서식 옆에 보여줄 "취합할 때 이렇게 정리돼요" 한 줄 (01-contract.md 5절 표 기반). */
export function normalizeHint(field: Field): string {
  switch (field.type) {
    case 'number':
      return `취합할 때 "₩1000", "1,000${field.unit?.trim() || '개'}"처럼 들어와도 숫자 1000으로 정리돼요.`;
    case 'date':
      return `"2026.11.1", "11월 1일"처럼 들어와도 ${DATE_EXAMPLE[field.dateFormat ?? 'yyyy-mm-dd']} 형식으로 정리돼요.`;
    case 'select':
      return '엑셀에서 드롭다운으로 보여요. 목록에 없는 값은 취합할 때 확인을 요청해요.';
    case 'pattern':
      return field.pattern === 'email'
        ? '앞뒤 공백과 대문자 도메인은 취합할 때 자동으로 정리돼요.'
        : `"${RAW_EXAMPLE[field.pattern ?? 'mobile']}"처럼 들어와도 ${field.pattern ? PATTERN_INFO[field.pattern].example : ''} 모양으로 정리돼요.`;
    case 'calc':
      return '계산 칸은 잠겨 있고 엑셀이 자동으로 계산해요. 취합본에서는 합친 값으로 다시 계산해요(비율처럼 더하면 틀리는 값도 맞게).';
    default:
      return '앞뒤 공백은 취합할 때 자동으로 정리돼요.';
  }
}
