export const KINGDEE_FORM_IDS = {
  MATERIAL: 'BD_MATERIAL',
  CUSTOMER: 'BD_Customer',
  SUPPLIER: 'BD_Supplier',
  SALE_ORDER: 'SAL_SaleOrder',
  PURCHASE_ORDER: 'PUR_PurchaseOrder',
  PUR_REQUISITION: 'PUR_Requisition',
  SUB_SUBREQORDER: 'SUB_SUBREQORDER',
  IN_STOCK_APPLY: 'PRZG_RKSQD',
  IN_STOCK: 'STK_InStock',
  OUT_STOCK: 'STK_OutStock',
  VOUCHER: 'GL_VOUCHER',
} as const;

export type KingdeeFormId =
  (typeof KINGDEE_FORM_IDS)[keyof typeof KINGDEE_FORM_IDS] | (string & {});

export interface KingdeeConfig {
  serverUrl: string;
  acctId: string;
  username: string;
  password: string;
  appId: string;
  appSecret: string;
  lcid: number;
  orgNum: number;
}

export interface KingdeeLoginContext {
  SessionId?: string;
  UserToken?: string;
  UserName?: string;
  DBid?: string;
  CustomName?: string;
  DataCenterName?: string;
  CurrentOrganizationInfo?: {
    ID?: number;
    Name?: string;
  };
}

export interface KingdeeLoginResult {
  LoginResultType: number;
  Message?: string;
  KDSVCSessionId?: string;
  Context?: KingdeeLoginContext;
}

export interface KingdeeErrorItem {
  FieldName?: string;
  Message?: string;
  DIndex?: number;
}

export interface KingdeeResponseStatus {
  IsSuccess?: boolean;
  ErrorCode?: number;
  MsgCode?: number | string;
  Errors?: KingdeeErrorItem[];
  SuccessEntitys?: Array<{ Id?: number | string; Number?: string }>;
}

export interface KingdeeResultEnvelope<T = unknown> {
  Result?: T;
  ResponseStatus?: KingdeeResponseStatus;
}

export interface KingdeeAuthErrorPayload {
  error: 'authentication_failed';
  message: string;
  hint: string;
  original: unknown;
}

export interface BillQueryParams {
  formId: KingdeeFormId;
  fieldKeys: string;
  filterString?: string;
  orderString?: string;
  topCount?: number;
  startRow?: number;
  limit?: number;
}

export interface BillQueryPage<T = unknown> {
  rows: T[];
  rowCount: number;
  truncated: boolean;
  nextStartRow?: number;
  hint?: string;
}

export interface BillQueryAllResult<T = unknown> {
  rows: T[];
  rowCount: number;
  exhausted: boolean;
  nextStartRow?: number;
  hint?: string;
}

export interface BillCountResult {
  estimatedRows: number;
  isExact: boolean;
  hint?: string;
}

export interface BillRangeQueryParams {
  formId: KingdeeFormId;
  fieldKeys: string;
  dateField: string;
  dateFrom: string;
  dateTo: string;
  extraFilter?: string;
  chunk?: 'month' | 'week' | 'day';
  pageSize?: number;
}

export interface IdsPayload {
  CreateOrgId: number;
  Numbers: string[];
  Ids: string;
}

export interface ViewBillParams {
  formId: KingdeeFormId;
  number?: string;
  billId?: string;
}

export interface SaveBillParams {
  formId: KingdeeFormId;
  model: Record<string, unknown> | { Model: Record<string, unknown> };
}

export interface OperateBillParams {
  formId: KingdeeFormId;
  numbers?: string;
  ids?: string;
}

export interface ExecuteOperationParams extends OperateBillParams {
  opNumber: string;
}

export interface PushBillParams extends OperateBillParams {
  ruleId?: string;
  targetFormId?: string;
  targetOrgId?: string;
  targetBillTypeId?: string;
  isEnableDefaultRule?: boolean;
  customParams?: Record<string, unknown>;
}

export const KINGDEE_AUTH_FAIL_MSG_CODE = 1;
export const KINGDEE_AUTH_FAIL_MSG = '会话信息已丢失';
export const KINGDEE_AUTH_ERROR_KEY = 'authentication_failed';
