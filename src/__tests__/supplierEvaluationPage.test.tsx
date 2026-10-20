import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import {
  formatRate,
  monthOverallRate,
  productDetails,
  recentMonths,
  supplierMonthRates,
  type InspectLine,
} from '@/features/supplier/aggregate';
import { loadInspectLines } from '@/features/supplier/load';
import { loadArrivalSources } from '@/features/supplier/loadTimeliness';
import { SupplierEvaluationPage } from '@/features/supplier/SupplierEvaluationPage';
import { useKingdeeStore } from '@/store/useKingdeeStore';

vi.mock('@/features/supplier/load', () => ({
  loadInspectLines: vi.fn(),
}));

vi.mock('@/features/supplier/loadTimeliness', () => ({
  loadArrivalSources: vi.fn(),
}));

function sampleLines(months: string[]): InspectLine[] {
  const current = months[months.length - 1] ?? '';
  const oldest = months[0] ?? '';
  return [
    {
      supplier: '甲供',
      materialNumber: 'M-1',
      materialName: '螺丝',
      month: current,
      qualifiedQty: 40,
      arrivalQty: 50,
      remark: '重量不足',
    },
    {
      supplier: '甲供',
      materialNumber: 'M-1',
      materialName: '螺丝',
      month: current,
      qualifiedQty: 40,
      arrivalQty: 50,
      remark: '重量不足；包装破损',
    },
    {
      supplier: '乙供',
      materialNumber: 'M-3',
      materialName: '垫片',
      month: current,
      qualifiedQty: 1,
      arrivalQty: 4,
      remark: '',
    },
    {
      supplier: '甲供',
      materialNumber: 'M-1',
      materialName: '螺丝',
      month: oldest,
      qualifiedQty: 3,
      arrivalQty: 0,
      remark: '',
    },
  ];
}

afterEach(() => {
  useKingdeeStore.setState({
    serverUrl: '',
    acctName: '',
    username: '',
    password: '',
    sessionId: null,
    userName: null,
    orgId: null,
  });
  localStorage.removeItem('kingdee');
  localStorage.removeItem('supplier-evaluation-layout-v2');
  localStorage.removeItem('supplier-timeliness-layout');
  vi.mocked(loadInspectLines).mockReset();
  vi.mocked(loadArrivalSources).mockReset();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.mocked(loadArrivalSources).mockResolvedValue({
    lines: [],
    receive: [],
    instock: [],
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('SupplierEvaluationPage', () => {
  it('asks to connect Kingdee when there is no session', () => {
    render(<SupplierEvaluationPage />);
    expect(
      screen.getByRole('heading', { name: '到货检验分析' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '售后质量指标' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '到货及时率' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('请先点击右上角「连接金蝶」完成登录。'),
    ).toBeInTheDocument();
    expect(loadInspectLines).not.toHaveBeenCalled();
    expect(loadArrivalSources).not.toHaveBeenCalled();
  });

  it('shows the rate table and supplier detail', async () => {
    const user = userEvent.setup();
    const months = recentMonths(new Date());
    const current = months[months.length - 1] ?? '';
    const lines = sampleLines(months);
    vi.mocked(loadInspectLines).mockResolvedValue(lines);
    useKingdeeStore.getState().setSession('session-1', '测试');

    render(<SupplierEvaluationPage />);

    expect(
      await screen.findByText('近 6 个月没有已审核的采购订单。'),
    ).toBeInTheDocument();
    const title = await screen.findByRole('heading', { name: '到货检验分析' });
    const monthFrom = screen.getByRole('combobox', { name: '开始年月' });
    const monthTo = screen.getByRole('combobox', { name: '结束年月' });
    expect(
      monthFrom.compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(monthFrom).toHaveTextContent(current);
    expect(monthTo).toHaveTextContent(current);
    expect(
      screen.getByRole('combobox', { name: '供应商比较' }),
    ).toHaveTextContent('包含');
    expect(screen.getByPlaceholderText('搜索供应商')).toHaveValue('XLS');
    expect(screen.getByLabelText('宽限天数')).toHaveValue(2);
    await user.clear(screen.getByPlaceholderText('搜索供应商'));
    await user.tab();
    expect(screen.getByText('过滤条件')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '添加条件' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '移除' }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen
          .getByRole('heading', { name: '到货质检明细' })
          .closest('section') as HTMLElement,
      ).queryByPlaceholderText('搜索供应商'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('售后月份')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '近6个月供应商到货合格率' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '近6个月到货合格率' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '到货质检明细' }),
    ).toBeInTheDocument();
    for (const title of ['近6个月供应商到货合格率', '到货质检明细']) {
      const section = screen
        .getByRole('heading', { name: title })
        .closest('section');
      const header = section?.querySelector('th');
      expect(header?.className).toContain('sticky');
      expect(header?.className).toContain('top-0');
      expect(header?.parentElement?.closest('div')?.className).toContain(
        'overflow-auto',
      );
    }

    const rateCell = formatRate(
      supplierMonthRates(lines, months)[0]?.months.find(
        (item) => item.month === current,
      )?.rate ?? null,
    );
    expect(screen.getAllByText(rateCell).length).toBeGreaterThan(0);
    const summary = screen
      .getByRole('heading', { name: '近6个月供应商到货合格率' })
      .closest('section') as HTMLElement;
    expect(within(summary).getByText(months[0] ?? '')).toBeInTheDocument();

    const currentLines = lines.filter((line) => line.month === current);
    const overallText = formatRate(monthOverallRate(currentLines, ''));
    expect(screen.getByTestId('overall-rate')).toHaveTextContent(overallText);
    expect(screen.getByTestId('overall-rate')).toHaveClass('text-red-600');
    expect(screen.queryByText('请选择供应商')).not.toBeInTheDocument();
    expect(screen.getAllByText('螺丝').length).toBeGreaterThan(0);
    expect(screen.getByText('垫片')).toBeInTheDocument();

    const supplierFilter = screen.getByPlaceholderText('搜索供应商');
    expect(supplierFilter).toHaveValue('');
    await user.click(supplierFilter);
    expect(
      screen.queryByRole('button', { name: '全部' }),
    ).not.toBeInTheDocument();
    await user.keyboard('甲');
    expect(
      screen.queryByRole('button', { name: '乙供' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '甲供' }));

    const supplierOverall = formatRate(
      monthOverallRate(currentLines, '', '甲供'),
    );
    expect(screen.getByTestId('overall-rate')).toHaveTextContent(
      supplierOverall,
    );
    expect(screen.getByTestId('overall-rate')).not.toHaveTextContent(
      overallText,
    );
    const detail = productDetails(lines, '甲供', current);
    expect(detail.length).toBeGreaterThan(0);
    for (const row of detail) {
      expect(screen.getAllByText(row.materialName).length).toBeGreaterThan(0);
      expect(screen.getByText(row.reasonSummary)).toBeInTheDocument();
    }
    expect(screen.queryByText('垫片')).not.toBeInTheDocument();
    expect(within(summary).getByText(months[0] ?? '')).toBeInTheDocument();

    const oldest = months[0] ?? '';
    await user.click(monthTo);
    await user.click(screen.getByRole('button', { name: current }));
    await user.click(monthFrom);
    if (oldest.slice(0, 4) !== current.slice(0, 4)) {
      await user.click(screen.getByRole('button', { name: '上一年' }));
    }
    await user.click(screen.getByRole('button', { name: oldest }));
    expect(
      within(
        screen
          .getByRole('heading', { name: '到货质检明细' })
          .closest('section') as HTMLElement,
      ).getByRole('columnheader', { name: '月份' }),
    ).toBeInTheDocument();
    expect(within(summary).getByText(current)).toBeInTheDocument();

    await user.click(monthTo);
    if (oldest.slice(0, 4) !== current.slice(0, 4)) {
      await user.click(screen.getByRole('button', { name: '上一年' }));
    }
    expect(screen.getByRole('button', { name: oldest })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(monthFrom);
    if (oldest.slice(0, 4) !== current.slice(0, 4)) {
      await user.click(screen.getByRole('button', { name: '下一年' }));
    }
    expect(screen.getByRole('button', { name: current })).toBeDisabled();
  });

  it('pages the summary and detail tables', async () => {
    const user = userEvent.setup();
    const months = recentMonths(new Date());
    const current = months[months.length - 1] ?? '';
    const lines = Array.from({ length: 21 }, (_, index) => ({
      supplier: `供${String(index + 1).padStart(2, '0')}`,
      materialNumber: `M-${index + 1}`,
      materialName: `商品${String(index + 1).padStart(2, '0')}`,
      month: current,
      qualifiedQty: 1,
      arrivalQty: 1,
      remark: '',
    }));
    vi.mocked(loadInspectLines).mockResolvedValue(lines);
    useKingdeeStore.getState().setSession('session-1', '测试');

    render(<SupplierEvaluationPage />);
    await user.clear(screen.getByPlaceholderText('搜索供应商'));
    await user.tab();

    expect(
      await screen.findByText('近 6 个月没有已审核的采购订单。'),
    ).toBeInTheDocument();
    const summary = (
      await screen.findByRole('heading', { name: '近6个月供应商到货合格率' })
    ).closest('section');
    const detail = screen
      .getByRole('heading', { name: '到货质检明细' })
      .closest('section');
    if (!summary || !detail) {
      throw new Error('未找到表格所在卡片');
    }

    expect(within(summary).getByText('供01')).toBeInTheDocument();
    expect(within(summary).queryByText('供21')).not.toBeInTheDocument();
    expect(within(detail).getByText('商品01')).toBeInTheDocument();
    expect(within(detail).queryByText('商品21')).not.toBeInTheDocument();
    expect(within(summary).getByText('共 21 条')).toBeInTheDocument();
    expect(screen.getByTestId('overall-rate')).toHaveClass('text-green-600');
    expect(within(detail).getByText('共 21 条')).toBeInTheDocument();

    await user.click(within(summary).getByRole('button', { name: '下一页' }));
    expect(within(summary).getByText('供21')).toBeInTheDocument();
    expect(within(summary).queryByText('供01')).not.toBeInTheDocument();
    expect(within(detail).getByText('商品01')).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: '下一页' }));
    expect(within(detail).getByText('商品21')).toBeInTheDocument();
    expect(within(detail).queryByText('商品01')).not.toBeInTheDocument();
  });
});
