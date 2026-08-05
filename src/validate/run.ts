import * as tl from 'azure-pipelines-task-lib/task';

import { getChangedFilesInDir } from '@lib/utils';
import { ChangedFile } from '@lib/types';
import {
  createHTTPsClient,
  createSSHClient,
  loadValidateConfig,
  validateTaskApiKey,
  getSyncTransport,
  DEFAULT_SYNC_COMPARE_MODE,
} from '@lib/task-orchestration';
import { ValidationError } from '@lib/errors';
import { createLogger, type TaskSummary } from '@lib/logger';
import {
  filterChangedFilesWithReport,
  mapDeployedToChangedFiles,
  collectInvalidPowerOns,
  determineValidationMode,
  normalizeValidationErrors,
  formatErrorsForSummary,
  calculateValidationStats,
  type ValidationResult,
  type SkippedFile,
} from '@lib/validation-utils';
import {
  formatChangedFileReason,
  formatComparisonStrategy,
} from '@lib/change-debug';
import {
  findUnpreservedServerManagedFiles,
  formatServerManagedFilesWarning,
} from '@lib/server-managed-files';

export interface ValidatePowerOnTaskDependencies {
  task: typeof tl;
  loadConfig: typeof loadValidateConfig;
  validateApiKey: typeof validateTaskApiKey;
  createHttpsClient: typeof createHTTPsClient;
  createSshClient: typeof createSSHClient;
  getGitChangedFiles: typeof getChangedFilesInDir;
  createTaskLogger: typeof createLogger;
  filterChangedFiles: typeof filterChangedFilesWithReport;
  registerCleanup: (
    event: 'exit' | 'SIGINT' | 'SIGTERM',
    listener: () => void,
  ) => void;
}

const productionDependencies: ValidatePowerOnTaskDependencies = {
  task: tl,
  loadConfig: loadValidateConfig,
  validateApiKey: validateTaskApiKey,
  createHttpsClient: createHTTPsClient,
  createSshClient: createSSHClient,
  getGitChangedFiles: getChangedFilesInDir,
  createTaskLogger: createLogger,
  filterChangedFiles: filterChangedFilesWithReport,
  registerCleanup: (event, listener) => process.on(event, listener),
};

export async function runValidatePowerOnTask(
  dependencies: ValidatePowerOnTaskDependencies = productionDependencies,
): Promise<string> {
  const {
    task,
    loadConfig,
    validateApiKey,
    createHttpsClient,
    createSshClient,
    getGitChangedFiles,
    createTaskLogger,
    filterChangedFiles,
    registerCleanup,
  } = dependencies;

  const config = loadConfig();

  // Create logger with task prefix
  const logger = createTaskLogger({
    logPrefix: config.logPrefix,
    verbose: config.debug,
  });
  logger.startTimer('validation');

  // Validate API key
  await validateApiKey(config.apiKey, config.symitarHostname);

  // Determine connection type
  const connectionType = task.getInput('connectionType', true) as
    'https' | 'ssh';

  logger.info(
    `Using ${connectionType.toUpperCase()} connection to ${config.symitarHostname}`,
  );
  logger.info(`Sync method: ${config.syncMethod.toUpperCase()}`);

  // Log ignore list if any
  if (config.validateIgnore.length > 0) {
    logger.info(`Ignoring: ${config.validateIgnore.join(', ')}`);
  }

  if (config.preserveServerFiles.length > 0) {
    logger.info(
      `Preserving server files: ${config.preserveServerFiles.join(', ')}`,
    );
  }

  // Determine validation mode
  const validationMode = determineValidationMode(
    config.targetBranch,
    config.buildBranch,
  );

  // Initialize changed files
  let changedFiles: ChangedFile[] = [];

  // Create client and worker based on connection type
  let validateFn: (filePath: string) => Promise<{
    isValid: boolean;
    errors: string[] | string;
  }>;

  // Helper to log skipped files
  const logSkippedFiles = (skippedFiles: SkippedFile[]) => {
    if (skippedFiles.length > 0) {
      logger.info(`Skipping ${skippedFiles.length} file(s):`);
      for (const skipped of skippedFiles) {
        logger.info(
          `- ${skipped.filePath.replace(config.powerOnsDirectory, '')} (${skipped.reason})`,
        );
      }
    }
  };

  const logNonPrChangeReasons = (fileNames: string[]) => {
    logger.debug(
      formatComparisonStrategy(config.syncMethod, DEFAULT_SYNC_COMPARE_MODE),
    );
    fileNames.forEach((fileName) =>
      logger.debug(
        formatChangedFileReason(
          fileName,
          DEFAULT_SYNC_COMPARE_MODE,
          'local',
          'Sym',
        ),
      ),
    );
  };

  const warnAboutServerManagedFiles = (files: ChangedFile[]) => {
    const serverManagedFiles = findUnpreservedServerManagedFiles(
      files.map((file) => file.filePath),
      config.preserveServerFiles,
    );
    if (serverManagedFiles.length > 0) {
      task.warning(formatServerManagedFilesWarning(serverManagedFiles));
    }
  };

  if (connectionType === 'https') {
    const client = createHttpsClient(config);

    if (validationMode === 'git-diff') {
      logger.info(
        `Beginning validation for check in to '${config.targetBranchName}', using Sym ${config.symNumber}`,
      );
      // Changed files via git diff
      const rawChangedFiles = getGitChangedFiles(
        config.targetBranch,
        config.powerOnsDirectory,
      );
      warnAboutServerManagedFiles(rawChangedFiles);
      const { filesToValidate, skippedFiles } = await filterChangedFiles(
        rawChangedFiles,
        config.validateIgnore,
        config.preserveServerFiles,
      );
      logSkippedFiles(skippedFiles);
      changedFiles = filesToValidate;
    } else if (validationMode === 'hash-comparison') {
      logger.info(
        `Beginning validation for '${config.buildBranchName}' build, using Sym ${config.symNumber}`,
      );

      const { deployed } = await client.getChangedFiles(
        config.powerOnsDirectory,
        undefined,
        undefined,
        {
          transport: getSyncTransport(config.syncMethod),
          compareMode: DEFAULT_SYNC_COMPARE_MODE,
        },
      );
      logNonPrChangeReasons(deployed);

      // Changed files via hash diff on Symitar
      const rawChangedFiles = mapDeployedToChangedFiles(
        deployed,
        config.powerOnsDirectory,
      );
      warnAboutServerManagedFiles(rawChangedFiles);
      const { filesToValidate, skippedFiles } = await filterChangedFiles(
        rawChangedFiles,
        config.validateIgnore,
        config.preserveServerFiles,
      );
      logSkippedFiles(skippedFiles);
      changedFiles = filesToValidate;
    }

    validateFn = (filePath: string) =>
      client.validatePowerOn(filePath, {
        localIncludeDir: config.powerOnsDirectory,
      });

    // Cleanup function
    const cleanup = () => client.end();
    registerCleanup('exit', cleanup);
    registerCleanup('SIGINT', cleanup);
    registerCleanup('SIGTERM', cleanup);
  } else {
    // SSH
    const client = await createSshClient(config);

    const worker = await client.createValidateWorker({
      symNumber: config.symNumber,
      symitarUserNumber: config.symitarUserNumber,
      symitarUserPassword: config.symitarUserPassword,
    });

    if (validationMode === 'git-diff') {
      logger.info(
        `Beginning validation for check in to '${config.targetBranchName}', using Sym ${config.symNumber}`,
      );
      // Changed files via git diff
      const rawChangedFiles = getGitChangedFiles(
        config.targetBranch,
        config.powerOnsDirectory,
      );
      warnAboutServerManagedFiles(rawChangedFiles);
      const { filesToValidate, skippedFiles } = await filterChangedFiles(
        rawChangedFiles,
        config.validateIgnore,
        config.preserveServerFiles,
      );
      logSkippedFiles(skippedFiles);
      changedFiles = filesToValidate;
    } else if (validationMode === 'hash-comparison') {
      logger.info(
        `Beginning validation for '${config.buildBranchName}' build, using Sym ${config.symNumber}`,
      );

      const { deployed } = await client.getChangedFiles(
        {
          symNumber: config.symNumber,
          symitarUserNumber: config.symitarUserNumber,
          symitarUserPassword: config.symitarUserPassword,
        },
        config.powerOnsDirectory,
        undefined,
        undefined,
        {
          transport: getSyncTransport(config.syncMethod),
          compareMode: DEFAULT_SYNC_COMPARE_MODE,
        },
      );
      logNonPrChangeReasons(deployed);

      // Changed files via hash diff on Symitar
      const rawChangedFiles = mapDeployedToChangedFiles(
        deployed,
        config.powerOnsDirectory,
      );
      warnAboutServerManagedFiles(rawChangedFiles);
      const { filesToValidate, skippedFiles } = await filterChangedFiles(
        rawChangedFiles,
        config.validateIgnore,
        config.preserveServerFiles,
      );
      logSkippedFiles(skippedFiles);
      changedFiles = filesToValidate;
    }

    validateFn = (filePath: string) =>
      worker.validatePowerOn(filePath, {
        localIncludeDir: config.powerOnsDirectory,
      });

    // Cleanup function
    const cleanup = () => client.end();
    registerCleanup('exit', cleanup);
    registerCleanup('SIGINT', cleanup);
    registerCleanup('SIGTERM', cleanup);
  }

  if (changedFiles.length === 0) {
    logger.info(
      `No changed PowerOn files found comparing ${config.powerOnsDirectory} directory with Sym ${config.symNumber} on ${config.symitarHostname}`,
    );

    // Set output variables
    task.setVariable('filesValidated', '0', false, true);
    task.setVariable('filesPassed', '0', false, true);
    task.setVariable('filesFailed', '0', false, true);

    return 'No changed PowerOn files found';
  }

  // Log the changed PowerOn files
  logger.info(
    `Found ${changedFiles.length} changed PowerOn${changedFiles.length === 1 ? '' : 's'} in ${config.powerOnsDirectory} directory:`,
  );

  for (const file of changedFiles) {
    logger.info(
      `- ${file.filePath.replace(config.powerOnsDirectory, '')} (${file.status})`,
    );
  }

  // Validate the changed PowerOns sequentially
  logger.info(
    `Validating ${changedFiles.length} PowerOn${changedFiles.length === 1 ? '' : 's'}...`,
  );

  const validationResults: ValidationResult[] = [];

  for (let i = 0; i < changedFiles.length; i++) {
    const file = changedFiles[i];
    const fileName = file.filePath.replace(config.powerOnsDirectory, '');
    logger.info(`Validating ${fileName}...`);
    logger.debug(`Validating ${file.filePath}`);

    const { isValid, errors } = await validateFn(file.filePath);

    if (isValid) {
      logger.debug(`${file.filePath} is valid`);
    }

    validationResults.push({
      file,
      isValid,
      errors: normalizeValidationErrors(errors),
    });
  }

  // Collect invalid PowerOns
  const invalidPowerOns = collectInvalidPowerOns(
    validationResults,
    config.powerOnsDirectory,
  );

  // End timer and create summary
  const duration = logger.endTimer('validation') ?? 0;

  const summary: TaskSummary = {
    taskName: `Validate PowerOn (${connectionType.toUpperCase()})`,
    status: invalidPowerOns.length === 0 ? 'success' : 'failure',
    duration,
    filesProcessed: changedFiles.length,
    filesSucceeded: changedFiles.length - invalidPowerOns.length,
    filesFailed: invalidPowerOns.length,
    errors: formatErrorsForSummary(invalidPowerOns),
    metadata: {
      symNumber: config.symNumber,
      symitarHostname: config.symitarHostname,
      directory: config.powerOnsDirectory,
      connectionType: connectionType.toUpperCase(),
      syncMethod: config.syncMethod.toUpperCase(),
    },
  };

  logger.logSummary(summary);

  // Set output variables
  const stats = calculateValidationStats(
    changedFiles.length,
    invalidPowerOns.length,
  );

  task.setVariable(
    'filesValidated',
    stats.filesValidated.toString(),
    false,
    true,
  );
  task.setVariable('filesPassed', stats.filesPassed.toString(), false, true);
  task.setVariable('filesFailed', stats.filesFailed.toString(), false, true);

  // Throw an error if any PowerOns are invalid
  if (invalidPowerOns.length > 0) {
    throw new ValidationError(
      `Found ${invalidPowerOns.length} invalid PowerOn${invalidPowerOns.length === 1 ? '' : 's'}`,
      invalidPowerOns,
      {
        totalFiles: changedFiles.length,
        invalidCount: invalidPowerOns.length,
      },
    );
  }

  return 'Successfully validated all changed PowerOns';
}
