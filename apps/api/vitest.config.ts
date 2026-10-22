import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Vitest compiles with esbuild, which does not emit the decorator metadata
 * (design:paramtypes) that Nest's dependency injection reads. Unit tests
 * build their services by hand and never notice; the end-to-end suite boots
 * the whole app, so source files go through TypeScript itself first — the
 * same approach as ts-jest.
 */
function decoratorMetadata(): Plugin {
  return {
    name: 'typescript-decorator-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || id.endsWith('.d.ts') || id.includes('node_modules')) return null;
      if (!code.includes('@')) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          useDefineForClassFields: false,
          sourceMap: true,
        },
      });
      return { code: out.outputText, map: out.sourceMapText };
    },
  };
}

export default defineConfig({
  plugins: [decoratorMetadata()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // This local Neon compute cannot reliably establish many concurrent new
    // connections at once (see DATABASE_URL's connection_limit=3 in .env) —
    // running test files in parallel multiplies that across workers and
    // starves every one of them out with transaction-acquisition timeouts.
    // One file at a time keeps total concurrent connections low; it costs
    // wall-clock time, not correctness.
    fileParallelism: false,
    // Even a single fresh connection to this Neon compute can take several
    // seconds (observed 500ms-4.5s cold). Vitest's 5s default is too tight
    // for a test doing more than one sequential DB round trip.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
