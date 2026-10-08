import { useEffect, useState } from 'react';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import { formatKingdeeError } from '@/apis/kingdee/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SuggestInput } from '@/components/shared/SuggestInput';
import { ChartView } from '@/features/analysis/ChartView';
import type { ColumnHeader } from '@/features/analysis/ChartView';
import type { FieldCatalog } from '@/features/analysis/catalog';
import { knownOptions } from '@/features/analysis/enums';
import { FORM_OPTIONS, formLabel } from '@/features/analysis/forms';
import { CHART_TYPES } from '@/features/analysis/chartSpec';
import { RELATIVE_DATES, validateDataset } from '@/features/analysis/model';
import {
  loadCatalog,
  runMerged,
  runQuery,
  type QueryChartResult,
} from '@/features/analysis/query';
import { useAnalysisStore } from '@/features/analysis/store';
import {
  BOARD_TEMPLATES,
  instantiateTemplate,
} from '@/features/analysis/templates';
import type {
  ChartType,
  Dashboard,
  Dataset,
  FieldDisplay,
  FieldRef,
  Filter,
  FilterOperator,
  FilterValueMode,
  RelativeDate,
  SeriesCase,
  Widget,
} from '@/features/analysis/types';
import { useToast } from '@/hooks/use-toast';
import { useKingdeeStore } from '@/store/useKingdeeStore';

const FILTER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
];

const VALUE_MODES: { value: FilterValueMode; label: string }[] = [
  { value: 'literal', label: '固定值' },
  { value: 'field', label: '字段' },
  { value: 'relativeDate', label: '相对日期' },
];

const RELATIVE_DATE_LABELS: Record<RelativeDate, string> = {
  today: '今天',
  thisMonth: '本月',
  last6Months: '最近 6 个月',
  last365Days: '最近 365 天',
};

function newId(): string {
  return crypto.randomUUID();
}

function blankDataset(): Dataset {
  return {
    id: newId(),
    name: '',
    formId: '',
    dimension: { field: '', display: 'name' },
    grain: null,
    series: null,
    seriesCases: [],
    measure: { field: '', display: 'value' },
    aggregation: 'sum',
    columns: [],
    filters: [],
    limit: 20,
    chartType: 'bar',
  };
}

export function AnalysisPage() {
  const { toast } = useToast();
  const datasets = useAnalysisStore((state) => state.datasets);
  const dashboards = useAnalysisStore((state) => state.dashboards);
  const saveDataset = useAnalysisStore((state) => state.saveDataset);
  const deleteDataset = useAnalysisStore((state) => state.deleteDataset);
  const saveDashboard = useAnalysisStore((state) => state.saveDashboard);
  const deleteDashboard = useAnalysisStore((state) => state.deleteDashboard);
  const applyTemplate = useAnalysisStore((state) => state.applyTemplate);

  const [editing, setEditing] = useState<Dataset | null>(null);
  const [openDashboard, setOpenDashboard] = useState<string | null>(null);

  const dashboard = dashboards.find((item) => item.id === openDashboard);

  return (
    <div className="px-6 py-8">
      <h1 className="mb-6 text-lg font-medium">数据分析</h1>
      {dashboard ? (
        <DashboardView
          dashboard={dashboard}
          datasets={datasets}
          onBack={() => setOpenDashboard(null)}
          onDelete={() => {
            deleteDashboard(dashboard.id);
            setOpenDashboard(null);
          }}
        />
      ) : editing ? (
        <DatasetEditor
          dataset={editing}
          onCancel={() => setEditing(null)}
          onSave={(dataset) => {
            saveDataset(dataset);
            setEditing(null);
            toast({ title: '数据集已保存', description: dataset.name });
          }}
        />
      ) : (
        <Overview
          datasets={datasets}
          dashboards={dashboards}
          onEditDataset={setEditing}
          onCreateDataset={() => setEditing(blankDataset())}
          onDeleteDataset={deleteDataset}
          onOpenDashboard={setOpenDashboard}
          onCreateDashboard={() => {
            const created: Dashboard = {
              id: newId(),
              name: `看板 ${dashboards.length + 1}`,
              filters: [],
              widgets: [],
            };
            saveDashboard(created);
            setOpenDashboard(created.id);
          }}
          onApplyTemplate={(templateId) => {
            const template = BOARD_TEMPLATES.find(
              (item) => item.id === templateId,
            );
            if (!template) {
              return;
            }
            const board = instantiateTemplate(template);
            applyTemplate(board);
            setOpenDashboard(board.dashboard.id);
            toast({
              title: '已从模板创建',
              description: `${board.dashboard.name}，含 ${board.datasets.length} 个数据集，可直接编辑微调`,
            });
          }}
        />
      )}
    </div>
  );
}

function Overview({
  datasets,
  dashboards,
  onEditDataset,
  onCreateDataset,
  onDeleteDataset,
  onOpenDashboard,
  onCreateDashboard,
  onApplyTemplate,
}: {
  datasets: Dataset[];
  dashboards: Dashboard[];
  onEditDataset: (dataset: Dataset) => void;
  onCreateDataset: () => void;
  onDeleteDataset: (id: string) => void;
  onOpenDashboard: (id: string) => void;
  onCreateDashboard: () => void;
  onApplyTemplate: (templateId: string) => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium">数据集</h2>
          <Button type="button" size="sm" onClick={onCreateDataset}>
            新建数据集
          </Button>
        </header>
        {datasets.length === 0 ? (
          <p className="text-sm text-zinc-500">还没有数据集。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {datasets.map((dataset) => (
              <li
                key={dataset.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">{dataset.name}</div>
                  <div className="text-xs text-zinc-500">
                    {dataset.formId} · {dataset.dimension.field}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onEditDataset(dataset)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteDataset(dataset.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium">看板</h2>
          <div className="flex gap-2">
            <select
              aria-label="从模板创建"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  onApplyTemplate(event.target.value);
                }
              }}
            >
              <option value="">从模板创建</option>
              {BOARD_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" onClick={onCreateDashboard}>
              新建看板
            </Button>
          </div>
        </header>
        {dashboards.length === 0 ? (
          <p className="text-sm text-zinc-500">还没有看板。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50"
                  onClick={() => onOpenDashboard(dashboard.id)}
                >
                  <div className="text-sm font-medium">{dashboard.name}</div>
                  <div className="text-xs text-zinc-500">
                    {dashboard.widgets.length} 个图表
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fieldOptions(catalog: FieldCatalog | null) {
  return (catalog?.fields ?? []).map((field) => ({
    value: field.key,
    label: `${field.name}（${field.key}）`,
  }));
}

function valueOptions(catalog: FieldCatalog | null, field: string) {
  const fromCatalog = catalog?.fields.find((item) => item.key === field.trim());
  return fromCatalog && fromCatalog.options.length > 0
    ? fromCatalog.options
    : knownOptions(field);
}

function FilterValueInput({
  field,
  value,
  catalog,
  onChange,
}: {
  field: string;
  value: string;
  catalog: FieldCatalog | null;
  onChange: (value: string) => void;
}) {
  const options = valueOptions(catalog, field);
  if (options.length === 0) {
    return (
      <Input
        className="flex-1"
        placeholder="值"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <select
      aria-label="值"
      className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
      value={options.some((option) => option.value === value) ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">请选择</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function FilterRows({
  filters,
  catalog,
  onChange,
}: {
  filters: Filter[];
  catalog: FieldCatalog | null;
  onChange: (filters: Filter[]) => void;
}) {
  const updateAt = (index: number, patch: Partial<Filter>) =>
    onChange(
      filters.map((filter, current) =>
        current === index ? { ...filter, ...patch } : filter,
      ),
    );
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-zinc-600">过滤条件</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...filters, { field: '', operator: 'eq', value: '' }])
          }
        >
          添加条件
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {filters.map((filter, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex-1">
              <SuggestInput
                value={filter.field}
                placeholder="字段"
                options={fieldOptions(catalog)}
                onChange={(field) => updateAt(index, { field })}
              />
            </div>
            <select
              className="h-9 w-24 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filter.operator}
              onChange={(event) =>
                updateAt(index, {
                  operator: event.target.value as FilterOperator,
                })
              }
            >
              {FILTER_OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 w-28 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filter.valueMode ?? 'literal'}
              onChange={(event) => {
                const valueMode = event.target.value as FilterValueMode;
                updateAt(index, {
                  valueMode,
                  value: valueMode === 'relativeDate' ? 'today' : '',
                });
              }}
            >
              {VALUE_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            {(filter.valueMode ?? 'literal') === 'relativeDate' ? (
              <select
                className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                value={filter.value}
                onChange={(event) =>
                  updateAt(index, { value: event.target.value })
                }
              >
                {RELATIVE_DATES.map((token) => (
                  <option key={token} value={token}>
                    {RELATIVE_DATE_LABELS[token]}
                  </option>
                ))}
              </select>
            ) : (filter.valueMode ?? 'literal') === 'field' ? (
              <div className="flex-1">
                <SuggestInput
                  value={filter.value}
                  placeholder="比较字段"
                  options={fieldOptions(catalog)}
                  onChange={(value) => updateAt(index, { value })}
                />
              </div>
            ) : (
              <FilterValueInput
                field={filter.field}
                value={filter.value}
                catalog={catalog}
                onChange={(value) => updateAt(index, { value })}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange(filters.filter((_, current) => current !== index))
              }
            >
              移除
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

const DISPLAYS: { value: FieldDisplay; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'number', label: '编码' },
  { value: 'value', label: '原值' },
];

function FieldInput({
  label,
  field,
  catalog,
  onChange,
}: {
  label: string;
  field: FieldRef;
  catalog: FieldCatalog | null;
  onChange: (field: FieldRef) => void;
}) {
  const lookup = catalog?.fields.find((item) => item.key === field.field);
  const showDisplay =
    Boolean(lookup?.lookupFormId) || field.field.includes('.');
  return (
    <div className="flex flex-col gap-1.5 text-sm text-zinc-600">
      {label}
      <div className="flex gap-2">
        <div className="flex-1">
          <SuggestInput
            value={field.field}
            placeholder="输入中文名或字段标识筛选"
            options={(catalog?.fields ?? []).map((item) => ({
              value: item.key,
              label: `${item.name}（${item.key}）`,
            }))}
            onChange={(next) =>
              onChange({
                field: next,
                display: next === field.field ? field.display : 'name',
              })
            }
          />
        </div>
        {showDisplay ? (
          <select
            aria-label={`${label}显示`}
            className="h-9 w-24 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
            value={field.display}
            onChange={(event) =>
              onChange({
                ...field,
                display: event.target.value as FieldDisplay,
              })
            }
          >
            {DISPLAYS.map((display) => (
              <option key={display.value} value={display.value}>
                {display.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

function DatasetEditor({
  dataset,
  onCancel,
  onSave,
}: {
  dataset: Dataset;
  onCancel: () => void;
  onSave: (dataset: Dataset) => void;
}) {
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Dataset>(dataset);
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [preview, setPreview] = useState<QueryChartResult | null>(null);
  const [querying, setQuerying] = useState(false);

  const update = (patch: Partial<Dataset>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const requireConnection = (): boolean => {
    if (sessionId) {
      return true;
    }
    toast({
      title: '请先连接金蝶',
      description: '点击右上角「连接金蝶」完成登录后再操作',
    });
    return false;
  };

  const handleLoadCatalog = () => loadCatalogFor(draft.formId);

  const loadCatalogFor = async (formId: string) => {
    if (!requireConnection()) {
      return;
    }
    if (!formId.trim()) {
      toast({ title: '请先填写表单 ID' });
      return;
    }
    setLoadingCatalog(true);
    try {
      const loaded = await loadCatalog(formId.trim());
      setCatalog(loaded);
      toast({
        title: '已读取字段',
        description: `${loaded.formName}，共 ${loaded.fields.length} 个字段`,
      });
    } catch (error) {
      toast({
        title: '读取字段失败',
        description: formatKingdeeError(error),
        variant: 'destructive',
      });
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handlePreview = async () => {
    if (!requireConnection()) {
      return;
    }
    const check = validateDataset(draft);
    if (!check.valid) {
      toast({ title: '配置不完整', description: check.message });
      return;
    }
    setQuerying(true);
    try {
      const result = await runQuery(draft);
      setPreview(result);
      if (result.rows.length === 0 && result.detail.length === 0) {
        toast({
          title: '没有可绘制的数据',
          description:
            result.fetched === 0
              ? '查询没有返回行，请检查表单 ID、字段和过滤条件'
              : '度量字段不是数值。要按两个文本字段交叉统计，请把第二个字段填到「拆分系列」，度量留空并把聚合方式改为计数；要求和、请把度量换成数量或金额字段',
        });
      }
    } catch (error) {
      toast({
        title: '查询失败',
        description: formatKingdeeError(error),
        variant: 'destructive',
      });
    } finally {
      setQuerying(false);
    }
  };

  const updateCase = (index: number, patch: Partial<SeriesCase>) =>
    update({
      seriesCases: draft.seriesCases.map((item, current) =>
        current === index ? { ...item, ...patch } : item,
      ),
    });

  const handleSave = () => {
    const check = validateDataset(draft);
    if (!check.valid) {
      toast({ title: '配置不完整', description: check.message });
      return;
    }
    onSave(draft);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm text-zinc-600">
          数据集名称
          <Input
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-zinc-600">
            表单
            <SuggestInput
              value={draft.formId}
              placeholder="输入中文名或标识筛选，如 销售订单"
              options={FORM_OPTIONS.map((option) => ({
                value: option.id,
                label: formLabel(option),
              }))}
              onChange={(formId) => {
                update({ formId });
                setCatalog(null);
              }}
              onPick={(option) => {
                void loadCatalogFor(option.value);
              }}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={loadingCatalog}
            onClick={() => {
              void handleLoadCatalog();
            }}
          >
            {loadingCatalog ? '读取中...' : '读取字段'}
          </Button>
        </div>
        <FieldInput
          label="维度（横轴）"
          field={draft.dimension}
          catalog={catalog}
          onChange={(dimension) => update({ dimension })}
        />
        <label className="flex items-end gap-2 pb-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            className="mb-0.5"
            checked={draft.grain === 'month'}
            onChange={(event) =>
              update({ grain: event.target.checked ? 'month' : null })
            }
          />
          按月分组（维度为日期时）
        </label>
        <FieldInput
          label="拆分系列（可选）"
          field={draft.series ?? { field: '', display: 'name' }}
          catalog={catalog}
          onChange={(series) =>
            update({ series: series.field.trim() ? series : null })
          }
        />
        <FieldInput
          label="度量（数值）"
          field={draft.measure}
          catalog={catalog}
          onChange={(measure) => update({ measure })}
        />
        <label className="flex flex-col gap-1.5 text-sm text-zinc-600">
          聚合方式
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={draft.aggregation}
            onChange={(event) =>
              update({
                aggregation: event.target.value as Dataset['aggregation'],
              })
            }
          >
            <option value="sum">求和</option>
            <option value="count">计数</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-zinc-600">
          显示组数上限
          <Input
            type="number"
            min={1}
            value={draft.limit}
            onChange={(event) =>
              update({ limit: Number(event.target.value) || 0 })
            }
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-zinc-600">
          图表类型
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={draft.chartType}
            onChange={(event) =>
              update({ chartType: event.target.value as ChartType })
            }
          >
            {CHART_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-zinc-600">
              明细列（可选，生成明细表）
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                update({
                  columns: [...draft.columns, { field: '', display: 'value' }],
                })
              }
            >
              添加列
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {draft.columns.map((column, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <SuggestInput
                    value={column.field}
                    placeholder="列字段"
                    options={fieldOptions(catalog)}
                    onChange={(field) =>
                      update({
                        columns: draft.columns.map((item, current) =>
                          current === index
                            ? {
                                ...item,
                                field,
                                display:
                                  field === item.field ? item.display : 'name',
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </div>
                <select
                  aria-label="列显示"
                  className="h-9 w-24 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={column.display}
                  onChange={(event) =>
                    update({
                      columns: draft.columns.map((item, current) =>
                        current === index
                          ? {
                              ...item,
                              display: event.target.value as FieldDisplay,
                            }
                          : item,
                      ),
                    })
                  }
                >
                  {DISPLAYS.map((display) => (
                    <option key={display.value} value={display.value}>
                      {display.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      columns: draft.columns.filter(
                        (_, current) => current !== index,
                      ),
                    })
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-zinc-600">
              条件拆分系列（可选，按条件给行归类）
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                update({
                  seriesCases: [
                    ...draft.seriesCases,
                    { label: '', field: '', operator: 'lt', value: '' },
                  ],
                })
              }
            >
              添加条件
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {draft.seriesCases.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  className="w-28 shrink-0"
                  placeholder="系列名"
                  value={item.label}
                  onChange={(event) =>
                    updateCase(index, { label: event.target.value })
                  }
                />
                <div className="flex-1">
                  <SuggestInput
                    value={item.field}
                    placeholder="字段"
                    options={fieldOptions(catalog)}
                    onChange={(field) => updateCase(index, { field })}
                  />
                </div>
                <select
                  className="h-9 w-24 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={item.operator}
                  onChange={(event) =>
                    updateCase(index, {
                      operator: event.target.value as FilterOperator,
                    })
                  }
                >
                  {FILTER_OPERATORS.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 w-28 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={item.valueMode ?? 'literal'}
                  onChange={(event) => {
                    const valueMode = event.target.value as FilterValueMode;
                    updateCase(index, {
                      valueMode,
                      value: valueMode === 'relativeDate' ? 'today' : '',
                    });
                  }}
                >
                  {VALUE_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                {(item.valueMode ?? 'literal') === 'relativeDate' ? (
                  <select
                    className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                    value={item.value}
                    onChange={(event) =>
                      updateCase(index, { value: event.target.value })
                    }
                  >
                    {RELATIVE_DATES.map((token) => (
                      <option key={token} value={token}>
                        {RELATIVE_DATE_LABELS[token]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <FilterValueInput
                    field={item.field}
                    value={item.value}
                    catalog={catalog}
                    onChange={(value) => updateCase(index, { value })}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      seriesCases: draft.seriesCases.filter(
                        (_, current) => current !== index,
                      ),
                    })
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <FilterRows
            filters={draft.filters}
            catalog={catalog}
            onChange={(filters) => update({ filters })}
          />
        </div>
        <div className="flex gap-2 md:col-span-2">
          <Button
            type="button"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={querying}
            onClick={() => {
              void handlePreview();
            }}
          >
            {querying ? '查询中...' : '预览'}
          </Button>
          <Button type="button" variant="outline" onClick={handleSave}>
            保存数据集
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            返回
          </Button>
        </div>
      </div>
      {preview && (preview.rows.length > 0 || preview.detail.length > 0) ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <ChartView
            dataset={draft}
            chartType={draft.chartType}
            result={preview}
            headers={columnHeaders(catalog, draft)}
          />
        </div>
      ) : null}
    </div>
  );
}

function columnHeaders(
  catalog: FieldCatalog | null,
  dataset: Dataset,
): ColumnHeader[] {
  return dataset.columns.map((column) => ({
    field: column.field,
    label:
      catalog?.fields.find((item) => item.key === column.field.trim())?.name ??
      column.field,
  }));
}

function DashboardView({
  dashboard,
  datasets,
  onBack,
  onDelete,
}: {
  dashboard: Dashboard;
  datasets: Dataset[];
  onBack: () => void;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const saveDashboard = useAnalysisStore((state) => state.saveDashboard);
  const saveWidget = useAnalysisStore((state) => state.saveWidget);
  const deleteWidget = useAnalysisStore((state) => state.deleteWidget);
  const [adding, setAdding] = useState(false);
  const [filterFormId, setFilterFormId] = useState('');
  const [filterCatalog, setFilterCatalog] = useState<FieldCatalog | null>(null);
  const [loadingFilterFields, setLoadingFilterFields] = useState(false);
  const [widgetDraft, setWidgetDraft] = useState({
    title: '',
    datasetId: datasets[0]?.id ?? '',
    chartType: (datasets[0]?.chartType ?? 'bar') as ChartType,
    extraIds: [] as string[],
  });

  const { width, containerRef, mounted } = useContainerWidth();

  const filterForms = [
    ...new Map(
      dashboard.widgets
        .map((widget) => datasets.find((item) => item.id === widget.datasetId))
        .filter((item): item is Dataset => Boolean(item))
        .map((item) => [item.formId, item.formId]),
    ).values(),
  ];

  const handleLoadFilterFields = async (formId: string) => {
    setFilterFormId(formId);
    if (!formId) {
      setFilterCatalog(null);
      return;
    }
    setLoadingFilterFields(true);
    try {
      setFilterCatalog(await loadCatalog(formId));
    } catch (error) {
      toast({
        title: '读取字段失败',
        description: formatKingdeeError(error),
        variant: 'destructive',
      });
    } finally {
      setLoadingFilterFields(false);
    }
  };

  const layout: LayoutItem[] = dashboard.widgets.map((widget, index) => ({
    i: widget.id,
    x: widget.layout.w > 1 ? widget.layout.x : (index % 2) * 6,
    y: widget.layout.w > 1 ? widget.layout.y : Math.floor(index / 2) * 8,
    w: Math.max(widget.layout.w, 2),
    h: Math.max(widget.layout.h, 2),
    minW: 2,
    minH: widget.chartType === 'kpi' ? 2 : 6,
  }));

  const handleAddWidget = () => {
    if (!widgetDraft.datasetId) {
      toast({ title: '请先创建数据集' });
      return;
    }
    const widget: Widget = {
      id: newId(),
      title: widgetDraft.title.trim() || '未命名图表',
      datasetId: widgetDraft.datasetId,
      chartType: widgetDraft.chartType,
      sources: widgetDraft.extraIds,
      layout: {
        x: (dashboard.widgets.length % 2) * 6,
        y: Infinity,
        w: 6,
        h: 8,
      },
    };
    saveWidget(dashboard.id, widget);
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <input
          className="rounded-md border border-transparent bg-transparent px-2 text-lg font-medium hover:border-zinc-200 focus:border-input focus:outline-none"
          value={dashboard.name}
          onChange={(event) =>
            saveDashboard({ ...dashboard, name: event.target.value })
          }
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            添加图表
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
            删除看板
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            返回
          </Button>
        </div>
      </div>
      {adding ? (
        <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-zinc-600">
            标题
            <Input
              value={widgetDraft.title}
              onChange={(event) =>
                setWidgetDraft({ ...widgetDraft, title: event.target.value })
              }
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-zinc-600">
            数据集
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={widgetDraft.datasetId}
              onChange={(event) => {
                const datasetId = event.target.value;
                const chosen = datasets.find((item) => item.id === datasetId);
                setWidgetDraft({
                  ...widgetDraft,
                  datasetId,
                  chartType: chosen?.chartType ?? widgetDraft.chartType,
                });
              }}
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-zinc-600">
            合并更多数据集（可选，按维度对齐）
            <select
              multiple
              className="h-20 rounded-md border border-input bg-transparent px-2 text-sm"
              value={widgetDraft.extraIds}
              onChange={(event) =>
                setWidgetDraft({
                  ...widgetDraft,
                  extraIds: [...event.target.selectedOptions].map(
                    (option) => option.value,
                  ),
                })
              }
            >
              {datasets
                .filter((dataset) => dataset.id !== widgetDraft.datasetId)
                .map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-600">
            图表类型（默认用数据集的，可改）
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={widgetDraft.chartType}
              onChange={(event) =>
                setWidgetDraft({
                  ...widgetDraft,
                  chartType: event.target.value as ChartType,
                })
              }
            >
              {CHART_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={handleAddWidget}>
            确定
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setAdding(false)}
          >
            取消
          </Button>
        </div>
      ) : null}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-zinc-600">过滤字段来源</span>
          <select
            aria-label="过滤字段来源"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={filterFormId}
            onChange={(event) => {
              void handleLoadFilterFields(event.target.value);
            }}
          >
            <option value="">选择表单后可下拉选字段</option>
            {filterForms.map((formId) => (
              <option key={formId} value={formId}>
                {formLabel(
                  FORM_OPTIONS.find((option) => option.id === formId) ?? {
                    id: formId,
                    name: formId,
                  },
                )}
              </option>
            ))}
          </select>
          {loadingFilterFields ? (
            <span className="text-xs text-zinc-500">读取中...</span>
          ) : null}
        </div>
        <FilterRows
          filters={dashboard.filters}
          catalog={filterCatalog}
          onChange={(filters) => saveDashboard({ ...dashboard, filters })}
        />
      </div>
      {dashboard.widgets.length === 0 ? (
        <p className="text-sm text-zinc-500">看板是空的，添加一个图表。</p>
      ) : (
        <div ref={containerRef}>
          {mounted ? (
            <GridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: 12, rowHeight: 32, margin: [16, 16] }}
              dragConfig={{
                enabled: true,
                bounded: false,
                handle: '.widget-drag',
                cancel: '',
                threshold: 3,
              }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              onLayoutChange={(next) => {
                const widgets = dashboard.widgets.map((widget) => {
                  const item = next.find((entry) => entry.i === widget.id);
                  return item
                    ? {
                        ...widget,
                        layout: { x: item.x, y: item.y, w: item.w, h: item.h },
                      }
                    : widget;
                });
                if (
                  widgets.some(
                    (widget, index) =>
                      widget.layout !== dashboard.widgets[index]?.layout,
                  )
                ) {
                  saveDashboard({ ...dashboard, widgets });
                }
              }}
            >
              {dashboard.widgets.map((widget) => {
                const dataset = datasets.find(
                  (item) => item.id === widget.datasetId,
                );
                return (
                  <div key={widget.id}>
                    <div className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                      <div className="widget-drag mb-2 flex cursor-move items-center justify-between">
                        <h3 className="text-sm font-medium">{widget.title}</h3>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteWidget(dashboard.id, widget.id)}
                        >
                          移除
                        </Button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        {dataset ? (
                          <WidgetChart
                            dataset={dataset}
                            chartType={widget.chartType}
                            sources={widget.sources
                              .map((id) =>
                                datasets.find((item) => item.id === id),
                              )
                              .filter((item): item is Dataset => Boolean(item))}
                            filters={dashboard.filters}
                          />
                        ) : (
                          <p className="text-sm text-zinc-500">
                            数据集已被删除。
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          ) : null}
        </div>
      )}
    </div>
  );
}

function WidgetChart({
  dataset,
  chartType,
  sources,
  filters,
}: {
  dataset: Dataset;
  chartType: ChartType;
  sources: Dataset[];
  filters: Filter[];
}) {
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const { toast } = useToast();
  const [result, setResult] = useState<QueryChartResult | null>(null);
  const [headers, setHeaders] = useState<ColumnHeader[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const run = async () => {
      const queried = sources.length
        ? await runMerged(
            [dataset, ...sources].map((source) => ({
              dataset: { ...source, filters: [...source.filters, ...filters] },
              legend: source.name,
            })),
          )
        : await runQuery({
            ...dataset,
            filters: [...dataset.filters, ...filters],
          });
      if (cancelled) {
        return;
      }
      setResult(queried);
      if (dataset.columns.length > 0) {
        const catalog = await loadCatalog(dataset.formId).catch(() => null);
        if (!cancelled) {
          setHeaders(columnHeaders(catalog, dataset));
        }
      }
    };
    run()
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailed(true);
          toast({
            title: '查询失败',
            description: formatKingdeeError(error),
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // 过滤条件按内容比较，避免看板每次保存都触发重复查询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, dataset, chartType, filterKey]);

  if (!sessionId) {
    return (
      <p className="text-sm text-zinc-500">
        请先点击右上角「连接金蝶」完成登录。
      </p>
    );
  }
  if (loading && !result) {
    return <p className="text-sm text-zinc-500">查询中...</p>;
  }
  if (failed && !result) {
    return <p className="text-sm text-zinc-500">查询失败。</p>;
  }
  if (!result || (result.rows.length === 0 && result.detail.length === 0)) {
    return <p className="text-sm text-zinc-500">没有可绘制的数据。</p>;
  }
  return (
    <ChartView
      dataset={dataset}
      chartType={chartType}
      result={result}
      headers={headers}
    />
  );
}
