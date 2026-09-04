export interface LicenseStatus {
  valid: boolean;
  machineId: string;
  expiresAt: string | null;
  reason: string;
}
