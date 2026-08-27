import { exitWhenFlushed } from '../exit';

describe('exitWhenFlushed', () => {
  // Guards half of a live-observed hang fix. Forcing the exit is load-bearing,
  // but on the runner stdout is a pipe and pipe writes are asynchronous -
  // exiting in the next tick discards the `::error::` annotations the error
  // handler just wrote, leaving a red step with no reason on it.
  it('waits for stdout to drain before exiting', () => {
    const exit = jest.fn();
    let flush: (() => void) | undefined;

    exitWhenFlushed(1, exit, (_chunk, callback) => {
      flush = callback;
    });

    // Still queued: exiting here is exactly the bug.
    expect(exit).not.toHaveBeenCalled();

    flush?.();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('carries the resolved exit code through', () => {
    const exit = jest.fn();

    exitWhenFlushed(0, exit, (_chunk, callback) => callback());

    expect(exit).toHaveBeenCalledWith(0);
  });

  // The timeout is not defensive padding: this mechanism exists to stop the
  // process hanging, so a stdout that never drains must not resurrect the hang.
  it('exits anyway when stdout never drains', () => {
    jest.useFakeTimers();

    try {
      const exit = jest.fn();

      exitWhenFlushed(1, exit, () => {
        // Never invokes the callback.
      });

      expect(exit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2_000);

      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('exits once even if the drain callback arrives after the timeout', () => {
    jest.useFakeTimers();

    try {
      const exit = jest.fn();
      let flush: (() => void) | undefined;

      exitWhenFlushed(1, exit, (_chunk, callback) => {
        flush = callback;
      });

      jest.advanceTimersByTime(2_000);
      flush?.();

      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
