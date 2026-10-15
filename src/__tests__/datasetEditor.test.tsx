import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisPage } from '@/features/analysis/AnalysisPage';
import type { FieldCatalog } from '@/features/analysis/catalog';
import { beginCatalogLoad, runQuery } from '@/features/analysis/query';
import { useAnalysisStore } from '@/features/analysis/store';
import { saveAnalysisState } from '@/features/analysis/storage';
import type { Dataset } from '@/features/analysis/types';
import { useKingdeeStore } from '@/store/useKingdeeStore';

vi.mock('@/features/analysis/query', () => ({
  beginCatalogLoad: vi.fn(),
  runQuery: vi.fn(),
  runMerged: vi.fn(),
  searchLookup: vi.fn(),
}));

const catalog: FieldCatalog = {
  formId: 'PUR_PurchaseOrder',
  formName: '采购订单',
  fields: [
    {
      key: 'FSupplierId',
      name: '供应商',
      entity: '',
      kind: 'lookup',
      lookupFormId: 'BD_Supplier',
      options: [],
    },
    {
      key: 'FMaterialId',
      name: '物料',
      entity: '',
      kind: 'lookup',
      lookupFormId: 'BD_MATERIAL',
      options: [],
    },
    {
      key: 'FQty',
      name: '数量',
      entity: '',
      kind: 'number',
      lookupFormId: null,
      options: [],
    },
  ],
};

function dataset(patch: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: '采购分析',
    formId: 'PUR_PurchaseOrder',
    dimension: { field: 'FSupplierId', display: 'name' },
    series: { field: 'FMaterialId', display: 'number' },
    seriesCases: [],
    measure: { field: 'FQty', display: 'value' },
    aggregation: 'sum',
    columns: [],
    filters: [],
    limit: 20,
    chartType: 'bar',
    ...patch,
  };
}

async function openEditor() {
  const user = userEvent.setup();
  render(<AnalysisPage />);
  await user.click(screen.getByRole('button', { name: '编辑' }));
  return user;
}

describe('dataset field display', () => {
  beforeEach(() => {
    vi.mocked(beginCatalogLoad).mockReset();
    vi.mocked(beginCatalogLoad).mockReturnValue({
      cached: catalog,
      fresh: new Promise(() => {}),
    });
    useKingdeeStore.setState({
      sessionId: 'session',
      serverUrl: 'http://kingdee.example',
      acctName: 'demo',
    });
    useAnalysisStore.setState({
      datasets: [dataset()],
      dashboards: [],
    });
  });

  afterEach(() => {
    cleanup();
    useAnalysisStore.setState({ datasets: [], dashboards: [] });
    saveAnalysisState({ datasets: [], dashboards: [] });
  });

  it('hides the axis display picker and still stores name or number automatically', async () => {
    const user = await openEditor();
    const axes = screen.getAllByPlaceholderText('输入中文名或字段标识筛选');

    await user.click(axes[0]);
    expect(
      await screen.findByRole('option', { name: '物料（FMaterialId）' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'X 轴按月' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'X 轴显示' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: '图例（可选）显示' }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: '物料（FMaterialId）' }),
    );
    await user.click(screen.getByRole('button', { name: '保存数据集' }));

    const saved = useAnalysisStore.getState().datasets[0];
    expect(saved?.dimension).toEqual({ field: 'FMaterialId', display: 'name' });
    expect(saved?.series).toEqual({ field: 'FMaterialId', display: 'number' });
    expect(saved?.measure).toEqual({ field: 'FQty', display: 'value' });
  });

  it('offers only numeric fields for a sum measure', async () => {
    const user = await openEditor();
    const measure = screen.getByText('Y 轴').querySelector('input');
    if (!measure) {
      throw new Error('找不到度量字段');
    }

    await user.click(measure);

    expect(
      await screen.findByRole('option', { name: '数量（FQty）' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: '供应商（FSupplierId）' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: '物料（FMaterialId）' }),
    ).not.toBeInTheDocument();
  });

  it('lists every field for a sum measure when the catalog has no numbers', async () => {
    vi.mocked(beginCatalogLoad).mockReturnValue({
      cached: {
        ...catalog,
        fields: catalog.fields.filter((field) => field.kind !== 'number'),
      },
      fresh: new Promise(() => {}),
    });
    const user = await openEditor();
    const measure = screen.getByText('Y 轴').querySelector('input');
    if (!measure) {
      throw new Error('找不到度量字段');
    }

    await user.click(measure);

    expect(
      await screen.findByRole('option', { name: '供应商（FSupplierId）' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '物料（FMaterialId）' }),
    ).toBeInTheDocument();
  });

  it('hides the column display picker and stores the name for a lookup column', async () => {
    const user = await openEditor();

    await user.click(screen.getByRole('combobox', { name: '展示' }));
    await user.click(screen.getByRole('button', { name: '明细表' }));
    await user.click(screen.getByRole('button', { name: '添加列' }));

    expect(
      screen.queryByRole('combobox', { name: '列显示' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByPlaceholderText('列字段'));
    await user.click(
      await screen.findByRole('button', { name: '供应商（FSupplierId）' }),
    );
    await user.click(screen.getByRole('button', { name: '保存数据集' }));

    expect(useAnalysisStore.getState().datasets[0]?.columns).toEqual([
      { field: 'FSupplierId', display: 'name' },
    ]);
  });

  it('pages a detail preview instead of asking for a row cap', async () => {
    vi.mocked(runQuery).mockReset();
    vi.mocked(runQuery).mockResolvedValue({
      rows: [],
      detail: [{ cells: ['甲供应商'] }],
      skipped: 0,
      truncated: false,
      fetched: 50,
      queryTruncated: true,
    });
    const user = await openEditor();

    await user.click(screen.getByRole('combobox', { name: '展示' }));
    await user.click(screen.getByRole('button', { name: '明细表' }));
    expect(screen.queryByText('显示行数上限')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加列' }));
    await user.click(screen.getByPlaceholderText('列字段'));
    await user.click(
      await screen.findByRole('button', { name: '供应商（FSupplierId）' }),
    );
    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(await screen.findByRole('cell', { name: '1' })).toBeInTheDocument();
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), { page: 0 });

    await user.click(screen.getByRole('button', { name: '下一页' }));

    expect(await screen.findByRole('cell', { name: '51' })).toBeInTheDocument();
    expect(runQuery).toHaveBeenLastCalledWith(expect.anything(), { page: 1 });
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled();
  });
});
