import * as core from '@actions/core';
import { validatePowerOns } from './validator';

async function run(): Promise<void> {
  try {
    // Get inputs
    const symitarHostname = core.getInput('symitar-hostname', { required: true });
    const symNumber = core.getInput('sym-number', { required: true });
    const symitarUserNumber = core.getInput('symitar-user-number', { required: true });
    const symitarUserPassword = core.getInput('symitar-user-password', { required: true });
    const sshUsername = core.getInput('ssh-username', { required: true });
    const sshPassword = core.getInput('ssh-password', { required: true });
    const sshPort = parseInt(core.getInput('ssh-port', { required: false }) || '22', 10);
    const apiKey = core.getInput('api-key', { required: true });
    const connectionType = core.getInput('connection-type', { required: false }) || 'ssh';
    const poweronDirectory = core.getInput('poweron-directory', { required: false }) || 'REPWRITERSPECS/';
    const targetBranch = core.getInput('target-branch', { required: false });
    const validateIgnore = core.getInput('validate-ignore', { required: false }) || '';
    const logPrefix = '[ValidatePowerOn]';

    // Validate connection type
    if (connectionType !== 'https' && connectionType !== 'ssh') {
      throw new Error(`Invalid connection type: ${connectionType}. Must be "https" or "ssh"`);
    }

    // Parse ignore list
    const ignoreList = validateIgnore
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    core.info(`${logPrefix} Starting PowerOn validation`);
    core.info(`${logPrefix} Connection: ${connectionType.toUpperCase()}`);
    core.info(`${logPrefix} Hostname: ${symitarHostname}`);
    core.info(`${logPrefix} Sym: ${symNumber}`);
    core.info(`${logPrefix} Directory: ${poweronDirectory}`);

    if (ignoreList.length > 0) {
      core.info(`${logPrefix} Ignoring: ${ignoreList.join(', ')}`);
    }

    // Run validation
    const startTime = Date.now();
    const result = await validatePowerOns({
      symitarHostname,
      symNumber,
      symitarUserNumber,
      symitarUserPassword,
      sshUsername,
      sshPassword,
      sshPort,
      apiKey,
      connectionType: connectionType as 'https' | 'ssh',
      poweronDirectory,
      targetBranch,
      ignoreList,
      logPrefix,
    });

    const duration = Math.round((Date.now() - startTime) / 1000);

    // Set outputs
    core.setOutput('files-validated', result.filesValidated);
    core.setOutput('files-passed', result.filesPassed);
    core.setOutput('files-failed', result.filesFailed);
    core.setOutput('duration', duration);

    // Log summary
    core.info('');
    core.info(`${logPrefix} ========================================`);
    core.info(`${logPrefix} Validation Summary`);
    core.info(`${logPrefix} ========================================`);
    core.info(`${logPrefix} Files Validated: ${result.filesValidated}`);
    core.info(`${logPrefix} Files Passed: ${result.filesPassed}`);
    core.info(`${logPrefix} Files Failed: ${result.filesFailed}`);
    core.info(`${logPrefix} Duration: ${duration}s`);
    core.info(`${logPrefix} ========================================`);

    if (result.filesFailed > 0) {
      core.info('');
      core.error(`${logPrefix} Validation failed for ${result.filesFailed} file(s):`);
      for (const error of result.errors) {
        core.error(`${logPrefix} ${error}`);
      }
      core.setFailed(`Found ${result.filesFailed} invalid PowerOn file(s)`);
    } else {
      core.info(`${logPrefix} All PowerOn files validated successfully!`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}

run();
