/**
 * Structured logging utilities with performance tracking and metrics
 */

export interface LogContext {
  [key: string]: unknown;
}

export interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  itemsProcessed?: number;
  errorsEncountered?: number;
}

export interface TaskSummary {
  taskName: string;
  status: 'success' | 'failure';
  duration: number;
  filesProcessed: number;
  filesSucceeded: number;
  filesFailed: number;
  errors: string[];
  metadata?: LogContext;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LoggerOptions {
  verbose?: boolean;
  logPrefix?: string;
  enableTimings?: boolean;
}

/**
 * Structured logger with context, metrics, and performance tracking
 */
export class Logger {
  private options: Required<LoggerOptions>;
  private metrics: Map<string, PerformanceMetrics> = new Map();

  constructor(options: LoggerOptions = {}) {
    this.options = {
      verbose: options.verbose ?? false,
      logPrefix: options.logPrefix ?? '',
      enableTimings: options.enableTimings ?? true,
    };
  }

  /**
   * Formats a log message with optional prefix and context
   */
  private formatMessage(message: string, context?: LogContext): string {
    const prefix = this.options.logPrefix ? `${this.options.logPrefix} ` : '';
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `${prefix}${message}${contextStr}`;
  }

  /**
   * Log info level message
   */
  info(message: string, context?: LogContext): void {
    console.info(this.formatMessage(message, context));
  }

  /**
   * Log warning level message
   */
  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage(message, context));
  }

  /**
   * Log error level message
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext =
      error instanceof Error
        ? { ...context, error: error.message, stack: error.stack }
        : context;
    console.error(this.formatMessage(message, errorContext));
  }

  /**
   * Log debug level message (only in verbose mode)
   */
  debug(message: string, context?: LogContext): void {
    if (this.options.verbose) {
      console.info(this.formatMessage(`[DEBUG] ${message}`, context));
    }
  }

  /**
   * Start tracking performance for a named operation
   */
  startTimer(name: string): void {
    if (!this.options.enableTimings) return;

    this.metrics.set(name, {
      startTime: Date.now(),
      itemsProcessed: 0,
      errorsEncountered: 0,
    });

    this.debug(`Started: ${name}`);
  }

  /**
   * Stop tracking performance and return duration
   */
  endTimer(name: string): number | undefined {
    if (!this.options.enableTimings) return undefined;

    const metric = this.metrics.get(name);
    if (!metric) {
      this.warn(`No timer found for: ${name}`);
      return undefined;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    this.debug(`Completed: ${name}`, { duration: `${metric.duration}ms` });

    return metric.duration;
  }

  /**
   * Get metrics for a named operation
   */
  getMetrics(name: string): PerformanceMetrics | undefined {
    return this.metrics.get(name);
  }

  /**
   * Increment items processed counter for a named operation
   */
  incrementProcessed(name: string, count = 1): void {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.itemsProcessed = (metric.itemsProcessed ?? 0) + count;
    }
  }

  /**
   * Increment errors encountered counter for a named operation
   */
  incrementErrors(name: string, count = 1): void {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.errorsEncountered = (metric.errorsEncountered ?? 0) + count;
    }
  }

  /**
   * Log a summary report for a task
   */
  logSummary(summary: TaskSummary): void {
    const {
      taskName,
      status,
      duration,
      filesProcessed,
      filesSucceeded,
      filesFailed,
    } = summary;

    console.info('');
    console.info('='.repeat(60));
    console.info(`Task Summary: ${taskName}`);
    console.info('='.repeat(60));
    console.info(`Status: ${status.toUpperCase()}`);
    console.info(`Duration: ${this.formatDuration(duration)}`);
    console.info(`Files Processed: ${filesProcessed}`);
    console.info(`Files Succeeded: ${filesSucceeded}`);
    console.info(`Files Failed: ${filesFailed}`);

    if (summary.errors.length > 0) {
      console.info('');
      console.info('Errors:');
      summary.errors.forEach((error, index) => {
        console.info(`  ${index + 1}. ${error}`);
      });
    }

    if (summary.metadata && Object.keys(summary.metadata).length > 0) {
      console.info('');
      console.info('Additional Info:');
      Object.entries(summary.metadata).forEach(([key, value]) => {
        console.info(`  ${key}: ${value}`);
      });
    }

    console.info('='.repeat(60));
    console.info('');
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Log progress for an operation
   */
  logProgress(current: number, total: number, message?: string): void {
    const percentage = ((current / total) * 100).toFixed(1);
    const progressMsg = message
      ? `${message}: ${current}/${total} (${percentage}%)`
      : `Progress: ${current}/${total} (${percentage}%)`;

    this.info(progressMsg);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalPrefix: string): Logger {
    return new Logger({
      ...this.options,
      logPrefix: this.options.logPrefix
        ? `${this.options.logPrefix} ${additionalPrefix}`
        : additionalPrefix,
    });
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
  }
}

/**
 * Create a logger instance with optional configuration
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

/**
 * Performance tracking decorator for async functions
 */
export function trackPerformance<T>(
  logger: Logger,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  logger.startTimer(name);
  return fn()
    .then((result) => {
      logger.endTimer(name);
      return result;
    })
    .catch((error) => {
      logger.endTimer(name);
      logger.incrementErrors(name);
      throw error;
    });
}
