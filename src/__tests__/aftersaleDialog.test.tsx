import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import { vi } from 'vitest';
import { AftersaleOrderDialog } from '@/features/aftersale/AftersaleOrderDialog';
import { placeAftersaleOrders } from '@/features/aftersale/requisition';

vi.mock('@/features/aftersale/requisition', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/aftersale/requisition')>();
  return {
    ...actual,
    placeAftersaleOrders: vi.fn(),
  };
});

function workbookFile(rows: unknown[][]): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  const buffer = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  }) as Uint8Array;
  const bytes = new Uint8Array(buffer);
  const file = new File([bytes], 'aftersale.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () =>
      Promise.resolve(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
  });
  return file;
}

describe('AftersaleOrderDialog', () => {
  it('keeps submit and audit after ordering, without a push button', async () => {
    const user = userEvent.setup();
    vi.mocked(placeAftersaleOrders).mockResolvedValue({
      succeeded: [
        { supplier: 'CP00220', billNos: ['REQ001'], billIds: ['11'] },
      ],
      failed: [],
    });
    render(<AftersaleOrderDialog open onOpenChange={() => undefined} />);

    const file = workbookFile([
      ['物料编码', '申请数量', '到货日期', '建议供应商', '采购员', '仓库'],
      ['BCDJS10063', 1000, '2026/08/26', 'CP00220', '23050514', 'CK338'],
    ]);
    fireEvent.change(screen.getByLabelText('上传 Excel 文件'), {
      target: { files: [file] },
    });
    await user.click(
      await screen.findByRole('checkbox', { name: '选择供应商 CP00220' }),
    );
    await user.click(screen.getByRole('button', { name: '下单' }));

    expect(await screen.findByText('REQ001')).toBeInTheDocument();
    const billScroller = screen.getByText('REQ001').closest('div');
    expect(billScroller?.className).toContain('max-h-[240px]');
    expect(billScroller?.className).toContain('overflow-y-auto');
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审核' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下推' }),
    ).not.toBeInTheDocument();
  });
});
