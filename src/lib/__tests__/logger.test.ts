import {
  Logger,
  createLogger,
  trackPerformance,
  type TaskSummary,
  type LogContext,
} from '../logger';

describe('logger', () => {
  let consoleSpy: {
    info: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = {
      info: jest.spyOn(console, 'info').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
    };
  });

  afterEach(() => {
    consoleSpy.info.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('Logger', () => {
    describe('info', () => {
      it('should log info messages', () => {
        const logger = new Logger();

        logger.info('Test message');

        expect(consoleSpy.info).toHaveBeenCalledWith('Test message');
      });

      it('should include prefix when configured', () => {
        const logger = new Logger({ logPrefix: '[TASK]' });

        logger.info('Test message');

        expect(consoleSpy.info).toHaveBeenCalledWith('[TASK] Test message');
      });

      it('should include context when provided', () => {
        const logger = new Logger();
        const context: LogContext = { fileCount: 5 };

        logger.info('Processing files', context);

        expect(consoleSpy.info).toHaveBeenCalledWith(
          'Processing files {"fileCount":5}',
        );
      });
    });

    describe('warn', () => {
      it('should log warning messages', () => {
        const logger = new Logger();

        logger.warn('Warning message');

        expect(consoleSpy.warn).toHaveBeenCalledWith('Warning message');
      });

      it('should include prefix and context', () => {
        const logger = new Logger({ logPrefix: '[WARN]' });

        logger.warn('Issue detected', { severity: 'medium' });

        expect(consoleSpy.warn).toHaveBeenCalledWith(
          '[WARN] Issue detected {"severity":"medium"}',
        );
      });
    });

    describe('error', () => {
      it('should log error messages', () => {
        const logger = new Logger();

        logger.error('Error occurred');

        expect(consoleSpy.error).toHaveBeenCalledWith('Error occurred');
      });

      it('should include error details when Error object provided', () => {
        const logger = new Logger();
        const error = new Error('Test error');

        logger.error('Failed to process', error);

        const call = consoleSpy.error.mock.calls[0][0];
        expect(call).toContain('Failed to process');
        expect(call).toContain('Test error');
      });

      it('should include additional context', () => {
        const logger = new Logger();

        logger.error('Failed', undefined, { fileId: '123' });

        expect(consoleSpy.error).toHaveBeenCalledWith(
          'Failed {"fileId":"123"}',
        );
      });
    });

    describe('debug', () => {
      it('should not log debug messages when verbose is false', () => {
        const logger = new Logger({ verbose: false });

        logger.debug('Debug info');

        expect(consoleSpy.info).not.toHaveBeenCalled();
      });

      it('should log debug messages when verbose is true', () => {
        const logger = new Logger({ verbose: true });

        logger.debug('Debug info');

        expect(consoleSpy.info).toHaveBeenCalledWith('[DEBUG] Debug info');
      });

      it('should include context in verbose mode', () => {
        const logger = new Logger({ verbose: true });

        logger.debug('Details', { step: 3 });

        expect(consoleSpy.info).toHaveBeenCalledWith(
          '[DEBUG] Details {"step":3}',
        );
      });
    });

    describe('performance tracking', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('should track performance metrics', () => {
        const logger = new Logger();

        logger.startTimer('test-operation');
        jest.advanceTimersByTime(1000);
        const duration = logger.endTimer('test-operation');

        expect(duration).toBe(1000);
      });

      it('should not track when enableTimings is false', () => {
        const logger = new Logger({ enableTimings: false });

        logger.startTimer('test-operation');
        const duration = logger.endTimer('test-operation');

        expect(duration).toBeUndefined();
      });

      it('should return undefined when timer not found', () => {
        const logger = new Logger();

        const duration = logger.endTimer('non-existent');

        expect(duration).toBeUndefined();
        expect(consoleSpy.warn).toHaveBeenCalledWith(
          'No timer found for: non-existent',
        );
      });

      it('should get metrics for named operation', () => {
        const logger = new Logger();

        logger.startTimer('operation');
        jest.advanceTimersByTime(500);
        logger.endTimer('operation');

        const metrics = logger.getMetrics('operation');

        expect(metrics).toBeDefined();
        expect(metrics?.duration).toBe(500);
      });

      it('should increment items processed', () => {
        const logger = new Logger();

        logger.startTimer('process');
        logger.incrementProcessed('process', 5);
        logger.incrementProcessed('process', 3);

        const metrics = logger.getMetrics('process');

        expect(metrics?.itemsProcessed).toBe(8);
      });

      it('should increment errors encountered', () => {
        const logger = new Logger();

        logger.startTimer('process');
        logger.incrementErrors('process');
        logger.incrementErrors('process', 2);

        const metrics = logger.getMetrics('process');

        expect(metrics?.errorsEncountered).toBe(3);
      });

      it('should clear all metrics', () => {
        const logger = new Logger();

        logger.startTimer('op1');
        logger.startTimer('op2');
        logger.clearMetrics();

        expect(logger.getMetrics('op1')).toBeUndefined();
        expect(logger.getMetrics('op2')).toBeUndefined();
      });
    });

    describe('logSummary', () => {
      it('should log formatted summary report', () => {
        const logger = new Logger();
        const summary: TaskSummary = {
          taskName: 'Validate PowerOn',
          status: 'success',
          duration: 2500,
          filesProcessed: 10,
          filesSucceeded: 10,
          filesFailed: 0,
          errors: [],
        };

        logger.logSummary(summary);

        expect(consoleSpy.info).toHaveBeenCalledWith('');
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('Task Summary'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('SUCCESS'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('2.50s'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('Files Processed: 10'),
        );
      });

      it('should include errors in summary when present', () => {
        const logger = new Logger();
        const summary: TaskSummary = {
          taskName: 'Validate PowerOn',
          status: 'failure',
          duration: 1500,
          filesProcessed: 5,
          filesSucceeded: 3,
          filesFailed: 2,
          errors: ['File1.PO: Syntax error', 'File2.PO: Invalid command'],
        };

        logger.logSummary(summary);

        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('Errors:'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('File1.PO'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('File2.PO'),
        );
      });

      it('should include metadata when provided', () => {
        const logger = new Logger();
        const summary: TaskSummary = {
          taskName: 'Sync PowerOn',
          status: 'success',
          duration: 3000,
          filesProcessed: 15,
          filesSucceeded: 15,
          filesFailed: 0,
          errors: [],
          metadata: {
            symNumber: 627,
            branch: 'main',
          },
        };

        logger.logSummary(summary);

        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('Additional Info'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('symNumber: 627'),
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('branch: main'),
        );
      });
    });

    describe('logProgress', () => {
      it('should log progress with percentage', () => {
        const logger = new Logger();

        logger.logProgress(5, 10);

        expect(consoleSpy.info).toHaveBeenCalledWith('Progress: 5/10 (50.0%)');
      });

      it('should include custom message', () => {
        const logger = new Logger();

        logger.logProgress(3, 12, 'Validating files');

        expect(consoleSpy.info).toHaveBeenCalledWith(
          'Validating files: 3/12 (25.0%)',
        );
      });
    });

    describe('child', () => {
      it('should create child logger with combined prefix', () => {
        const parent = new Logger({ logPrefix: '[TASK]' });
        const child = parent.child('[STEP1]');

        child.info('Test');

        expect(consoleSpy.info).toHaveBeenCalledWith('[TASK] [STEP1] Test');
      });

      it('should create child from logger without prefix', () => {
        const parent = new Logger();
        const child = parent.child('[CHILD]');

        child.info('Test');

        expect(consoleSpy.info).toHaveBeenCalledWith('[CHILD] Test');
      });

      it('should inherit verbose setting', () => {
        const parent = new Logger({ verbose: true });
        const child = parent.child('[CHILD]');

        child.debug('Debug message');

        expect(consoleSpy.info).toHaveBeenCalledWith(
          '[CHILD] [DEBUG] Debug message',
        );
      });
    });
  });

  describe('createLogger', () => {
    it('should create logger instance with default options', () => {
      const logger = createLogger();

      logger.info('Test');

      expect(consoleSpy.info).toHaveBeenCalledWith('Test');
    });

    it('should create logger with custom options', () => {
      const logger = createLogger({ logPrefix: '[CUSTOM]', verbose: true });

      logger.debug('Debug test');

      expect(consoleSpy.info).toHaveBeenCalledWith(
        '[CUSTOM] [DEBUG] Debug test',
      );
    });
  });

  describe('trackPerformance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should track performance of async function', async () => {
      const logger = new Logger();
      const asyncFn = jest.fn(async () => {
        jest.advanceTimersByTime(1000);
        return 'result';
      });

      const result = await trackPerformance(logger, 'test-op', asyncFn);

      expect(result).toBe('result');
      const metrics = logger.getMetrics('test-op');
      expect(metrics?.duration).toBe(1000);
    });

    it('should track errors in async function', async () => {
      const logger = new Logger();
      const asyncFn = jest.fn(async () => {
        throw new Error('Test error');
      });

      await expect(
        trackPerformance(logger, 'failing-op', asyncFn),
      ).rejects.toThrow('Test error');

      const metrics = logger.getMetrics('failing-op');
      expect(metrics?.errorsEncountered).toBe(1);
    });

    it('should still end timer when function fails', async () => {
      const logger = new Logger();
      const asyncFn = async () => {
        jest.advanceTimersByTime(500);
        throw new Error('Failure');
      };

      await expect(
        trackPerformance(logger, 'error-op', asyncFn),
      ).rejects.toThrow();

      const metrics = logger.getMetrics('error-op');
      expect(metrics?.duration).toBe(500);
    });
  });
});
