import axios, { type AxiosError } from 'axios';
import { useKingdeeStore } from '@/store/useKingdeeStore';
import type { KingdeeConfig, KingdeeLoginResult } from '@/types/kingdee';
import {
  isTauriRuntime,
  parseKingdeeBody,
  KINGDEE_JSON_HEADERS,
  KINGDEE_UPSTREAM_HEADERS,
} from '@/apis/kingdee/transport';
import { isAuthFailure, wrapAuthError } from '@/apis/kingdee/utils';

const AUTH_SERVICES = [
  'AuthService.LoginByAppSecret',
  'AuthService.ValidateUser',
  'AccountService.GetDataCenterList',
];

export class KingdeeError extends Error {
  readonly payload?: unknown;

  constructor(message: string, payload?: unknown) {
    super(message);
    this.name = 'KingdeeError';
    this.payload = payload;
  }
}

export class KingdeeAuthError extends KingdeeError {
  constructor(payload: unknown) {
    super('金蝶认证失败', payload);
    this.name = 'KingdeeAuthError';
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function getKingdeeConfig(): KingdeeConfig {
  const stored = useKingdeeStore.getState();
  return {
    serverUrl: normalizeBaseUrl(
      stored.serverUrl || import.meta.env.VITE_KD_SERVER_URL || '/k3cloud/',
    ),
    acctId: stored.acctName || import.meta.env.VITE_KD_ACCT_ID || '',
    username: stored.username || import.meta.env.VITE_KD_USERNAME || '',
    password: stored.password || '',
    appId: import.meta.env.VITE_KD_APP_ID ?? '',
    appSecret: import.meta.env.VITE_KD_APP_SEC ?? '',
    lcid: Number(import.meta.env.VITE_KD_LCID ?? 2052),
    orgNum: Number(import.meta.env.VITE_KD_ORG_NUM ?? 0),
  };
}

function serviceUrl(serviceName: string): string {
  const { serverUrl } = getKingdeeConfig();
  return `${serverUrl}${serviceName}.common.kdsvc`;
}

function isAuthService(serviceName: string): boolean {
  return AUTH_SERVICES.some((item) => serviceName.includes(item));
}

function payloadMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return undefined;
}

export function formatLoginSuccessToast(
  result: KingdeeLoginResult,
  fallbackName = '',
): { title: string; description: string } {
  const userName = result.Context?.UserName?.trim() || fallbackName || '用户';
  const company =
    result.Context?.CustomName?.trim() ||
    result.Context?.DataCenterName?.trim() ||
    '';

  return {
    title: '登录成功',
    description: company ? `${userName}，${company}` : `欢迎回来，${userName}`,
  };
}

export function formatKingdeeError(error: unknown): string {
  if (error instanceof KingdeeError) {
    const extra = payloadMessage(error.payload);
    if (extra && extra !== error.message) {
      return extra;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '请检查连接信息';
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const sessionId = useKingdeeStore.getState().sessionId;
  const sessionHeaders: Record<string, string> = {};
  if (sessionId) {
    sessionHeaders['kdservice-sessionid'] = sessionId;
  }

  if (isTauriRuntime()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...KINGDEE_UPSTREAM_HEADERS, ...sessionHeaders },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new KingdeeError(
        `金蝶接口 HTTP ${response.status}`,
        text || response.statusText,
      );
    }
    return parseKingdeeBody<T>(text);
  }

  try {
    const { data } = await axios.post<T>(
      `/__kingdee?target=${encodeURIComponent(url)}`,
      body,
      {
        timeout: 120_000,
        headers: {
          ...KINGDEE_JSON_HEADERS,
          ...sessionHeaders,
          'X-Kingdee-Url': url,
        },
      },
    );
    return data;
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const payload = axiosError.response?.data;
    throw new KingdeeError(
      payloadMessage(payload) ||
        (status ? `金蝶接口 HTTP ${status}` : axiosError.message) ||
        '金蝶接口调用失败',
      payload,
    );
  }
}

export async function execute<T = unknown>(
  serviceName: string,
  parameters: unknown[] = [],
): Promise<T> {
  if (!isAuthService(serviceName)) {
    await ensureSession();
  }

  const body = {
    format: 1,
    useragent: 'ApiClient',
    rid: crypto.randomUUID(),
    parameters,
    timestamp: String(Math.floor(Date.now() / 1000)),
    v: '1.0',
  };

  try {
    const data = await postJson<T>(serviceUrl(serviceName), body);
    if (isAuthFailure(data)) {
      useKingdeeStore.getState().clearSession();
      throw new KingdeeAuthError(wrapAuthError(data));
    }
    return data;
  } catch (error) {
    if (error instanceof KingdeeAuthError || error instanceof KingdeeError) {
      throw error;
    }
    throw new KingdeeError(
      error instanceof Error ? error.message : '金蝶接口调用失败',
      error,
    );
  }
}

export async function executeForm<T = unknown>(
  method: string,
  formId: string,
  data: unknown,
): Promise<T> {
  return execute<T>(
    `Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.${method}`,
    [formId, JSON.stringify(data)],
  );
}

export async function executeData<T = unknown>(
  method: string,
  data: unknown,
): Promise<T> {
  return execute<T>(
    `Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.${method}`,
    [data],
  );
}

export async function loginByAppSecret(): Promise<KingdeeLoginResult> {
  const config = getKingdeeConfig();
  const missing = (
    [
      ['VITE_KD_ACCT_ID', config.acctId],
      ['VITE_KD_USERNAME', config.username],
      ['VITE_KD_APP_ID', config.appId],
      ['VITE_KD_APP_SEC', config.appSecret],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new KingdeeError(`缺少金蝶配置: ${missing.join(', ')}`);
  }

  const result = await execute<KingdeeLoginResult>(
    'Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret',
    [
      config.acctId,
      config.username,
      config.appId,
      config.appSecret,
      String(config.lcid),
    ],
  );

  applyLoginResult(result, config.username);
  return result;
}

export async function loginByPassword(): Promise<KingdeeLoginResult> {
  const stored = useKingdeeStore.getState();
  if (
    !stored.serverUrl ||
    !stored.acctName ||
    !stored.username ||
    !stored.password
  ) {
    throw new KingdeeError('请先在设置中填写金蝶连接信息');
  }

  const config = getKingdeeConfig();
  const result = await execute<KingdeeLoginResult>(
    'Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser',
    [config.acctId, config.username, config.password, config.lcid],
  );

  applyLoginResult(result, config.username);
  return result;
}

function applyLoginResult(result: KingdeeLoginResult, fallbackName: string) {
  if (result?.LoginResultType !== 1) {
    throw new KingdeeAuthError(
      wrapAuthError(result ?? { Message: '登录未返回成功状态' }),
    );
  }

  const sessionId =
    result.KDSVCSessionId ||
    result.Context?.SessionId ||
    result.Context?.UserToken;

  if (!sessionId) {
    throw new KingdeeError('登录成功但未返回会话 ID', result);
  }

  useKingdeeStore
    .getState()
    .setSession(
      sessionId,
      result.Context?.UserName ?? fallbackName,
      result.Context?.CurrentOrganizationInfo?.ID ?? null,
    );
}

async function ensureSession(): Promise<void> {
  if (useKingdeeStore.getState().sessionId) {
    return;
  }
  const { password } = useKingdeeStore.getState();
  if (password) {
    await loginByPassword();
    return;
  }
  await loginByAppSecret();
}

export async function getDataCenters(): Promise<unknown> {
  return execute(
    'Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService.GetDataCenterList',
  );
}
