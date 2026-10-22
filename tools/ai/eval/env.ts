/** bridge.ts가 읽기 전에 시험용 작업 폴더를 정한다 (import 순서상 가장 먼저 불러야 한다) */
import { join } from 'node:path';
process.env.MOA_AI_HOME ??= join(process.cwd(), 'tools/ai/eval/out/ws');
