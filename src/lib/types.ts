/**
 * Type for file status
 */
export type FileStatus = 'modified' | 'deleted' | 'added';

/**
 * Interface for a changed file
 */
export interface ChangedFile {
  filePath: string;
  status: FileStatus;
}

/**
 * Interface for configuration options
 */
export type RepoConfig = {
  inputs: {
    powerOnsDirectory: string;
    letterFilesDirectory: string;
    dataFilesDirectory: string;
    helpFilesDirectory: string;
  };
  branchSymNumbers: Record<string, number>;
  installPowerOns: string[];
  validateIgnorePowerOns: string[];
  preserveServerFiles: string[];
};
