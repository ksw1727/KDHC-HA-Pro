/**
 * 쓰던 엑셀 양식을 AI가 읽을 글로 바꾼다 (moa read-excel, AI로 만들기 · 쓰던 엑셀 올리기).
 * 칸 값·수식·병합·입력 규칙·채우기 색·메모와, 한난MOA로 옮기기 어려운 것(매크로·조건부 서식·그림·시트 참조·지원하지 않는 함수)을 함께 적는다.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/** 한난MOA 계산식이 아는 함수 (contract/formula). 나머지는 "옮길 수 없는 함수"로 알린다 */
const KNOWN_FN = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNTA', 'COUNT', 'ROUND', 'IF', 'IFERROR']);

export interface ExcelFindings {
  macros: boolean;
  sheets: number;
  crossSheetFormulas: string[];   // 다른 시트를 참조하는 수식 (주소)
  unknownFunctions: string[];     // 한난MOA 계산식에 없는 함수 이름
  conditionalFormats: number;
  images: number;
}

const colName = (n: number) => { let s = ''; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return text(v.result as ExcelJS.CellValue);
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(v);
}

export async function dumpExcel(bytes: Uint8Array, maxLines = 400): Promise<{ text: string; findings: ExcelFindings }> {
  const zip = await JSZip.loadAsync(bytes);
  const macros = !!zip.file('xl/vbaProject.bin');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const f: ExcelFindings = { macros, sheets: wb.worksheets.length, crossSheetFormulas: [], unknownFunctions: [], conditionalFormats: 0, images: 0 };
  const lines: string[] = [];
  const unknown = new Set<string>();

  for (const ws of wb.worksheets) {
    const imgs = ws.getImages().length;
    const cf = (ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings?.length ?? 0;
    f.images += imgs;
    f.conditionalFormats += cf;
    const merges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    lines.push(`\n## 시트 "${ws.name}"${ws.state !== 'visible' ? ` (${ws.state === 'veryHidden' ? '완전 숨김' : '숨김'})` : ''} · ${ws.rowCount}행 × ${ws.columnCount}열`);
    if (merges.length) lines.push(`병합: ${merges.slice(0, 40).join(', ')}${merges.length > 40 ? ` … ${merges.length - 40}개 더` : ''}`);
    if (cf) lines.push(`조건부 서식: ${cf}개`);
    if (imgs) lines.push(`그림·도형: ${imgs}개`);
    const dv = (ws as unknown as { dataValidations?: { model?: Record<string, ExcelJS.DataValidation> } }).dataValidations?.model ?? {};
    const dvs = Object.entries(dv);
    if (dvs.length) {
      lines.push('입력 규칙:');
      // 같은 규칙은 한 줄로 묶는다 (예: C22 … C51 (30칸): list "안전모,…")
      const fmt = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x));
      const groups = new Map<string, string[]>();
      for (const [addr, r] of dvs) {
        const rule = `${r.type}${r.formulae?.length ? ` ${r.formulae.map(fmt).join(' ~ ')}` : ''}${r.allowBlank === false ? ' (빈칸 불가)' : ''}`;
        groups.set(rule, [...(groups.get(rule) ?? []), addr]);
      }
      for (const [rule, addrs] of [...groups].slice(0, 30)) lines.push(`  ${addrs.length > 3 ? `${addrs[0]} … ${addrs.at(-1)} (${addrs.length}칸)` : addrs.join(', ')}: ${rule}`);
    }
    // 칸: 값이 있거나, 비었지만 채우기 색·테두리가 있는 칸(입력 칸 후보)
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (lines.length > maxLines) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = text(cell.value);
        const formula = typeof cell.value === 'object' && cell.value && 'formula' in cell.value ? String((cell.value as { formula: string }).formula) : '';
        const fill = cell.fill?.type === 'pattern' && (cell.fill as ExcelJS.FillPattern).fgColor?.argb;
        const border = !!(cell.border && (cell.border.top || cell.border.bottom || cell.border.left || cell.border.right));
        const note = cell.note ? (typeof cell.note === 'string' ? cell.note : (cell.note.texts ?? []).map((t) => t.text).join('')) : '';
        if (!v && !formula && !fill && !note && !border) return;
        if (formula) {
          if (/!/.test(formula)) f.crossSheetFormulas.push(`${ws.name}!${colName(c)}${r}`);
          for (const m of formula.matchAll(/([A-Z][A-Z0-9.]*)\s*\(/g)) if (!KNOWN_FN.has(m[1])) unknown.add(m[1]);
        }
        const tags = [
          cell.font?.bold ? '굵게' : '',
          fill && fill !== 'FFFFFFFF' ? `채움#${fill.slice(2)}` : '',
          border && !v && !formula ? '빈 칸' : '',
          cell.protection?.locked === false ? '잠금 해제' : '',
        ].filter(Boolean);
        cells.push(`${colName(c)}${r}=${formula ? `=${formula}${v ? ` → ${v}` : ''}` : JSON.stringify(v)}${tags.length ? ` [${tags.join(',')}]` : ''}${note ? ` (메모: ${note.slice(0, 60)})` : ''}`);
      });
      if (cells.length) lines.push(`${r}행: ${cells.join(' | ')}`);
    });
    if (lines.length > maxLines) { lines.push(`… (너무 길어 ${maxLines}줄까지만 보여요)`); break; }
  }
  f.unknownFunctions = [...unknown];

  const head = [
    `# 엑셀 파일 요약`,
    `시트 ${f.sheets}장${f.macros ? ' · 매크로 있음(.xlsm)' : ''}${f.images ? ` · 그림 ${f.images}개` : ''}${f.conditionalFormats ? ` · 조건부 서식 ${f.conditionalFormats}개` : ''}`,
    f.crossSheetFormulas.length ? `다른 시트를 참조하는 수식: ${f.crossSheetFormulas.slice(0, 10).join(', ')}${f.crossSheetFormulas.length > 10 ? ' …' : ''}` : '',
    f.unknownFunctions.length ? `한난MOA 계산식에 없는 함수: ${f.unknownFunctions.join(', ')}` : '',
    `칸 표기: 주소="값" [굵게, 채움#색, 빈 칸(테두리만), 잠금 해제] (메모)`,
  ].filter(Boolean);
  return { text: [...head, ...lines].join('\n'), findings: f };
}
