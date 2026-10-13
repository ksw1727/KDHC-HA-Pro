import type { FormSchema } from '@contract/schema';

const FORBIDDEN_FILE = /[\\/:*?"<>|]/g;

/** 파일 이름에 쓸 수 없는 문자(\/:*?"<>|)는 '_'로 (02-generator.md 2.6) */
export function safeFileName(name: string): string {
  return name.replace(FORBIDDEN_FILE, '_').trim() || '양식';
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** [양식 파일 저장]: {양식제목}.form.json = FormSchema 그대로 */
export function exportFormJson(schema: FormSchema) {
  const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(schema.title || '새 양식')}.form.json`);
}
