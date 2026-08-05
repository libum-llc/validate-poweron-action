/**
 * Base class for all PowerOn Pipelines errors
 * Provides context and proper error type information
 */
export class PowerOnError extends Error {
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: Error;

  constructor(
    message: string,
    context?: Record<string, unknown>,
    originalError?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.originalError = originalError;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Returns a formatted error message with context
   */
  getDetailedMessage(): string {
    const parts: string[] = [this.message];

    if (this.context && Object.keys(this.context).length > 0) {
      parts.push('\nContext:');
      for (const [key, value] of Object.entries(this.context)) {
        parts.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (this.originalError) {
      parts.push(`\nCaused by: ${this.originalError.message}`);
    }

    return parts.join('\n');
  }
}

/**
 * Error thrown when configuration loading or validation fails
 */
export class ConfigError extends PowerOnError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    originalError?: Error,
  ) {
    super(message, context, originalError);
  }
}

/**
 * Error thrown when PowerOn file validation fails
 */
export class ValidationError extends PowerOnError {
  public readonly invalidFiles?: Array<{ name: string; errors: string }>;

  constructor(
    message: string,
    invalidFiles?: Array<{ name: string; errors: string }>,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.invalidFiles = invalidFiles;
  }

  /**
   * Returns a formatted error message for Azure Pipelines
   */
  getAzureFormattedMessage(): string {
    if (!this.invalidFiles || this.invalidFiles.length === 0) {
      return this.message;
    }

    const details = this.invalidFiles
      .map(
        (po) =>
          `##[error] - ${po.name}\n${'##[error]'}\n` +
          po.errors
            .split('\n')
            .map((line) => `##[error]   ${line}`)
            .join('\n'),
      )
      .join('\n');

    return `${this.message}:\n${details}`;
  }
}

/**
 * Error thrown when connection to Symitar fails
 */
export class ConnectionError extends PowerOnError {
  public readonly hostname?: string;
  public readonly port?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    hostname?: string,
    port?: number,
    retryable = false,
    originalError?: Error,
  ) {
    super(
      message,
      {
        hostname,
        port,
        retryable,
      },
      originalError,
    );
    this.hostname = hostname;
    this.port = port;
    this.retryable = retryable;
  }
}

/**
 * Error thrown when API key validation fails
 */
export class AuthenticationError extends PowerOnError {
  public readonly apiKeyPrefix?: string;
  public readonly hostname?: string;

  constructor(
    message: string,
    apiKey?: string,
    hostname?: string,
    originalError?: Error,
  ) {
    // Only include the first 8 characters of the API key for security
    const apiKeyPrefix = apiKey ? apiKey.substring(0, 8) + '...' : undefined;

    super(
      message,
      {
        apiKeyPrefix,
        hostname,
      },
      originalError,
    );
    this.apiKeyPrefix = apiKeyPrefix;
    this.hostname = hostname;
  }
}

/**
 * Error thrown when symNumber is invalid or not found
 */
export class SymNumberError extends PowerOnError {
  public readonly branchName?: string;
  public readonly targetBranchName?: string;

  constructor(message: string, branchName?: string, targetBranchName?: string) {
    super(message, {
      branchName,
      targetBranchName,
    });
    this.branchName = branchName;
    this.targetBranchName = targetBranchName;
  }
}

/**
 * Error thrown when input validation fails
 */
export class InputError extends PowerOnError {
  public readonly inputName?: string;

  constructor(
    message: string,
    inputName?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { inputName, ...context });
    this.inputName = inputName;
  }
}

/**
 * Utility to wrap unknown errors in PowerOnError
 */
export function wrapError(
  error: unknown,
  message?: string,
  context?: Record<string, unknown>,
): PowerOnError {
  if (error instanceof PowerOnError) {
    return error;
  }

  if (error instanceof Error) {
    return new PowerOnError(message || error.message, context, error);
  }

  return new PowerOnError(message || 'An unknown error occurred', {
    ...context,
    originalError: error,
  });
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ConnectionError) {
    return error.retryable;
  }
  return false;
}
