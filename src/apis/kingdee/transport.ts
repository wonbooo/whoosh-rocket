export const KINGDEE_JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
};

export const KINGDEE_UPSTREAM_HEADERS = {
  ...KINGDEE_JSON_HEADERS,
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
};

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function parseKingdeeBody<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('金蝶返回空响应');
  }
  return JSON.parse(trimmed) as T;
}
