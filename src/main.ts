import * as core from '@actions/core';
import { validatePowerOns } from './validator';
import { version } from '../package.json';
import { AuthenticationError, ConnectionError } from './subscription';

function parseListInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function run(): Promise<void> {
  const logPrefix = '[ValidatePowerOn]';

  try {
    // Get inputs
    const symitarHostname = core.getInput('symitar-hostname', { required: true });
    const symNumberInput = core.getInput('sym-number', { required: true });
    const symNumber = symNumberInput.padStart(3, '0');
    const symitarUserNumber = core.getInput('symitar-user-number', { required: true });
    const symitarUserPassword = core.getInput('symitar-user-password', { required: true });
    const sshUsername = core.getInput('ssh-username', { required: true });
    const sshPassword = core.getInput('ssh-password', { required: true });
    const sshPortInput = core.getInput('ssh-port', { required: false }) || '22';
    const apiKey = core.getInput('api-key', { required: true }).trim();
    const symitarAppPort = core.getInput('symitar-app-port', { required: false });
    const connectionType = core.getInput('connection-type', { required: false }) || 'ssh';
    const poweronDirectory =
      core.getInput('poweron-directory', { required: false }) || 'REPWRITERSPECS/';
    const targetBranch = core.getInput('target-branch', { required: false });
    const validateIgnore = core.getInput('validate-ignore', { required: false }) || '';
    const preserveServerFilesInput =
      core.getInput('preserve-server-files', { required: false }) || '';
    const debug = core.getInput('debug', { required: false }) === 'true';
    const syncMethod = core.getInput('sync-method', { required: false }) || 'sftp';

    // Mask sensitive information
    core.setSecret(apiKey);
    core.setSecret(symitarUserPassword);
    core.setSecret(sshPassword);

    // Validate connection type
    if (connectionType !== 'https' && connectionType !== 'ssh') {
      throw new Error(`Invalid connection type: ${connectionType}. Must be "https" or "ssh"`);
    }

    // Validate sync method
    if (syncMethod !== 'rsync' && syncMethod !== 'sftp') {
      throw new Error(`Invalid sync method: ${syncMethod}. Must be "rsync" or "sftp"`);
    }

    // Validate hostname format
    if (!symitarHostname.match(/^[a-zA-Z0-9.-]+$/)) {
      throw new Error(`Invalid hostname format: ${symitarHostname}`);
    }

    // Validate and parse SSH port
    const sshPort = parseInt(sshPortInput, 10);
    if (isNaN(sshPort) || sshPort < 1 || sshPort > 65535) {
      throw new Error(`Invalid SSH port: ${sshPortInput}. Must be between 1-65535`);
    }

    // Validate HTTPS-specific requirements
    if (connectionType === 'https' && !symitarAppPort) {
      throw new Error('symitar-app-port is required when using HTTPS connection type');
    }

    // Validate and parse Symitar app port if provided
    if (symitarAppPort) {
      const port = parseInt(symitarAppPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid symitar-app-port: ${symitarAppPort}. Must be between 1-65535`);
      }
    }

    // Parse ignore list
    const ignoreList = parseListInput(validateIgnore);
    const preserveServerFiles = parseListInput(preserveServerFilesInput);

    core.info(`${logPrefix} Starting PowerOn validation (v${version})`);
    core.info(`${logPrefix} Connection Type: ${connectionType.toUpperCase()}`);
    core.info(`${logPrefix} Sync Method: ${syncMethod.toUpperCase()}`);
    core.info(`${logPrefix} Hostname: ${symitarHostname}`);
    core.info(`${logPrefix} Sym: ${symNumber}`);
    core.info(`${logPrefix} Directory: ${poweronDirectory}`);
    core.info(`${logPrefix} API Key: ${apiKey ? '✓ provided' : '✗ missing'}`);

    // Log connection-specific details
    if (connectionType === 'ssh') {
      core.info(`${logPrefix} SSH Username: ${sshUsername}`);
      core.info(`${logPrefix} SSH Port: ${sshPort}`);
    } else {
      core.info(`${logPrefix} Symitar App Port: ${symitarAppPort}`);
    }

    if (ignoreList.length > 0) {
      core.info(`${logPrefix} Ignoring: ${ignoreList.join(', ')}`);
    }

    if (preserveServerFiles.length > 0) {
      core.info(`${logPrefix} Preserving server files: ${preserveServerFiles.join(', ')}`);
    }

    if (debug) {
      core.info(`${logPrefix} Debug mode: enabled`);
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
      symitarAppPort: symitarAppPort ? parseInt(symitarAppPort, 10) : undefined,
      connectionType: connectionType as 'https' | 'ssh',
      poweronDirectory,
      targetBranch,
      ignoreList,
      preserveServerFiles,
      logPrefix,
      debug,
      syncMethod: syncMethod as 'rsync' | 'sftp',
    });

    // Set outputs
    core.setOutput('files-validated', result.filesValidated);
    core.setOutput('files-passed', result.filesPassed);
    core.setOutput('files-failed', result.filesFailed);

    // Log summary
    core.info('');
    core.info(`${logPrefix} ========================================`);
    core.info(`${logPrefix} Validation Summary`);
    core.info(`${logPrefix} ========================================`);
    core.info(`${logPrefix} Files Validated: ${result.filesValidated}`);
    if (result.validatedFiles.length > 0) {
      core.info(`${logPrefix} Validated Files:`);
      for (const file of result.validatedFiles) {
        core.info(`${logPrefix}   - ${file}`);
      }
    }
    core.info(`${logPrefix} Files Passed: ${result.filesPassed}`);
    core.info(`${logPrefix} Files Failed: ${result.filesFailed}`);
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
    // Handle authentication and connection errors specially
    if (error instanceof AuthenticationError) {
      core.error(`${logPrefix} Authentication failed: ${error.message}`);
      core.error(`${logPrefix} API Key: ${error.apiKey ? '***' : 'not provided'}`);
      core.error(`${logPrefix} Host: ${error.host}`);
      if (error.stack) {
        core.debug(`${logPrefix} Stack trace: ${error.stack}`);
      }
      core.setFailed(`API key validation failed: ${error.message}`);
    } else if (error instanceof ConnectionError) {
      core.error(`${logPrefix} Connection failed: ${error.message}`);
      core.error(`${logPrefix} Host: ${error.host}:${error.port}`);
      if (error.originalError) {
        core.error(`${logPrefix} Original error: ${error.originalError.message}`);
        if (error.originalError.stack) {
          core.debug(`${logPrefix} Original stack trace: ${error.originalError.stack}`);
        }
      }
      if (error.stack) {
        core.debug(`${logPrefix} Stack trace: ${error.stack}`);
      }
      core.setFailed(`Failed to connect to license server: ${error.message}`);
    } else if (error instanceof Error) {
      core.error(`${logPrefix} Unexpected error: ${error.message}`);
      if (error.stack) {
        core.debug(`${logPrefix} Stack trace: ${error.stack}`);
      }
      core.setFailed(error.message);
    } else {
      core.error(`${logPrefix} Unknown error: ${String(error)}`);
      core.setFailed(String(error));
    }
  }
}

run();
