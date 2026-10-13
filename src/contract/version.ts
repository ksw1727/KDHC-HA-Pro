/** 공통 계약 버전. 하위 호환이 깨지는 계약 변경 시 올린다 (01-contract.md 10절). */
export const CONTRACT_VERSION = 1 as const;

/** 시트 보호 비밀번호 (미결정 D2의 기본안: 앱 고정 비밀번호). */
export const PROTECT_PASSWORD = 'hanan-moa';
