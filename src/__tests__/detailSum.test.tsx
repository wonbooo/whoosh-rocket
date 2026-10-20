import { render, screen } from '@testing-library/react';
import { ChartView } from '@/features/analysis/ChartView';
import type { QueryChartResult } from '@/features/analysis/query';
import type { Dataset } from '@/features/analysis/types';

function detailDataset(columns: Dataset['columns']): Dataset {
  return {
    id: 'ds',
    name: '明细',
    formId: 'PUR_PurchaseOrder',
    dimension: { field: '', display: 'value' },
    series: null,
    seriesCases: [],
    measure: { field: '', display: 'value' },
    aggregation: 'count',
    columns,
    filters: [],
    limit: 20,
    chartType: 'kpi',
  };
}

function result(
  detail: QueryChartResult['detail'],
  queryTruncated = false,
): QueryChartResult {
  return {
    rows: [],
    detail,
    skipped: 0,
    truncated: false,
    fetched: detail.length,
    queryTruncated,
  };
}

const columns: Dataset['columns'] = [
  { field: 'FBillNo', display: 'value' },
  { field: 'FQty', display: 'value', sum: true },
  { field: 'FStockInQty', display: 'value', sum: true },
];

describe('detail column sums', () => {
  it('sums only the columns marked for a total', () => {
    render(
      <ChartView
        dataset={detailDataset(columns)}
        chartType="kpi"
        result={result([
          { cells: ['PO1', '10', '4'] },
          { cells: ['PO2', '2.5', '1'] },
          { cells: ['PO3', '不是数字', ''] },
        ])}
      />,
    );

    const footer = screen.getByText('合计').closest('tr');
    expect(footer).toHaveTextContent('12.5');
    expect(footer).toHaveTextContent('5');
    expect(footer).not.toHaveTextContent('PO1');
  });

  it('labels the total as the current page when more rows exist', () => {
    render(
      <ChartView
        dataset={detailDataset(columns)}
        chartType="kpi"
        result={result([{ cells: ['PO1', '3', '1'] }], true)}
        hasNext
      />,
    );

    expect(screen.getByText('本页合计')).toBeInTheDocument();
    expect(screen.queryByText('合计')).not.toBeInTheDocument();
  });
});
