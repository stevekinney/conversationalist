import { rmSync } from 'node:fs';

import { $ } from 'bun';
import chalk from 'chalk';

const info = (msg: string) => console.log(chalk.cyan(msg));
const success = (msg: string) => console.log(chalk.green(msg));
const error = (msg: string) => console.error(chalk.red(msg));

async function build() {
  console.log(chalk.bgBlue.black(' Build '));

  // Clean dist directory
  info('Cleaning dist directory...');
  rmSync('dist', { recursive: true, force: true });

  // Entry points to build
  const entryPoints = [
    { entry: './src/index.ts', outdir: 'dist' },
    { entry: './src/adapters/openai/index.ts', outdir: 'dist/adapters/openai' },
    { entry: './src/adapters/anthropic/index.ts', outdir: 'dist/adapters/anthropic' },
    { entry: './src/adapters/gemini/index.ts', outdir: 'dist/adapters/gemini' },
  ];

  // Build JavaScript with Bun (target node for npm compatibility)
  info('Building JavaScript...');
  for (const { entry, outdir } of entryPoints) {
    info(`  Building ${entry}...`);
    const buildResult =
      await $`bun build --target=node --outdir=${outdir} --sourcemap=external --external=zod ${entry}`.quiet();

    if (buildResult.exitCode !== 0) {
      error(`JavaScript build failed for ${entry}`);
      console.error(buildResult.stderr.toString());
      process.exit(1);
    }
  }

  // Generate TypeScript declarations
  info('Generating TypeScript declarations...');
  const tscResult =
    await $`bunx tsc --emitDeclarationOnly --project tsconfig.build.json`.quiet();

  if (tscResult.exitCode !== 0) {
    error('Declaration generation failed');
    console.error(tscResult.stderr.toString());
    process.exit(1);
  }

  success('Build completed successfully');
}

build().catch((err) => {
  error(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
