import type {
  ChartType,
  Dashboard,
  Dataset,
  FieldDisplay,
  FieldRef,
  Filter,
  RelativeDate,
  SeriesCase,
  Widget,
} from '@/features/analysis/types';

type FieldSpec = readonly [string, FieldDisplay];

interface DatasetSpec {
  name: string;
  formId: string;
  dimension: FieldSpec;
  grain?: 'month';
  measure?: FieldSpec;
  aggregation: 'sum' | 'count';
  columns?: FieldSpec[];
  seriesCases?: SeriesCase[];
  filters: Filter[];
  limit: number;
  chartType: ChartType;
  span?: 12 | 6;
  height?: number;
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  build: () => { datasets: Dataset[] };
}

export interface InstantiatedBoard {
  datasets: Dataset[];
  dashboard: Dashboard;
}

const APPROVED: Filter = {
  field: 'FDocumentStatus',
  operator: 'eq',
  value: 'C',
};

const NOT_FROZEN: Filter = {
  field: 'FMRPFreezeStatus',
  operator: 'eq',
  value: 'A',
};

const NOT_TERMINATED: Filter = {
  field: 'FMRPTerminateStatus',
  operator: 'eq',
  value: 'A',
};

const OPEN_ORDER: Filter[] = [
  APPROVED,
  { field: 'FCloseStatus', operator: 'eq', value: 'A' },
  { field: 'FMRPCloseStatus', operator: 'eq', value: 'A' },
  NOT_FROZEN,
  NOT_TERMINATED,
];

function relative(
  field: string,
  value: RelativeDate,
  operator: Filter['operator'] = 'eq',
): Filter {
  return { field, operator, value, valueMode: 'relativeDate' };
}

function ref([field, display]: FieldSpec): FieldRef {
  return { field, display };
}

function dataset(spec: DatasetSpec, templateId: string): Dataset {
  return {
    id: `template:${templateId}:${spec.name}`,
    name: spec.name,
    formId: spec.formId,
    dimension: ref(spec.dimension),
    grain: spec.grain ?? null,
    series: null,
    seriesCases: spec.seriesCases ?? [],
    measure: spec.measure ? ref(spec.measure) : { field: '', display: 'value' },
    aggregation: spec.aggregation,
    columns: (spec.columns ?? []).map(ref),
    filters: spec.filters,
    limit: spec.limit,
    chartType: spec.chartType,
    origin: { templateId },
  };
}

const ORDER_DETAIL: FieldSpec[] = [
  ['FBillNo', 'value'],
  ['FSupplierId', 'name'],
  ['FMaterialId', 'name'],
  ['FDeliveryDate', 'value'],
  ['FQty', 'value'],
];

const purchaseInbound: DatasetSpec[] = [
  {
    name: '今日应入库订单',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    filters: [
      APPROVED,
      NOT_FROZEN,
      NOT_TERMINATED,
      relative('FDeliveryDate', 'today'),
    ],
    limit: 20,
    chartType: 'kpi',
    height: 4,
  },
  {
    name: '逾期订单数',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    filters: [...OPEN_ORDER, relative('FDeliveryDate', 'today', 'lt')],
    limit: 20,
    chartType: 'kpi',
    height: 4,
  },
  {
    name: '收料待入库订单数',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    filters: [
      ...OPEN_ORDER,
      { field: 'FReceiveQty', operator: 'gt', value: '0' },
      {
        field: 'FStockInQty',
        operator: 'lt',
        value: 'FReceiveQty',
        valueMode: 'field',
      },
      relative('FDate', 'last365Days'),
    ],
    limit: 20,
    chartType: 'kpi',
    height: 4,
  },
  {
    name: '本月采购数',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    filters: [
      APPROVED,
      NOT_FROZEN,
      NOT_TERMINATED,
      relative('FDate', 'thisMonth'),
    ],
    limit: 20,
    chartType: 'kpi',
    height: 4,
  },
  {
    name: '今日应入库订单明细',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    columns: ORDER_DETAIL,
    filters: [
      APPROVED,
      NOT_FROZEN,
      NOT_TERMINATED,
      relative('FDeliveryDate', 'today'),
    ],
    limit: 20,
    chartType: 'kpi',
    span: 12,
  },
  {
    name: '逾期订单数明细',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    columns: ORDER_DETAIL,
    filters: [...OPEN_ORDER, relative('FDeliveryDate', 'today', 'lt')],
    limit: 20,
    chartType: 'kpi',
    span: 12,
  },
  {
    name: '收料待入库订单明细',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    columns: ORDER_DETAIL,
    filters: [
      ...OPEN_ORDER,
      { field: 'FReceiveQty', operator: 'gt', value: '0' },
      {
        field: 'FStockInQty',
        operator: 'lt',
        value: 'FReceiveQty',
        valueMode: 'field',
      },
      relative('FDate', 'last365Days'),
    ],
    limit: 20,
    chartType: 'kpi',
    span: 12,
  },
  {
    name: '本月采购明细',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FMaterialId', 'name'],
    aggregation: 'count',
    columns: ORDER_DETAIL,
    filters: [
      APPROVED,
      NOT_FROZEN,
      NOT_TERMINATED,
      relative('FDate', 'thisMonth'),
    ],
    limit: 20,
    chartType: 'kpi',
    span: 12,
  },
  {
    name: '订单收料明细',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FBillNo', 'value'],
    aggregation: 'count',
    columns: [
      ...ORDER_DETAIL,
      ['FReceiveQty', 'value'],
      ['FStockInQty', 'value'],
    ],
    filters: [APPROVED],
    limit: 50,
    chartType: 'bar',
    span: 12,
  },
  {
    name: '采购金额·订单',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FDate', 'value'],
    grain: 'month',
    measure: ['FAllAmount', 'value'],
    aggregation: 'sum',
    filters: [APPROVED, relative('FDate', 'thisMonth')],
    limit: 12,
    chartType: 'bar-stacked',
    span: 12,
  },
  {
    name: '采购金额·入库',
    formId: 'STK_InStock',
    dimension: ['FDate', 'value'],
    grain: 'month',
    measure: ['FAllAmount', 'value'],
    aggregation: 'sum',
    filters: [APPROVED, relative('FDate', 'thisMonth')],
    limit: 12,
    chartType: 'bar-stacked',
  },
  {
    name: '采购金额·退料',
    formId: 'PUR_MRB',
    dimension: ['FDate', 'value'],
    grain: 'month',
    measure: ['FAllAmount', 'value'],
    aggregation: 'sum',
    filters: [APPROVED, relative('FDate', 'thisMonth')],
    limit: 12,
    chartType: 'bar-stacked',
  },
  {
    name: '逾期订单统计',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FDeliveryDate', 'value'],
    grain: 'month',
    aggregation: 'count',
    seriesCases: [
      {
        label: '逾期',
        field: 'FDeliveryDate',
        operator: 'lt',
        value: 'today',
        valueMode: 'relativeDate',
      },
      {
        label: '未逾期',
        field: 'FDeliveryDate',
        operator: 'gt',
        value: 'today',
        valueMode: 'relativeDate',
      },
    ],
    filters: [APPROVED, relative('FDeliveryDate', 'last6Months')],
    limit: 12,
    chartType: 'bar',
  },
  {
    name: '供应商排名',
    formId: 'PUR_PurchaseOrder',
    dimension: ['FSupplierId', 'name'],
    measure: ['FBillAllAmount', 'value'],
    aggregation: 'sum',
    filters: [APPROVED],
    limit: 10,
    chartType: 'bar-horizontal',
  },
];

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'purchase-inbound',
    name: '采购入库看板',
    description:
      '今日应入库、逾期、收料待入库、本月采购的指标卡和明细，加上采购金额、逾期统计和供应商排名',
    build: () => ({
      datasets: purchaseInbound.map((spec) =>
        dataset(spec, 'purchase-inbound'),
      ),
    }),
  },
];

export function templateSpans(templateId: string): number[] {
  if (templateId === 'purchase-inbound') {
    return purchaseInbound.map((spec) => spec.span ?? 6);
  }
  return [];
}

function templateHeights(templateId: string): number[] {
  if (templateId === 'purchase-inbound') {
    return purchaseInbound.map((spec) => spec.height ?? 8);
  }
  return [];
}

const AMOUNT_SOURCES = ['采购金额·入库', '采购金额·退料'];

export function instantiateTemplate(
  template: BoardTemplate,
): InstantiatedBoard {
  const { datasets } = template.build();
  const byName = new Map(datasets.map((item) => [item.name, item.id]));
  const spans = templateSpans(template.id);
  const heights = templateHeights(template.id);
  let cursor = 0;
  let rowHeight = 0;
  const widgets: Widget[] = datasets.map((item, index) => {
    const width = spans[index] ?? 6;
    const height = heights[index] ?? 8;
    const x = width >= 12 || cursor + width > 12 ? 0 : cursor;
    const y = x === 0 ? rowHeight : rowHeight - height;
    cursor = x + width;
    rowHeight = x === 0 ? rowHeight + height : Math.max(rowHeight, y + height);
    return {
      id: crypto.randomUUID(),
      title: item.name,
      datasetId: item.id,
      chartType: item.chartType,
      sources:
        item.name === '采购金额·订单'
          ? AMOUNT_SOURCES.map((name) => byName.get(name)).filter(
              (id): id is string => id != null,
            )
          : [],
      layout: { x, y, w: width, h: height },
    };
  });
  return {
    datasets,
    dashboard: {
      id: crypto.randomUUID(),
      name: template.name,
      filters: [],
      widgets,
    },
  };
}
