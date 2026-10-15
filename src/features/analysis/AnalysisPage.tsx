import { useEffect, useMemo, useRef, useState } from 'react';
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
import { controlKind, mergeCatalogs } from '@/features/analysis/catalog';
import type { FieldCatalog, FieldKind } from '@/features/analysis/catalog';
import { readCatalogCache } from '@/features/analysis/catalogCache';
import { knownOptions } from '@/features/analysis/enums';
import { FORM_OPTIONS, formLabel } from '@/features/analysis/forms';
import {
  RELATIVE_DATES,
  defaultFieldDisplay,
  resolveDataset,
  validateDataset,
} from '@/features/analysis/model';
import {
  compatibleChartTypes,
  fieldLabels,
  fieldNeeds,
  measureNotNumericMessage,
  orderedChartTypes,
  presentDataset,
  presentationOf,
  SHAPE_HINTS,
  chartShape,
} from '@/features/analysis/presentation';
import type { Presentation } from '@/features/analysis/presentation';
import {
  beginCatalogLoad,
  runMerged,
  runQuery,
  searchLookup,
  type LookupMatch,
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

const RELATIVE_DATE_LABELS: Record<RelativeDate, string> = {
  today: '今天',
  thisMonth: '本月',
  last6Months: '最近 6 个月',
  last365Days: '最近 365 天',
};

const COMPARE_LABELS: Record<FilterOperator, string> = {
  eq: '等于',
  neq: '不等于',
  contains: '包含',
  gt: '大于',
  lt: '小于',
};

interface ClauseValue {
  field: string;
  operator: FilterOperator;
  value: string;
  valueMode?: FilterValueMode;
  valueLabel?: string;
}

function operatorsFor(kind: FieldKind): { value: string; label: string }[] {
  if (kind === 'date') {
    return [
      { value: 'eq', label: COMPARE_LABELS.eq },
      { value: 'neq', label: COMPARE_LABELS.neq },
      { value: 'gt', label: COMPARE_LABELS.gt },
      { value: 'lt', label: COMPARE_LABELS.lt },
      ...RELATIVE_DATES.map((token) => ({
        value: token,
        label: RELATIVE_DATE_LABELS[token],
      })),
    ];
  }
  if (kind === 'lookup') {
    return ['eq', 'neq', 'contains'].map((value) => ({
      value,
      label: COMPARE_LABELS[value as FilterOperator],
    }));
  }
  if (kind === 'enum') {
    return ['eq', 'neq'].map((value) => ({
      value,
      label: COMPARE_LABELS[value as FilterOperator],
    }));
  }
  if (kind === 'number') {
    return ['eq', 'neq', 'gt', 'lt'].map((value) => ({
      value,
      label: COMPARE_LABELS[value as FilterOperator],
    }));
  }
  return ['eq', 'neq', 'contains'].map((value) => ({
    value,
    label: COMPARE_LABELS[value as FilterOperator],
  }));
}

function isRelativeToken(value: string): value is RelativeDate {
  return (RELATIVE_DATES as string[]).includes(value);
}

function displayedOperator(clause: ClauseValue): string {
  if (
    clause.valueMode === 'relativeDate' &&
    clause.operator === 'eq' &&
    isRelativeToken(clause.value)
  ) {
    return clause.value;
  }
  return clause.operator;
}

function clauseAfterOperator(
  clause: ClauseValue,
  next: string,
): Partial<ClauseValue> {
  if (isRelativeToken(next)) {
    return {
      operator: 'eq',
      valueMode: 'relativeDate',
      value: next,
      valueLabel: undefined,
    };
  }
  const operator = next as FilterOperator;
  if (clause.valueMode === 'relativeDate' && clause.operator === 'eq') {
    return {
      operator,
      value: '',
      valueMode: undefined,
      valueLabel: undefined,
    };
  }
  if (clause.valueMode === 'relativeDate' && operator === 'eq') {
    return {
      operator,
      value: '',
      valueMode: undefined,
      valueLabel: undefined,
    };
  }
  return { operator };
}

function clauseAfterField(
  clause: ClauseValue,
  field: string,
  catalog: FieldCatalog | null,
): Partial<ClauseValue> {
  const kind = controlKind(catalog, field);
  const allowed = new Set(operatorsFor(kind).map((item) => item.value));
  if (!allowed.has(displayedOperator(clause))) {
    return {
      field,
      operator: 'eq',
      value: '',
      valueMode: undefined,
      valueLabel: undefined,
    };
  }
  if (clause.valueMode === 'relativeDate' && kind !== 'date') {
    return {
      field,
      value: '',
      valueMode: undefined,
      valueLabel: undefined,
    };
  }
  if (clause.valueMode === 'lookup' && kind !== 'lookup') {
    return {
      field,
      value: '',
      valueMode: undefined,
      valueLabel: undefined,
    };
  }
  return { field };
}

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

function fieldOptions(catalog: FieldCatalog | null, kinds?: FieldKind[]) {
  const fields = catalog?.fields ?? [];
  const matched = kinds
    ? fields.filter((field) => kinds.includes(field.kind))
    : fields;
  const visible = kinds && matched.length === 0 ? fields : matched;
  return visible.map((field) => ({
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

function lookupChoices(
  value: string,
  valueLabel: string | undefined,
  hits: LookupMatch[],
): { value: string; label: string }[] {
  const names = new Map(hits.map((hit) => [hit.number, hit.name]));
  if (value && valueLabel) {
    names.set(value, valueLabel);
  }
  const options = [...names].map(([number, name]) => ({
    value: number,
    label: `${name}（${number}）`,
  }));
  if (value && !names.has(value)) {
    options.unshift({ value, label: value });
  }
  return options;
}

function LookupValueInput({
  formId,
  value,
  valueLabel,
  theme,
  onChange,
}: {
  formId: string;
  value: string;
  valueLabel?: string;
  theme: BoardTheme;
  onChange: (patch: Partial<ClauseValue>) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<LookupMatch[]>([]);

  useEffect(() => {
    const trimmed = keyword.trim();
    if (!formId || trimmed.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchLookup(formId, trimmed)
        .then((found) => {
          if (!cancelled) {
            setHits(found);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHits([]);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [formId, keyword]);

  const names = new Map(hits.map((hit) => [hit.number, hit.name]));
  if (value && valueLabel) {
    names.set(value, valueLabel);
  }

  return (
    <SuggestInput
      value={value}
      options={lookupChoices(value, valueLabel, hits)}
      placeholder="搜索名称或编码"
      colors={suggestColors(theme)}
      onQuery={setKeyword}
      onChange={(next) =>
        onChange({
          value: next,
          valueLabel: names.get(next),
          valueMode: 'lookup',
        })
      }
    />
  );
}

function ClauseValueControl({
  clause,
  catalog,
  theme,
  onChange,
}: {
  clause: ClauseValue;
  catalog: FieldCatalog | null;
  theme: BoardTheme;
  onChange: (patch: Partial<ClauseValue>) => void;
}) {
  if (clause.valueMode === 'field') {
    return (
      <div className="min-w-0 flex-1">
        <SuggestInput
          value={clause.value}
          placeholder="比较字段"
          options={fieldOptions(catalog)}
          colors={suggestColors(theme)}
          onChange={(value) => onChange({ value, valueMode: 'field' })}
        />
      </div>
    );
  }
  if (
    clause.valueMode === 'relativeDate' &&
    clause.operator === 'eq' &&
    isRelativeToken(clause.value)
  ) {
    return null;
  }

  const kind = controlKind(catalog, clause.field);
  if (kind === 'date') {
    const relativeLabel =
      clause.valueMode === 'relativeDate' && isRelativeToken(clause.value)
        ? RELATIVE_DATE_LABELS[clause.value]
        : '';
    const dateValue =
      relativeLabel || !/^\d{4}-\d{2}-\d{2}$/.test(clause.value)
        ? ''
        : clause.value;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {relativeLabel ? (
          <span className="shrink-0 text-sm" style={{ color: theme.text }}>
            {relativeLabel}
          </span>
        ) : null}
        <Input
          type="date"
          aria-label="值"
          className="min-w-0 flex-1"
          value={dateValue}
          onChange={(event) =>
            onChange({
              value: event.target.value,
              valueMode: event.target.value ? 'literal' : undefined,
              valueLabel: undefined,
            })
          }
        />
      </div>
    );
  }
  if (kind === 'lookup') {
    const formId =
      catalog?.fields.find((item) => item.key === clause.field.trim())
        ?.lookupFormId ?? '';
    return (
      <div className="min-w-0 flex-1">
        <LookupValueInput
          formId={formId}
          value={clause.value}
          valueLabel={clause.valueLabel}
          theme={theme}
          onChange={onChange}
        />
      </div>
    );
  }
  if (kind === 'enum') {
    const options = valueOptions(catalog, clause.field);
    return (
      <SelectMenu
        aria-label="值"
        className="min-w-0 flex-1"
        value={
          options.some((option) => option.value === clause.value)
            ? clause.value
            : ''
        }
        placeholder="请选择"
        colors={suggestColors(theme)}
        options={[{ value: '', label: '请选择' }, ...options]}
        onChange={(value) =>
          onChange({ value, valueMode: undefined, valueLabel: undefined })
        }
      />
    );
  }
  if (kind === 'number') {
    return (
      <Input
        type="number"
        aria-label="值"
        className="min-w-0 flex-1"
        placeholder="值"
        value={clause.value}
        onChange={(event) =>
          onChange({
            value: event.target.value,
            valueMode: undefined,
            valueLabel: undefined,
          })
        }
      />
    );
  }
  return (
    <Input
      aria-label="值"
      className="min-w-0 flex-1"
      placeholder="值"
      value={clause.value}
      onChange={(event) =>
        onChange({
          value: event.target.value,
          valueMode: undefined,
          valueLabel: undefined,
        })
      }
    />
  );
}

function ClauseOperator({
  clause,
  catalog,
  theme,
  onChange,
}: {
  clause: ClauseValue;
  catalog: FieldCatalog | null;
  theme: BoardTheme;
  onChange: (patch: Partial<ClauseValue>) => void;
}) {
  return (
    <SelectMenu
      aria-label="比较符"
      className="w-40 shrink-0"
      value={displayedOperator(clause)}
      colors={suggestColors(theme)}
      options={operatorsFor(controlKind(catalog, clause.field))}
      onChange={(next) => onChange(clauseAfterOperator(clause, next))}
    />
  );
}

export function FilterRows({
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
            <div className="min-w-0 flex-1">
              <SuggestInput
                value={filter.field}
                placeholder="字段"
                options={fieldOptions(catalog)}
                colors={suggestColors(theme)}
                onChange={(field) =>
                  updateAt(index, clauseAfterField(filter, field, catalog))
                }
              />
            </div>
            <ClauseOperator
              clause={filter}
              catalog={catalog}
              theme={theme}
              onChange={(patch) => updateAt(index, patch)}
            />
            <ClauseValueControl
              clause={filter}
              catalog={catalog}
              theme={theme}
              onChange={(patch) => updateAt(index, patch)}
            />
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

function FieldInput({
  label,
  field,
  catalog,
  theme,
  kinds,
  onChange,
}: {
  label: string;
  field: FieldRef;
  catalog: FieldCatalog | null;
  theme: BoardTheme;
  kinds?: FieldKind[];
  onChange: (field: FieldRef) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 text-sm"
      style={{ color: theme.textMuted }}
    >
      {label}
      <SuggestInput
        value={field.field}
        placeholder="输入中文名或字段标识筛选"
        options={fieldOptions(catalog, kinds)}
        colors={suggestColors(theme)}
        onChange={(next) =>
          onChange({
            field: next,
            display:
              next === field.field
                ? field.display
                : defaultFieldDisplay(catalog, next),
          })
        }
      />
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
  const serverUrl = useKingdeeStore((state) => state.serverUrl);
  const acctName = useKingdeeStore((state) => state.acctName);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Dataset>(dataset);
  const [mode, setMode] = useState<Presentation>(presentationOf(dataset));
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [preview, setPreview] = useState<QueryChartResult | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [querying, setQuerying] = useState(false);
  const catalogRequest = useRef(0);

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

  const handleLoadCatalog = () => loadCatalogFor(draft.formId, true);

  const loadCatalogFor = (formId: string, force: boolean): number => {
    const requestId = ++catalogRequest.current;
    if (!requireConnection()) {
      return requestId;
    }
    const trimmed = formId.trim();
    if (!trimmed) {
      toast({ title: '请先填写表单 ID' });
      return requestId;
    }
    const { cached, fresh } = beginCatalogLoad(
      { serverUrl, acctName },
      trimmed,
      { force },
    );
    if (cached) {
      setCatalog(cached);
    }
    setLoadingCatalog(force || !cached);
    void fresh
      .then((loaded) => {
        if (catalogRequest.current !== requestId) {
          return;
        }
        setCatalog(loaded);
        if (force || !cached) {
          toast({
            title: '已读取字段',
            description: `${loaded.formName}，共 ${loaded.fields.length} 个字段`,
          });
        }
      })
      .catch((error: unknown) => {
        if (catalogRequest.current !== requestId) {
          return;
        }
        if (force || !cached) {
          toast({
            title: '读取字段失败',
            description: formatKingdeeError(error),
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        if (catalogRequest.current === requestId) {
          setLoadingCatalog(false);
        }
      });
    return requestId;
  };

  useEffect(() => {
    if (!sessionId || !dataset.formId.trim()) {
      return;
    }
    const requestId = loadCatalogFor(dataset.formId, false);
    return () => {
      if (catalogRequest.current === requestId) {
        catalogRequest.current += 1;
      }
    };
    // 打开配置或换账套时先用已保存的目录，再在后台向金蝶刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, serverUrl, acctName, dataset.formId]);

  const presented = resolveDataset(presentDataset(draft, mode), catalog);
  const needs = fieldNeeds(mode, draft.chartType);
  const labels = fieldLabels(draft.chartType);

  const runPreview = async (page: number) => {
    if (!requireConnection()) {
      return;
    }
    const check = validateDataset(presented, mode, catalog);
    if (!check.valid) {
      toast({ title: '配置不完整', description: check.message });
      return;
    }
    setQuerying(true);
    try {
      const result = await runQuery(presented, { page });
      setPreview(result);
      setPreviewPage(page);
      if (
        page === 0 &&
        result.rows.length === 0 &&
        result.detail.length === 0
      ) {
        toast({
          title: '没有可绘制的数据',
          description:
            result.fetched === 0
              ? '查询没有返回行，请检查表单 ID、字段和过滤条件'
              : measureNotNumericMessage(draft.chartType),
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
    const check = validateDataset(presented, mode, catalog);
    if (!check.valid) {
      toast({ title: '配置不完整', description: check.message });
      return;
    }
    onSave(presented);
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
                loadCatalogFor(option.value, false);
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
        <label className="flex flex-col gap-1.5 text-sm" style={muted}>
          展示
          <SelectMenu
            aria-label="展示"
            value={mode}
            colors={suggestColors(theme)}
            options={[
              { value: 'chart', label: '图表' },
              { value: 'detail', label: '明细表' },
            ]}
            onChange={(next) => {
              setMode(next as Presentation);
              setPreview(null);
              setPreviewPage(0);
            }}
          />
        </label>
        {mode === 'chart' ? (
          <label className="flex flex-col gap-1.5 text-sm" style={muted}>
            图表类型
            <SelectMenu
              aria-label="图表类型"
              value={draft.chartType}
              colors={suggestColors(theme)}
              options={orderedChartTypes()}
              onChange={(chartType) => {
                update({ chartType: chartType as ChartType });
                setPreview(null);
                setPreviewPage(0);
              }}
            />
          </label>
        ) : null}
        {mode === 'chart' ? (
          <p className="text-sm md:col-span-2" style={muted}>
            {SHAPE_HINTS[chartShape(draft.chartType)]}
          </p>
        ) : null}
        {needs.dimension ? (
          <FieldInput
            label={labels.dimension}
            field={draft.dimension}
            catalog={catalog}
            theme={theme}
            onChange={(dimension) => update({ dimension })}
          />
        ) : null}
        {needs.series ? (
          <FieldInput
            label={
              needs.seriesRequired ? labels.series : `${labels.series}（可选）`
            }
            field={draft.series ?? { field: '', display: 'name' }}
            catalog={catalog}
            theme={theme}
            onChange={(series) =>
              update({ series: series.field.trim() ? series : null })
            }
          />
        ) : null}
        {needs.aggregation ? (
          <label className="flex flex-col gap-1.5 text-sm" style={muted}>
            {labels.aggregation}
            <SelectMenu
              aria-label={labels.aggregation}
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
        ) : null}
        {needs.measure && draft.aggregation === 'sum' ? (
          <FieldInput
            label={labels.measure}
            field={draft.measure}
            catalog={catalog}
            theme={theme}
            kinds={['number']}
            onChange={(measure) => update({ measure })}
          />
        ) : null}
        {needs.columns ? (
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm" style={muted}>
                明细列
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({
                    columns: [
                      ...draft.columns,
                      { field: '', display: 'value' },
                    ],
                  })
                }
              >
                添加列
              </Button>
            </div>
            {draft.columns.length === 0 ? (
              <p className="text-sm" style={muted}>
                添加要显示的列。
              </p>
            ) : null}
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
                                    field === item.field
                                      ? item.display
                                      : defaultFieldDisplay(catalog, field),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </div>
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
        ) : null}
        {needs.seriesCases ? (
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm" style={muted}>
                条件拆分（可选，按条件给行归类）
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({
                    seriesCases: [
                      ...draft.seriesCases,
                      { label: '', field: '', operator: 'eq', value: '' },
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
                  <div className="min-w-0 flex-1">
                    <SuggestInput
                      value={item.field}
                      placeholder="字段"
                      options={fieldOptions(catalog)}
                      colors={suggestColors(theme)}
                      onChange={(field) =>
                        updateCase(
                          index,
                          clauseAfterField(item, field, catalog),
                        )
                      }
                    />
                  </div>
                  <ClauseOperator
                    clause={item}
                    catalog={catalog}
                    theme={theme}
                    onChange={(patch) => updateCase(index, patch)}
                  />
                  <ClauseValueControl
                    clause={item}
                    catalog={catalog}
                    theme={theme}
                    onChange={(patch) => updateCase(index, patch)}
                  />
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
        ) : null}
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
              void runPreview(0);
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
      {preview &&
      (preview.rows.length > 0 ||
        preview.detail.length > 0 ||
        previewPage > 0) ? (
        <div className="h-80 rounded-xl border p-5" style={panelStyle(theme)}>
          <ChartView
            dataset={presented}
            chartType={presented.chartType}
            result={preview}
            headers={columnHeaders(catalog, presented)}
            palette={boardPalette(theme)}
            dark={theme.dark}
            page={previewPage}
            hasNext={preview.queryTruncated}
            busy={querying}
            onPage={
              presented.columns.length > 0
                ? (page) => {
                    void runPreview(page);
                  }
                : undefined
            }
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
  const serverUrl = useKingdeeStore((state) => state.serverUrl);
  const acctName = useKingdeeStore((state) => state.acctName);
  const saveDashboard = useAnalysisStore((state) => state.saveDashboard);
  const saveWidget = useAnalysisStore((state) => state.saveWidget);
  const deleteWidget = useAnalysisStore((state) => state.deleteWidget);
  const [adding, setAdding] = useState(false);
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

  const filterFormKey = useMemo(() => {
    const ids = dashboard.widgets
      .map(
        (widget) =>
          datasets.find((item) => item.id === widget.datasetId)?.formId ?? '',
      )
      .filter((formId) => formId.trim().length > 0);
    return [...new Set(ids)].join('\n');
  }, [dashboard.widgets, datasets]);

  useEffect(() => {
    const formIds = filterFormKey ? filterFormKey.split('\n') : [];
    if (formIds.length === 0) {
      setFilterCatalog(null);
      setLoadingFilterFields(false);
      return;
    }
    const scope = { serverUrl, acctName };
    let cancelled = false;
    const cached = formIds
      .map((formId) => readCatalogCache(scope, formId))
      .filter((item): item is FieldCatalog => item != null);
    setFilterCatalog(cached.length > 0 ? mergeCatalogs(cached) : null);
    setLoadingFilterFields(cached.length === 0);
    void Promise.allSettled(
      formIds.map((formId) => beginCatalogLoad(scope, formId).fresh),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const catalogs: FieldCatalog[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          catalogs.push(result.value);
          return;
        }
        const fallback = readCatalogCache(scope, formIds[index] ?? '');
        if (fallback) {
          catalogs.push(fallback);
        }
      });
      const failed = results.find(
        (result, index) =>
          result.status === 'rejected' &&
          readCatalogCache(scope, formIds[index] ?? '') == null,
      );
      if (failed?.status === 'rejected') {
        toast({
          title: '读取字段失败',
          description: formatKingdeeError(failed.reason),
          variant: 'destructive',
        });
      }
      setFilterCatalog(catalogs.length > 0 ? mergeCatalogs(catalogs) : null);
      setLoadingFilterFields(false);
    });
    return () => {
      cancelled = true;
    };
    // 表单集合或账套变化时先用缓存，再在后台刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFormKey, serverUrl, acctName]);

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
          {(datasets.find((item) => item.id === widgetDraft.datasetId)?.columns
            .length ?? 0) > 0 ? (
            <p className="pb-2 text-sm" style={muted}>
              明细表，按数据集里的列显示
            </p>
          ) : (
            <label className="flex flex-col gap-1.5 text-sm" style={muted}>
              图表类型（只能换成同类图）
              <SelectMenu
                aria-label="图表类型"
                value={widgetDraft.chartType}
                colors={suggestColors(theme)}
                options={compatibleChartTypes(
                  datasets.find((item) => item.id === widgetDraft.datasetId)
                    ?.chartType ?? widgetDraft.chartType,
                )}
                onChange={(chartType) =>
                  setWidgetDraft({
                    ...widgetDraft,
                    chartType: chartType as ChartType,
                  })
                }
              />
            </label>
          )}
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
        {loadingFilterFields ? (
          <p className="mb-2 text-xs" style={muted}>
            读取字段...
          </p>
        ) : null}
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
  const serverUrl = useKingdeeStore((state) => state.serverUrl);
  const acctName = useKingdeeStore((state) => state.acctName);
  const { toast } = useToast();
  const [result, setResult] = useState<QueryChartResult | null>(null);
  const [headers, setHeaders] = useState<ColumnHeader[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [shownPage, setShownPage] = useState(0);

  const filterKey = JSON.stringify(filters);
  const paging = sources.length === 0 && dataset.columns.length > 0;
  const detailKey = `${dataset.id}:${filterKey}`;
  const [pageKey, setPageKey] = useState(detailKey);
  if (paging && pageKey !== detailKey) {
    setPageKey(detailKey);
    setPage(0);
  }
  const activePage = paging && pageKey === detailKey ? page : 0;

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const scope = { serverUrl, acctName };
    if (dataset.columns.length > 0) {
      const cached = readCatalogCache(scope, dataset.formId);
      if (cached) {
        setHeaders(columnHeaders(cached, dataset));
      }
    }
    const run = async () => {
      const queried = sources.length
        ? await runMerged(
            [dataset, ...sources].map((source) => ({
              dataset: { ...source, filters: [...source.filters, ...filters] },
              legend: source.name,
            })),
          )
        : await runQuery(
            {
              ...dataset,
              filters: [...dataset.filters, ...filters],
            },
            { page: activePage },
          );
      if (cancelled) {
        return;
      }
      setResult(queried);
      setShownPage(activePage);
      if (dataset.columns.length > 0) {
        try {
          const catalog = await beginCatalogLoad(scope, dataset.formId).fresh;
          if (!cancelled) {
            setHeaders(columnHeaders(catalog, dataset));
          }
        } catch {
          if (!cancelled) {
            setHeaders(
              columnHeaders(readCatalogCache(scope, dataset.formId), dataset),
            );
          }
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
  }, [
    sessionId,
    dataset,
    chartType,
    filterKey,
    serverUrl,
    acctName,
    activePage,
  ]);

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
  const empty =
    !result || (result.rows.length === 0 && result.detail.length === 0);
  if (empty && shownPage === 0) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        没有可绘制的数据。
      </p>
    );
  }
  if (!result) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        查询中...
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
      page={shownPage}
      hasNext={result.queryTruncated}
      busy={loading}
      onPage={paging ? setPage : undefined}
    />
  );
}
