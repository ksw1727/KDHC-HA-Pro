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

export interface SheetMeta { name: string; state: 'visible' | 'hidden' | 'veryHidden'; rows: number }
export interface DumpOptions {
  /** 옛 방식(moa read-excel): 이 줄 수를 넘으면 자른다 */
  maxLines?: number;
  /** AI로 보낼 때: 글자 수 한도. 넘으면 반복되는 자료 행부터 줄여 한도 안에 맞춘다 (오류를 내지 않는다) */
  maxChars?: number;
  /** 이 시트만 요약한다 (없으면 모든 시트) */
  sheets?: string[];
  /** 요약 맨 위에 덧붙일 안내 (예: .xls를 바꿔 읽음) */
  notes?: string[];
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? decodeXml(m[1]) : undefined; };

interface SheetEntry { name: string; state: SheetMeta['state']; path?: string }
/** workbook.xml + rels: 시트 이름·숨김·XML 경로 */
async function sheetEntries(zip: JSZip): Promise<SheetEntry[]> {
  const wbXml = await zip.file('xl/workbook.xml')?.async('string');
  if (!wbXml) throw new Error('엑셀 시트 목록을 찾지 못했어요');
  const relsXml = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'); const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const out: SheetEntry[] = [];
  for (const m of wbXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name'); if (!name) continue;
    const st = attr(m[0], 'state');
    const rid = /\s(?:\w+:)?id="([^"]*)"/.exec(m[0])?.[1];
    out.push({ name, state: st === 'hidden' || st === 'veryHidden' ? st : 'visible', path: rid ? targets.get(rid) : undefined });
  }
  return out;
}

/** 시트 이름·숨김 여부·대략 행 수만 빠르게 읽는다 (셀 값은 읽지 않는다). 시트 고르기 화면용 */
export async function listSheets(bytes: Uint8Array): Promise<SheetMeta[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: SheetMeta[] = [];
  for (const { name, state, path } of await sheetEntries(zip)) {
    let rows = 0;
    const xml = path ? await zip.file(path)?.async('string') : undefined;
    if (xml) {
      const dim = /<(?:\w+:)?dimension\b[^>]*\sref="[A-Z]+(\d+)(?::[A-Z]+(\d+))?"/.exec(xml);
      rows = dim ? Number(dim[2] ?? dim[1]) : (xml.match(/<(?:\w+:)?row\b/g)?.length ?? 0);
    }
    out.push({ name, state, rows });
  }
  return out;
}

/** 아주 긴 시트는 앞 HEAD_ROWS행과 끝 TAIL_ROWS행만 읽는다 (요약에는 어차피 앞 몇 행과 마지막 행만 들어간다) */
export const HEAD_ROWS = 2000;
export const TAIL_ROWS = 20;
/** AI 요약용으로 가볍게: 그림·첨부 개체 내용은 비우고(개수는 남는다), 아주 긴 시트는 가운데 행을 덜어 낸다 */
export async function slimWorkbook(bytes: Uint8Array): Promise<{ bytes: Uint8Array; trimmed: Map<string, number> }> {
  const zip = await JSZip.loadAsync(bytes);
  let changed = false;
  for (const [path, f] of Object.entries(zip.files)) {
    if (!f.dir && /^xl\/(media|embeddings)\//.test(path)) { zip.file(path, new Uint8Array()); changed = true; }
  }
  const trimmed = new Map<string, number>();
  for (const { name, path } of await sheetEntries(zip)) {
    const xml = path ? await zip.file(path)?.async('string') : undefined;
    if (!xml || !path) continue;
    const a = xml.indexOf('<sheetData'); const end = xml.lastIndexOf('</sheetData>');
    if (a < 0 || end < 0) continue;
    const starts: number[] = [];
    for (let i = xml.indexOf('<row', a); i !== -1 && i < end; i = xml.indexOf('<row', i + 4)) if (' >/'.includes(xml[i + 4])) starts.push(i);
    if (starts.length <= HEAD_ROWS + TAIL_ROWS + 500) continue;
    zip.file(path, xml.slice(0, starts[HEAD_ROWS]) + xml.slice(starts[starts.length - TAIL_ROWS]));
    trimmed.set(name, starts.length);
    changed = true;
  }
  return { bytes: changed ? await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }) : bytes, trimmed };
}

interface RowLine { r: number; cells: string[]; sig: string }
interface SheetDump { name: string; head: string[]; rows: RowLine[] }
interface Level { keep: number; textMax: number; cellMax: number }
/** 한도를 넘으면 차례로 더 줄인다: 반복 자료 행을 앞 keep행만, 긴 글자는 textMax자까지, 한 줄 칸은 cellMax개까지 */
const LEVELS: Level[] = [
  { keep: Infinity, textMax: 200, cellMax: Infinity },
  { keep: 30, textMax: 200, cellMax: 80 },
  { keep: 15, textMax: 200, cellMax: 80 },
  { keep: 5, textMax: 200, cellMax: 80 },
  { keep: 3, textMax: 60, cellMax: 50 },
  { keep: 2, textMax: 30, cellMax: 40 },
  { keep: 1, textMax: 16, cellMax: 30 },
];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…(${s.length}자)` : s);

/**
 * 한 줄에서 이어지는 빈 칸을 묶는다: `I5="" [빈 칸] | J5="" [빈 칸] | … Z5` → `I5~Z5="" [빈 칸, 18칸]`.
 * 계획·실적 표처럼 빈 입력 칸이 많은 양식은 요약의 대부분이 빈 칸이라, 이것만으로 몇 배 짧아진다.
 * 표시(굵게·채움 등)가 같은 빈 칸끼리만 묶는다. 3칸 이상일 때만.
 */
export function packBlanks(cells: string[]): string[] {
  const out: string[] = [];
  const blank = (c: string) => /^([A-Z]{1,3}\d+)="" \[([^\]]*빈 칸[^\]]*)\]$/.exec(c);
  for (let i = 0; i < cells.length;) {
    const a = blank(cells[i]);
    let j = i + 1;
    if (a) while (j < cells.length && blank(cells[j])?.[2] === a[2]) j++;
    if (a && j - i >= 3) { out.push(`${a[1]}~${blank(cells[j - 1])![1]}="" [${a[2]}, ${j - i}칸]`); i = j; }
    else { out.push(cells[i]); i++; }
  }
  return out;
}

function renderSheet(d: SheetDump, lv: Level): { lines: string[]; skipped: number } {
  const lines = [...d.head];
  const row = (x: RowLine) => { const cs = packBlanks(x.cells); return `${x.r}행: ${cs.slice(0, lv.cellMax).map((c) => clip(c, lv.textMax + 12)).join(' | ')}${cs.length > lv.cellMax ? ` | … 외 ${cs.length - lv.cellMax}칸` : ''}`; };
  let skipped = 0;
  for (let i = 0; i < d.rows.length;) {
    let j = i + 1;
    while (j < d.rows.length && d.rows[j].sig === d.rows[i].sig) j++;
    const run = d.rows.slice(i, j);
    if (run.length > lv.keep + 2) {
      run.slice(0, lv.keep).forEach((x) => lines.push(row(x)));
      const mid = run.slice(lv.keep, -1);
      lines.push(`… ${mid[0].r}~${mid.at(-1)!.r}행 ${mid.length}행 생략 (위·아래 행과 같은 칸 구성, 값만 다름)`);
      lines.push(row(run.at(-1)!));
      skipped += mid.length;
    } else run.forEach((x) => lines.push(row(x)));
    i = j;
  }
  return { lines, skipped };
}

export async function dumpExcel(bytes: Uint8Array, opts: number | DumpOptions = 400): Promise<{ text: string; findings: ExcelFindings }> {
  const o: DumpOptions = typeof opts === 'number' ? { maxLines: opts } : opts;
  const maxLines = o.maxChars ? Infinity : (o.maxLines ?? 400);
  // AI로 보낼 때는 그림을 비우고 아주 긴 시트를 덜어 내 브라우저 메모리를 아낀다
  let trimmed = new Map<string, number>();
  if (o.maxChars) ({ bytes, trimmed } = await slimWorkbook(bytes));
  const zip = await JSZip.loadAsync(bytes);
  const macros = !!zip.file('xl/vbaProject.bin');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const all = wb.worksheets;
  if (o.sheets) {
    const missing = o.sheets.filter((n) => !all.some((ws) => ws.name === n));
    if (missing.length) throw new Error(`이 파일에 없는 시트예요: ${missing.join(', ')}`);
    if (!o.sheets.length) throw new Error('요약할 시트를 하나 이상 골라 주세요');
  }
  const picked = o.sheets ? all.filter((ws) => o.sheets!.includes(ws.name)) : all;
  const f: ExcelFindings = { macros, sheets: all.length, crossSheetFormulas: [], unknownFunctions: [], conditionalFormats: 0, images: 0 };
  const dumps: SheetDump[] = [];
  const unknown = new Set<string>();
  let lineCount = 0;
  let cutAt = '';

  for (const ws of picked) {
    const imgs = ws.getImages().length;
    const cf = (ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings?.length ?? 0;
    f.images += imgs;
    f.conditionalFormats += cf;
    const merges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    const head: string[] = [];
    head.push(`\n## 시트 "${ws.name}"${ws.state !== 'visible' ? ` (${ws.state === 'veryHidden' ? '완전 숨김' : '숨김'})` : ''} · ${ws.rowCount}행 × ${ws.columnCount}열`);
    if (merges.length) head.push(`병합: ${merges.slice(0, 40).join(', ')}${merges.length > 40 ? ` … ${merges.length - 40}개 더` : ''}`);
    if (trimmed.has(ws.name)) head.push(`행이 많아(약 ${trimmed.get(ws.name)!.toLocaleString()}행) 앞 ${HEAD_ROWS.toLocaleString()}행과 끝 ${TAIL_ROWS}행만 읽었어요. 가운데 행은 같은 구성의 자료로 보고 건너뛰었어요.`);
    if (cf) head.push(`조건부 서식: ${cf}개`);
    if (imgs) head.push(`그림·도형: ${imgs}개`);
    const dv = (ws as unknown as { dataValidations?: { model?: Record<string, ExcelJS.DataValidation> } }).dataValidations?.model ?? {};
    const dvs = Object.entries(dv);
    if (dvs.length) {
      head.push('입력 규칙:');
      // 같은 규칙은 한 줄로 묶는다 (예: C22 … C51 (30칸): list "안전모,…")
      const fmt = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x));
      const groups = new Map<string, string[]>();
      for (const [addr, r] of dvs) {
        const rule = `${r.type}${r.formulae?.length ? ` ${r.formulae.map(fmt).join(' ~ ')}` : ''}${r.allowBlank === false ? ' (빈칸 불가)' : ''}`;
        groups.set(rule, [...(groups.get(rule) ?? []), addr]);
      }
      for (const [rule, addrs] of [...groups].slice(0, 30)) head.push(`  ${addrs.length > 3 ? `${addrs[0]} … ${addrs.at(-1)} (${addrs.length}칸)` : addrs.join(', ')}: ${rule}`);
    }
    const d: SheetDump = { name: ws.name, head, rows: [] };
    lineCount += head.length;
    // 칸: 값이 있거나, 비었지만 채우기 색·테두리가 있는 칸(입력 칸 후보)
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (lineCount > maxLines) return;
      const cells: string[] = [];
      const shape: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        // 병합된 칸의 나머지 칸은 첫 칸 값을 되풀이할 뿐이라 적지 않는다 (병합 범위는 위에 따로 적는다)
        if (cell.isMerged && cell.master !== cell) return;
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
        // 같은 칸 구성인지: 어느 열에 칸이 있고 굵게·채움·수식 모양이 같은지 (값은 보지 않는다)
        shape.push(`${c}${cell.font?.bold ? 'b' : ''}${fill || ''}${formula ? `=${formula.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (_, col, n) => `${col}${Number(n) - r}`)}` : ''}${note ? 'n' : ''}`);
      });
      if (cells.length) { d.rows.push({ r, cells, sig: shape.join(',') }); lineCount++; }
    });
    dumps.push(d);
    if (lineCount > maxLines) { cutAt = `… (너무 길어 ${o.maxLines}줄까지만 보여요)`; break; }
  }
  f.unknownFunctions = [...unknown];

  const others = all.filter((ws) => !picked.includes(ws));
  const head = [
    `# 엑셀 파일 요약`,
    ...(o.notes ?? []),
    `시트 ${f.sheets}장${f.macros ? ' · 매크로 있음(.xlsm)' : ''}${f.images ? ` · 그림 ${f.images}개` : ''}${f.conditionalFormats ? ` · 조건부 서식 ${f.conditionalFormats}개` : ''}`,
    others.length ? `사용자가 고른 시트만 담았어요: ${picked.map((ws) => `"${ws.name}"`).join(', ')} (담지 않은 시트 ${others.length}장: ${others.slice(0, 20).map((ws) => `"${ws.name}"`).join(', ')}${others.length > 20 ? ' …' : ''})` : '',
    f.crossSheetFormulas.length ? `다른 시트를 참조하는 수식: ${f.crossSheetFormulas.slice(0, 10).join(', ')}${f.crossSheetFormulas.length > 10 ? ' …' : ''}` : '',
    f.unknownFunctions.length ? `한난MOA 계산식에 없는 함수: ${f.unknownFunctions.join(', ')}` : '',
    `칸 표기: 주소="값" [굵게, 채움#색, 빈 칸(테두리만), 잠금 해제] (메모). 이어지는 빈 칸은 I5~Z5="" [빈 칸, 18칸]처럼 묶어 적어요(그 사이 모든 칸이 같은 빈 칸)`,
  ].filter(Boolean);

  // 옛 방식: 줄 수로만 자른다
  if (!o.maxChars) {
    const lines = dumps.flatMap((d) => renderSheet(d, LEVELS[0]).lines);
    if (cutAt) lines.push(cutAt);
    return { text: [...head, ...lines].join('\n'), findings: f };
  }

  // 글자 한도: 덜 줄인 단계부터 해 보고, 맞는 첫 단계를 쓴다
  const max = o.maxChars;
  const size = (ls: string[]) => ls.reduce((n, l) => n + l.length + 1, 0);
  for (const [i, lv] of LEVELS.entries()) {
    const parts = dumps.map((d) => renderSheet(d, lv));
    const note = i === 0 ? [] : [`줄인 방법: 같은 칸 구성이 이어지는 자료 행은 앞 ${lv.keep}행과 마지막 행만 적고 나머지는 '…행 생략'으로 줄였어요. 머리글·입력 칸·규칙·병합은 그대로예요.`];
    const text = [...head, ...note, ...parts.flatMap((p) => p.lines)].join('\n');
    if (text.length <= max || i === LEVELS.length - 1) {
      if (text.length <= max) return { text, findings: f };
      // 마지막 단계로도 넘치면: 시트마다 공평하게 나눠 뒤쪽 줄을 자른다 (자른 곳을 적어 AI가 알게 한다)
      const tail = '\n주의: 요약 한도 때문에 일부 시트의 뒤쪽 행을 담지 못했어요. 양식을 만들 때 이 점을 사용자에게 알려 주세요.';
      let budget = max - size([...head, ...note]) - tail.length - 50;
      const order = parts.map((p, k) => ({ k, len: size(p.lines) })).sort((a, b) => a.len - b.len);
      const kept: string[][] = parts.map(() => []);
      order.forEach(({ k }, n) => {
        const share = Math.floor(budget / (order.length - n));
        const out: string[] = []; let used = 0;
        for (const l of parts[k].lines) {
          if (used + l.length + 1 > share - 60) break;
          out.push(l); used += l.length + 1;
        }
        if (out.length < parts[k].lines.length) {
          const lastRow = /^(\d+)행:/.exec(out.at(-1) ?? '')?.[1];
          const msg = out.length ? `… (요약 한도 때문에 ${lastRow ? `${lastRow}행 뒤로는` : '이 아래는'} 담지 못했어요)` : `\n## 시트 "${dumps[k].name}" (요약 한도 때문에 담지 못했어요)`;
          out.push(msg); used += msg.length + 1;
        }
        kept[k] = out; budget -= used;
      });
      let cut = [...head, ...note, ...kept.flat()].join('\n') + tail;
      if (cut.length > max) cut = `${cut.slice(0, max - tail.length - 2)}…${tail}`;
      return { text: cut, findings: f };
    }
  }
  throw new Error('unreachable');
}
