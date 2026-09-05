import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import { vi } from 'vitest';
import { placePackagingOrders } from '@/features/packaging/order';
import { PackagingOrderDialog } from '@/features/packaging/PackagingOrderDialog';

vi.mock('@/features/packaging/order', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/packaging/order')>();
  return {
    ...actual,
    placePackagingOrders: vi.fn(),
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
  const file = new File([bytes], 'packaging.xlsx', {
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

describe('PackagingOrderDialog', () => {
  it('shows nested tables and outer checkbox selects all details', async () => {
    const user = userEvent.setup();
    render(<PackagingOrderDialog open onOpenChange={() => undefined} />);

    const file = workbookFile([
      ['基础信息', '', '', '明细信息', '', '', '', '', ''],
      [
        '供应商',
        '采购员',
        '货主',
        '物料编码',
        '收货仓库',
        '申请数量',
        '货主',
        '预计入库时间',
        '保管者',
      ],
      [
        'CP00220',
        '23050514',
        'CP00220',
        'BCDJS10063',
        'CK338',
        200,
        'CP00220',
        '2026/09/29',
        'mjs',
      ],
      ['', '', '', 'BCDJS10101', 'CK338', 300, 'CP00220', '2026/09/29', 'mjs'],
    ]);

    const input = screen.getByLabelText('上传 Excel 文件');
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByRole('columnheader', { name: '供应商' }),
    ).toBeInTheDocument();
    expect(screen.getByText('BCDJS10063')).toBeInTheDocument();
    expect(screen.getByText('BCDJS10101')).toBeInTheDocument();
    expect(screen.getAllByText('2026/09/29').length).toBe(2);

    const outer = screen.getByRole('checkbox', {
      name: '选择货主 CP00220 的全部明细',
    });
    const innerA = screen.getByRole('checkbox', { name: '选择 BCDJS10063' });
    const innerB = screen.getByRole('checkbox', { name: '选择 BCDJS10101' });

    await user.click(outer);
    expect(innerA).toBeChecked();
    expect(innerB).toBeChecked();

    await user.click(innerB);
    expect(innerB).not.toBeChecked();
    expect(innerA).toBeChecked();

    await user.click(outer);
    expect(innerA).toBeChecked();
    expect(innerB).toBeChecked();

    await user.click(
      screen.getByRole('button', { name: '收起货主 CP00220 的明细' }),
    );
    expect(screen.queryByText('BCDJS10063')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getAllByText('CP00220').length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: '提交' }),
    ).not.toBeInTheDocument();
  });

  it('keeps submit and audit after ordering, without a push button', async () => {
    const user = userEvent.setup();
    vi.mocked(placePackagingOrders).mockResolvedValue({
      succeeded: [{ supplier: 'CP00220', billNos: ['RK001'], billIds: ['11'] }],
      failed: [],
    });
    render(<PackagingOrderDialog open onOpenChange={() => undefined} />);

    const file = workbookFile([
      ['基础信息', '', '', '明细信息', '', '', '', '', ''],
      [
        '供应商',
        '采购员',
        '货主',
        '物料编码',
        '收货仓库',
        '申请数量',
        '货主',
        '预计入库时间',
        '保管者',
      ],
      [
        'CP00220',
        '23050514',
        'CP00220',
        'BCDJS10063',
        'CK338',
        200,
        'CP00220',
        '2026/09/29',
        'mjs',
      ],
    ]);
    fireEvent.change(screen.getByLabelText('上传 Excel 文件'), {
      target: { files: [file] },
    });
    await user.click(
      await screen.findByRole('checkbox', {
        name: '选择货主 CP00220 的全部明细',
      }),
    );
    await user.click(screen.getByRole('button', { name: '下单' }));

    expect(await screen.findByText('RK001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审核' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下推' }),
    ).not.toBeInTheDocument();
  });
});
