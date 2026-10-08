import type { CatalogOption } from '@/features/analysis/catalog';

/**
 * 金蝶标准单据通用的状态枚举。元数据里读不到可选项时，按字段标识兜底，
 * 让用户选「已审核」而不是自己猜代码。不同账套的自定义枚举不在这里。
 */
export const KNOWN_ENUMS: Record<string, CatalogOption[]> = {
  FDocumentStatus: [
    { value: 'Z', label: '暂存' },
    { value: 'A', label: '创建' },
    { value: 'B', label: '审核中' },
    { value: 'C', label: '已审核' },
    { value: 'D', label: '重新审核' },
  ],
  FCloseStatus: [
    { value: 'A', label: '未关闭' },
    { value: 'B', label: '已关闭' },
  ],
  FCancelStatus: [
    { value: 'A', label: '未作废' },
    { value: 'B', label: '已作废' },
  ],
  FMRPCloseStatus: [
    { value: 'A', label: '正常' },
    { value: 'B', label: '业务关闭' },
  ],
  FMRPFreezeStatus: [
    { value: 'A', label: '正常' },
    { value: 'B', label: '业务冻结' },
  ],
  FMRPTerminateStatus: [
    { value: 'A', label: '正常' },
    { value: 'B', label: '业务终止' },
  ],
};

export function knownOptions(field: string): CatalogOption[] {
  const key = field.trim().split('.').pop() ?? '';
  return KNOWN_ENUMS[key] ?? [];
}
