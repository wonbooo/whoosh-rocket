import {
  execute,
  executeData,
  executeForm,
  loginByAppSecret,
} from '@/apis/kingdee/client';
import {
  buildDateFilter,
  buildIdsPayload,
  iterDateChunks,
  wrapModelData,
  wrapQueryResult,
  buildWorkflowAuditPayload,
} from '@/apis/kingdee/utils';
import type {
  BillCountResult,
  BillQueryAllResult,
  BillQueryPage,
  BillQueryParams,
  BillRangeQueryParams,
  ExecuteOperationParams,
  OperateBillParams,
  PushBillParams,
  SaveBillParams,
  ViewBillParams,
} from '@/types/kingdee';

const PROBE_LIMIT = 5000;

function queryPayload(params: BillQueryParams) {
  const topCount = params.topCount ?? 100;
  const startRow = params.startRow ?? 0;
  const limit = params.limit ?? 2000;
  return {
    payload: {
      FormId: params.formId,
      FieldKeys: params.fieldKeys,
      FilterString: params.filterString ?? '',
      OrderString: params.orderString ?? '',
      TopRowCount: topCount > 0 ? startRow + topCount : 0,
      StartRow: startRow,
      Limit: topCount > 0 ? topCount : limit,
    },
    topCount,
    startRow,
    limit,
  };
}

function asRowList<T>(data: unknown): T[] {
  if (!Array.isArray(data)) {
    throw new Error('金蝶查询未返回列表数据');
  }
  return data as T[];
}

export const kingdeeApi = {
  login: loginByAppSecret,

  async queryBill<T = unknown[]>(
    params: BillQueryParams,
  ): Promise<BillQueryPage<T>> {
    const { payload, topCount, startRow, limit } = queryPayload(params);
    const data = await executeData<unknown>('ExecuteBillQuery', payload);
    return wrapQueryResult(asRowList<T>(data), topCount, limit, startRow);
  },

  async queryBillJson<T = Record<string, unknown>>(
    params: BillQueryParams,
  ): Promise<BillQueryPage<T>> {
    const { payload, topCount, startRow, limit } = queryPayload(params);
    const data = await executeData<unknown>('BillQuery', payload);
    return wrapQueryResult(asRowList<T>(data), topCount, limit, startRow);
  },

  async countBill(formId: string, filterString = ''): Promise<BillCountResult> {
    const data = await executeData<unknown>('BillQuery', {
      FormId: formId,
      FieldKeys: 'FID',
      FilterString: filterString,
      TopRowCount: PROBE_LIMIT,
      StartRow: 0,
      Limit: PROBE_LIMIT,
    });
    const rows = asRowList(data);
    const estimatedRows = rows.length;
    const isExact = estimatedRows < PROBE_LIMIT;
    return {
      estimatedRows,
      isExact,
      ...(isExact
        ? {}
        : {
            hint: `实际行数 ≥ ${PROBE_LIMIT}，建议按自然月分片查询。`,
          }),
    };
  },

  async queryBillAll<T = Record<string, unknown>>(
    params: Omit<BillQueryParams, 'topCount' | 'startRow' | 'limit'> & {
      maxRows?: number;
      pageSize?: number;
    },
  ): Promise<BillQueryAllResult<T>> {
    const maxRows = params.maxRows ?? 20_000;
    const pageSize = params.pageSize ?? 2000;
    const { rows, exhausted, nextStartRow } = await paginateBill<T>(
      {
        FormId: params.formId,
        FieldKeys: params.fieldKeys,
        FilterString: params.filterString ?? '',
        OrderString: params.orderString ?? '',
      },
      pageSize,
      maxRows,
    );

    return {
      rows,
      rowCount: rows.length,
      exhausted,
      ...(exhausted
        ? {}
        : {
            nextStartRow,
            hint: '已达 maxRows 安全上限，请缩小过滤条件或改用 queryBillRange。',
          }),
    };
  },

  async queryBillRange<T = Record<string, unknown>>(
    params: BillRangeQueryParams,
  ): Promise<BillQueryAllResult<T> & { chunks: number }> {
    const chunks = iterDateChunks(
      params.dateFrom,
      params.dateTo,
      params.chunk ?? 'month',
    );
    const pageSize = params.pageSize ?? 2000;
    const rows: T[] = [];

    for (const [from, to] of chunks) {
      const page = await paginateBill<T>(
        {
          FormId: params.formId,
          FieldKeys: params.fieldKeys,
          FilterString: buildDateFilter(
            params.dateField,
            from,
            to,
            params.extraFilter,
          ),
          OrderString: '',
        },
        pageSize,
        20_000,
      );
      rows.push(...page.rows);
    }

    return {
      rows,
      rowCount: rows.length,
      exhausted: true,
      chunks: chunks.length,
    };
  },

  async exportBillCsv(params: BillQueryParams): Promise<Blob> {
    const result = await kingdeeApi.queryBillAll<Record<string, unknown>>({
      ...params,
      maxRows: 100_000,
    });
    const fields = params.fieldKeys
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const header = fields.join(',');
    const lines = result.rows.map((row) =>
      fields.map((field) => csvCell(row[field])).join(','),
    );
    return new Blob([[header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
  },

  viewBill(params: ViewBillParams) {
    return executeForm('View', params.formId, {
      CreateOrgId: 0,
      Number: params.number ?? '',
      Id: params.billId ?? '',
      IsSortBySeq: 'false',
    });
  },

  queryMetadata(formId: string) {
    return executeData('QueryBusinessInfo', { FormId: formId });
  },

  queryGroupInfo(groupFieldKey: string) {
    return executeData('QueryGroupInfo', { GroupFieldKey: groupFieldKey });
  },

  saveBill(params: SaveBillParams) {
    return executeForm('Save', params.formId, wrapModelData(params.model));
  },

  batchSave(formId: string, model: unknown) {
    return executeForm('BatchSave', formId, model);
  },

  draftBill(params: SaveBillParams) {
    return executeForm('Draft', params.formId, wrapModelData(params.model));
  },

  submitBill(params: OperateBillParams) {
    return executeForm(
      'Submit',
      params.formId,
      buildIdsPayload(params.numbers, params.ids),
    );
  },

  auditBill(params: OperateBillParams) {
    return executeForm(
      'Audit',
      params.formId,
      buildIdsPayload(params.numbers, params.ids),
    );
  },

  workflowAudit(
    params: OperateBillParams & { userName?: string; opinion?: string },
  ) {
    return execute(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.WorkflowAudit',
      [
        JSON.stringify(
          buildWorkflowAuditPayload({
            formId: params.formId,
            numbers: params.numbers,
            ids: params.ids,
            userName: params.userName,
            opinion: params.opinion,
          }),
        ),
      ],
    );
  },

  unauditBill(params: OperateBillParams) {
    return executeForm(
      'UnAudit',
      params.formId,
      buildIdsPayload(params.numbers, params.ids),
    );
  },

  deleteBill(params: OperateBillParams) {
    return executeForm(
      'Delete',
      params.formId,
      buildIdsPayload(params.numbers, params.ids),
    );
  },

  allocateBill(params: OperateBillParams) {
    return executeForm(
      'Allocate',
      params.formId,
      buildIdsPayload(params.numbers, params.ids),
    );
  },

  executeOperation(params: ExecuteOperationParams) {
    return execute(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExcuteOperation',
      [
        params.formId,
        params.opNumber,
        JSON.stringify(buildIdsPayload(params.numbers, params.ids)),
      ],
    );
  },

  pushBill(params: PushBillParams) {
    const data: Record<string, unknown> = {
      Numbers: buildIdsPayload(params.numbers, params.ids).Numbers,
      Ids: params.ids ?? '',
      RuleId: params.ruleId ?? '',
      TargetFormId: params.targetFormId ?? '',
      TargetOrgId: params.targetOrgId ?? '0',
      TargetBillTypeId: params.targetBillTypeId ?? '',
      IsEnableDefaultRule:
        params.isEnableDefaultRule === false ? 'false' : 'true',
      IsDraftWhenSaveFail: params.isDraftWhenSaveFail ? 'true' : 'false',
    };
    if (params.customParams) {
      data.CustomParams = params.customParams;
    }
    return executeForm('Push', params.formId, data);
  },

  switchOrg(orgNumber: string) {
    return executeData('SwitchOrg', { OrgNumber: orgNumber });
  },

  getSysReportData(formId: string, data: unknown) {
    return executeForm('GetSysReportData', formId, data);
  },
};

async function paginateBill<T>(
  params: {
    FormId: string;
    FieldKeys: string;
    FilterString: string;
    OrderString: string;
  },
  pageSize: number,
  maxRows: number,
): Promise<{ rows: T[]; exhausted: boolean; nextStartRow: number }> {
  const rows: T[] = [];
  let currentStart = 0;

  while (true) {
    const data = await executeData<unknown>('BillQuery', {
      ...params,
      StartRow: currentStart,
      TopRowCount: currentStart + pageSize,
      Limit: pageSize,
    });
    const page = asRowList<T>(data);
    rows.push(...page);

    if (rows.length >= maxRows) {
      return {
        rows: rows.slice(0, maxRows),
        exhausted: false,
        nextStartRow: maxRows,
      };
    }

    if (page.length < pageSize) {
      return {
        rows,
        exhausted: true,
        nextStartRow: rows.length,
      };
    }

    currentStart += pageSize;
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
