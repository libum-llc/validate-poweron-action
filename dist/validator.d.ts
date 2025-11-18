export interface ValidationConfig {
    symitarHostname: string;
    symNumber: string;
    symitarUserNumber: string;
    symitarUserPassword: string;
    apiKey?: string;
    connectionType: 'https' | 'ssh';
    poweronDirectory: string;
    targetBranch?: string;
    ignoreList: string[];
    logPrefix: string;
}
export interface ValidationResult {
    filesValidated: number;
    filesPassed: number;
    filesFailed: number;
    errors: string[];
}
export declare function validatePowerOns(config: ValidationConfig): Promise<ValidationResult>;
