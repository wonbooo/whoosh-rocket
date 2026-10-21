import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisPage } from '@/features/analysis/AnalysisPage';
import { useAnalysisStore } from '@/features/analysis/store';
import {
  saveAnalysisSettings,
  saveAnalysisState,
} from '@/features/analysis/storage';

describe('board overview', () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      datasets: [],
      dashboards: [],
      hiddenTemplateIds: [],
      savedTemplates: [],
    });
  });

  afterEach(() => {
    cleanup();
    const themeId = useAnalysisStore.getState().themeId ?? 'default';
    saveAnalysisSettings({ themeId, hiddenTemplateIds: [] });
    useAnalysisStore.setState({
      datasets: [],
      dashboards: [],
      hiddenTemplateIds: [],
      savedTemplates: [],
    });
    saveAnalysisState({ datasets: [], dashboards: [], savedTemplates: [] });
  });

  it('shows only dashboards and removes a template from the menu', async () => {
    const user = userEvent.setup();
    render(<AnalysisPage />);

    expect(
      screen.queryByRole('heading', { name: '数据集' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '看板' })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: '从模板创建' }));

    expect(
      screen.queryByRole('option', { name: '从模板创建' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '采购入库看板' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除 采购入库看板' }));

    expect(
      screen.getByText(
        '确定删除模板「采购入库看板」？模板里的数据集也会删除。',
      ),
    ).toBeInTheDocument();
    expect(useAnalysisStore.getState().hiddenTemplateIds).toEqual([]);

    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(
      screen.queryByRole('option', { name: '采购入库看板' }),
    ).not.toBeInTheDocument();
    expect(useAnalysisStore.getState().hiddenTemplateIds).toEqual([
      'purchase-inbound',
    ]);
    expect(useAnalysisStore.getState().dashboards).toEqual([]);
  });

  it('asks before deleting a dashboard', async () => {
    useAnalysisStore.setState({
      dashboards: [
        {
          id: 'board-1',
          name: '经营看板',
          filters: [],
          widgets: [],
        },
      ],
      datasets: [
        {
          id: 'ds-1',
          name: '采购分析',
          formId: 'PUR_PurchaseOrder',
          dimension: { field: 'FMaterialId', display: 'name' },
          series: null,
          seriesCases: [],
          measure: { field: '', display: 'value' },
          aggregation: 'count',
          columns: [],
          filters: [],
          limit: 20,
          chartType: 'bar',
          dashboardId: 'board-1',
        },
      ],
    });
    const user = userEvent.setup();
    render(<AnalysisPage />);

    await user.click(screen.getByRole('button', { name: '删除 经营看板' }));
    expect(
      screen.getByText(
        '确定删除看板「经营看板」？这块看板里的数据集也会删除。',
      ),
    ).toBeInTheDocument();
    expect(useAnalysisStore.getState().datasets).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(useAnalysisStore.getState().dashboards).toEqual([]);
    expect(useAnalysisStore.getState().datasets).toEqual([]);
  });

  it('exports a board and imports the file as a new board', async () => {
    const dataset = {
      id: 'ds-1',
      name: '采购分析',
      formId: 'PUR_PurchaseOrder',
      dimension: { field: 'FMaterialId', display: 'name' as const },
      series: null,
      seriesCases: [],
      measure: { field: '', display: 'value' as const },
      aggregation: 'count' as const,
      columns: [],
      filters: [],
      limit: 20,
      chartType: 'bar' as const,
      dashboardId: 'board-1',
    };
    useAnalysisStore.setState({
      dashboards: [
        {
          id: 'board-1',
          name: '经营看板',
          filters: [],
          widgets: [
            {
              id: 'w-1',
              title: '采购分析',
              datasetId: 'ds-1',
              chartType: 'bar',
              sources: [],
              layout: { x: 0, y: 0, w: 6, h: 8 },
            },
          ],
        },
      ],
      datasets: [dataset],
    });
    const downloads: { name: string; text: string }[] = [];
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:board';
    URL.revokeObjectURL = () => {};
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clickDownload() {
      downloads.push({
        name: this.download,
        text: String(this.href),
      });
    };
    const user = userEvent.setup();
    render(<AnalysisPage />);

    await user.click(screen.getByRole('button', { name: '导出 经营看板' }));

    expect(downloads).toEqual([
      { name: '经营看板.whoosh-board.json', text: 'blob:board' },
    ]);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = click;

    const file = new File(
      [
        JSON.stringify({
          kind: 'whoosh-board',
          version: 1,
          name: '经营看板',
          filters: [],
          widgets: [
            {
              id: 'w-1',
              title: '采购分析',
              datasetId: 'ds-1',
              chartType: 'bar',
              sources: [],
              layout: { x: 0, y: 0, w: 6, h: 8 },
            },
          ],
          datasets: [{ ...dataset }],
        }),
      ],
      '经营看板.whoosh-board.json',
      { type: 'application/json' },
    );
    await user.upload(screen.getByLabelText('选择看板文件'), file);
    expect(
      await screen.findByRole('textbox', { name: '看板名称' }),
    ).toHaveValue('经营看板 2');
    expect(
      useAnalysisStore.getState().dashboards.map((item) => item.name),
    ).toEqual(['经营看板', '经营看板 2']);
  });

  it('asks for a unique dashboard name before creating from a template', async () => {
    useAnalysisStore.setState({
      dashboards: [
        {
          id: 'board-1',
          name: '采购入库看板',
          filters: [],
          widgets: [],
        },
      ],
    });
    const user = userEvent.setup();
    render(<AnalysisPage />);

    await user.click(screen.getByRole('combobox', { name: '从模板创建' }));
    await user.click(screen.getByRole('button', { name: '采购入库看板' }));

    const name = screen.getByRole('textbox', { name: '看板名称' });
    expect(name).toHaveValue('采购入库看板');
    expect(screen.getByText('看板名称已存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定' })).toBeDisabled();

    await user.clear(name);
    await user.type(name, '本月入库');
    expect(screen.queryByText('看板名称已存在')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(
      useAnalysisStore.getState().dashboards.map((item) => item.name),
    ).toContain('本月入库');
  });
});
