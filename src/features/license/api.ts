import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/apis/kingdee/transport';
import type { LicenseStatus } from '@/features/license/types';

export function isLicenseEnforced(): boolean {
  return isTauriRuntime();
}

export async function fetchMachineId(): Promise<string> {
  return invoke<string>('get_machine_id');
}

export async function fetchLicenseStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('get_license_status');
}

export async function importLicense(content: string): Promise<LicenseStatus> {
  try {
    return await invoke<LicenseStatus>('import_license', { content });
  } catch (error) {
    throw toError(error);
  }
}

export async function issueLicense(
  password: string,
  machineId: string,
): Promise<string> {
  try {
    return await invoke<string>('issue_license', { password, machineId });
  } catch (error) {
    throw toError(error);
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string' && error.trim()) {
    return new Error(error);
  }
  return new Error('操作失败');
}
