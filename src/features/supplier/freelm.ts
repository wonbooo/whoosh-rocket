import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/apis/kingdee/transport';

export function freelmErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }
  return 'FreeLM 没有响应。';
}

export async function completeWithFreelm(input: {
  system: string;
  user: string;
}): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('当前不是桌面端，无法启动应用附带的 FreeLM。');
  }
  return invoke<string>('freelm_complete', {
    baseUrl: '',
    apiKey: '',
    model: '',
    system: input.system,
    user: input.user,
  });
}
