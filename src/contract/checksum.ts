import type { FileMeta } from './meta';

/** 객체 키를 알파벳 순으로 정렬한 JSON (undefined는 뺀다) */
export function canonicalJSON(x: unknown): string {
  if (x === undefined) return 'null';
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? 'null' : canonicalJSON(v))).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`).join(',')}}`;
}

/** 01-contract.md 4.4: SHA-256(canonicalJSON({kind, schema, orgName, sheetName, cellMap, aggregate})) 16진수 앞 16자 */
export async function computeChecksum(meta: Omit<FileMeta, 'checksum'> | FileMeta): Promise<string> {
  const { kind, schema, orgName, sheetName, cellMap, aggregate } = meta;
  const data = new TextEncoder().encode(canonicalJSON({ kind, schema, orgName, sheetName, cellMap, aggregate }));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
