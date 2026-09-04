import {
  KINGDEE_AUTH_ERROR_KEY,
  KINGDEE_AUTH_FAIL_MSG,
  KINGDEE_AUTH_FAIL_MSG_CODE,
  type KingdeeAuthErrorPayload,
  type IdsPayload,
  type KingdeeResponseStatus,
} from '@/types/kingdee';

export function splitCsv(value = ''): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildIdsPayload(numbers = '', ids = ''): IdsPayload {
  return {
    CreateOrgId: 0,
    Numbers: splitCsv(numbers),
    Ids: splitCsv(ids),
  };
}

export function wrapModelData(model: Record<string, unknown>): {
  Model: Record<string, unknown>;
} {
  if (
    model.Model &&
    typeof model.Model === 'object' &&
    !Array.isArray(model.Model)
  ) {
    return model as { Model: Record<string, unknown> };
  }
  return { Model: model };
}

export function asMsgCode(value: unknown): number | null {
  if (typeof value === 'boolean' || value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function* responseStatuses(
  data: unknown,
): Generator<KingdeeResponseStatus> {
  if (Array.isArray(data)) {
    for (const item of data) {
      yield* responseStatuses(item);
    }
    return;
  }

  if (!data || typeof data !== 'object') {
    return;
  }

  const record = data as Record<string, unknown>;
  const status = record.ResponseStatus;
  if (status && typeof status === 'object') {
    yield status as KingdeeResponseStatus;
  }

  const result = record.Result;
  if (result && typeof result === 'object') {
    yield* responseStatuses(result);
  }
}

export function isAuthFailure(data: unknown): boolean {
  if (
    data &&
    typeof data === 'object' &&
    (data as KingdeeAuthErrorPayload).error === KINGDEE_AUTH_ERROR_KEY
  ) {
    return true;
  }

  for (const status of responseStatuses(data)) {
    const msgCode = asMsgCode(status.MsgCode);
    if (msgCode === KINGDEE_AUTH_FAIL_MSG_CODE) {
      return true;
    }
    if (msgCode != null) {
      continue;
    }
    for (const err of status.Errors ?? []) {
      if ((err.Message ?? '').includes(KINGDEE_AUTH_FAIL_MSG)) {
        return true;
      }
    }
  }

  return false;
}

export const AUTH_ERROR_HINT =
  '这是认证失败，不是会话过期，重试无效。请核对账套、用户、应用 ID / 密钥、语言是否与金蝶「第三方系统登录授权」一致，以及该授权是否启用。';

export function wrapAuthError(original: unknown): KingdeeAuthErrorPayload {
  return {
    error: KINGDEE_AUTH_ERROR_KEY,
    message:
      '金蝶返回「会话信息已丢失，请重新登录」，但这是认证失败，不是会话过期。',
    hint: AUTH_ERROR_HINT,
    original,
  };
}

export function wrapQueryResult<T>(
  data: T[],
  topCount: number,
  limit: number,
  startRow: number,
): {
  rows: T[];
  rowCount: number;
  truncated: boolean;
  nextStartRow?: number;
  hint?: string;
} {
  const rowCount = data.length;
  const cap = topCount > 0 ? topCount : limit;
  const truncated = rowCount > 0 && rowCount >= cap;
  return {
    rows: data,
    rowCount,
    truncated,
    ...(truncated
      ? {
          nextStartRow: startRow + rowCount,
          hint: `返回行数已达上限（${cap} 行），数据可能被截断。请用 startRow=${startRow + rowCount} 继续翻页。`,
        }
      : {}),
  };
}

export function buildDateFilter(
  dateField: string,
  dateFrom: string,
  dateTo: string,
  extraFilter = '',
): string {
  const dateFilter = `${dateField} >= '${dateFrom}' AND ${dateField} < '${dateTo}'`;
  return extraFilter ? `(${extraFilter}) AND ${dateFilter}` : dateFilter;
}

export function iterDateChunks(
  dateFrom: string,
  dateTo: string,
  chunk: 'month' | 'week' | 'day',
): Array<[string, string]> {
  const current = parseIsoDate(dateFrom);
  const end = parseIsoDate(dateTo);
  if (end <= current) {
    throw new Error('dateTo 必须晚于 dateFrom');
  }

  const ranges: Array<[string, string]> = [];
  let cursor = current;
  while (cursor < end) {
    const next = nextChunkDate(cursor, chunk);
    const chunkEnd = next < end ? next : end;
    ranges.push([formatIsoDate(cursor), formatIsoDate(chunkEnd)]);
    cursor = chunkEnd;
  }
  return ranges;
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`日期格式错误（需要 YYYY-MM-DD）: ${value}`);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatIsoDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextChunkDate(current: Date, chunk: 'month' | 'week' | 'day'): Date {
  if (chunk === 'month') {
    return new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }
  if (chunk === 'week') {
    return new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 7,
    );
  }
  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + 1,
  );
}
