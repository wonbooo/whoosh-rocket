import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { vi } from 'vitest';
import { seriesGradient } from '@/features/supplier/AftersaleCharts';
import { AftersaleQualityPanel } from '@/features/supplier/AftersaleQualityPanel';
import {
  complaintBars,
  factoryPaySlices,
  loadAftersaleMonths,
  parseAftersaleQualityWorkbook,
  saveAftersaleMonth,
  supplierSummaries,
  type ComplaintEvent,
} from '@/features/supplier/aftersaleQuality';
import type { PersistedRecord } from '@/lib/persistedRecord';

vi.mock('@antv/g2', () => ({
  Chart: class {
    options() {}
    render() {
      return Promise.resolve();
    }
    destroy() {}
  },
}));

const HEADERS = [
  '反馈人',
  '经销商',
  '厂家',
  '产品名称',
  '数量（个）',
  '产品问题大类',
  '处理方案',
  '我司赔付金额',
  '厂家赔付金额',
  '登记日期',
  '历史字段备注',
];

function line(input: {
  supplier: string;
  product?: string;
  qty?: string | number;
  category: string;
  solution: string;
  company?: string | number;
  factory?: string | number;
  date: string | number;
  dealer?: string;
}): unknown[] {
  return [
    '张三',
    input.dealer ?? '某经销商',
    input.supplier,
    input.product ?? '',
    input.qty ?? '',
    input.category,
    input.solution,
    input.company ?? '',
    input.factory ?? '',
    input.date,
    '历史',
  ];
}

function hesheng(input: {
  supplier?: string;
  product?: string;
  qty: string | number;
  category: string;
  company: number;
  date: string;
}): unknown[] {
  return line({
    supplier: input.supplier ?? '禾胜禾（福建）食品有限公司',
    product: input.product,
    qty: input.qty,
    category: input.category,
    solution: '退货退款',
    company: input.company,
    factory: input.company,
    date: input.date,
  });
}

function acceptanceRows(): unknown[][] {
  const linyi = (
    category: string,
    qty: string | number,
    amount?: number,
  ): unknown[] =>
    line({
      supplier: '临沂宏旭食品有限公司',
      qty,
      category,
      solution: '补发',
      company: amount,
      factory: amount,
      date: '2026-09-10',
    });
  const village = (
    category: string,
    qty: number,
    solution: string,
    amount?: number,
  ): unknown[] =>
    line({
      supplier: '龙岩市乡村爱情食品有限公司',
      qty,
      category,
      solution,
      company: amount,
      factory: amount,
      date: '2026-09-11',
    });
  return [
    hesheng({
      product: '商品甲\n商品乙\n商品丙',
      qty: 1117,
      category: '设备包装',
      company: 2000,
      date: '2026-09-02',
    }),
    hesheng({
      supplier: '禾胜禾（福建）\n食品有限公司',
      qty: 1000,
      category: '设备包装',
      company: 2000,
      date: '2026-09-03',
    }),
    hesheng({
      qty: 1000,
      category: '设备包装',
      company: 2000,
      date: '2026-09-04',
    }),
    hesheng({
      qty: 730,
      category: '设备包装',
      company: 2000,
      date: '2026-09-05',
    }),
    hesheng({
      qty: '10\n20',
      category: '设备包装',
      company: 1524.22,
      date: '2026-09-06',
    }),
    hesheng({
      qty: 970,
      category: '异物问题',
      company: 1000,
      date: '2026-09-18',
    }),
    linyi('设备包装', 20, 3207.41),
    linyi('设备包装', 20),
    linyi('设备包装', '-'),
    linyi('感官质量', 20),
    linyi('感官质量', 20),
    linyi('异物问题', 20),
    linyi('日期标识', 22),
    linyi('物流运输问题', 22),
    linyi('产品变质', 20),
    village('设备包装', 50, '退货退款', 1161.11),
    village('设备包装', 50, '补发'),
    village('产品变质', 50, '换货'),
    village('产品变质', 50, '待跟进'),
    village('日期标识', 11, '待跟进'),
    line({
      supplier: '漳州市云吉食品有限公司',
      qty: 100,
      category: '设备包装',
      solution: '退款',
      company: 568.56,
      factory: 568.56,
      date: '2026-09-12',
    }),
    line({
      supplier: '漳州市云吉食品有限公司',
      qty: 50,
      category: '设备包装',
      solution: '退款',
      date: '2026-09-12',
    }),
    line({
      supplier: '漳州市云吉食品有限公司',
      qty: 44,
      category: '异物问题',
      solution: '退款',
      date: '2026-09-13',
    }),
    line({
      supplier: '焕烨（福建）生物科技有限公司',
      qty: 8,
      category: '设备包装',
      solution: '退款',
      company: 31.68,
      factory: 31.68,
      date: '2026-09-14',
    }),
    line({
      supplier: '山东美致食品有限公司',
      qty: 2,
      category: '设备包装',
      solution: '待跟进',
      date: '2026-09-15',
    }),
  ];
}

function workbookBytes(rows: unknown[][], extraSheet = true): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['售后问题登记表'],
    HEADERS,
    ...rows,
    Array.from({ length: HEADERS.length }, () => ''),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '登记表');
  if (extraSheet) {
    const ignored = XLSX.utils.aoa_to_sheet([
      ['标题'],
      HEADERS,
      line({
        supplier: '不应读到的厂家',
        qty: 1,
        category: '设备包装',
        solution: '待跟进',
        company: 9,
        factory: 9,
        date: '2026-10-01',
      }),
    ]);
    XLSX.utils.book_append_sheet(book, ignored, '其他');
  }
  return new Uint8Array(
    XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as Uint8Array,
  );
}

function fileFrom(bytes: Uint8Array, name: string): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(buffer),
  });
  return file;
}

function memoryRecord(): PersistedRecord {
  const bucket = new Map<string, string>();
  return {
    get: (key) => bucket.get(key) ?? null,
    set: (key, value) => {
      bucket.set(key, value);
    },
    remove: (key) => {
      bucket.delete(key);
    },
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
});

afterEach(() => {
  localStorage.removeItem('supplier-aftersale-layout');
  vi.unstubAllGlobals();
});

describe('aftersale chart colors', () => {
  it('gives each series its own gradient', () => {
    const fills = Array.from({ length: 6 }, (_, index) =>
      seriesGradient(index, 'pie'),
    );
    expect(new Set(fills).size).toBe(fills.length);
    for (const fill of fills) {
      expect(fill).toMatch(/^l\(90\) 0:#[0-9A-F]{6} 1:#[0-9A-F]{6}$/);
    }
    expect(seriesGradient(0, 'bar')).toMatch(/^l\(0\) /);
    expect(seriesGradient(0, 'pie')).not.toBe(seriesGradient(0, 'bar'));
  });
});

describe('aftersale quality workbook', () => {
  it('summarizes the acceptance sheet without mixing in the inspection rate', () => {
    const parsed = parseAftersaleQualityWorkbook(
      workbookBytes(acceptanceRows()),
    );
    expect(parsed.month).toBe('2026-09');
    expect(parsed.events).toHaveLength(25);
    expect(parsed.events.map((event) => event.supplier)).not.toContain(
      '某经销商',
    );
    expect(parsed.events.map((event) => event.supplier)).not.toContain(
      '不应读到的厂家',
    );

    const rows = supplierSummaries(parsed.events);
    expect(rows.map((row) => row.supplier)).toEqual([
      '禾胜禾（福建）食品有限公司',
      '临沂宏旭食品有限公司',
      '龙岩市乡村爱情食品有限公司',
      '漳州市云吉食品有限公司',
      '焕烨（福建）生物科技有限公司',
      '山东美致食品有限公司',
    ]);
    expect(rows.map((row) => row.eventCount)).toEqual([6, 9, 5, 3, 1, 1]);
    expect(rows.map((row) => row.quantity)).toEqual([
      4847, 164, 211, 194, 8, 2,
    ]);
    expect(rows[0]?.categories).toBe('设备包装 5个、异物问题 1个');
    expect(rows[1]?.categories).toBe(
      '设备包装 3个、感官质量 2个、产品变质 1个、日期标识 1个、物流运输问题 1个、异物问题 1个',
    );
    expect(rows[2]?.categories).toBe(
      '产品变质 2个、设备包装 2个、日期标识 1个',
    );
    expect(rows[3]?.categories).toBe('设备包装 2个、异物问题 1个');
    expect(rows.map((row) => row.closure)).toEqual([
      '已结案 6个，待跟进 0个',
      '已结案 9个，待跟进 0个',
      '已结案 3个，待跟进 2个',
      '已结案 3个，待跟进 0个',
      '已结案 1个，待跟进 0个',
      '已结案 0个，待跟进 1个',
    ]);
    expect(rows.map((row) => row.companyPayText)).toEqual([
      '10524.22',
      '3207.41',
      '1161.11',
      '568.56',
      '31.68',
      '—',
    ]);
    expect(rows.map((row) => row.factoryPayText)).toEqual([
      '10524.22',
      '3207.41',
      '1161.11',
      '568.56',
      '31.68',
      '—',
    ]);
    expect(rows.map((row) => row.payRateText)).toEqual([
      '100.00%',
      '100.00%',
      '100.00%',
      '100.00%',
      '100.00%',
      '—',
    ]);

    const slices = factoryPaySlices(rows);
    expect(slices.map((item) => item.name)).toEqual([
      '禾胜禾（福建）食品有限公司',
      '临沂宏旭食品有限公司',
      '龙岩市乡村爱情食品有限公司',
      '漳州市云吉食品有限公司',
      '焕烨（福建）生物科技有限公司',
    ]);
    expect(
      slices.reduce((sum, item) => sum + Math.round(item.value * 100), 0) / 100,
    ).toBe(15492.98);
    expect(
      complaintBars(rows).map((item) => `${item.name}:${item.value}`),
    ).toEqual([
      '临沂宏旭食品有限公司:9',
      '禾胜禾（福建）食品有限公司:6',
      '龙岩市乡村爱情食品有限公司:5',
      '漳州市云吉食品有限公司:3',
      '焕烨（福建）生物科技有限公司:1',
      '山东美致食品有限公司:1',
    ]);
  });

  it('keeps XLS as part of the supplier name in the table and charts', () => {
    const parsed = parseAftersaleQualityWorkbook(
      workbookBytes(
        [
          line({
            supplier: '禾胜禾（福建）食品有限公司XLS',
            qty: 10,
            category: '设备包装',
            solution: '退款',
            company: 100,
            factory: 80,
            date: '2026-09-02',
          }),
          line({
            supplier: '禾胜禾（福建）食品有限公司',
            qty: 5,
            category: '异物问题',
            solution: '退款',
            company: 40,
            factory: 40,
            date: '2026-09-03',
          }),
        ],
        false,
      ),
    );
    const rows = supplierSummaries(parsed.events);
    expect(rows.map((row) => row.supplier)).toEqual([
      '禾胜禾（福建）食品有限公司XLS',
      '禾胜禾（福建）食品有限公司',
    ]);
    expect(factoryPaySlices(rows).map((item) => item.name)).toEqual([
      '禾胜禾（福建）食品有限公司XLS',
      '禾胜禾（福建）食品有限公司',
    ]);
    expect(complaintBars(rows).map((item) => item.name)).toEqual([
      '禾胜禾（福建）食品有限公司XLS',
      '禾胜禾（福建）食品有限公司',
    ]);
  });

  it('parses comma amounts and excel serial dates', () => {
    const serial = (Date.UTC(2026, 8, 8) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const bytes = workbookBytes(
      [
        line({
          supplier: '甲公司',
          qty: '1,117',
          category: '设备包装',
          solution: '退款',
          company: '1,234.50',
          factory: '617.25',
          date: serial,
        }),
      ],
      false,
    );
    const parsed = parseAftersaleQualityWorkbook(bytes);
    expect(parsed.month).toBe('2026-09');
    const row = supplierSummaries(parsed.events)[0];
    expect(row?.quantity).toBe(1117);
    expect(row?.companyPayText).toBe('1234.50');
    expect(row?.factoryPayText).toBe('617.25');
    expect(row?.payRateText).toBe('50.00%');
  });

  it('rejects a workbook that mixes months or drops a required column', () => {
    expect(() =>
      parseAftersaleQualityWorkbook(
        workbookBytes([
          line({
            supplier: '甲公司',
            qty: 1,
            category: '设备包装',
            solution: '退款',
            date: '2026-09-01',
          }),
          line({
            supplier: '甲公司',
            qty: 1,
            category: '设备包装',
            solution: '退款',
            date: '2026-10-01',
          }),
        ]),
      ),
    ).toThrow('一份表格只能包含一个年月');
    const sheet = XLSX.utils.aoa_to_sheet([
      ['标题'],
      ['厂家', '数量（个）'],
      ['甲公司', 1],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '登记表');
    const bytes = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as Uint8Array,
    );
    expect(() => parseAftersaleQualityWorkbook(bytes)).toThrow('处理方案');
  });

  it('overwrites the same month and keeps other months', async () => {
    const record = memoryRecord();
    const first: ComplaintEvent = {
      supplier: '甲公司',
      quantity: 1,
      companyPay: 1,
      factoryPay: 1,
      category: '设备包装',
      pending: false,
    };
    const replacement: ComplaintEvent = {
      ...first,
      supplier: '乙公司',
    };
    const october: ComplaintEvent = {
      ...first,
      supplier: '丙公司',
    };
    await saveAftersaleMonth(record, { month: '2026-09', events: [first] });
    await saveAftersaleMonth(record, { month: '2026-10', events: [october] });
    await saveAftersaleMonth(record, {
      month: '2026-09',
      events: [replacement],
    });
    expect(loadAftersaleMonths(record)).toEqual([
      { month: '2026-09', events: [replacement] },
      { month: '2026-10', events: [october] },
    ]);
  });
});

function MonthHost({ record }: { record: PersistedRecord }) {
  const [month, setMonth] = useState('');
  return (
    <>
      <select
        aria-label="年月"
        value={month}
        onChange={(event) => setMonth(event.target.value)}
      >
        <option value="">全部</option>
        <option value="2026-09">2026-09</option>
        <option value="2026-10">2026-10</option>
      </select>
      <AftersaleQualityPanel record={record} month={month} onMonth={setMonth} />
    </>
  );
}

describe('AftersaleQualityPanel', () => {
  it('shows the uploaded month and replaces it on a later upload', async () => {
    const record = memoryRecord();
    render(<MonthHost record={record} />);
    expect(
      screen.getByRole('heading', { name: '售后质量指标' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('上传售后问题登记表'), {
      target: {
        files: [fileFrom(workbookBytes(acceptanceRows()), '2026-09.xlsx')],
      },
    });

    expect(
      await screen.findByRole('cell', { name: '禾胜禾（福建）食品有限公司' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('年月')).toHaveValue('2026-09');
    expect(
      screen.getByRole('img', {
        name: '工厂赔付金额：禾胜禾（福建）食品有限公司 10524.22、临沂宏旭食品有限公司 3207.41、龙岩市乡村爱情食品有限公司 1161.11、漳州市云吉食品有限公司 568.56、焕烨（福建）生物科技有限公司 31.68',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: '客诉事件：临沂宏旭食品有限公司 9、禾胜禾（福建）食品有限公司 6、龙岩市乡村爱情食品有限公司 5、漳州市云吉食品有限公司 3、焕烨（福建）生物科技有限公司 1、山东美致食品有限公司 1',
      }),
    ).toBeInTheDocument();
    const meizhi = screen.getByRole('row', { name: /山东美致食品有限公司/ });
    expect(within(meizhi).getAllByText('—')).toHaveLength(3);
    for (const title of ['客诉汇总', '工厂赔付金额', '客诉事件']) {
      const card = screen
        .getByRole('heading', { name: title })
        .closest('section');
      expect(card?.querySelector('.widget-drag')).not.toBeNull();
      expect(
        within(card as HTMLElement).getByRole('button', { name: '放大' }),
      ).toBeInTheDocument();
    }
    fireEvent.click(
      within(
        screen
          .getByRole('heading', { name: '客诉汇总' })
          .closest('section') as HTMLElement,
      ).getByRole('button', { name: '放大' }),
    );
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('button', { name: '缩小' }),
    ).not.toBeInTheDocument();

    const october = workbookBytes(
      [
        line({
          supplier: '十月供应商有限公司',
          qty: 3,
          category: '设备包装',
          solution: '退款',
          company: 10,
          factory: 10,
          date: '2026-10-02',
        }),
      ],
      false,
    );
    fireEvent.change(screen.getByLabelText('上传售后问题登记表'), {
      target: { files: [fileFrom(october, '2026-10.xlsx')] },
    });
    expect(
      await screen.findByRole('cell', { name: '十月供应商有限公司' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('年月')).toHaveValue('2026-10');
    fireEvent.change(screen.getByLabelText('年月'), {
      target: { value: '2026-09' },
    });
    expect(
      screen.getByRole('cell', { name: '禾胜禾（福建）食品有限公司' }),
    ).toBeInTheDocument();

    const replaced = workbookBytes(
      [
        line({
          supplier: '替换后的供应商',
          qty: 4,
          category: '异物问题',
          solution: '待跟进',
          date: '2026-09-18',
        }),
      ],
      false,
    );
    fireEvent.change(screen.getByLabelText('上传售后问题登记表'), {
      target: { files: [fileFrom(replaced, '2026-09-new.xlsx')] },
    });
    expect(
      await screen.findByRole('cell', { name: '替换后的供应商' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('cell', { name: '禾胜禾（福建）食品有限公司' }),
    ).not.toBeInTheDocument();
    expect(loadAftersaleMonths(record).map((item) => item.month)).toEqual([
      '2026-09',
      '2026-10',
    ]);
  });
});
