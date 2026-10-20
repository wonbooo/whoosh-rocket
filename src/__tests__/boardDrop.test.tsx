import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisPage } from '@/features/analysis/AnalysisPage';
import { useAnalysisStore } from '@/features/analysis/store';
import { saveAnalysisState } from '@/features/analysis/storage';
import type { Dashboard, Dataset } from '@/features/analysis/types';

function dataset(): Dataset {
  return {
    id: 'ds-1',
    name: '采购分析',
    formId: 'PUR_PurchaseOrder',
    dimension: { field: 'FSupplierId', display: 'name' },
    series: null,
    seriesCases: [],
    measure: { field: 'FQty', display: 'value' },
    aggregation: 'sum',
    columns: [],
    filters: [],
    limit: 20,
    chartType: 'bar',
  };
}

function dashboard(): Dashboard {
  return {
    id: 'board-1',
    name: '经营看板',
    filters: [],
    widgets: [
      {
        id: 'widget-1',
        title: '旧标题',
        datasetId: 'ds-1',
        chartType: 'bar',
        sources: [],
        layout: { x: 0, y: 0, w: 6, h: 8 },
      },
    ],
  };
}

describe('dashboard panels', () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      datasets: [dataset()],
      dashboards: [dashboard()],
      hiddenTemplateIds: [],
    });
  });

  afterEach(() => {
    cleanup();
    useAnalysisStore.setState({
      datasets: [],
      dashboards: [],
      hiddenTemplateIds: [],
      savedTemplates: [],
    });
    saveAnalysisState({ datasets: [], dashboards: [], savedTemplates: [] });
  });

  async function openBoard() {
    const user = userEvent.setup();
    render(<AnalysisPage />);
    await user.click(screen.getByRole('button', { name: /^经营看板/ }));
    return user;
  }

  it('rejects a dashboard name that another board already uses', async () => {
    useAnalysisStore.setState({
      dashboards: [
        dashboard(),
        {
          id: 'board-2',
          name: '已有看板',
          filters: [],
          widgets: [],
        },
      ],
    });
    const user = await openBoard();
    const name = screen.getByRole('textbox', { name: '看板名称' });

    await user.clear(name);
    await user.type(name, '已有看板');
    expect(screen.getByText('看板名称已存在')).toBeInTheDocument();
    await user.tab();
    expect(useAnalysisStore.getState().dashboards[0]?.name).toBe('经营看板');

    await user.clear(name);
    await user.type(name, '新看板');
    await user.tab();
    expect(useAnalysisStore.getState().dashboards[0]?.name).toBe('新看板');
  });

  it('opens the dataset editor from the panel settings icon', async () => {
    const user = await openBoard();

    await user.click(screen.getByRole('button', { name: '配置数据集' }));

    expect(screen.getByLabelText('数据集名称')).toBeInTheDocument();
    expect(screen.getByLabelText('数据集名称')).toHaveValue('采购分析');
  });

  it('places a panel where the pointer rests after adding a chart', async () => {
    const user = await openBoard();
    const add = screen.getByRole('button', { name: '添加图表' });
    await user.pointer([
      { keys: '[MouseLeft>]', target: add },
      { coords: { x: 80, y: 120 } },
      { keys: '[/MouseLeft]' },
    ]);

    expect(
      useAnalysisStore.getState().datasets.map((item) => item.name),
    ).toContain('未命名图表');
    expect(useAnalysisStore.getState().dashboards[0]?.widgets).toHaveLength(2);
    expect(await screen.findByText('未命名图表')).toBeInTheDocument();
  });

  it('asks before removing a panel and then deletes its dataset', async () => {
    const user = await openBoard();

    await user.click(screen.getByRole('button', { name: '移除' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      '确定移除「采购分析」，并删除对应的数据集？',
    );
    expect(useAnalysisStore.getState().datasets).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(useAnalysisStore.getState().datasets).toEqual([]);
    expect(useAnalysisStore.getState().dashboards[0]?.widgets).toEqual([]);
  });

  it('saves the board as a template and rejects a duplicate name', async () => {
    const user = await openBoard();

    await user.click(screen.getByRole('button', { name: '保存为模板' }));
    expect(screen.getByRole('textbox', { name: '模板名称' })).toHaveValue(
      '经营看板',
    );
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(
      useAnalysisStore.getState().savedTemplates.map((item) => item.name),
    ).toEqual(['经营看板']);

    await user.click(screen.getByRole('button', { name: '保存为模板' }));
    expect(screen.getByText('模板名称已存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定' })).toBeDisabled();
  });
});
