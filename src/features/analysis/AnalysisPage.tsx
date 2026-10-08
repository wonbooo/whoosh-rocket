import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import GridLayout, { getCompactor, useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import { formatKingdeeError } from '@/apis/kingdee/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SuggestInput } from '@/components/shared/SuggestInput';
import type { SuggestColors } from '@/components/shared/SuggestInput';
import { SelectMenu } from '@/components/shared/SelectMenu';
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
import { findTheme } from '@/features/analysis/themes';
import type { BoardTheme } from '@/features/analysis/themes';
import {
  groupOverlaps,
  droppedOn,
  overlaps,
} from '@/features/analysis/overlap';
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

function boardPalette(theme: BoardTheme) {
  return {
    colors: theme.colors,
    text: theme.text,
    muted: theme.textMuted,
    grid: theme.dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)',
    panel: theme.panel,
    panelAlt: theme.panelAlt,
  };
}

function panelStyle(theme: BoardTheme): React.CSSProperties {
  return {
    background: theme.panel,
    borderColor: theme.border,
    color: theme.text,
    boxShadow: theme.dark
      ? `0 0 24px ${theme.accent}14`
      : '0 1px 2px rgba(0, 0, 0, 0.05)',
  };
}

function suggestColors(theme: BoardTheme): SuggestColors {
  return {
    panel: theme.panel,
    panelAlt: theme.panelAlt,
    border: theme.border,
    text: theme.text,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

function dashboardsUsing(dashboards: Dashboard[], datasetId: string): number {
  return dashboards.filter((dashboard) =>
    dashboard.widgets.some(
      (widget) =>
        widget.datasetId === datasetId || widget.sources.includes(datasetId),
    ),
  ).length;
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
  const themeId = useAnalysisStore((state) => state.themeId);
  const theme = findTheme(themeId);

  const [editing, setEditing] = useState<Dataset | null>(null);
  const [openDashboard, setOpenDashboard] = useState<string | null>(null);

  const dashboard = dashboards.find((item) => item.id === openDashboard);

  return (
    <div
      className="min-h-[calc(100vh-4rem)] px-6 py-8"
      style={{
        background: theme.background,
        color: theme.text,
        colorScheme: theme.dark ? 'dark' : 'light',
      }}
    >
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-medium">数据分析</h1>
      </div>
      {dashboard ? (
        <DashboardView
          dashboard={dashboard}
          datasets={datasets}
          theme={theme}
          onBack={() => setOpenDashboard(null)}
          onDelete={() => {
            deleteDashboard(dashboard.id);
            setOpenDashboard(null);
          }}
        />
      ) : editing ? (
        <DatasetEditor
          dataset={editing}
          theme={theme}
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
          theme={theme}
          onEditDataset={setEditing}
          onCreateDataset={() => setEditing(blankDataset())}
          onDeleteDataset={(id) => {
            const used = dashboardsUsing(dashboards, id);
            const dataset = datasets.find((item) => item.id === id);
            if (dataset?.origin && used > 0) {
              toast({
                title: '无法删除',
                description: `该数据集被 ${used} 个看板使用，先删除对应看板后再删`,
              });
              return;
            }
            deleteDataset(id);
          }}
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
  theme,
  onEditDataset,
  onCreateDataset,
  onDeleteDataset,
  onOpenDashboard,
  onCreateDashboard,
  onApplyTemplate,
}: {
  datasets: Dataset[];
  dashboards: Dashboard[];
  theme: BoardTheme;
  onEditDataset: (dataset: Dataset) => void;
  onCreateDataset: () => void;
  onDeleteDataset: (id: string) => void;
  onOpenDashboard: (id: string) => void;
  onCreateDashboard: () => void;
  onApplyTemplate: (templateId: string) => void;
}) {
  const muted = { color: theme.textMuted };
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-xl border p-5" style={panelStyle(theme)}>
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium">数据集</h2>
          <Button type="button" size="sm" onClick={onCreateDataset}>
            新建数据集
          </Button>
        </header>
        {datasets.length === 0 ? (
          <p className="text-sm" style={muted}>
            还没有数据集。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {datasets.map((dataset) => (
              <li
                key={dataset.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
                style={{ borderColor: theme.border }}
              >
                <div>
                  <div className="text-sm font-medium">{dataset.name}</div>
                  <div className="text-xs" style={muted}>
                    {dataset.formId} · {dataset.dimension.field}
                    {dataset.origin
                      ? ` · 模板：${
                          BOARD_TEMPLATES.find(
                            (template) =>
                              template.id === dataset.origin?.templateId,
                          )?.name ?? dataset.origin.templateId
                        }`
                      : ''}
                    {` · 被 ${dashboardsUsing(dashboards, dataset.id)} 个看板使用`}
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
      <section className="rounded-xl border p-5" style={panelStyle(theme)}>
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium">看板</h2>
          <div className="flex gap-2">
            <SelectMenu
              aria-label="从模板创建"
              className="w-32 text-xs"
              value=""
              placeholder="从模板创建"
              colors={suggestColors(theme)}
              options={[
                { value: '', label: '从模板创建' },
                ...BOARD_TEMPLATES.map((template) => ({
                  value: template.id,
                  label: template.name,
                })),
              ]}
              onChange={(value) => {
                if (value) {
                  onApplyTemplate(value);
                }
              }}
            />
            <Button type="button" size="sm" onClick={onCreateDashboard}>
              新建看板
            </Button>
          </div>
        </header>
        {dashboards.length === 0 ? (
          <p className="text-sm" style={muted}>
            还没有看板。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <button
                  type="button"
                  className="w-full rounded-lg border px-3 py-2 text-left"
                  style={{ borderColor: theme.border }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = theme.panelAlt;
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                  }}
                  onClick={() => onOpenDashboard(dashboard.id)}
                >
                  <div className="text-sm font-medium">{dashboard.name}</div>
                  <div className="text-xs" style={muted}>
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
  theme,
  onChange,
}: {
  field: string;
  value: string;
  catalog: FieldCatalog | null;
  theme: BoardTheme;
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
    <SelectMenu
      aria-label="值"
      className="flex-1"
      value={options.some((option) => option.value === value) ? value : ''}
      placeholder="请选择"
      colors={suggestColors(theme)}
      options={[{ value: '', label: '请选择' }, ...options]}
      onChange={onChange}
    />
  );
}

function FilterRows({
  filters,
  catalog,
  theme,
  onChange,
}: {
  filters: Filter[];
  catalog: FieldCatalog | null;
  theme: BoardTheme;
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
        <span className="text-sm" style={{ color: theme.textMuted }}>
          过滤条件
        </span>
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
                colors={suggestColors(theme)}
                onChange={(field) => updateAt(index, { field })}
              />
            </div>
            <SelectMenu
              className="w-24 shrink-0"
              value={filter.operator}
              colors={suggestColors(theme)}
              options={FILTER_OPERATORS}
              onChange={(operator) =>
                updateAt(index, { operator: operator as FilterOperator })
              }
            />
            <SelectMenu
              className="w-28 shrink-0"
              value={filter.valueMode ?? 'literal'}
              colors={suggestColors(theme)}
              options={VALUE_MODES}
              onChange={(mode) => {
                const valueMode = mode as FilterValueMode;
                updateAt(index, {
                  valueMode,
                  value: valueMode === 'relativeDate' ? 'today' : '',
                });
              }}
            />
            {(filter.valueMode ?? 'literal') === 'relativeDate' ? (
              <SelectMenu
                className="flex-1"
                value={filter.value}
                colors={suggestColors(theme)}
                options={RELATIVE_DATES.map((token) => ({
                  value: token,
                  label: RELATIVE_DATE_LABELS[token],
                }))}
                onChange={(value) => updateAt(index, { value })}
              />
            ) : (filter.valueMode ?? 'literal') === 'field' ? (
              <div className="flex-1">
                <SuggestInput
                  value={filter.value}
                  placeholder="比较字段"
                  options={fieldOptions(catalog)}
                  colors={suggestColors(theme)}
                  onChange={(value) => updateAt(index, { value })}
                />
              </div>
            ) : (
              <FilterValueInput
                field={filter.field}
                value={filter.value}
                catalog={catalog}
                theme={theme}
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
  theme,
  onChange,
}: {
  label: string;
  field: FieldRef;
  catalog: FieldCatalog | null;
  theme: BoardTheme;
  onChange: (field: FieldRef) => void;
}) {
  const lookup = catalog?.fields.find((item) => item.key === field.field);
  const showDisplay =
    Boolean(lookup?.lookupFormId) || field.field.includes('.');
  return (
    <div
      className="flex flex-col gap-1.5 text-sm"
      style={{ color: theme.textMuted }}
    >
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
            colors={suggestColors(theme)}
            onChange={(next) =>
              onChange({
                field: next,
                display: next === field.field ? field.display : 'name',
              })
            }
          />
        </div>
        {showDisplay ? (
          <SelectMenu
            aria-label={`${label}显示`}
            className="w-24 shrink-0"
            value={field.display}
            colors={suggestColors(theme)}
            options={DISPLAYS}
            onChange={(display) =>
              onChange({ ...field, display: display as FieldDisplay })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function DatasetEditor({
  dataset,
  theme,
  onCancel,
  onSave,
}: {
  dataset: Dataset;
  theme: BoardTheme;
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

  const muted = { color: theme.textMuted };

  return (
    <div className="flex flex-col gap-6">
      <div
        className="grid gap-4 rounded-xl border p-5 md:grid-cols-2"
        style={panelStyle(theme)}
      >
        <label className="flex flex-col gap-1.5 text-sm" style={muted}>
          数据集名称
          <Input
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1.5 text-sm" style={muted}>
            表单
            <SuggestInput
              value={draft.formId}
              placeholder="输入中文名或标识筛选，如 销售订单"
              options={FORM_OPTIONS.map((option) => ({
                value: option.id,
                label: formLabel(option),
              }))}
              colors={suggestColors(theme)}
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
          theme={theme}
          onChange={(dimension) => update({ dimension })}
        />
        <label className="flex items-end gap-2 pb-2 text-sm" style={muted}>
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
          theme={theme}
          onChange={(series) =>
            update({ series: series.field.trim() ? series : null })
          }
        />
        <FieldInput
          label="度量（数值）"
          field={draft.measure}
          catalog={catalog}
          theme={theme}
          onChange={(measure) => update({ measure })}
        />
        <label className="flex flex-col gap-1.5 text-sm" style={muted}>
          聚合方式
          <SelectMenu
            value={draft.aggregation}
            colors={suggestColors(theme)}
            options={[
              { value: 'sum', label: '求和' },
              { value: 'count', label: '计数' },
            ]}
            onChange={(aggregation) =>
              update({ aggregation: aggregation as Dataset['aggregation'] })
            }
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm" style={muted}>
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
        <label className="flex flex-col gap-1.5 text-sm" style={muted}>
          图表类型
          <SelectMenu
            value={draft.chartType}
            colors={suggestColors(theme)}
            options={CHART_TYPES}
            onChange={(chartType) =>
              update({ chartType: chartType as ChartType })
            }
          />
        </label>
        <div className="md:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm" style={muted}>
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
                    colors={suggestColors(theme)}
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
                <SelectMenu
                  aria-label="列显示"
                  className="w-24 shrink-0"
                  value={column.display}
                  colors={suggestColors(theme)}
                  options={DISPLAYS}
                  onChange={(display) =>
                    update({
                      columns: draft.columns.map((item, current) =>
                        current === index
                          ? { ...item, display: display as FieldDisplay }
                          : item,
                      ),
                    })
                  }
                />
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
            <span className="text-sm" style={muted}>
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
                    colors={suggestColors(theme)}
                    onChange={(field) => updateCase(index, { field })}
                  />
                </div>
                <SelectMenu
                  className="w-24 shrink-0"
                  value={item.operator}
                  colors={suggestColors(theme)}
                  options={FILTER_OPERATORS}
                  onChange={(operator) =>
                    updateCase(index, { operator: operator as FilterOperator })
                  }
                />
                <SelectMenu
                  className="w-28 shrink-0"
                  value={item.valueMode ?? 'literal'}
                  colors={suggestColors(theme)}
                  options={VALUE_MODES}
                  onChange={(mode) => {
                    const valueMode = mode as FilterValueMode;
                    updateCase(index, {
                      valueMode,
                      value: valueMode === 'relativeDate' ? 'today' : '',
                    });
                  }}
                />
                {(item.valueMode ?? 'literal') === 'relativeDate' ? (
                  <SelectMenu
                    className="flex-1"
                    value={item.value}
                    colors={suggestColors(theme)}
                    options={RELATIVE_DATES.map((token) => ({
                      value: token,
                      label: RELATIVE_DATE_LABELS[token],
                    }))}
                    onChange={(value) => updateCase(index, { value })}
                  />
                ) : (
                  <FilterValueInput
                    field={item.field}
                    value={item.value}
                    catalog={catalog}
                    theme={theme}
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
            theme={theme}
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
        <div className="h-80 rounded-xl border p-5" style={panelStyle(theme)}>
          <ChartView
            dataset={draft}
            chartType={draft.chartType}
            result={preview}
            headers={columnHeaders(catalog, draft)}
            palette={boardPalette(theme)}
            dark={theme.dark}
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
  theme,
  onBack,
  onDelete,
}: {
  dashboard: Dashboard;
  datasets: Dataset[];
  theme: BoardTheme;
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
  const [expanded, setExpanded] = useState<Widget | null>(null);

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

  const groups = groupOverlaps(dashboard.widgets);
  const groupedLayout: LayoutItem[] = groups.map((group) => {
    const item = layout.find((entry) => entry.i === group.anchor.id);
    return {
      ...(item ?? { x: 0, y: 0, w: 6, h: 8, minW: 2, minH: 2 }),
      i: group.anchor.id,
    };
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

  const muted = { color: theme.textMuted };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <input
          className="rounded-md border border-transparent bg-transparent px-2 text-lg font-medium focus:border-input focus:outline-none"
          style={{ color: theme.text }}
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
        <div
          className="flex items-end gap-2 rounded-xl border p-4"
          style={panelStyle(theme)}
        >
          <label className="flex flex-1 flex-col gap-1.5 text-sm" style={muted}>
            标题
            <Input
              value={widgetDraft.title}
              onChange={(event) =>
                setWidgetDraft({ ...widgetDraft, title: event.target.value })
              }
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm" style={muted}>
            数据集
            <SelectMenu
              value={widgetDraft.datasetId}
              colors={suggestColors(theme)}
              options={datasets.map((dataset) => ({
                value: dataset.id,
                label: dataset.name,
              }))}
              onChange={(datasetId) => {
                const chosen = datasets.find((item) => item.id === datasetId);
                setWidgetDraft({
                  ...widgetDraft,
                  datasetId,
                  chartType: chosen?.chartType ?? widgetDraft.chartType,
                });
              }}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm" style={muted}>
            合并更多数据集（可选，按维度对齐）
            <div
              className="flex h-20 flex-col gap-1 overflow-auto rounded-md border px-2 py-1.5 text-sm"
              style={{ borderColor: theme.border }}
            >
              {datasets.filter(
                (dataset) => dataset.id !== widgetDraft.datasetId,
              ).length === 0 ? (
                <span style={muted}>没有其他数据集</span>
              ) : (
                datasets
                  .filter((dataset) => dataset.id !== widgetDraft.datasetId)
                  .map((dataset) => (
                    <label key={dataset.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={widgetDraft.extraIds.includes(dataset.id)}
                        onChange={(event) =>
                          setWidgetDraft({
                            ...widgetDraft,
                            extraIds: event.target.checked
                              ? [...widgetDraft.extraIds, dataset.id]
                              : widgetDraft.extraIds.filter(
                                  (id) => id !== dataset.id,
                                ),
                          })
                        }
                      />
                      {dataset.name}
                    </label>
                  ))
              )}
            </div>
          </label>
          <label className="flex flex-col gap-1.5 text-sm" style={muted}>
            图表类型（默认用数据集的，可改）
            <SelectMenu
              value={widgetDraft.chartType}
              colors={suggestColors(theme)}
              options={CHART_TYPES}
              onChange={(chartType) =>
                setWidgetDraft({
                  ...widgetDraft,
                  chartType: chartType as ChartType,
                })
              }
            />
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
      <div className="rounded-xl border p-4" style={panelStyle(theme)}>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm" style={muted}>
            过滤字段来源
          </span>
          <SelectMenu
            aria-label="过滤字段来源"
            className="w-64"
            value={filterFormId}
            placeholder="选择表单后可下拉选字段"
            colors={suggestColors(theme)}
            options={[
              { value: '', label: '选择表单后可下拉选字段' },
              ...filterForms.map((formId) => ({
                value: formId,
                label: formLabel(
                  FORM_OPTIONS.find((option) => option.id === formId) ?? {
                    id: formId,
                    name: formId,
                  },
                ),
              })),
            ]}
            onChange={(formId) => {
              void handleLoadFilterFields(formId);
            }}
          />
          {loadingFilterFields ? (
            <span className="text-xs" style={muted}>
              读取中...
            </span>
          ) : null}
        </div>
        <FilterRows
          filters={dashboard.filters}
          catalog={filterCatalog}
          theme={theme}
          onChange={(filters) => saveDashboard({ ...dashboard, filters })}
        />
      </div>
      {dashboard.widgets.length === 0 ? (
        <p className="text-sm" style={muted}>
          看板是空的，添加一个图表。
        </p>
      ) : (
        <div ref={containerRef}>
          {mounted ? (
            <GridLayout
              width={width}
              layout={groupedLayout}
              gridConfig={{ cols: 12, rowHeight: 32, margin: [16, 16] }}
              compactor={getCompactor(null, true)}
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
                  const group = groups.find(
                    (candidate) =>
                      candidate.members.length > 1 &&
                      candidate.members.some(
                        (member) => member.id === widget.id,
                      ),
                  );
                  if (group && widget.id !== group.anchor.id) {
                    const anchor = next.find(
                      (entry) => entry.i === group.anchor.id,
                    );
                    return anchor
                      ? {
                          ...widget,
                          layout: {
                            x: anchor.x,
                            y: anchor.y,
                            w: anchor.w,
                            h: anchor.h,
                          },
                        }
                      : widget;
                  }
                  if (!item) {
                    return widget;
                  }
                  const landed = groups.find(
                    (candidate) =>
                      candidate.anchor.id !== widget.id &&
                      droppedOn(item, candidate.anchor.layout),
                  );
                  const target = landed ? landed.anchor.layout : item;
                  return {
                    ...widget,
                    layout: {
                      x: target.x,
                      y: target.y,
                      w: target.w,
                      h: target.h,
                    },
                  };
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
              {groups.map((group) => {
                const stacked = group.members.length > 1;
                return (
                  <div key={group.anchor.id}>
                    <div
                      className="flex h-full flex-col rounded-xl border p-3"
                      style={panelStyle(theme)}
                    >
                      {stacked ? (
                        <WidgetTabs
                          members={group.members}
                          datasets={datasets}
                          filters={dashboard.filters}
                          theme={theme}
                          onExpand={setExpanded}
                          onDetach={(widget) => {
                            const taken = dashboard.widgets.filter(
                              (item) => item.id !== widget.id,
                            );
                            let y = widget.layout.y + widget.layout.h;
                            const collides = (row: number) =>
                              taken.some((item) =>
                                overlaps(
                                  {
                                    x: widget.layout.x,
                                    y: row,
                                    w: widget.layout.w,
                                    h: widget.layout.h,
                                  },
                                  item.layout,
                                ),
                              );
                            while (collides(y)) {
                              y += 1;
                            }
                            saveWidget(dashboard.id, {
                              ...widget,
                              layout: { ...widget.layout, y },
                            });
                          }}
                        />
                      ) : (
                        <>
                          <div className="widget-drag mb-2 flex cursor-move items-center justify-between">
                            <h3 className="text-sm font-medium">
                              {group.anchor.title}
                            </h3>
                            <div className="flex items-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="放大"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => setExpanded(group.anchor)}
                              >
                                <Maximize2 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  deleteWidget(dashboard.id, group.anchor.id)
                                }
                              >
                                移除
                              </Button>
                            </div>
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto">
                            <WidgetBody
                              widget={group.anchor}
                              datasets={datasets}
                              filters={dashboard.filters}
                              theme={theme}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          ) : null}
          {expanded ? (
            <ExpandedWidget
              widget={expanded}
              datasets={datasets}
              filters={dashboard.filters}
              theme={theme}
              onClose={() => setExpanded(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function WidgetBody({
  widget,
  datasets,
  filters,
  theme,
}: {
  widget: Widget;
  datasets: Dataset[];
  filters: Filter[];
  theme: BoardTheme;
}) {
  const dataset = datasets.find((item) => item.id === widget.datasetId);
  if (!dataset) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        数据集已被删除。
      </p>
    );
  }
  return (
    <WidgetChart
      dataset={dataset}
      chartType={widget.chartType}
      sources={widget.sources
        .map((id) => datasets.find((item) => item.id === id))
        .filter((item): item is Dataset => Boolean(item))}
      filters={filters}
      theme={theme}
    />
  );
}

function WidgetTabs({
  members,
  datasets,
  filters,
  theme,
  onDetach,
  onExpand,
}: {
  members: Widget[];
  datasets: Dataset[];
  filters: Filter[];
  theme: BoardTheme;
  onDetach: (widget: Widget) => void;
  onExpand: (widget: Widget) => void;
}) {
  const [active, setActive] = useState(members[0]?.id ?? '');
  const current = members.find((member) => member.id === active) ?? members[0];
  return (
    <>
      <div className="mb-2 flex items-center gap-1">
        <div className="widget-drag flex min-w-0 flex-1 cursor-move gap-1 overflow-auto">
          {members.map((member) => {
            const selected = member.id === current?.id;
            return (
              <button
                key={member.id}
                type="button"
                className="shrink-0 rounded-md px-2.5 py-1 text-xs"
                style={{
                  background: selected ? theme.accent : theme.panelAlt,
                  color: selected ? theme.accentText : theme.textMuted,
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setActive(member.id)}
              >
                {member.title}
              </button>
            );
          })}
        </div>
        {current ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="放大"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onExpand(current)}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="拆出来单独显示"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onDetach(current)}
            >
              拆出
            </Button>
          </>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {current ? (
          <WidgetBody
            widget={current}
            datasets={datasets}
            filters={filters}
            theme={theme}
          />
        ) : null}
      </div>
    </>
  );
}

function ExpandedWidget({
  widget,
  datasets,
  filters,
  theme,
  onClose,
}: {
  widget: Widget;
  datasets: Dataset[];
  filters: Filter[];
  theme: BoardTheme;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col p-6"
      style={{ background: theme.background, color: theme.text }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">{widget.title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="缩小"
          onClick={onClose}
        >
          <Minimize2 className="h-4 w-4" />
          缩小
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto rounded-xl border p-4"
        style={panelStyle(theme)}
      >
        <WidgetBody
          widget={widget}
          datasets={datasets}
          filters={filters}
          theme={theme}
        />
      </div>
    </div>
  );
}

function WidgetChart({
  dataset,
  chartType,
  sources,
  filters,
  theme,
}: {
  dataset: Dataset;
  chartType: ChartType;
  sources: Dataset[];
  filters: Filter[];
  theme: BoardTheme;
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
      <p className="text-sm" style={{ color: theme.textMuted }}>
        请先点击右上角「连接金蝶」完成登录。
      </p>
    );
  }
  if (loading && !result) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        查询中...
      </p>
    );
  }
  if (failed && !result) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        查询失败。
      </p>
    );
  }
  if (!result || (result.rows.length === 0 && result.detail.length === 0)) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        没有可绘制的数据。
      </p>
    );
  }
  return (
    <ChartView
      dataset={dataset}
      chartType={chartType}
      result={result}
      headers={headers}
      palette={boardPalette(theme)}
      dark={theme.dark}
    />
  );
}
