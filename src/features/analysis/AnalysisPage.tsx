import { useState } from 'react';
import { formatKingdeeError } from '@/apis/kingdee/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SuggestInput } from '@/components/shared/SuggestInput';
import { ChartView } from '@/features/analysis/ChartView';
import type { FieldCatalog } from '@/features/analysis/catalog';
import { FORM_OPTIONS, formLabel } from '@/features/analysis/forms';
import { CHART_TYPES } from '@/features/analysis/chartSpec';
import { validateDataset } from '@/features/analysis/model';
import {
  loadCatalog,
  queryChart,
  type QueryChartResult,
} from '@/features/analysis/query';
import { useAnalysisStore } from '@/features/analysis/store';
import type {
  ChartType,
  Dashboard,
  Dataset,
  FieldDisplay,
  FieldRef,
  Filter,
  FilterOperator,
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

function newId(): string {
  return crypto.randomUUID();
}

function blankDataset(): Dataset {
  return {
    id: newId(),
    name: '',
    formId: '',
    dimension: { field: '', display: 'name' },
    series: null,
    measure: { field: '', display: 'value' },
    aggregation: 'sum',
    filters: [],
    limit: 20,
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

  const [editing, setEditing] = useState<Dataset | null>(null);
  const [openDashboard, setOpenDashboard] = useState<string | null>(null);

  const dashboard = dashboards.find((item) => item.id === openDashboard);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
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
              widgets: [],
            };
            saveDashboard(created);
            setOpenDashboard(created.id);
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
}: {
  datasets: Dataset[];
  dashboards: Dashboard[];
  onEditDataset: (dataset: Dataset) => void;
  onCreateDataset: () => void;
  onDeleteDataset: (id: string) => void;
  onOpenDashboard: (id: string) => void;
  onCreateDashboard: () => void;
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
          <Button type="button" size="sm" onClick={onCreateDashboard}>
            新建看板
          </Button>
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
  const [previewChart, setPreviewChart] = useState<ChartType>('bar');
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
      const result = await queryChart(draft);
      setPreview(result);
      if (result.rows.length === 0) {
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

  const handleSave = () => {
    const check = validateDataset(draft);
    if (!check.valid) {
      toast({ title: '配置不完整', description: check.message });
      return;
    }
    onSave(draft);
  };

  const updateFilter = (index: number, patch: Partial<Filter>) =>
    update({
      filters: draft.filters.map((filter, current) =>
        current === index ? { ...filter, ...patch } : filter,
      ),
    });

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
            value={previewChart}
            onChange={(event) =>
              setPreviewChart(event.target.value as ChartType)
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
            <span className="text-sm text-zinc-600">过滤条件</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                update({
                  filters: [
                    ...draft.filters,
                    { field: '', operator: 'eq', value: '' },
                  ],
                })
              }
            >
              添加条件
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {draft.filters.map((filter, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <SuggestInput
                    value={filter.field}
                    placeholder="字段"
                    options={(catalog?.fields ?? []).map((field) => ({
                      value: field.key,
                      label: `${field.name}（${field.key}）`,
                    }))}
                    onChange={(field) => updateFilter(index, { field })}
                  />
                </div>
                <select
                  className="h-9 w-28 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={filter.operator}
                  onChange={(event) =>
                    updateFilter(index, {
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
                <Input
                  className="flex-1"
                  placeholder="值"
                  value={filter.value}
                  onChange={(event) =>
                    updateFilter(index, { value: event.target.value })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      filters: draft.filters.filter(
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
      {preview && preview.rows.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <ChartView
            dataset={draft}
            chartType={previewChart}
            result={preview}
          />
        </div>
      ) : null}
    </div>
  );
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
  const [widgetDraft, setWidgetDraft] = useState({
    title: '',
    datasetId: datasets[0]?.id ?? '',
    chartType: 'bar' as ChartType,
  });

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
      layout: { x: 0, y: dashboard.widgets.length, w: 1, h: 1 },
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
              onChange={(event) =>
                setWidgetDraft({
                  ...widgetDraft,
                  datasetId: event.target.value,
                })
              }
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-600">
            图表类型
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
      {dashboard.widgets.length === 0 ? (
        <p className="text-sm text-zinc-500">看板是空的，添加一个图表。</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {dashboard.widgets.map((widget) => {
            const dataset = datasets.find(
              (item) => item.id === widget.datasetId,
            );
            return (
              <div
                key={widget.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-3 flex items-center justify-between">
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
                {dataset ? (
                  <WidgetChart dataset={dataset} chartType={widget.chartType} />
                ) : (
                  <p className="text-sm text-zinc-500">数据集已被删除。</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WidgetChart({
  dataset,
  chartType,
}: {
  dataset: Dataset;
  chartType: ChartType;
}) {
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const { toast } = useToast();
  const [result, setResult] = useState<QueryChartResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleQuery = async () => {
    if (!sessionId) {
      toast({
        title: '请先连接金蝶',
        description: '点击右上角「连接金蝶」完成登录后再查询',
      });
      return;
    }
    setLoading(true);
    try {
      setResult(await queryChart(dataset));
    } catch (error) {
      toast({
        title: '查询失败',
        description: formatKingdeeError(error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={() => {
          void handleQuery();
        }}
      >
        {loading ? '查询中...' : '查询'}
      </Button>
    );
  }
  if (result.rows.length === 0) {
    return <p className="text-sm text-zinc-500">没有可绘制的数据。</p>;
  }
  return <ChartView dataset={dataset} chartType={chartType} result={result} />;
}
