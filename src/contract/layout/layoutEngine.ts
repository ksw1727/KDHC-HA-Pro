import type { DataValidation } from 'exceljs';
import type { Block, Field, FieldsBlock, FormSchema, GridBlock, ListBlock, MatrixBlock } from '../schema';
import { gridOwners, orgLabel, sameOrg } from '../schema';
import type { CellMap, CellValue, FieldsBlockMap, GridBlockMap, ListBlockMap, MatrixBlockMap } from '../meta';
import { FIELD_TYPES } from '../fieldTypes';
import { parseFormula, printFormula, toExcel, type Node, type RefResolver } from '../formula/formula';
import { computeGrid, computeListRow, computeMatrix, computeSpareRow } from '../formula/compute';
import { gridNames, TOTAL_COL_NAME, TOTAL_ROW_NAME } from '../formula/context';
import { addr, colLetter, parseAddr, range } from './address';
import { freeRegions, freeSize, freeTop } from '../free';
import type { AggregateFill, LayoutInput, ModelCell, SheetModel } from './sheetModel';

/**
 * 같은 틀 레이아웃 엔진 (01-contract.md 7절). 순수 함수.
 * 빈 양식(template)과 취합본 첫 시트(aggregate)를 같은 규칙으로 배치한다.
 * 상대 날짜 입력 규칙 때문에 today를 받는다(기본값 없음 → 호출하는 쪽이 정함).
 */
export function layoutSheet(schema: FormSchema, input: LayoutInput, opts: { today: Date }): SheetModel {
  return new Layouter(schema, input, opts.today).run();
}

const FORBIDDEN_SHEET = /[\\/?*[\]:]/g;

/**
 * 엑셀 시트 이름 규칙: 31자 이하, 금지 문자 → '_'. 비면 '양식'.
 * 작은따옴표(')는 ’로 바꾼다: 엑셀은 '로 시작·끝나는 이름을 막고, ExcelJS는 인쇄 영역 이름에서 '를 이스케이프하지 않아 파일이 깨진다.
 */
export function sheetNameOf(title: string): string {
  const s = title.replace(FORBIDDEN_SHEET, '_').replace(/'/g, '’').trim().slice(0, 31);
  return s || '양식';
}

const asCell = (v: CellValue | undefined): string | number | undefined => (v === null || v === undefined || v === '' ? undefined : v);

/** 글자 폭 대략 계산 (한글 2, 나머지 1). 열 너비 정하는 데 쓴다. */
function textWidth(v: unknown): number {
  const s = String(v ?? '');
  let w = 0;
  for (const ch of s) w += /[ㄱ-힝]/.test(ch) ? 2 : 1;
  return w;
}

function infoLine(schema: FormSchema): string {
  const parts: string[] = [];
  if (schema.guide?.trim()) parts.push(schema.guide.trim());
  if (schema.deadline) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schema.deadline);
    parts.push(m ? `제출 기한 ${Number(m[2])}월 ${Number(m[3])}일` : `제출 기한 ${schema.deadline}`);
  }
  if (schema.contact?.trim()) parts.push(`문의 ${schema.contact.trim()}`);
  return parts.join(' · ');
}

const headerText = (f: Field) => (f.required ? `${f.label} *` : f.label);
const abs = (a: string) => a.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');

class Layouter {
  private cells = new Map<string, ModelCell>();
  private merges: string[] = [];
  private validations: { address: string; rule: DataValidation }[] = [];
  private cellMap: CellMap = { printArea: '', blocks: {} };
  private freeze?: { row: number };
  private lastInputRow = 0;
  /** 모든 블록을 놓은 뒤에 넣는 수식 (다른 블록 위치가 필요해서) */
  private jobs: (() => void)[] = [];
  private headerAddr = new Map<string, string>();
  private listGeom?: { first: number; last: number; cols: Map<string, string> };
  private parsed = new Map<string, Node | null>();
  private readonly agg?: AggregateFill;
  private readonly lastCol: number;

  constructor(private schema: FormSchema, private input: LayoutInput, private today: Date) {
    this.agg = input.mode === 'aggregate' ? input.data : undefined;
    this.lastCol = this.computeLastCol();
  }

  private get isTemplate() { return this.input.mode === 'template'; }
  private get autoCount() { return this.agg?.autoColumns.length ?? 0; }

  private put(cell: ModelCell) {
    this.cells.set(cell.address, cell);
    const row = Number(/\d+$/.exec(cell.address)![0]);
    if (cell.role === 'input' || cell.role === 'example' || cell.role === 'auto-value' || cell.role === 'row-number' || cell.formula || cell.role === 'fixed' || cell.role === 'calc' || cell.role === 'other-input')
      this.lastInputRow = Math.max(this.lastInputRow, row);
  }

  private node(f: Field): Node | null {
    const src = f.formula ?? '';
    if (!this.parsed.has(src)) {
      try { this.parsed.set(src, parseFormula(src)); } catch { this.parsed.set(src, null); }
    }
    return this.parsed.get(src)!;
  }

  /** 계산 칸에 엑셀 수식 넣기. 식이 잘못됐으면 "(계산식 확인)" */
  private setFormula(address: string, f: Field, resolve: RefResolver) {
    const cell = this.cells.get(address);
    if (!cell) return;
    const n = this.node(f);
    try {
      if (!n) throw new Error();
      cell.formula = toExcel(n, resolve);
      cell.note = `계산: ${printFormula(n)}`;
    } catch {
      delete cell.formula;
      cell.value = '(계산식 확인)';
      cell.mark = 'error';
    }
  }

  /** 목록·위쪽 정보에서 이름 → 주소 (같은 줄 r, 여러 값 함수 안이면 열 전체) */
  private listResolver(r: number | null): RefResolver {
    return (name, agg) => {
      const g = this.listGeom;
      const col = g?.cols.get(name);
      if (col && g) return agg || r === null ? `${col}${g.first}:${col}${g.last}` : `${col}${r}`;
      const h = this.headerAddr.get(name);
      return h ? abs(h) : undefined;
    };
  }

  private merge(c1: number, r: number, c2: number) {
    if (c2 > c1) this.merges.push(range(c1, r, c2, r));
  }

  private validate(address: string, field: Field) {
    if (!this.isTemplate) return;
    const rule = FIELD_TYPES[field.type].excelValidation(field, this.today);
    if (rule) this.validations.push({ address, rule });
  }

  /** 블록이 필요로 하는 열 수 (자동 칸 포함). */
  private blockWidth(b: Block): number {
    switch (b.kind) {
      case 'fields': return 2;
      case 'list': return 1 + b.columns.length + this.autoCount;
      case 'matrix': return 1 + b.colLabels.length + (b.totalCol ? 1 : 0) + (b.calcCols?.length ?? 0);
      case 'grid': return b.colLabels.length + (this.agg && b.spareRows > 0 ? this.autoCount : 0);
    }
  }

  private computeLastCol(): number {
    return Math.max(this.blocksLastCol(), ...Object.values(this.agg?.stackedBy ?? {}).map((s) => s.columns.length));
  }

  private blocksLastCol(): number {
    if (this.schema.layout === 'free') {
      // 판 열 수 + (취합본이면) 입력 줄 영역 오른쪽 자동 칸
      const list = freeRegions(this.schema).find((r) => r.kind === 'list');
      return Math.max(5, freeSize(this.schema).cols, list ? list.c2 + this.autoCount : 0);
    }
    if (this.schema.layout === 'collect') {
      const w = Math.max(0, ...(this.schema.collect?.starter ?? []).map((r) => r.length));
      return Math.max(5, w);
    }
    return Math.max(2, ...this.schema.blocks.map((b) => this.blockWidth(b)));
  }

  run(): SheetModel {
    if (this.schema.layout === 'collect') return this.runCollect();

    const { schema } = this;
    const last = this.lastCol;
    let row = this.putHeader(last);
    if (schema.layout === 'free') {
      this.placeFree(freeTop(schema));
    } else {
      schema.blocks.forEach((b, i) => {
        if (i > 0) row += 1; // 블록 사이 빈 행
        if (b.title?.trim()) {
          this.put({ address: addr(1, row), value: b.title.trim(), role: 'label' });
          this.merge(1, row, last);
          row += 1;
        }
        row = this.placeBlock(b, row);
      });
    }

    for (const job of this.jobs) job();
    this.placeStacked(this.lastInputRow + 2);

    const printArea = range(1, 1, last, Math.max(this.lastInputRow, 2));
    this.cellMap.printArea = printArea;

    return {
      sheetName: sheetNameOf(schema.title),
      columns: this.columnWidths(),
      cells: [...this.cells.values()].sort(cellOrder),
      merges: this.merges,
      validations: this.validations,
      printArea,
      freeze: this.freeze,
      cellMap: this.cellMap,
    };
  }

  /**
   * 취합 결과 맨 아래: 합계·대표값 하나로 뭉쳐진 자리(숫자 표, 여러 곳이 겹친 빈칸채우기)의 원래 내용을
   * 제출처별로 한 줄씩 그대로 쌓는다. 합계는 위에 그대로 두고, 그 아래에 내용이 남는다.
   */
  private placeStacked(row: number) {
    for (const s of Object.values(this.agg?.stackedBy ?? {})) {
      this.put({ address: addr(1, row), value: s.title, role: 'label' });
      this.merge(1, row, this.lastCol);
      row += 1;
      s.columns.forEach((c, i) => this.put({ address: addr(1 + i, row), value: c.header, role: 'auto-header' }));
      row += 1;
      for (const r of s.rows) {
        s.columns.forEach((c, i) => this.put({
          address: addr(1 + i, row), value: asCell(r[i]), role: 'auto-value',
          numFmt: c.field && c.field.type !== 'calc' ? FIELD_TYPES[c.field.type].excelNumFmt(c.field) : undefined,
        }));
        row += 1;
      }
      row += 1;   // 블록 사이 빈 행
    }
  }

  /** 1행 제목, 2행 정보칸, 4행 제출처 줄. 블록을 놓기 시작할 행을 돌려준다 */
  private putHeader(last: number): number {
    const { schema } = this;
    // 1행 제목, 2행 정보칸
    this.put({ address: 'A1', value: schema.title, role: 'title' });
    this.merge(1, 1, last);
    const info = this.input.mode === 'aggregate' ? this.input.info : infoLine(schema);
    this.put({ address: 'A2', value: info || undefined, role: 'guide', wrap: true });
    this.merge(1, 2, last);

    // 4행 제출처 줄
    let row = 4;
    if (schema.org.mode !== 'none') {
      const shared = this.input.mode === 'template' && !!this.input.shared;
      this.put({ address: 'A4', value: `${orgLabel(schema)}명`, role: 'label', required: schema.org.mode === 'input' || shared });
      if (this.input.mode === 'aggregate') {
        // 줄이 없는 양식(숫자 표·빈칸채우기)은 위 칸이 합계·대표값이라, 제출처별 내용이 어디 있는지 알린다
        const rows = schema.blocks.some((b) => b.kind === 'list' || (b.kind === 'grid' && b.spareRows > 0));
        const stacked = Object.keys(this.agg?.stackedBy ?? {}).length > 0;
        const lbl = orgLabel(schema);
        const above = schema.blocks.some((b) => b.kind === 'matrix') ? '합계' : '한 곳 값';
        this.put({ address: 'B4', value: rows ? '(줄별 자동 칸 참고)' : stacked ? `(위는 ${above} · 아래 ${lbl}별 줄 참고)` : '(적어 낸 곳은 칸 메모 참고)', role: 'input', mark: 'muted' });
      } else if (schema.org.mode === 'preset' && !shared) {
        this.put({ address: 'B4', value: this.input.orgName ?? schema.org.orgs?.[0], role: 'locked-value' });
      } else {
        this.put({ address: 'B4', role: 'input', required: true });
        const orgs = schema.org.orgs ?? [];
        if (orgs.length) {
          this.validations.push({
            address: 'B4',
            rule: {
              type: 'list', allowBlank: false, formulae: [`"${orgs.join(',')}"`],
              showErrorMessage: true, errorStyle: 'stop', errorTitle: '입력 형식 확인',
              error: `${orgLabel(schema)}명: 목록에서 고르세요`,
            },
          });
        }
      }
      this.merge(2, 4, last);
      this.cellMap.orgCell = 'B4';
      row = 6;
    }
    return row;
  }

  /**
   * 자유 제작형 (01-contract.md 3.2절): 판 A1을 top행 A열에 놓고, 글자 칸·합친 칸·입력 영역을 그대로 옮긴다.
   * 입력 칸은 fields 블록 지도에, 입력 줄 영역·숫자 표는 기존 블록 배치(위치만 다름)로 그린다.
   */
  private placeFree(top: number) {
    const { schema } = this;
    const free = schema.free!;
    const at = (a: string) => { const p = parseAddr(a); return { row: top + p.row - 1, col: p.col }; };
    const regions = freeRegions(schema);
    const hasList = regions.some((r) => r.kind === 'list');
    for (const [a, v] of Object.entries(free.texts)) {
      const p = at(a);
      if (v !== '') this.put({ address: addr(p.col, p.row), value: v, role: 'label' });
    }
    for (const m of free.merges) {
      const [a, b = a] = m.split(':');
      const p = at(a);
      const q = at(b);
      if (q.col > p.col || q.row > p.row) this.merges.push(range(p.col, p.row, q.col, q.row));
    }
    for (const b of schema.blocks) {
      if (b.kind === 'fields') {
        const map: FieldsBlockMap = { kind: 'fields', cells: {} };
        for (const f of b.fields) {
          const p = at(free.places[f.key]);
          const valueCell = addr(p.col, p.row);
          // 이름이 적힌 칸: 왼쪽 글자 칸, 없으면 위쪽 글자 칸, 둘 다 없으면 값 칸
          const left = p.col > 1 ? this.cells.get(addr(p.col - 1, p.row)) : undefined;
          const up = p.row > top ? this.cells.get(addr(p.col, p.row - 1)) : undefined;
          const labelCell = left?.role === 'label' ? left.address : up?.role === 'label' ? up.address : valueCell;
          this.headerAddr.set(f.label.trim(), valueCell);
          if (this.isTemplate && f.type === 'calc') {
            this.put({ address: valueCell, role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(f), fieldKey: f.key });
            this.jobs.push(() => this.setFormula(valueCell, f, this.listResolver(null)));
          } else if (this.isTemplate) {
            this.put({ address: valueCell, role: 'input', required: f.required, numFmt: FIELD_TYPES[f.type].excelNumFmt(f), wrap: f.type === 'memo', fieldKey: f.key });
            this.validate(valueCell, f);
          } else {
            const label = schema.org.mode === 'none' ? '파일' : orgLabel(schema);
            this.put({ address: valueCell, value: hasList ? '(줄별 자동 칸 참고)' : `(${label}별 시트 참고)`, role: 'input', mark: 'muted', fieldKey: f.key });
          }
          map.cells[f.key] = { labelCell, valueCell };
        }
        this.cellMap.blocks[b.id] = map;
      } else if (b.kind === 'list') {
        const p = at(free.places[b.id]);
        this.placeList(b, p.row, p.col, false);
      } else if (b.kind === 'matrix') {
        const p = at(free.places[b.id]);
        this.placeMatrix(b, p.row, p.col);
      }
    }
    // 인쇄영역이 판 끝까지 오도록
    this.lastInputRow = Math.max(this.lastInputRow, top + freeSize(schema).rows - 1);
  }

  /** 블록을 row부터 배치하고 다음 빈 행 번호를 돌려준다. */
  private placeBlock(b: Block, row: number): number {
    switch (b.kind) {
      case 'fields': return this.placeFields(b, row);
      case 'list': return this.placeList(b, row, 2, true);
      case 'matrix': return this.placeMatrix(b, row, 1);
      case 'grid': return this.placeGrid(b, row);
    }
  }

  private placeFields(b: FieldsBlock, row: number): number {
    const map: FieldsBlockMap = { kind: 'fields', cells: {} };
    for (const f of b.fields) {
      const labelCell = addr(1, row);
      const valueCell = addr(2, row);
      this.put({ address: labelCell, value: f.label, role: 'label', required: f.required, fieldKey: f.key });
      this.headerAddr.set(f.label.trim(), valueCell);
      if (this.isTemplate && f.type === 'calc') {
        this.put({ address: valueCell, role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(f), fieldKey: f.key });
        this.jobs.push(() => this.setFormula(valueCell, f, this.listResolver(null)));
      } else if (this.isTemplate) {
        this.put({ address: valueCell, role: 'input', required: f.required, numFmt: FIELD_TYPES[f.type].excelNumFmt(f), wrap: f.type === 'memo', fieldKey: f.key });
        this.validate(valueCell, f);
      } else {
        this.put({ address: valueCell, value: '(줄별 자동 칸 참고)', role: 'input', mark: 'muted', fieldKey: f.key });
      }
      this.merge(2, row, this.lastCol);
      map.cells[f.key] = { labelCell, valueCell };
      row += 1;
    }
    this.cellMap.blocks[b.id] = map;
    return row;
  }

  /** c0 = 첫 항목 열. numbered면 c0 왼쪽 열에 번호를 넣는다(자유 제작형은 번호 없음) */
  private placeList(b: ListBlock, row: number, c0: number, numbered: boolean): number {
    const headerRow = row;
    const map: ListBlockMap = { kind: 'list', headerRow, firstDataRow: 0, lastDataRow: 0, columns: {} };
    if (numbered) this.put({ address: addr(c0 - 1, headerRow), value: '번호', role: 'header' });
    b.columns.forEach((f, i) => {
      const col = c0 + i;
      this.put({ address: addr(col, headerRow), value: headerText(f), role: 'header', required: f.required, fieldKey: f.key });
      map.columns[f.key] = colLetter(col);
    });
    const autoStart = c0 + b.columns.length;
    this.agg?.autoColumns.forEach((name, i) => this.put({ address: addr(autoStart + i, headerRow), value: name, role: 'auto-header' }));
    if (numbered) this.freeze = { row: headerRow };

    let r = headerRow + 1;
    if (this.isTemplate && b.exampleRow) {
      map.exampleRow = r;
      if (numbered) this.put({ address: addr(c0 - 1, r), value: '예시', role: 'row-number' });
      // 예시 줄의 계산 칸은 예시 값으로 계산해 보여 준다
      const ex = b.columns.some((f) => f.type === 'calc') ? computeListRow(b, { ...b.exampleRow }) : b.exampleRow ?? {};
      b.columns.forEach((f, i) => this.put({ address: addr(c0 + i, r), value: asCell(ex[f.key]), role: 'example', numFmt: FIELD_TYPES[f.type].excelNumFmt(f), fieldKey: f.key }));
      r += 1;
    }
    map.firstDataRow = r;
    const cols = new Map(b.columns.map((f, i) => [f.label.trim(), colLetter(c0 + i)]));

    if (this.isTemplate) {
      for (let n = 1; n <= b.maxRows; n++, r++) {
        if (numbered) this.put({ address: addr(c0 - 1, r), value: n, role: 'row-number' });
        b.columns.forEach((f, i) => {
          const a = addr(c0 + i, r);
          if (f.type === 'calc') {
            this.put({ address: a, role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(f), fieldKey: f.key });
            const rr = r;
            this.jobs.push(() => this.setFormula(a, f, this.listResolver(rr)));
          } else {
            this.put({ address: a, role: 'input', required: f.required, numFmt: FIELD_TYPES[f.type].excelNumFmt(f), wrap: f.type === 'memo', fieldKey: f.key });
          }
        });
      }
      map.lastDataRow = r - 1;
      this.listGeom = { first: map.firstDataRow, last: map.lastDataRow, cols };
      b.columns.forEach((f, i) => f.type !== 'calc' && this.validate(range(c0 + i, map.firstDataRow, c0 + i, map.lastDataRow), f));
    } else {
      const rows = this.agg?.rows ?? [];
      rows.forEach((rec, n) => {
        const rowMark = rec.strike ? 'strike' : rec.muted ? 'muted' : undefined;
        if (numbered) this.put({ address: addr(c0 - 1, r), value: n + 1, role: 'row-number', mark: rowMark });
        // 계산 칸 값이 없으면 같은 줄 값으로 다시 계산
        const vals = b.columns.some((f) => f.type === 'calc' && rec.values[f.key] === undefined) ? computeListRow(b, rec.values) : rec.values;
        b.columns.forEach((f, i) => {
          const m = rec.marks?.find((x) => x.key === f.key);
          this.put({ address: addr(c0 + i, r), value: asCell(vals[f.key]), role: f.type === 'calc' ? 'calc' : 'input', numFmt: FIELD_TYPES[f.type].excelNumFmt(f), mark: m?.mark ?? rowMark, note: m?.note, fieldKey: f.key });
        });
        rec.auto.forEach((v, i) => this.put({ address: addr(autoStart + i, r), value: asCell(v), role: 'auto-value', mark: rowMark }));
        r += 1;
      });
      map.lastDataRow = Math.max(map.firstDataRow, r - 1);
      this.listGeom = { first: map.firstDataRow, last: map.lastDataRow, cols };
      if (rows.length === 0) r += 1;
    }
    this.cellMap.blocks[b.id] = map;
    return r;
  }

  /** c0 = 왼쪽 위 빈칸(행 제목 열) */
  private placeMatrix(b: MatrixBlock, row: number, c0: number): number {
    const map: MatrixBlockMap = { kind: 'matrix', rowLabelCells: [], colLabelCells: [], cells: [] };
    const f = b.cell;
    const fmt = FIELD_TYPES.number.excelNumFmt(f);
    const nC = b.colLabels.length;
    const nR = b.rowLabels.length;
    const calcCols = b.calcCols ?? [];
    const calcRows = b.calcRows ?? [];
    const firstCol = c0 + 1;
    const lastDataCol = firstCol + nC - 1;
    const totalColIdx = lastDataCol + 1;
    const calcColStart = lastDataCol + 1 + (b.totalCol ? 1 : 0);
    const firstRow = row + 1;
    const lastRow = firstRow + nR - 1;
    const totalRowIdx = lastRow + 1;
    const calcRowStart = lastRow + 1 + (b.totalRow ? 1 : 0);

    // 이름 → 열 번호 / 행 번호
    const colOf = new Map<string, number>();
    b.colLabels.forEach((l, c) => colOf.set(l.trim(), firstCol + c));
    if (b.totalCol) colOf.set(TOTAL_COL_NAME, totalColIdx);
    calcCols.forEach((cf, k) => colOf.set(cf.label.trim(), calcColStart + k));
    const rowOf = new Map<string, number>();
    b.rowLabels.forEach((l, r) => rowOf.set(l.trim(), firstRow + r));
    if (b.totalRow) rowOf.set(TOTAL_ROW_NAME, totalRowIdx);
    calcRows.forEach((rf, k) => rowOf.set(rf.label.trim(), calcRowStart + k));

    // 머리글 행
    this.put({ address: addr(c0, row), role: 'header' });
    b.colLabels.forEach((label, c) => {
      const a = addr(firstCol + c, row);
      this.put({ address: a, value: label, role: 'header', fieldKey: f.key });
      map.colLabelCells.push(a);
    });
    if (b.totalCol) this.put({ address: addr(totalColIdx, row), value: TOTAL_COL_NAME, role: 'header' });
    calcCols.forEach((cf, k) => this.put({ address: addr(calcColStart + k, row), value: cf.label, role: 'header', fieldKey: cf.key }));

    const full = this.isTemplate ? null : computeMatrix(b, this.agg?.matrixSumsBy?.[b.id] ?? this.agg?.matrixSums ?? []);
    const rowsAll = [...b.rowLabels.map((_, r) => firstRow + r), ...(b.totalRow ? [totalRowIdx] : []), ...calcRows.map((_, k) => calcRowStart + k)];
    const colsAll = [...b.colLabels.map((_, c) => firstCol + c), ...(b.totalCol ? [totalColIdx] : []), ...calcCols.map((_, k) => calcColStart + k)];
    const calcColField = (col: number) => calcCols[col - calcColStart];
    const calcRowField = (r: number) => calcRows[r - calcRowStart];

    rowsAll.forEach((rr, ri) => {
      const isData = rr <= lastRow;
      const isTotal = b.totalRow && rr === totalRowIdx;
      const rowField = rr >= calcRowStart ? calcRowField(rr) : undefined;
      // 행 제목
      const la = addr(c0, rr);
      this.put({ address: la, value: isData ? b.rowLabels[ri] : isTotal ? TOTAL_ROW_NAME : rowField!.label, role: 'header', fieldKey: rowField?.key });
      if (isData) map.rowLabelCells.push(la);
      const rowCells: string[] = [];
      colsAll.forEach((col, ci) => {
        const a = addr(col, rr);
        const v = full ? asCell(full.values[ri]?.[ci]) : undefined;
        const colField = col >= calcColStart ? calcColField(col) : undefined;
        const isDataCol = col <= lastDataCol;
        if (isData && isDataCol) {
          // 취합 결과의 합은 필수 칸이 아니라 노란색을 쓰지 않는다 (화면에서 노란 칸 = 확인할 칸)
          this.put({ address: a, value: v, role: 'input', required: this.isTemplate && f.required, numFmt: fmt, fieldKey: f.key });
          rowCells.push(a);
        } else if (colField) {
          // 계산 열: 그 행에 계산 열의 식을 적용 (합계 행·계산 행 포함)
          this.put({ address: a, value: v, role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(colField), fieldKey: colField.key });
          if (this.isTemplate) this.jobs.push(() => this.setFormula(a, colField, (name) => (colOf.has(name) ? addr(colOf.get(name)!, rr) : undefined)));
        } else if (rowField) {
          // 계산 행: 그 열에 계산 행의 식을 적용
          this.put({ address: a, value: v, role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(rowField), fieldKey: rowField.key });
          if (this.isTemplate) this.jobs.push(() => this.setFormula(a, rowField, (name) => (rowOf.has(name) ? addr(col, rowOf.get(name)!) : undefined)));
        } else if (isTotal) {
          // 합계 행 (데이터 열·계 열)
          this.put(this.isTemplate ? { address: a, formula: `SUM(${range(col, firstRow, col, lastRow)})`, role: 'fixed', numFmt: fmt } : { address: a, value: v, role: 'fixed', numFmt: fmt });
        } else {
          // 계 열 (데이터 행)
          this.put(this.isTemplate ? { address: a, formula: `SUM(${range(firstCol, rr, lastDataCol, rr)})`, role: 'fixed', numFmt: fmt } : { address: a, value: v, role: 'fixed', numFmt: fmt });
        }
      });
      if (isData) map.cells.push(rowCells);
    });
    if (this.isTemplate && nR > 0 && nC > 0) this.validate(range(firstCol, firstRow, lastDataCol, lastRow), f);

    this.cellMap.blocks[b.id] = map;
    return (rowsAll.at(-1) ?? row) + 1;
  }

  private placeGrid(b: GridBlock, row: number): number {
    const headerRow = row;
    const map: GridBlockMap = { kind: 'grid', headerRow, firstRow: row + 1, columns: [], inputCells: {}, fixedCells: {} };
    const width = b.colLabels.length;
    b.colLabels.forEach((label, c) => {
      this.put({ address: addr(1 + c, headerRow), value: label || undefined, role: 'header' });
      map.columns.push(colLetter(1 + c));
    });
    const showAuto = !!this.agg && b.spareRows > 0;
    if (showAuto) this.agg!.autoColumns.forEach((name, i) => this.put({ address: addr(width + 1 + i, headerRow), value: name, role: 'auto-header' }));
    this.freeze = { row: headerRow };

    let r = headerRow + 1;
    const firstBodyRow = r;
    const names = gridNames(b);
    const nameAddr = (name: string) => {
      const p = names.get(name);
      return p ? addr(1 + p.c, firstBodyRow + p.r) : undefined;
    };
    // 빈 양식: 다른 제출처가 채우는 칸은 회색·잠금 (작성처는 gridOwners)
    const owners = this.isTemplate ? gridOwners(this.schema) : new Map<string, string>();
    // 공용 파일은 누가 쓸지 몰라 다른 제출처 칸을 잠그지 않는다 (취합은 작성처 파일의 값만 쓴다)
    const me = this.input.mode === 'template' && !this.input.shared ? this.input.orgName ?? this.schema.org.orgs?.[0] : undefined;
    const gridCalc = this.isTemplate ? {} : computeGrid(b, Object.fromEntries(Object.entries(this.agg?.grid ?? {}).map(([k, v]) => [k, v.value])));
    for (const cells of b.rows) {
      cells.forEach((cell, c) => {
        const a = addr(1 + c, r);
        if (cell.kind === 'calc') {
          const f = cell.field;
          this.put({ address: a, value: this.isTemplate ? undefined : asCell(gridCalc[f.key]), role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(f), fieldKey: f.key });
          if (this.isTemplate) this.jobs.push(() => this.setFormula(a, f, (name) => nameAddr(name)));
        } else if (cell.kind === 'fixed') {
          this.put({ address: a, value: cell.value, role: 'fixed' });
          map.fixedCells[a] = cell.value;
        } else if (cell.kind === 'input') {
          const f = cell.field;
          const owner = owners.get(f.key);
          if (owner && me && !sameOrg(owner, me)) {
            this.put({ address: a, role: 'other-input', fieldKey: f.key });
            map.inputCells[f.key] = a;
            return;
          }
          const g = this.agg?.grid?.[f.key];
          this.put({ address: a, value: this.isTemplate ? undefined : asCell(g?.value), note: g?.note, role: 'input', required: this.isTemplate && f.required, numFmt: FIELD_TYPES[f.type].excelNumFmt(f), fieldKey: f.key });
          map.inputCells[f.key] = a;
          this.validate(a, f);
        } else {
          this.put({ address: a, role: 'fixed' });
        }
      });
      r += 1;
    }

    if (b.spareRows > 0) {
      const spareFirst = r;
      const cols = b.spareColumns ?? [];
      const colOf = new Map(cols.map((f, c) => [f.label.trim(), 1 + c]));
      if (this.isTemplate) {
        for (let n = 0; n < b.spareRows; n++, r++) {
          cols.forEach((f, c) => {
            const a = addr(1 + c, r);
            if (f.type === 'calc') {
              this.put({ address: a, role: 'calc', numFmt: FIELD_TYPES.calc.excelNumFmt(f), fieldKey: f.key });
              const rr = r;
              this.jobs.push(() => this.setFormula(a, f, (name) => (colOf.has(name) ? addr(colOf.get(name)!, rr) : undefined)));
            } else {
              this.put({ address: a, role: 'input', required: f.required, numFmt: FIELD_TYPES[f.type].excelNumFmt(f), fieldKey: f.key });
            }
          });
        }
        cols.forEach((f, c) => f.type !== 'calc' && this.validate(range(1 + c, spareFirst, 1 + c, r - 1), f));
      } else {
        for (const sp of this.agg?.gridSpare ?? []) {
          const vals = computeSpareRow(b, sp.values);
          cols.forEach((f, c) => this.put({ address: addr(1 + c, r), value: asCell(vals[c]), role: f.type === 'calc' ? 'calc' : 'input', numFmt: FIELD_TYPES[f.type].excelNumFmt(f), fieldKey: f.key }));
          sp.auto.forEach((v, i) => this.put({ address: addr(width + 1 + i, r), value: asCell(v), role: 'auto-value' }));
          r += 1;
        }
        if (r === spareFirst) r += 1;
      }
      map.spare = { firstRow: spareFirst, lastRow: Math.max(spareFirst, r - 1) };
    }
    this.cellMap.blocks[b.id] = map;
    return r;
  }

  private runCollect(): SheetModel {
    const { schema } = this;
    const last = this.lastCol;
    this.put({ address: 'A1', value: schema.title, role: 'title' });
    this.merge(1, 1, last);
    const info = infoLine(schema);
    if (schema.org.mode !== 'none') {
      this.put({ address: 'A2', value: `${orgLabel(schema)}명`, role: 'label' });
      this.put({ address: 'B2', value: this.input.mode === 'template' ? this.input.orgName ?? schema.org.orgs?.[0] : undefined, role: 'locked-value' });
      this.put({ address: 'C2', value: info || undefined, role: 'guide', wrap: true });
      this.merge(3, 2, last);
    } else {
      this.put({ address: 'A2', value: info || undefined, role: 'guide', wrap: true });
      this.merge(1, 2, last);
    }
    // 제작한 양식: 글자가 있는 칸 = 제목·안내 칸(label), 빈칸 = 테두리 있는 작성 자리(fixed)
    (schema.collect?.starter ?? []).forEach((cells, i) => {
      cells.forEach((v, c) => {
        const filled = v !== null && v !== '';
        this.put({ address: addr(1 + c, 4 + i), value: filled ? v : undefined, role: filled ? 'label' : 'fixed' });
      });
    });
    return {
      sheetName: '보고서',
      columns: this.columnWidths(),
      cells: [...this.cells.values()].sort(cellOrder),
      merges: this.merges,
      validations: [],
      printArea: '',
      cellMap: { printArea: '', blocks: {} },
    };
  }

  private columnWidths(): { width: number }[] {
    const widths = Array.from({ length: this.lastCol }, () => 10);
    const merged = new Set(this.merges.map((m) => m.split(':')[0]));
    for (const c of this.cells.values()) {
      if (c.role === 'title' || c.role === 'guide' || merged.has(c.address)) continue;
      const col = /^([A-Z]+)/.exec(c.address)![1];
      const idx = col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      if (idx >= widths.length) continue;
      widths[idx] = Math.max(widths[idx], Math.min(40, textWidth(c.value) + 4));
    }
    if (this.schema.blocks.some((b) => b.kind === 'list') && !this.schema.blocks.some((b) => b.kind === 'fields') && this.schema.org.mode === 'none')
      widths[0] = 6;
    return widths.map((width) => ({ width }));
  }
}

function cellOrder(a: ModelCell, b: ModelCell): number {
  const pa = /^([A-Z]+)(\d+)$/.exec(a.address)!;
  const pb = /^([A-Z]+)(\d+)$/.exec(b.address)!;
  return Number(pa[2]) - Number(pb[2]) || pa[1].length - pb[1].length || pa[1].localeCompare(pb[1]);
}
