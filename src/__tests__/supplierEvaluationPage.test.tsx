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
import { SupplierEvaluationPage } from '@/features/supplier/SupplierEvaluationPage';
import { useKingdeeStore } from '@/store/useKingdeeStore';

vi.mock('@/features/supplier/load', () => ({
  loadInspectLines: vi.fn(),
}));

vi.mock('@antv/g2', () => ({
  Chart: class {
    options() {}
    render() {
      return Promise.resolve();
    }
    destroy() {}
  },
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
  localStorage.removeItem('supplier-evaluation-layout');
  vi.mocked(loadInspectLines).mockReset();
  vi.unstubAllGlobals();
});

beforeEach(() => {
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
      screen.getByText('请先点击右上角「连接金蝶」完成登录。'),
    ).toBeInTheDocument();
    expect(loadInspectLines).not.toHaveBeenCalled();
  });

  it('shows the rate table, chart, and supplier detail', async () => {
    const user = userEvent.setup();
    const months = recentMonths(new Date());
    const current = months[months.length - 1] ?? '';
    const lines = sampleLines(months);
    vi.mocked(loadInspectLines).mockResolvedValue(lines);
    useKingdeeStore.getState().setSession('session-1', '测试');

    render(<SupplierEvaluationPage />);

    expect(
      await screen.findByRole('heading', { name: '近6个月供应商到货合格率' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '分组柱状图' }),
    ).toBeInTheDocument();
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
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByTestId('supplier-rate-chart')).toBeInTheDocument();

    const overallText = `当月综合到货合格率 ${formatRate(monthOverallRate(lines, current))}`;
    expect(screen.getByText(overallText)).toBeInTheDocument();
    expect(screen.queryByText('请选择供应商')).not.toBeInTheDocument();
    expect(screen.getByText('螺丝')).toBeInTheDocument();
    expect(screen.getByText('垫片')).toBeInTheDocument();

    const supplierFilter = screen.getByPlaceholderText('搜索供应商');
    await user.click(supplierFilter);
    await user.keyboard('甲');
    expect(
      screen.queryByRole('button', { name: '乙供' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '甲供' }));

    const supplierOverall = `当月综合到货合格率 ${formatRate(monthOverallRate(lines, current, '甲供'))}`;
    expect(screen.getByText(supplierOverall)).toBeInTheDocument();
    expect(screen.queryByText(overallText)).not.toBeInTheDocument();
    const detail = productDetails(lines, '甲供', current);
    expect(detail.length).toBeGreaterThan(0);
    for (const row of detail) {
      expect(screen.getByText(row.materialName)).toBeInTheDocument();
      expect(screen.getByText(row.reasonSummary)).toBeInTheDocument();
    }
    expect(screen.queryByText('垫片')).not.toBeInTheDocument();
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
