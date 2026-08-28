/**
 * How long to wait for stdout to drain before exiting anyway.
 *
 * Generous relative to a pipe flush and negligible relative to the hang the
 * forced exit exists to prevent.
 */
const FLUSH_TIMEOUT_MS = 2_000;

/**
 * Exits once everything already written to stdout has actually left the
 * process.
 *
 * On the runner stdout is a pipe, and Node's pipe writes are asynchronous:
 * `process.exit()` discards whatever is still queued. `main.ts`'s error
 * handler writes the `::error::` annotations - including one per invalid
 * PowerOn - and returns immediately, so exiting in the very next tick can drop
 * precisely the diagnostics that make a red step actionable. Writing an empty
 * chunk and waiting for its callback is enough, because stream callbacks fire
 * in write order: when this one runs, everything queued ahead of it is out.
 *
 * The timeout is not belt-and-braces. Forcing the exit is load-bearing (see
 * the entry point in `main.ts`), so a stdout that never drains must not
 * reintroduce the hang it exists to prevent.
 *
 * This lives outside `main.ts` on purpose. ncc's relocate-loader rewrites the
 * `require.main === module` guard in the entry module into a form that works
 * inside a webpack bundle, and that rewrite is sensitive to what else the
 * entry module contains - adding this function to `main.ts` silently lost it,
 * leaving webpack's own mapping, which is also true under a plain `require()`.
 * The bundle then ran the whole action on import. CI asserts on the emitted
 * guard (see "Assert the entry guard survived bundling"), but keeping the
 * entry module minimal avoids the trap in the first place.
 *
 * Deliberately does not spell out the rewritten expression: CI greps the
 * bundle for it, and a comment carrying the same text would satisfy that grep
 * on its own.
 *
 * @param code The exit code to terminate with
 * @param exit Injectable for tests; defaults to `process.exit`
 * @param write Injectable for tests; defaults to `process.stdout.write`
 */
export function exitWhenFlushed(
  code: number,
  exit: (exitCode: number) => void = (exitCode) => process.exit(exitCode),
  write: (chunk: string, callback: () => void) => void = (chunk, callback) =>
    process.stdout.write(chunk, callback),
): void {
  let exited = false;
  const finish = (): void => {
    if (exited) {
      return;
    }
    exited = true;
    exit(code);
  };

  const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);
  timer.unref?.();

  write('', () => {
    clearTimeout(timer);
    finish();
  });
}
