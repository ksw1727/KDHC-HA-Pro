import JSZip from 'jszip';

/**
 * ExcelJS가 지원하지 않는 부분을 xlsx 바이트에 직접 넣는다 (01-contract.md 4.2, 4.3).
 * - docProps/custom.xml: 사용자 지정 문서 속성 (kdhc.formId 등)
 * - xl/workbook.xml: 통합문서 구조 보호 (시트 추가·삭제·숨기기 해제 막기)
 */
export interface PatchOptions {
  customProps?: Record<string, string | number>;
  lockStructure?: boolean;
  password?: string;
}

const CUSTOM_CT = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const CUSTOM_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 엑셀의 옛 통합문서 보호 비밀번호 해시 (16비트, 16진수 4자리) */
export function legacyPasswordHash(password: string): string {
  let hash = 0;
  const chars = [...password].map((c) => c.charCodeAt(0) & 0x7fff);
  for (let i = chars.length - 1; i >= 0; i--) {
    hash = ((hash >> 14) & 0x01) | ((hash << 1) & 0x7fff);
    hash ^= chars[i];
  }
  hash = ((hash >> 14) & 0x01) | ((hash << 1) & 0x7fff);
  hash ^= chars.length;
  hash ^= 0xce4b;
  return hash.toString(16).toUpperCase().padStart(4, '0');
}

export async function patchXlsx(bytes: ArrayBuffer | Uint8Array, opts: PatchOptions): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);

  if (opts.customProps && Object.keys(opts.customProps).length) {
    const props = Object.entries(opts.customProps).map(([name, v], i) =>
      `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(name)}">${typeof v === 'number' ? `<vt:i4>${v}</vt:i4>` : `<vt:lpwstr>${esc(v)}</vt:lpwstr>`}</property>`).join('');
    zip.file('docProps/custom.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props}</Properties>`);

    let ct = await zip.file('[Content_Types].xml')!.async('string');
    if (!ct.includes('/docProps/custom.xml')) ct = ct.replace('</Types>', `<Override PartName="/docProps/custom.xml" ContentType="${CUSTOM_CT}"/></Types>`);
    zip.file('[Content_Types].xml', ct);

    let rels = await zip.file('_rels/.rels')!.async('string');
    if (!rels.includes('docProps/custom.xml')) rels = rels.replace('</Relationships>', `<Relationship Id="rIdKdhcCustom" Type="${CUSTOM_REL}" Target="docProps/custom.xml"/></Relationships>`);
    zip.file('_rels/.rels', rels);
  }

  if (opts.lockStructure) {
    let wb = await zip.file('xl/workbook.xml')!.async('string');
    wb = wb.replace(/<workbookProtection[^>]*\/>/, '');
    const pw = opts.password ? ` workbookPassword="${legacyPasswordHash(opts.password)}"` : '';
    const tag = `<workbookProtection lockStructure="1"${pw}/>`;
    wb = wb.includes('<bookViews') ? wb.replace('<bookViews', `${tag}<bookViews`) : wb.replace('<sheets>', `${tag}<sheets>`);
    zip.file('xl/workbook.xml', wb);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** 사용자 지정 문서 속성 읽기 (메타 시트가 지워졌을 때 식별용) */
export async function readCustomProps(bytes: ArrayBuffer | Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('docProps/custom.xml')?.async('string');
  if (!xml) return {};
  const out: Record<string, string> = {};
  const re = /<property[^>]*name="([^"]+)"[^>]*>\s*<vt:\w+>([^<]*)<\/vt:\w+>\s*<\/property>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out[m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')] = m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return out;
}

/** 01-contract.md 4.2 표의 속성 이름 */
export function kdhcProps(p: { formId: string; formVersion: number; kind: 'submission' | 'aggregate'; org?: string }): Record<string, string | number> {
  return { 'kdhc.formId': p.formId, 'kdhc.formVersion': p.formVersion, 'kdhc.kind': p.kind, ...(p.org ? { 'kdhc.org': p.org } : {}) };
}
