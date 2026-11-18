import {
  createQuestClient,
  createLogger,
  filterChangedFilesWithReport,
  validateApiKey,
  type ValidatePowerOnTaskDependencies,
} from '@libum-llc/pipelines-core';
import { createGitHubTaskHost } from '../lib/github-task-host';
import { getChangedFilesInDir } from '../lib/utils';
import { loadValidateConfig } from '../lib/task-orchestration';

// Core resolves local paths against config.workspacePath and owns the single connector.
export const validatePowerOnDependencies: ValidatePowerOnTaskDependencies = {
  task: createGitHubTaskHost(),
  loadConfig: loadValidateConfig,
  validateApiKey,
  createQuestClient,
  getGitChangedFiles: getChangedFilesInDir,
  createTaskLogger: createLogger,
  filterChangedFiles: (files, ignoreList, preserveServerFiles, baseDirectory) =>
    filterChangedFilesWithReport(
      files,
      ignoreList,
      preserveServerFiles,
      baseDirectory ?? process.env.GITHUB_WORKSPACE ?? undefined,
    ),
  registerCleanup: (event, listener) => process.on(event, listener),
};
