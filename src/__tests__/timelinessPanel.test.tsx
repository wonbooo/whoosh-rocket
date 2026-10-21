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
  it('rates a line by its received quantity and keeps closed lines', async () => {
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
        onCatalog={onCatalog}
      />,
    );

    const onTime = formatRate(14 / 16);
    expect(await screen.findByText(onTime)).toBeInTheDocument();
    expect(loadArrivalSources).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('按金蝶口径统计，关闭、冻结、终止的订单行也计入。'),
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
});
