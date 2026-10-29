/**
 * Test stub for the `server-only` package.
 *
 * The real package throws at import time unless the bundler resolved it through
 * the `react-server` export condition. Next.js does that automatically; vitest
 * does not, so any module marked `server-only` — `pipeline.ts`,
 * `providers/index.ts` — would fail to load in a test even though the code under
 * test is pure and perfectly testable.
 *
 * `vitest.config.ts` aliases `server-only` to this file. The stub deliberately
 * exports nothing: the marker is a bundler-level assertion about where a module
 * may run, not a runtime dependency, so replacing it with an empty module
 * changes no behaviour. Tests therefore exercise the REAL pipeline code rather
 * than a copy with the marker stripped out.
 */
export {};
