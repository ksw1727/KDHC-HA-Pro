/**
 * 어떤 엑셀이 와도 .xlsx 바이트로 맞춘다 (브라우저·Node 공용, 원본은 어디로도 보내지 않는다).
 * - .xlsx/.xlsm(ZIP): 그대로
 * - 열기 암호가 걸린 .xlsx/.xlsm(CFB 안 EncryptedPackage): 암호를 받아 브라우저 안에서 푼다 (Excel 2010 이후 기본 방식 Agile AES)
 * - 옛 .xls(BIFF): SheetJS로 읽어 .xlsx로 바꾼다 (값·수식·병합은 남고 채움색·테두리·입력 규칙은 빠질 수 있다)
 * SheetJS는 무거워서 CFB(.xls·암호 파일)일 때만 불러온다.
 */

/** 열기 암호가 있어 암호가 필요한 파일 */
export class LockedFileError extends Error {
  override name = 'LockedFileError';
  constructor(public kind: 'xlsx' | 'xls', message: string) { super(message); }
}
/** 암호가 틀림 */
export class WrongPasswordError extends Error { override name = 'WrongPasswordError'; }

export interface OpenedWorkbook {
  /** ExcelJS가 읽을 수 있는 .xlsx 바이트 */
  bytes: Uint8Array;
  /** AI·사용자에게 알릴 변환 내용 */
  notes: string[];
  /** .xls에서 읽은 사용자 지정 파일 속성 (SheetJS .xlsx 저장은 이를 옮기지 않으므로, 필요한 쪽에서 다시 넣는다) */
  customProps?: Record<string, string | number>;
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isCfb = (b: Uint8Array) => b.length > 7 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x);

const HOW_TO_UNLOCK = '엑셀에서 [파일 > 정보 > 통합 문서 보호 > 암호 설정]의 암호를 지우고 저장하거나, 여기서 암호를 입력해 주세요.';

type Xlsx = typeof import('xlsx');
let xlsxLib: Promise<Xlsx> | null = null;
const loadXlsx = () => (xlsxLib ??= import('xlsx'));

function cfbStream(X: Xlsx, cfb: unknown, name: string): Uint8Array | null {
  const e = X.CFB.find(cfb, name) as { content?: ArrayLike<number> } | null;
  return e?.content ? Uint8Array.from(e.content as ArrayLike<number>) : null;
}

/** 열기 암호가 걸린 .xlsx인지 (CFB 안에 EncryptedPackage가 있으면) */
export async function isEncryptedOoxml(bytes: Uint8Array): Promise<boolean> {
  if (!isCfb(bytes)) return false;
  const X = await loadXlsx();
  return !!cfbStream(X, X.CFB.read(bytes, { type: 'array' }), 'EncryptedPackage');
}

export async function openWorkbook(bytes: Uint8Array, _name: string, password?: string): Promise<OpenedWorkbook> {
  if (isZip(bytes)) return { bytes, notes: [] }; // .xlsx·.xlsm (확장자만 .xls인 .xlsx도)
  if (!isCfb(bytes)) throw new Error('엑셀 파일이 아니거나 손상된 파일이에요');
  const X = await loadXlsx();
  const cfb = X.CFB.read(bytes, { type: 'array' });
  const info = cfbStream(X, cfb, 'EncryptionInfo');
  const pkg = cfbStream(X, cfb, 'EncryptedPackage');
  if (info && pkg) {
    if (!password) throw new LockedFileError('xlsx', `열기 암호가 걸린 파일이에요. ${HOW_TO_UNLOCK}`);
    const plain = await decryptAgile(info, pkg, password);
    if (!isZip(plain)) throw new WrongPasswordError('암호를 풀었지만 엑셀 내용이 아니에요');
    return { bytes: plain, notes: ['열기 암호를 이 브라우저 안에서 풀어 읽었어요 (암호는 보내거나 저장하지 않아요).'] };
  }
  // 옛 .xls (BIFF5/8)
  let wb: import('xlsx').WorkBook;
  try {
    wb = X.read(bytes, { type: 'array', cellFormula: true, cellStyles: true, cellDates: true, ...(password ? { password } : {}) });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/password|encrypt/i.test(msg)) {
      if (password) throw new WrongPasswordError('암호가 맞지 않거나, 이 화면에서 풀 수 없는 옛 암호 방식이에요. 엑셀에서 암호를 지우고 .xlsx로 저장해 주세요.');
      throw new LockedFileError('xls', `열기 암호가 걸린 .xls 파일이에요. ${HOW_TO_UNLOCK}`);
    }
    throw new Error(`옛 엑셀(.xls)을 읽지 못했어요: ${msg}`);
  }
  const out = X.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer;
  const customProps: Record<string, string | number> = {};
  for (const [k, v] of Object.entries((wb as { Custprops?: Record<string, unknown> }).Custprops ?? {})) if (typeof v === 'string' || typeof v === 'number') customProps[k] = v;
  return { bytes: new Uint8Array(out), customProps, notes: ['옛 엑셀(.xls)을 .xlsx로 바꿔 읽었어요. 값·수식·병합은 그대로지만 채움색·테두리·입력 규칙(선택 목록)은 빠졌을 수 있어요.'] };
}

// ── Agile 암호 (ECMA-376 / MS-OFFCRYPTO 2.3.4.10~15) ──
const subtle = () => globalThis.crypto.subtle;
const HASH: Record<string, string> = { SHA1: 'SHA-1', 'SHA-1': 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' };
const BLOCK = {
  verifierInput: [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79],
  verifierHash: [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e],
  keyValue: [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6],
};
const cat = (...xs: ArrayLike<number>[]) => { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf16le = (s: string) => { const out = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i * 2] = c & 255; out[i * 2 + 1] = c >>> 8; } return out; };
const digest = async (alg: string, data: Uint8Array) => new Uint8Array(await subtle().digest(alg, data as BufferSource));
const fit = (b: Uint8Array, n: number, pad: number) => (b.length >= n ? b.slice(0, n) : cat(b, new Uint8Array(n - b.length).fill(pad)));

/** 패딩 없는 AES-CBC 복호화 (WebCrypto는 PKCS#7 패딩을 요구하므로, 패딩 블록 하나를 만들어 붙여 푼다) */
async function aesCbcNoPad(keyBytes: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16) throw new WrongPasswordError('암호 파일 구조가 올바르지 않아요');
  const key = await subtle().importKey('raw', keyBytes as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const last = data.length ? data.slice(-16) : iv;
  const padBlock = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last as BufferSource }, key, new Uint8Array(16).fill(16) as BufferSource)).slice(0, 16);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, key, cat(data, padBlock) as BufferSource));
}

interface KeyParams { salt: Uint8Array; blockSize: number; keyBits: number; hashSize: number; hash: string }
function params(tag: string): KeyParams {
  const a = (n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(tag)?.[1] ?? '';
  const cipher = a('cipherAlgorithm'); const chain = a('cipherChaining');
  if (cipher !== 'AES' || chain !== 'ChainingModeCBC') throw new WrongPasswordError(`지원하지 않는 암호 방식이에요(${cipher}/${chain}). 엑셀에서 암호를 지우고 저장해 주세요.`);
  const hash = HASH[a('hashAlgorithm')];
  if (!hash) throw new WrongPasswordError(`지원하지 않는 암호 해시예요(${a('hashAlgorithm')}). 엑셀에서 암호를 지우고 저장해 주세요.`);
  return { salt: b64(a('saltValue')), blockSize: Number(a('blockSize')), keyBits: Number(a('keyBits')), hashSize: Number(a('hashSize')), hash };
}

export async function decryptAgile(info: Uint8Array, pkg: Uint8Array, password: string): Promise<Uint8Array> {
  const major = info[0] | (info[1] << 8); const minor = info[2] | (info[3] << 8);
  if (!(major === 4 && minor === 4)) throw new WrongPasswordError('예전 암호 방식(Excel 2007)이라 이 화면에서 풀 수 없어요. 엑셀에서 암호를 지우고 저장해 주세요.');
  const xml = new TextDecoder().decode(info.subarray(8));
  const keyDataTag = /<(?:\w+:)?keyData\b[^>]*>/.exec(xml)?.[0];
  const encKeyTag = /<(?:\w+:)?encryptedKey\b[^>]*>/.exec(xml)?.[0];
  if (!keyDataTag || !encKeyTag) throw new WrongPasswordError('암호 정보가 올바르지 않아요');
  const kd = params(keyDataTag); const ek = params(encKeyTag);
  const attr = (n: string) => b64(new RegExp(`\\s${n}="([^"]*)"`).exec(encKeyTag)?.[1] ?? '');
  const spin = Number(/\sspinCount="(\d+)"/.exec(encKeyTag)?.[1] ?? '100000');
  if (!(spin > 0 && spin <= 10_000_000)) throw new WrongPasswordError('암호 정보가 올바르지 않아요');

  let h = await digest(ek.hash, cat(ek.salt, utf16le(password)));
  for (let i = 0; i < spin; i++) h = await digest(ek.hash, cat(le32(i), h));
  const keyFor = async (block: number[]) => fit(await digest(ek.hash, cat(h, block)), ek.keyBits / 8, 0x36);
  const iv = fit(ek.salt, ek.blockSize, 0x36);

  let verifierInput: Uint8Array; let verifierHash: Uint8Array;
  try {
    verifierInput = (await aesCbcNoPad(await keyFor(BLOCK.verifierInput), iv, attr('encryptedVerifierHashInput'))).slice(0, ek.salt.length);
    verifierHash = (await aesCbcNoPad(await keyFor(BLOCK.verifierHash), iv, attr('encryptedVerifierHashValue'))).slice(0, ek.hashSize);
  } catch { throw new WrongPasswordError('암호가 맞지 않아요'); }
  const expect = (await digest(ek.hash, verifierInput)).slice(0, ek.hashSize);
  if (expect.length !== verifierHash.length || expect.some((x, i) => x !== verifierHash[i])) throw new WrongPasswordError('암호가 맞지 않아요');
  const secret = (await aesCbcNoPad(await keyFor(BLOCK.keyValue), iv, attr('encryptedKeyValue'))).slice(0, kd.keyBits / 8);

  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true));
  const body = pkg.subarray(8);
  const parts: Uint8Array[] = [];
  for (let i = 0, off = 0; off < body.length; i++, off += 4096) {
    let seg = body.subarray(off, Math.min(off + 4096, body.length));
    if (seg.length % kd.blockSize) seg = seg.subarray(0, seg.length - (seg.length % kd.blockSize));
    const segIv = fit(await digest(kd.hash, cat(kd.salt, le32(i))), kd.blockSize, 0x36);
    parts.push(await aesCbcNoPad(secret, segIv, seg));
  }
  return cat(...parts).slice(0, size);
}
