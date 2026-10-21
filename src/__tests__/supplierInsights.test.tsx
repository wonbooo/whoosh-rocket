import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { loadInspectLines } from '@/features/supplier/load';
import { loadArrivalSources } from '@/features/supplier/loadTimeliness';
import { SupplierEvaluationPage } from '@/features/supplier/SupplierEvaluationPage';
import type { PurchaseLine } from '@/features/supplier/timeliness';
import { useKingdeeStore } from '@/store/useKingdeeStore';

vi.mock('@antv/g2', () => ({
  Chart: class {
    options() {}
    render() {
      return Promise.resolve();
    }
    destroy() {}
  },
}));

vi.mock('@/features/supplier/load', () => ({
  loadInspectLines: vi.fn(),
}));

vi.mock('@/features/supplier/loadTimeliness', () => ({
  loadArrivalSources: vi.fn(),
}));

function line(overrides: Partial<PurchaseLine> = {}): PurchaseLine {
  return {
    supplier: '甲供',
    billNo: 'PO-1',
    entryId: 'E1',
    materialNumber: 'M-1',
    materialName: '螺丝',
    orderQty: 10,
    deliveryDate: '2026-10-01',
    excluded: false,
    amount: 200_000,
    orderDate: '2026-09-28',
    receivedQty: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(loadInspectLines).mockResolvedValue([
    {
      supplier: '甲供',
      materialNumber: 'M-1',
      materialName: '螺丝',
      month: '2026-10',
      qualifiedQty: 8,
      arrivalQty: 10,
      remark: '',
    },
    {
      supplier: '乙供',
      materialNumber: 'M-2',
      materialName: '垫片',
      month: '2026-10',
      qualifiedQty: 10,
      arrivalQty: 10,
      remark: '',
    },
  ]);
  vi.mocked(loadArrivalSources).mockResolvedValue({
    lines: [
      line(),
      line({
        supplier: '乙供',
        billNo: 'PO-2',
        entryId: 'E2',
        materialName: '垫片',
        amount: 50_000,
        orderDate: '2026-09-20',
      }),
    ],
    receive: [
      {
        entryId: 'E1',
        billNo: 'PO-1',
        materialNumber: 'M-1',
        date: '2026-10-01',
        qty: 10,
      },
      {
        entryId: 'E2',
        billNo: 'PO-2',
        materialNumber: 'M-2',
        date: '2026-10-08',
        qty: 10,
      },
    ],
    instock: [],
  });
  useKingdeeStore.setState({
    serverUrl: '',
    acctName: '',
    username: '',
    password: '',
    sessionId: 'session-1',
    userName: '测试',
    orgId: null,
  });
});

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
  localStorage.removeItem('supplier-quadrant-layout');
  vi.unstubAllGlobals();
});

describe('supplier insight modules', () => {
  it('switches the quadrant axis, edits score weights, and opens the excel library', async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<SupplierEvaluationPage />);
    expect(screen.getByPlaceholderText('搜索供应商')).toHaveValue('XLS');
    expect(screen.getByLabelText('宽限天数')).toHaveValue(2);
    await user.clear(screen.getByPlaceholderText('搜索供应商'));
    await user.tab();

    expect(
      await screen.findByRole('heading', { name: '供应商四象限矩阵' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/右上（规模大且及时）有甲供/),
    ).toBeInTheDocument();
    const matrix = screen
      .getByRole('heading', { name: '四象限矩阵' })
      .closest('section') as HTMLElement;
    expect(matrix.querySelector('.widget-drag')).not.toBeNull();
    expect(
      matrix.parentElement?.querySelector('.react-resizable-handle'),
    ).not.toBeNull();
    const chart = within(matrix).getByRole('img', { name: /及时率/ });
    expect(chart.className).toContain('flex-1');
    await user.click(within(matrix).getByRole('button', { name: '放大' }));
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '缩小' }));

    await user.click(screen.getByRole('button', { name: '合格率' }));
    expect(await screen.findByText(/规模大且合格/)).toBeInTheDocument();

    const scorecard = screen
      .getByRole('heading', { name: '供应商综合评分卡' })
      .closest('section') as HTMLElement;
    expect(within(scorecard).getByText('甲供')).toBeInTheDocument();
    expect(within(scorecard).getByText('94.0')).toBeInTheDocument();
    expect(within(scorecard).getAllByText('—').length).toBeGreaterThan(0);
    const timelinessWeight = within(scorecard).getByRole('spinbutton', {
      name: '及时率权重',
    });
    await user.clear(timelinessWeight);
    await user.type(timelinessWeight, '100');
    for (const label of ['合格率权重', '规模权重', '敏捷权重']) {
      const input = within(scorecard).getByRole('spinbutton', { name: label });
      await user.clear(input);
      await user.type(input, '0');
    }
    expect(within(scorecard).getByText(/合计 100%/)).toBeInTheDocument();

    const risk = screen
      .getByRole('heading', { name: '供应商风险预警' })
      .closest('section') as HTMLElement;
    expect(within(risk).getByText('规则计算')).toBeInTheDocument();
    expect(within(risk).getByText(/甲供来料合格率/)).toBeInTheDocument();
    expect(within(risk).getByText(/当前不是桌面端/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上传 Excel' }));
    const dialog = screen.getByRole('dialog', { name: '已上传的售后 Excel' });
    expect(
      within(dialog).getByText('还没有上传过 Excel。'),
    ).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: '选择文件上传' }),
    );
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
