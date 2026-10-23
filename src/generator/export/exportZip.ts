import JSZip from 'jszip';
import type { FormSchema } from '@contract/schema';
import { writeWorkbook } from './writeWorkbook';
import { safeFileName } from './exportJson';

export interface ExportFile { name: string; bytes: Uint8Array }
export interface ExportResult {
  download: { name: string; blob: Blob };   // 내려받을 파일 (zip 또는 xlsx 1개)
  files: ExportFile[];                       // 안에 든 엑셀들
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 파일 이름 (02-generator.md 2.6): {제목}_v{버전}_{지사}.xlsx, 묶음은 {제목}_v{버전}_배포용.zip */
export function exportNames(schema: FormSchema, shared = false) {
  const base = `${safeFileName(schema.title || '양식')}_v${schema.formVersion}`;
  const preset = schema.org.mode === 'preset' && !shared;
  return {
    preset,
    zipName: `${base}_배포용.zip`,
    fileOf: (org?: string) => (org ? `${base}_${safeFileName(org)}.xlsx` : `${base}.xlsx`),
  };
}

/** 시트 모으기형은 파일 속성으로만 제출처를 알아내서 공용 파일 1개로 받을 수 없다 */
export const canShare = (schema: FormSchema) => schema.org.mode === 'preset' && schema.layout !== 'collect';

/**
 * 양식 내보내기: preset이면 지사마다 파일을 만들어 zip, 아니면 xlsx 하나. onProgress(만든 수, 전체)
 * shared: preset 양식을 공용 파일 1개로 (지사명은 작성자가 목록에서 고름)
 */
export async function exportForm(schema: FormSchema, now: Date, onProgress?: (done: number, total: number) => void, shared = false): Promise<ExportResult> {
  const share = shared && canShare(schema);
  const n = exportNames(schema, share);
  const orgs = n.preset ? schema.org.orgs ?? [] : [undefined];
  const files: ExportFile[] = [];
  for (const [i, org] of orgs.entries()) {
    files.push({ name: n.fileOf(org), bytes: await writeWorkbook(schema, { orgName: org, now, shared: share }) });
    onProgress?.(i + 1, orgs.length);
    await new Promise((r) => setTimeout(r, 0)); // 화면이 멈추지 않게
  }
  if (!n.preset) return { files, download: { name: files[0].name, blob: new Blob([files[0].bytes as BlobPart], { type: XLSX }) } };
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { files, download: { name: n.zipName, blob } };
}
