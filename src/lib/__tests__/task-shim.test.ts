import * as core from '@actions/core';

import { getInput, setVariable, warning } from '../task-shim';

jest.mock('@actions/core');

const coreMock = core as jest.Mocked<typeof core>;

describe('task-shim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getInput', () => {
    it('reads the kebab-case action input for a pipelines input name', () => {
      coreMock.getInput.mockReturnValue('https');

      expect(getInput('connectionType', true)).toBe('https');
      expect(coreMock.getInput).toHaveBeenCalledWith('connection-type', {
        required: true,
      });
    });

    it('defaults to an optional input when required is omitted', () => {
      coreMock.getInput.mockReturnValue('');

      expect(getInput('connectionType')).toBe('');
      expect(coreMock.getInput).toHaveBeenCalledWith('connection-type', {
        required: false,
      });
    });
  });

  describe('warning', () => {
    it('forwards the message to the runner', () => {
      warning('server managed files');

      expect(coreMock.warning).toHaveBeenCalledWith('server managed files');
    });
  });

  describe('setVariable', () => {
    it.each([
      ['filesValidated', 'files-validated'],
      ['filesPassed', 'files-passed'],
      ['filesFailed', 'files-failed'],
    ])('publishes %s as the %s action output', (name, outputName) => {
      setVariable(name, '3', false, true);

      expect(coreMock.setOutput).toHaveBeenCalledWith(outputName, '3');
      expect(coreMock.setSecret).not.toHaveBeenCalled();
    });

    it('masks secret values before publishing them', () => {
      setVariable('apiKey', 'super-secret', true, true);

      expect(coreMock.setSecret).toHaveBeenCalledWith('super-secret');
      expect(coreMock.setOutput).toHaveBeenCalledWith(
        'api-key',
        'super-secret',
      );
    });
  });
});
