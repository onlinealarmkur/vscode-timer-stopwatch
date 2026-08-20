import * as esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  minify: production,
  sourcemap: production ? false : 'inline',
  sourcesContent: false,
  logLevel: 'info',
});

if (watch) {
  const typescript = await import('typescript');
  const watchHost = typescript.createWatchCompilerHost(
    'tsconfig.json',
    { noEmit: true },
    typescript.sys,
    typescript.createSemanticDiagnosticsBuilderProgram,
  );

  typescript.createWatchProgram(watchHost);
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
