import axios, { type AxiosError } from 'axios';
import { useKingdeeStore } from '@/store/useKingdeeStore';
import type { KingdeeConfig, KingdeeLoginResult } from '@/types/kingdee';
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
  return {
    serverUrl: normalizeBaseUrl(
      import.meta.env.VITE_KD_SERVER_URL || '/k3cloud/',
    ),
    acctId: import.meta.env.VITE_KD_ACCT_ID ?? '',
    username: import.meta.env.VITE_KD_USERNAME ?? '',
    appId: import.meta.env.VITE_KD_APP_ID ?? '',
    appSecret: import.meta.env.VITE_KD_APP_SEC ?? '',
    lcid: Number(import.meta.env.VITE_KD_LCID ?? 2052),
    orgNum: Number(import.meta.env.VITE_KD_ORG_NUM ?? 0),
  };
}

const http = axios.create({
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const sessionId = useKingdeeStore.getState().sessionId;
  if (sessionId) {
    config.headers['kdservice-sessionid'] = sessionId;
  }
  return config;
});

function serviceUrl(serviceName: string): string {
  const { serverUrl } = getKingdeeConfig();
  return `${serverUrl}${serviceName}.common.kdsvc`;
}

function isAuthService(serviceName: string): boolean {
  return AUTH_SERVICES.some((item) => serviceName.includes(item));
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
    const { data } = await http.post<T>(serviceUrl(serviceName), body);
    if (isAuthFailure(data)) {
      useKingdeeStore.getState().clearSession();
      throw new KingdeeAuthError(wrapAuthError(data));
    }
    return data;
  } catch (error) {
    if (error instanceof KingdeeAuthError) {
      throw error;
    }
    const axiosError = error as AxiosError;
    throw new KingdeeError(
      axiosError.message || '金蝶接口调用失败',
      axiosError.response?.data,
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
    .setSession(sessionId, result.Context?.UserName ?? config.username);
  return result;
}

async function ensureSession(): Promise<void> {
  if (useKingdeeStore.getState().sessionId) {
    return;
  }
  await loginByAppSecret();
}

export async function getDataCenters(): Promise<unknown> {
  return execute(
    'Kingdee.BOS.ServiceFacade.ServicesStub.Account.AccountService.GetDataCenterList',
  );
}
