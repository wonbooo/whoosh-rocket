import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Maximize2,
  Minimize2,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import GridLayout, { getCompactor, useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import { formatKingdeeError } from '@/apis/kingdee/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { DETAIL_PAGE_SIZE } from '@/features/analysis/merge';
import { useAnalysisStore } from '@/features/analysis/store';
import { findTheme } from '@/features/analysis/themes';
import type { BoardTheme } from '@/features/analysis/themes';
import { boardExport, parseBoardExport } from '@/features/analysis/normalize';
import {
  groupOverlaps,
  droppedOn,
  overlaps,
} from '@/features/analysis/overlap';
import {
  BOARD_TEMPLATES,
  instantiateSavedTemplate,
  instantiateTemplate,
  instantiateImportedBoard,
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
  thisYear: '今年',
  last6Months: '最近 6 个月',
};

const COMPARE_LABELS: Record<FilterOperator, string> = {
  eq: '等于',
  neq: '不等于',
  contains: '包含',
  notContains: '不包含',
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
    return ['eq', 'neq', 'contains', 'notContains'].map((value) => ({
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
  return ['eq', 'neq', 'contains', 'notContains'].map((value) => ({
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

const PANEL_W = 6;
const PANEL_H = 8;
const GRID_COLS = 12;
const ROW_HEIGHT = 32;
const GRID_MARGIN: readonly [number, number] = [16, 16];
function cellBox(cell: { x: number; y: number }, gridWidth: number) {
  const colWidth =
    (gridWidth - GRID_MARGIN[0] * (GRID_COLS - 1) - GRID_MARGIN[0] * 2) /
    GRID_COLS;
  const left = Math.round(
    (colWidth + GRID_MARGIN[0]) * cell.x + GRID_MARGIN[0],
  );
  const top = Math.round(
    (ROW_HEIGHT + GRID_MARGIN[1]) * cell.y + GRID_MARGIN[1],
  );
  const width = Math.round(colWidth * PANEL_W + GRID_MARGIN[0] * (PANEL_W - 1));
  const height = Math.round(
    ROW_HEIGHT * PANEL_H + GRID_MARGIN[1] * (PANEL_H - 1),
  );
  return { left, top, width, height };
}

function gridCell(
  clientX: number,
  clientY: number,
  grid: HTMLElement,
  gridWidth: number,
  maxY: number,
): { x: number; y: number } | null {
  const colWidth =
    (gridWidth - GRID_MARGIN[0] * (GRID_COLS - 1) - GRID_MARGIN[0] * 2) /
    GRID_COLS;
  if (!(colWidth > 1)) {
    return { x: 0, y: 0 };
  }
  const rect = grid.getBoundingClientRect();
  const itemWidth = colWidth * PANEL_W + GRID_MARGIN[0] * (PANEL_W - 1);
  const itemHeight = ROW_HEIGHT * PANEL_H + GRID_MARGIN[1] * (PANEL_H - 1);
  const left = clientX - rect.left - itemWidth / 2;
  const top = clientY - rect.top - itemHeight / 2;
  const x = Math.round((left - GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]));
  const y = Math.round((top - GRID_MARGIN[1]) / (ROW_HEIGHT + GRID_MARGIN[1]));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.max(0, Math.min(GRID_COLS - PANEL_W, x)),
    y: Math.max(0, Math.min(maxY, y)),
  };
}

function blankDataset(): Dataset {
  return {
    id: newId(),
    name: '未命名图表',
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

function duplicateName(name: string, names: string[]): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && names.some((item) => item.trim() === trimmed);
}

function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function widgetTitle(widget: Widget, datasets: Dataset[]): string {
  const name = datasets
    .find((dataset) => dataset.id === widget.datasetId)
    ?.name.trim();
  return name || widget.title || '未命名图表';
}

export function AnalysisPage() {
  const { toast } = useToast();
  const datasets = useAnalysisStore((state) => state.datasets);
  const dashboards = useAnalysisStore((state) => state.dashboards);
  const saveDataset = useAnalysisStore((state) => state.saveDataset);
  const saveDashboard = useAnalysisStore((state) => state.saveDashboard);
  const savedTemplates = useAnalysisStore((state) => state.savedTemplates);
  const saveBoardTemplate = useAnalysisStore(
    (state) => state.saveBoardTemplate,
  );
  const hiddenTemplateIds = useAnalysisStore(
    (state) => state.hiddenTemplateIds,
  );
  const deleteTemplate = useAnalysisStore((state) => state.deleteTemplate);
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
      {editing ? (
        <DatasetEditor
          dataset={editing}
          theme={theme}
          onCancel={() => setEditing(null)}
          onSave={(dataset) => {
            saveDataset(dataset);
            if (dashboard) {
              const widgets = dashboard.widgets.map((widget) =>
                widget.datasetId === dataset.id
                  ? {
                      ...widget,
                      title: dataset.name.trim() || widget.title,
                      chartType: dataset.chartType,
                    }
                  : widget,
              );
              const changed = widgets.some(
                (widget, index) =>
                  widget.title !== dashboard.widgets[index]?.title ||
                  widget.chartType !== dashboard.widgets[index]?.chartType,
              );
              if (changed) {
                saveDashboard({ ...dashboard, widgets });
              }
            }
            setEditing(null);
            toast({ title: '数据集已保存', description: dataset.name });
          }}
        />
      ) : dashboard ? (
        <DashboardView
          dashboard={dashboard}
          datasets={datasets}
          theme={theme}
          onBack={() => setOpenDashboard(null)}
          onEditDataset={setEditing}
          templateNames={[
            ...BOARD_TEMPLATES.map((template) => template.name),
            ...(savedTemplates ?? []).map((template) => template.name),
          ]}
          onSaveTemplate={(name) => {
            const referenced = new Set<string>();
            for (const widget of dashboard.widgets) {
              if (widget.datasetId) {
                referenced.add(widget.datasetId);
              }
              for (const source of widget.sources ?? []) {
                referenced.add(source);
              }
            }
            saveBoardTemplate({
              id: newId(),
              name,
              datasets: datasets
                .filter((dataset) => referenced.has(dataset.id))
                .map((dataset) => {
                  const copy = { ...dataset };
                  delete copy.dashboardId;
                  return copy;
                }),
              filters: dashboard.filters.map((filter) => ({ ...filter })),
              widgets: dashboard.widgets.map((widget) => ({
                ...widget,
                sources: [...(widget.sources ?? [])],
                layout: { ...widget.layout },
              })),
            });
            toast({ title: '已保存为模板', description: name });
          }}
        />
      ) : (
        <Overview
          dashboards={dashboards}
          theme={theme}
          templates={[
            ...BOARD_TEMPLATES.filter(
              (template) => !hiddenTemplateIds?.includes(template.id),
            ),
            ...(savedTemplates ?? []),
          ]}
          onHideTemplate={deleteTemplate}
          onOpenDashboard={setOpenDashboard}
          onDeleteDashboard={deleteDashboard}
          onExportDashboard={(dashboard) => {
            const exported = boardExport(dashboard, datasets);
            const blob = new Blob([JSON.stringify(exported, null, 2)], {
              type: 'application/json',
            });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = `${dashboard.name.trim() || '看板'}.whoosh-board.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url));
          }}
          onImportBoard={(text) => {
            const imported = parseBoardExport(text);
            if (!imported) {
              toast({
                title: '导入失败',
                description: '这个文件不是看板导出文件',
              });
              return;
            }
            const taken = new Set(dashboards.map((item) => item.name.trim()));
            let name = imported.name.trim() || '导入的看板';
            if (taken.has(name)) {
              let suffix = 2;
              while (taken.has(`${name} ${suffix}`)) {
                suffix += 1;
              }
              name = `${name} ${suffix}`;
            }
            const board = instantiateImportedBoard(imported, name);
            applyTemplate(board);
            setOpenDashboard(board.dashboard.id);
            toast({
              title: '看板已导入',
              description: `${board.dashboard.name}，含 ${board.datasets.length} 个数据集`,
            });
          }}
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
          onApplyTemplate={(templateId, dashboardName) => {
            const saved = (savedTemplates ?? []).find(
              (item) => item.id === templateId,
            );
            const builtin = BOARD_TEMPLATES.find(
              (item) => item.id === templateId,
            );
            const board = saved
              ? instantiateSavedTemplate(saved, dashboardName)
              : builtin
                ? instantiateTemplate(builtin, dashboardName)
                : null;
            if (!board) {
              return;
            }
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
  dashboards,
  theme,
  templates,
  onHideTemplate,
  onOpenDashboard,
  onDeleteDashboard,
  onExportDashboard,
  onImportBoard,
  onCreateDashboard,
  onApplyTemplate,
}: {
  dashboards: Dashboard[];
  theme: BoardTheme;
  templates: { id: string; name: string }[];
  onHideTemplate: (id: string) => void;
  onOpenDashboard: (id: string) => void;
  onDeleteDashboard: (id: string) => void;
  onExportDashboard: (dashboard: Dashboard) => void;
  onImportBoard: (text: string) => void;
  onCreateDashboard: () => void;
  onApplyTemplate: (templateId: string, dashboardName: string) => void;
}) {
  const muted = { color: theme.textMuted };
  const [pendingTemplate, setPendingTemplate] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'template'; id: string; name: string }
    | { kind: 'dashboard'; id: string; name: string }
    | null
  >(null);
  const [boardName, setBoardName] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const boardNameTaken = duplicateName(
    boardName,
    dashboards.map((item) => item.name),
  );
  const boardNameMessage = !boardName.trim()
    ? '请填写看板名称'
    : boardNameTaken
      ? '看板名称已存在'
      : '';
  return (
    <div>
      <section className="rounded-xl border p-5" style={panelStyle(theme)}>
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">看板</h2>
          <div className="flex items-center gap-2">
            <SelectMenu
              aria-label="从模板创建"
              className="w-96"
              value=""
              placeholder="从模板创建"
              colors={suggestColors(theme)}
              options={templates.map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              onChange={(value) => {
                const template = templates.find((item) => item.id === value);
                if (!template) {
                  return;
                }
                setPendingTemplate(template);
                setBoardName(template.name);
              }}
              onRemove={(id) => {
                const template = templates.find((item) => item.id === id);
                if (!template) {
                  return;
                }
                setPendingDelete({
                  kind: 'template',
                  id: template.id,
                  name: template.name,
                });
              }}
            />
            <button
              type="button"
              aria-label="导入看板"
              title="导入看板"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
              style={{ borderColor: theme.border, color: theme.text }}
              onClick={() => importInput.current?.click()}
            >
              <Upload className="h-4 w-4" />
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              aria-label="选择看板文件"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) {
                  return;
                }
                void readFileText(file).then(onImportBoard);
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
              <li
                key={dashboard.id}
                className="flex items-center rounded-lg border"
                style={{ borderColor: theme.border }}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 px-3 py-2 text-left"
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
                <button
                  type="button"
                  aria-label={`导出 ${dashboard.name}`}
                  title="导出看板配置"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  style={{ color: theme.textMuted }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = theme.panelAlt;
                    event.currentTarget.style.color = theme.text;
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                    event.currentTarget.style.color = theme.textMuted;
                  }}
                  onClick={() => onExportDashboard(dashboard)}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${dashboard.name}`}
                  title="删除看板"
                  className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  style={{ color: theme.textMuted }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = theme.panelAlt;
                    event.currentTarget.style.color = theme.text;
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                    event.currentTarget.style.color = theme.textMuted;
                  }}
                  onClick={() =>
                    setPendingDelete({
                      kind: 'dashboard',
                      id: dashboard.id,
                      name: dashboard.name,
                    })
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Dialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingTemplate(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>从模板创建</DialogTitle>
            <DialogDescription>
              为「{pendingTemplate?.name ?? ''}」填写一个看板名称
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            看板名称
            <Input
              aria-label="看板名称"
              value={boardName}
              onChange={(event) => setBoardName(event.target.value)}
            />
            {boardNameMessage ? (
              <span className="text-xs text-red-500">{boardNameMessage}</span>
            ) : null}
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingTemplate(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={boardNameMessage.length > 0}
              onClick={() => {
                if (!pendingTemplate || boardNameMessage) {
                  return;
                }
                onApplyTemplate(pendingTemplate.id, boardName.trim());
                setPendingTemplate(null);
              }}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.kind === 'template' ? '删除模板' : '删除看板'}
            </DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === 'template'
                ? `确定删除模板「${pendingDelete.name}」？模板里的数据集也会删除。`
                : `确定删除看板「${pendingDelete?.name ?? ''}」？这块看板里的数据集也会删除。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!pendingDelete) {
                  return;
                }
                if (pendingDelete.kind === 'template') {
                  onHideTemplate(pendingDelete.id);
                } else {
                  onDeleteDashboard(pendingDelete.id);
                }
                setPendingDelete(null);
              }}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function catalogKind(
  catalog: FieldCatalog | null,
  field: string,
): FieldKind | null {
  return (
    catalog?.fields.find((item) => item.key === field.trim())?.kind ?? null
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
  const kind = catalogKind(catalog, field.field);
  const applyField = (next: string) => {
    const same = next === field.field;
    const selected: FieldRef = {
      field: next,
      display: same ? field.display : defaultFieldDisplay(catalog, next),
    };
    if (catalogKind(catalog, next) === 'date' && field.groupByMonth) {
      selected.groupByMonth = true;
    }
    onChange(selected);
  };
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
        onChange={applyField}
      />
      {kind === 'date' ? (
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`${label}是否按月分组`}
            checked={field.groupByMonth === true}
            onChange={(event) => {
              const next = { ...field };
              if (event.target.checked) {
                next.groupByMonth = true;
              } else {
                delete next.groupByMonth;
              }
              onChange(next);
            }}
          />
          是否按月分组
        </label>
      ) : null}
    </div>
  );
}

export function DatasetEditor({
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
                  <label
                    className="flex shrink-0 items-center gap-1.5 text-sm"
                    style={muted}
                  >
                    <input
                      type="checkbox"
                      aria-label={
                        column.field.trim()
                          ? `求和 ${column.field.trim()}`
                          : `求和 ${index + 1}`
                      }
                      checked={column.sum === true}
                      onChange={(event) =>
                        update({
                          columns: draft.columns.map((item, current) => {
                            if (current !== index) {
                              return item;
                            }
                            if (event.target.checked) {
                              return { ...item, sum: true };
                            }
                            const next = { ...item };
                            delete next.sum;
                            return next;
                          }),
                        })
                      }
                    />
                    求和
                  </label>
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
  onEditDataset,
  templateNames,
  onSaveTemplate,
}: {
  dashboard: Dashboard;
  datasets: Dataset[];
  theme: BoardTheme;
  onBack: () => void;
  onEditDataset: (dataset: Dataset) => void;
  templateNames: string[];
  onSaveTemplate: (name: string) => void;
}) {
  const { toast } = useToast();
  const serverUrl = useKingdeeStore((state) => state.serverUrl);
  const acctName = useKingdeeStore((state) => state.acctName);
  const saveDashboard = useAnalysisStore((state) => state.saveDashboard);
  const saveDataset = useAnalysisStore((state) => state.saveDataset);
  const saveWidget = useAnalysisStore((state) => state.saveWidget);
  const deleteWidget = useAnalysisStore((state) => state.deleteWidget);
  const deleteDataset = useAnalysisStore((state) => state.deleteDataset);
  const [removeTarget, setRemoveTarget] = useState<Widget | null>(null);
  const [adding, setAdding] = useState(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [filterCatalog, setFilterCatalog] = useState<FieldCatalog | null>(null);
  const [loadingFilterFields, setLoadingFilterFields] = useState(false);
  const [expanded, setExpanded] = useState<Widget | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const templateNameTaken = duplicateName(templateName, templateNames);
  const templateNameMessage = !templateName.trim()
    ? '请填写模板名称'
    : templateNameTaken
      ? '模板名称已存在'
      : '';

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

  const placePanel = (item: { x: number; y: number; w: number; h: number }) => {
    const dataset = { ...blankDataset(), dashboardId: dashboard.id };
    saveDataset(dataset);
    saveWidget(dashboard.id, {
      id: newId(),
      title: dataset.name,
      datasetId: dataset.id,
      chartType: dataset.chartType,
      sources: [],
      layout: { x: item.x, y: item.y, w: item.w, h: item.h },
    });
    setAdding(false);
  };
  const placeRef = useRef(placePanel);
  placeRef.current = placePanel;
  const maxYRef = useRef(0);
  maxYRef.current =
    groupedLayout.reduce((max, item) => Math.max(max, item.y + item.h), 0) +
    PANEL_H;
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragActive = useRef(false);

  const hidePlaceholder = () => {
    const node = placeholderRef.current;
    if (!node) {
      return;
    }
    node.style.display = 'none';
  };

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragActive.current) {
      return;
    }
    event.preventDefault();
    dragActive.current = true;
    const pointerId = event.pointerId;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(pointerId);
    } catch {
      // 部分环境不支持指针捕获，松开按键时仍会结束拖拽。
    }
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setAdding(true);
    let speed = 0;
    let frame = 0;

    const gridNode = () =>
      containerRef.current?.querySelector<HTMLElement>('.react-grid-layout') ??
      null;

    const follow = () => {
      const grid = gridNode();
      const node = placeholderRef.current;
      if (!grid || !node) {
        return;
      }
      const next = gridCell(
        pointerRef.current.x,
        pointerRef.current.y,
        grid,
        widthRef.current,
        maxYRef.current,
      );
      if (!next) {
        return;
      }
      const box = cellBox(next, widthRef.current);
      node.style.display = 'block';
      node.style.pointerEvents = 'none';
      node.style.width = `${box.width}px`;
      node.style.height = `${box.height}px`;
      node.style.transform = `translate(${box.left}px, ${box.top}px)`;
    };

    const finish = (place: boolean) => {
      if (!dragActive.current) {
        return;
      }
      dragActive.current = false;
      speed = 0;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      hidePlaceholder();
      if (place) {
        const grid = gridNode();
        if (grid) {
          const next = gridCell(
            pointerRef.current.x,
            pointerRef.current.y,
            grid,
            widthRef.current,
            maxYRef.current,
          );
          if (next) {
            placeRef.current({ ...next, w: PANEL_W, h: PANEL_H });
          }
        }
      }
      setAdding(false);
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      if ((moveEvent.buttons & 1) === 0) {
        finish(true);
        return;
      }
      const edge = 72;
      const height = window.innerHeight;
      if (moveEvent.clientY > height - edge) {
        speed = 10 + (moveEvent.clientY - (height - edge)) * 0.45;
      } else if (moveEvent.clientY < edge) {
        speed = -(10 + (edge - moveEvent.clientY) * 0.45);
      } else {
        speed = 0;
      }
      follow();
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      pointerRef.current = { x: upEvent.clientX, y: upEvent.clientY };
      finish(true);
    };

    const onCancel = () => finish(false);

    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        finish(false);
      }
    };

    const tick = () => {
      if (!dragActive.current) {
        return;
      }
      follow();
      if (speed !== 0) {
        const root = document.scrollingElement ?? document.documentElement;
        const maxScroll = root.scrollHeight - root.clientHeight;
        const nextTop = Math.min(
          maxScroll,
          Math.max(0, root.scrollTop + speed),
        );
        if (nextTop !== root.scrollTop) {
          root.scrollTop = nextTop;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey);
    frame = requestAnimationFrame(tick);
  };

  const openDataset = (widget: Widget) => {
    const existing = datasets.find(
      (dataset) => dataset.id === widget.datasetId,
    );
    if (existing) {
      onEditDataset(existing);
      return;
    }
    const dataset = blankDataset();
    saveDataset(dataset);
    saveWidget(dashboard.id, { ...widget, datasetId: dataset.id });
    onEditDataset(dataset);
  };

  const dashboards = useAnalysisStore((state) => state.dashboards);
  const [nameDraft, setNameDraft] = useState(dashboard.name);
  useEffect(() => {
    setNameDraft(dashboard.name);
  }, [dashboard.name]);
  const nameTaken = duplicateName(
    nameDraft,
    dashboards
      .filter((item) => item.id !== dashboard.id)
      .map((item) => item.name),
  );
  const nameMessage = !nameDraft.trim()
    ? '请填写看板名称'
    : nameTaken
      ? '看板名称已存在'
      : '';
  const commitName = () => {
    const next = nameDraft.trim();
    if (!next || nameTaken) {
      setNameDraft(dashboard.name);
      return;
    }
    if (next !== dashboard.name) {
      saveDashboard({ ...dashboard, name: next });
    }
  };

  const muted = { color: theme.textMuted };
  const showGrid = dashboard.widgets.length > 0 || adding;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <input
            aria-label="看板名称"
            className="rounded-md border border-transparent bg-transparent px-2 text-lg font-medium focus:border-input focus:outline-none"
            style={{ color: theme.text }}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          {nameDraft.trim() !== dashboard.name.trim() && nameMessage ? (
            <p className="px-2 text-xs text-red-500">{nameMessage}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setTemplateName(dashboard.name);
              setSavingTemplate(true);
            }}
          >
            保存为模板
          </Button>
          <Button
            type="button"
            size="sm"
            data-add-chart=""
            onPointerDown={beginDrag}
          >
            添加图表
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            返回
          </Button>
        </div>
      </div>
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
      {dashboard.widgets.length === 0 && !adding ? (
        <p className="text-sm" style={muted}>
          看板是空的，添加一个图表。
        </p>
      ) : null}
      {showGrid ? (
        <div ref={containerRef} className="relative">
          {mounted ? (
            <GridLayout
              width={width}
              layout={groupedLayout}
              gridConfig={{
                cols: GRID_COLS,
                rowHeight: ROW_HEIGHT,
                margin: [GRID_MARGIN[0], GRID_MARGIN[1]],
              }}
              style={{
                minHeight: adding
                  ? Math.max(
                      288,
                      (maxYRef.current + PANEL_H) *
                        (ROW_HEIGHT + GRID_MARGIN[1]),
                    )
                  : undefined,
              }}
              compactor={getCompactor(null, true)}
              dragConfig={{
                enabled: true,
                bounded: false,
                handle: '.widget-drag',
                cancel: '',
                threshold: 3,
              }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              onDragStart={() => setAdding(false)}
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
                  if (
                    widget.layout.x === target.x &&
                    widget.layout.y === target.y &&
                    widget.layout.w === target.w &&
                    widget.layout.h === target.h
                  ) {
                    return widget;
                  }
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
                    (widget, index) => widget !== dashboard.widgets[index],
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
                          onConfigure={openDataset}
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
                              {widgetTitle(group.anchor, datasets)}
                            </h3>
                            <div className="flex items-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="放大"
                                aria-label="放大"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => setExpanded(group.anchor)}
                              >
                                <Maximize2 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="配置数据集"
                                aria-label="配置数据集"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => openDataset(group.anchor)}
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="移除"
                                aria-label="移除"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => setRemoveTarget(group.anchor)}
                              >
                                <Trash2 className="h-4 w-4" />
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
          {adding ? (
            <div
              ref={placeholderRef}
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 z-10 rounded-xl bg-red-500/20"
              style={{ display: 'none', pointerEvents: 'none' }}
            />
          ) : null}
          <Dialog
            open={removeTarget !== null}
            onOpenChange={(open) => {
              if (!open) {
                setRemoveTarget(null);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>移除图表</DialogTitle>
                <DialogDescription>
                  确定移除「
                  {removeTarget ? widgetTitle(removeTarget, datasets) : ''}
                  」，并删除对应的数据集？
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRemoveTarget(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (!removeTarget) {
                      return;
                    }
                    if (removeTarget.datasetId) {
                      deleteDataset(removeTarget.datasetId);
                    } else {
                      deleteWidget(dashboard.id, removeTarget.id);
                    }
                    setRemoveTarget(null);
                  }}
                >
                  确定
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {expanded ? (
            <ExpandedWidget
              widget={expanded}
              datasets={datasets}
              filters={dashboard.filters}
              theme={theme}
              onClose={() => setExpanded(null)}
              onConfigure={openDataset}
            />
          ) : null}
        </div>
      ) : null}
      <Dialog
        open={savingTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setSavingTemplate(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为模板</DialogTitle>
            <DialogDescription>
              保存当前看板的图表和数据集配置，之后可从模板创建新看板
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            模板名称
            <Input
              aria-label="模板名称"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            {templateNameMessage ? (
              <span className="text-xs text-red-500">
                {templateNameMessage}
              </span>
            ) : null}
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSavingTemplate(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={templateNameMessage.length > 0}
              onClick={() => {
                if (templateNameMessage) {
                  return;
                }
                onSaveTemplate(templateName.trim());
                setSavingTemplate(false);
              }}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  if (!dataset.formId.trim()) {
    return (
      <p className="text-sm" style={{ color: theme.textMuted }}>
        点击设置图标配置数据集
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
  onConfigure,
  onDetach,
  onExpand,
}: {
  members: Widget[];
  datasets: Dataset[];
  filters: Filter[];
  theme: BoardTheme;
  onConfigure: (widget: Widget) => void;
  onDetach: (widget: Widget) => void;
  onExpand: (widget: Widget) => void;
}) {
  const [active, setActive] = useState(members[0]?.id ?? '');
  const current = members.find((member) => member.id === active) ?? members[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
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
                {widgetTitle(member, datasets)}
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
              aria-label="放大"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onExpand(current)}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="配置数据集"
              aria-label="配置数据集"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onConfigure(current)}
            >
              <Settings className="h-4 w-4" />
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
    </div>
  );
}

function ExpandedWidget({
  widget,
  datasets,
  filters,
  theme,
  onClose,
  onConfigure,
}: {
  widget: Widget;
  datasets: Dataset[];
  filters: Filter[];
  theme: BoardTheme;
  onClose: () => void;
  onConfigure: (widget: Widget) => void;
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
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="缩小"
            aria-label="缩小"
            onClick={onClose}
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="配置数据集"
            aria-label="配置数据集"
            onClick={() => onConfigure(widget)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
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
  const [pageSize, setPageSize] = useState<number>(DETAIL_PAGE_SIZE);
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
            { page: activePage, pageSize },
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
    pageSize,
  ]);

  const palette = useMemo(() => boardPalette(theme), [theme]);

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
      palette={palette}
      dark={theme.dark}
      page={shownPage}
      pageSize={pageSize}
      hasNext={result.queryTruncated}
      busy={loading}
      onPage={paging ? setPage : undefined}
      onPageSize={
        paging
          ? (size) => {
              setPageSize(size);
              setPage(0);
            }
          : undefined
      }
    />
  );
}
