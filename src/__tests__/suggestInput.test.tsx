import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestInput } from '@/components/shared/SuggestInput';

const OPTIONS = [
  { value: 'FBillNo', label: '单据编号（FBillNo）' },
  { value: 'FCustId', label: '客户（FCustId）' },
  { value: 'FBillAmount', label: '金额（FBillAmount）' },
];

function Harness({
  initial = '',
  onPick,
}: {
  initial?: string;
  onPick?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SuggestInput
      value={value}
      options={OPTIONS}
      placeholder="字段"
      onChange={setValue}
      onPick={(option) => onPick?.(option.value)}
    />
  );
}

describe('SuggestInput', () => {
  it('shows the Chinese label for a selected field key', () => {
    render(<Harness initial="FCustId" />);
    expect(screen.getByRole('combobox')).toHaveValue('客户（FCustId）');
  });

  it('keeps an unmatched identifier as typed', () => {
    render(<Harness initial="FCustom" />);
    expect(screen.getByRole('combobox')).toHaveValue('FCustom');
  });

  it('shows the Chinese label after a dropdown choice', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(
      screen.getByRole('button', { name: '单据编号（FBillNo）' }),
    );

    expect(screen.getByRole('combobox')).toHaveValue('单据编号（FBillNo）');
    expect(onPick).toHaveBeenCalledWith('FBillNo');
  });

  it('resolves a typed Chinese name to the field key', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('金额');
    await user.tab();

    expect(screen.getByRole('combobox')).toHaveValue('金额（FBillAmount）');
    expect(onPick).toHaveBeenCalledWith('FBillAmount');
  });
});
