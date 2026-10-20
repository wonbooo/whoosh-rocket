import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterRows } from '@/features/analysis/AnalysisPage';
import type { FieldCatalog } from '@/features/analysis/catalog';
import { searchLookup } from '@/features/analysis/query';
import { findTheme } from '@/features/analysis/themes';
import type { Filter } from '@/features/analysis/types';

vi.mock('@/features/analysis/query', () => ({
  searchLookup: vi.fn(),
  loadCatalog: vi.fn(),
  runQuery: vi.fn(),
  runMerged: vi.fn(),
}));

const theme = findTheme('default');

function catalog(fields: FieldCatalog['fields']): FieldCatalog {
  return { formId: 'PUR_PurchaseOrder', formName: '采购订单', fields };
}

function Harness({
  initial,
  fields,
}: {
  initial: Filter[];
  fields: FieldCatalog['fields'];
}) {
  const [filters, setFilters] = useState(initial);
  return (
    <FilterRows
      filters={filters}
      catalog={catalog(fields)}
      theme={theme}
      onChange={setFilters}
    />
  );
}

describe('filter value control', () => {
  beforeEach(() => {
    vi.mocked(searchLookup).mockReset();
    vi.mocked(searchLookup).mockResolvedValue([
      { number: 'VEN001', name: '甲供应商' },
    ]);
  });

  it('shows a date input for equals and hides the value for today', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[{ field: 'FDate', operator: 'eq', value: '' }]}
        fields={[
          {
            key: 'FDate',
            name: '日期',
            entity: '',
            kind: 'date',
            lookupFormId: null,
            options: [],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('值')).toHaveAttribute('type', 'date');

    await user.click(screen.getByRole('combobox', { name: '比较符' }));
    await user.click(screen.getByRole('button', { name: '今天' }));

    expect(screen.queryByLabelText('值')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '比较符' })).toHaveTextContent(
      '今天',
    );
  });

  it('shows a search input for a lookup field', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[{ field: 'FSupplierId', operator: 'eq', value: '' }]}
        fields={[
          {
            key: 'FSupplierId',
            name: '供应商',
            entity: '',
            kind: 'lookup',
            lookupFormId: 'BD_Supplier',
            options: [],
          },
        ]}
      />,
    );

    const search = screen.getByPlaceholderText('搜索名称或编码');
    expect(search).toBeInTheDocument();
    expect(screen.queryByText('固定值')).not.toBeInTheDocument();

    await user.type(search, '甲');
    expect(
      await screen.findByRole('button', { name: '甲供应商（VEN001）' }),
    ).toBeInTheDocument();
    expect(searchLookup).toHaveBeenCalledWith('BD_Supplier', '甲');
  });

  it('offers 不包含 next to 包含 for text and lookup fields', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[{ field: 'FBillNo', operator: 'contains', value: 'PO' }]}
        fields={[
          {
            key: 'FBillNo',
            name: '单据编号',
            entity: '',
            kind: 'text',
            lookupFormId: null,
            options: [],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '比较符' }));
    expect(screen.getByRole('button', { name: '包含' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '不包含' }));
    expect(screen.getByRole('combobox', { name: '比较符' })).toHaveTextContent(
      '不包含',
    );
  });
});
