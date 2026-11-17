import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { formatRate } from '@/features/supplier/aggregate';
import { TimelinessPanel } from '@/features/supplier/TimelinessPanel';
import { loadArrivalSources } from '@/features/supplier/loadTimeliness';
import type { PurchaseLine } from '@/features/supplier/timeliness';

vi.mock('@/features/supplier/loadTimeliness', () => ({
  loadArrivalSources: vi.fn(),
}));

const months = ['2026-09', '2026-10'];

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
    closed: false,
    ...overrides,
  };
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.mocked(loadArrivalSources).mockReset();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  localStorage.removeItem('supplier-timeliness-layout');
  vi.unstubAllGlobals();
});

describe('TimelinessPanel', () => {
  it('rates lines by arrival dates and keeps closed lines', async () => {
    const user = userEvent.setup();
    const onCatalog = vi.fn();
    vi.mocked(loadArrivalSources).mockResolvedValue({
      lines: [
        line({ receivedQty: 10 }),
        line({
          supplier: '乙供',
          billNo: 'PO-2',
          entryId: 'E2',
          materialNumber: 'M-2',
          materialName: '未到件',
          orderQty: 2,
          deliveryDate: '2026-10-17',
        }),
        line({
          supplier: '丙供',
          billNo: 'PO-3',
          entryId: 'E3',
          materialNumber: 'M-3',
          materialName: '关闭件',
          orderQty: 4,
          deliveryDate: '2026-10-02',
          excluded: true,
          receivedQty: 4,
        }),
      ],
      receive: [],
      instock: [
        {
          entryId: 'E1',
          billNo: 'PO-1',
          materialNumber: 'M-1',
          date: '2026-10-01',
          qty: 10,
        },
        {
          entryId: 'E3',
          billNo: 'PO-3',
          materialNumber: 'M-3',
          date: '2026-10-02',
          qty: 4,
        },
      ],
    });

    render(
      <TimelinessPanel
        sessionId="session-1"
        supplier=""
        monthFrom="2026-10"
        monthTo="2026-10"
        months={months}
        today={new Date(2026, 9, 18)}
        onCatalog={onCatalog}
      />,
    );

    const onTime = formatRate(14 / 16);
    expect(await screen.findByText(onTime)).toBeInTheDocument();
    expect(loadArrivalSources).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        '按交货日期归月、按采购入库单的日期和数量计算：及时率 = 准时已交货数量 / 订单数量；到货日期在要求交货日（含宽限天数）及之前算准时已交货，之后算逾期已交货；剩余未到数量在宽限截止日之后算逾期未交货。「逾期未到」不显示关闭状态为「已关闭」的订单行。',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('未到件').length).toBeGreaterThan(0);
    expect(screen.getAllByText('关闭件').length).toBeGreaterThan(0);
    expect(onCatalog.mock.calls.at(-1)?.[0]).toEqual(
      ['甲供', '乙供', '丙供'].sort((left, right) =>
        left.localeCompare(right, 'zh'),
      ),
    );
    expect(
      screen.getByRole('img', {
        name: /逾期与未交货：乙供 逾期已交货 0、逾期未交货 0、准时未交货 2/,
      }),
    ).toBeInTheDocument();

    const detail = screen
      .getByRole('heading', { name: '订单到货明细' })
      .closest('section') as HTMLElement;
    expect(
      within(detail).queryByRole('columnheader', { name: '准时未交货' }),
    ).not.toBeInTheDocument();
    expect(
      within(detail).getByRole('columnheader', { name: '逾期未交货' }),
    ).toBeInTheDocument();

    const grace = screen.getByLabelText('宽限天数');
    expect(grace).toHaveValue(2);
    await user.clear(grace);
    await user.type(grace, '0');
    expect(screen.getByTestId('overall-timeliness-rate')).toHaveTextContent(
      onTime,
    );
    expect(
      screen.getByRole('img', {
        name: /逾期与未交货：乙供 逾期已交货 0、逾期未交货 2、准时未交货 0/,
      }),
    ).toBeInTheDocument();
  });

  it('hides closed order lines from the overdue widget', async () => {
    vi.mocked(loadArrivalSources).mockResolvedValue({
      lines: [
        line({
          billNo: 'PO-OPEN',
          materialName: '未到件',
          orderQty: 2,
          deliveryDate: '2026-10-10',
        }),
        line({
          billNo: 'PO-CLOSED',
          entryId: 'E2',
          materialNumber: 'M-2',
          materialName: '已关闭未到件',
          orderQty: 5,
          deliveryDate: '2026-10-09',
          closed: true,
        }),
      ],
      receive: [],
      instock: [],
    });

    render(
      <TimelinessPanel
        sessionId="session-1"
        supplier=""
        monthFrom="2026-10"
        monthTo="2026-10"
        months={months}
        today={new Date(2026, 9, 18)}
      />,
    );

    const heading = await screen.findByRole('heading', { name: '逾期未到' });
    const widget = heading.closest('section');
    expect(widget).not.toBeNull();
    expect(
      within(widget as HTMLElement).getByText('未到件'),
    ).toBeInTheDocument();
    expect(
      within(widget as HTMLElement).queryByText('已关闭未到件'),
    ).not.toBeInTheDocument();
  });

  it('filters the widgets with an added condition', async () => {
    const user = userEvent.setup();
    vi.mocked(loadArrivalSources).mockResolvedValue({
      lines: [
        line({ receivedQty: 10 }),
        line({
          supplier: '乙供',
          billNo: 'PO-2',
          entryId: 'E2',
          materialNumber: 'M-2',
          materialName: '未到件',
          orderQty: 2,
          deliveryDate: '2026-10-17',
        }),
      ],
      receive: [],
      instock: [
        {
          entryId: 'E1',
          billNo: 'PO-1',
          materialNumber: 'M-1',
          date: '2026-10-01',
          qty: 10,
        },
      ],
    });

    render(
      <TimelinessPanel
        sessionId="session-1"
        supplier=""
        monthFrom="2026-10"
        monthTo="2026-10"
        months={months}
        today={new Date(2026, 9, 18)}
      />,
    );

    expect(
      await screen.findByTestId('overall-timeliness-rate'),
    ).toHaveTextContent(formatRate(10 / 12));
    expect(screen.getAllByText('未到件').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '添加条件' }));
    await user.click(screen.getByRole('combobox', { name: '字段' }));
    await user.click(screen.getByRole('button', { name: '供应商' }));
    await user.click(screen.getByRole('combobox', { name: '比较符' }));
    await user.click(screen.getByRole('button', { name: '包含' }));
    await user.type(screen.getByPlaceholderText('值'), '甲');

    expect(screen.queryByText('未到件')).not.toBeInTheDocument();
    expect(screen.getByTestId('overall-timeliness-rate')).toHaveTextContent(
      formatRate(1),
    );

    await user.click(screen.getByRole('button', { name: '移除' }));
    expect(
      await screen.findByTestId('overall-timeliness-rate'),
    ).toHaveTextContent(formatRate(10 / 12));
    expect(screen.getAllByText('未到件').length).toBeGreaterThan(0);
  });

  it('switches the actual arrival source between instock and receive', async () => {
    const user = userEvent.setup();
    vi.mocked(loadArrivalSources).mockResolvedValue({
      lines: [line()],
      receive: [
        {
          entryId: 'E1',
          billNo: 'PO-1',
          materialNumber: 'M-1',
          date: '2026-10-05',
          qty: 10,
        },
      ],
      instock: [
        {
          entryId: 'E1',
          billNo: 'PO-1',
          materialNumber: 'M-1',
          date: '2026-10-01',
          qty: 10,
        },
      ],
    });

    render(
      <TimelinessPanel
        sessionId="session-1"
        supplier=""
        monthFrom="2026-10"
        monthTo="2026-10"
        months={months}
        today={new Date(2026, 9, 18)}
      />,
    );

    expect(
      await screen.findByTestId('overall-timeliness-rate'),
    ).toHaveTextContent(formatRate(1));

    await user.selectOptions(screen.getByLabelText('实际到货日期'), 'receive');
    expect(screen.getByTestId('overall-timeliness-rate')).toHaveTextContent(
      formatRate(0),
    );
    expect(
      screen.getByRole('img', {
        name: /逾期与未交货：甲供 逾期已交货 10、逾期未交货 0、准时未交货 0/,
      }),
    ).toBeInTheDocument();
  });
});
