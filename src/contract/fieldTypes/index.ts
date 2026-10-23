import type { FieldType } from '../schema';
import type { FieldTypeDef } from './types';
import { text } from './text';
import { number } from './number';
import { date } from './date';
import { select } from './select';
import { memo } from './memo';
import { pattern } from './pattern';
import { calc } from './calc';

/** 항목 타입 레지스트리. 새 타입은 파일을 추가하고 여기 등록한다 (01-contract.md 5절). */
export const FIELD_TYPES: Record<FieldType, FieldTypeDef> = { text, number, date, select, memo, pattern, calc };

export const FIELD_TYPE_ORDER: FieldType[] = ['text', 'number', 'date', 'select', 'memo', 'pattern', 'calc'];

export type { FieldTypeDef, IssueCode, NormalizeResult } from './types';
export { numberFormat, NUMBER_LIMIT } from './number';
export { DATE_EXAMPLE } from './date';
export { PATTERN_INFO } from './pattern';
export { selectNeedsRange } from './select';
export { resolveDate } from './common';
