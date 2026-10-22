import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['server/entry.ts'], outfile: 'server/runtime.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  packages: 'external', sourcemap: false, minify: false,
  alias: { '@contract': `${root}src/contract`, '@gen': `${root}src/generator`, '@agg': `${root}src/aggregator` },
});
console.log('서버 배포 묶음 생성 완료');
