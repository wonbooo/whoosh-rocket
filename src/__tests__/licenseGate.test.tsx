import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LicenseGate } from '@/features/license/LicenseGate';
import { IssueLicenseHotkey } from '@/features/license/IssueLicenseHotkey';

const mocks = vi.hoisted(() => ({
  isLicenseEnforced: vi.fn(() => true),
  fetchLicenseStatus: vi.fn(),
  fetchMachineId: vi.fn(),
  importLicense: vi.fn(),
  issueLicense: vi.fn(),
}));

vi.mock('@/features/license/api', () => mocks);

describe('LicenseGate', () => {
  beforeEach(() => {
    mocks.isLicenseEnforced.mockReturnValue(true);
    mocks.fetchMachineId.mockResolvedValue('MACHINE-001');
    mocks.fetchLicenseStatus.mockResolvedValue({
      valid: false,
      machineId: 'MACHINE-001',
      expiresAt: null,
      reason: '请先导入授权',
    });
    mocks.importLicense.mockReset();
  });

  it('blocks the app until a license is imported', async () => {
    render(
      <LicenseGate>
        <div>首页内容</div>
      </LicenseGate>,
    );

    expect(await screen.findByText('需要授权')).toBeInTheDocument();
    expect(screen.getByText('请先导入授权')).toBeInTheDocument();
    expect(screen.getByText('MACHINE-001')).toBeInTheDocument();
    expect(screen.queryByText('首页内容')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '签发授权' }),
    ).not.toBeInTheDocument();
  });

  it('shows children after a valid license is imported', async () => {
    const user = userEvent.setup();
    mocks.importLicense.mockResolvedValue({
      valid: true,
      machineId: 'MACHINE-001',
      expiresAt: '2026-12-05',
      reason: '',
    });

    render(
      <LicenseGate>
        <div>首页内容</div>
      </LicenseGate>,
    );

    await screen.findByText('需要授权');
    fireEvent.change(screen.getByPlaceholderText(/粘贴授权文本/), {
      target: { value: 'license-text' },
    });
    await user.click(screen.getByRole('button', { name: '导入' }));

    expect(await screen.findByText('首页内容')).toBeInTheDocument();
    expect(screen.queryByText('需要授权')).not.toBeInTheDocument();
  });

  it('opens the issuer dialog after double-tapping Ctrl', async () => {
    const user = userEvent.setup();
    render(<IssueLicenseHotkey />);
    expect(screen.queryByText('签发授权')).not.toBeInTheDocument();
    await user.keyboard('{Control}{Control}');
    expect(
      await screen.findByRole('heading', { name: '签发授权' }),
    ).toBeInTheDocument();
  });

  it('does not open the issuer dialog on a single Ctrl tap', async () => {
    const user = userEvent.setup();
    render(<IssueLicenseHotkey />);
    await user.keyboard('{Control}');
    expect(
      screen.queryByRole('heading', { name: '签发授权' }),
    ).not.toBeInTheDocument();
  });

  it('does not treat Ctrl shortcuts as a double-tap', async () => {
    const user = userEvent.setup();
    render(<IssueLicenseHotkey />);
    await user.keyboard('{Control>}c{/Control}{Control>}c{/Control}');
    expect(
      screen.queryByRole('heading', { name: '签发授权' }),
    ).not.toBeInTheDocument();
  });
});
