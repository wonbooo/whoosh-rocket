import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Header } from '@/components/shared/Header';
import { LicenseProvider } from '@/features/license/LicenseContext';
import Home from '@/pages/Home';
import { useKingdeeStore } from '@/store/useKingdeeStore';

vi.mock('@/features/license/api', () => ({
  isLicenseEnforced: () => false,
  fetchMachineId: vi.fn(async () => 'MACHINE-001'),
  fetchLicenseStatus: vi.fn(async () => ({
    valid: true,
    machineId: 'MACHINE-001',
    expiresAt: '2026-12-05',
    reason: '',
  })),
  importLicense: vi.fn(),
}));

afterEach(async () => {
  await act(async () => {
    useKingdeeStore.setState({
      serverUrl: '',
      acctName: '',
      username: '',
      password: '',
      sessionId: null,
      userName: null,
      orgId: null,
    });
  });
  localStorage.removeItem('kingdee');
});

function renderHome() {
  return render(
    <LicenseProvider
      value={{
        status: {
          valid: true,
          machineId: 'MACHINE-001',
          expiresAt: '2026-12-05',
          reason: '',
        },
        refresh: vi.fn(async () => {}),
      }}
    >
      <MemoryRouter>
        <Header />
        <Home />
      </MemoryRouter>
    </LicenseProvider>,
  );
}

describe('Home page', () => {
  it('renders order types and connect action', () => {
    renderHome();
    expect(screen.getByText('咻咻小火箭')).toBeInTheDocument();
    expect(screen.getByText('授权至 2026-12-05')).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('button', {
        name: '变更授权',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('未连接金蝶')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '连接金蝶' }),
    ).toBeInTheDocument();
    expect(screen.getByText('委外下单')).toBeInTheDocument();
    expect(screen.getByText('包材下单')).toBeInTheDocument();
    expect(screen.getByText('售后包材下单')).toBeInTheDocument();
    expect(screen.getByText('供应商评价')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /供应商评价/ })).toHaveAttribute(
      'href',
      '/supplier',
    );
  });

  it('reloads saved connection settings when the dialog opens again', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '设置' }));
    const url = screen.getByLabelText(/金蝶URL/);
    await waitFor(() => expect(url).toBeEnabled());
    await user.type(url, 'http://kd.example/k3cloud/');
    await user.type(screen.getByLabelText(/账套ID/), 'acct-1');
    await user.type(screen.getByLabelText(/用户名/), 'demo');
    await user.type(screen.getByLabelText(/密码/), 'secret');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(
      await screen.findByDisplayValue('http://kd.example/k3cloud/'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/账套ID/)).toHaveValue('acct-1');
    expect(screen.getByLabelText(/用户名/)).toHaveValue('demo');
    expect(screen.getByLabelText(/密码/)).toHaveValue('secret');
  });

  it('opens settings dialog from the gear button', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByLabelText(/金蝶URL/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/FreeLM/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/账套ID/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  it('switches connect button to disconnect after login and logs out on click', async () => {
    const user = userEvent.setup();
    useKingdeeStore.getState().setSession('session-1', '测试用户');
    renderHome();

    expect(screen.getByText('已连接金蝶')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '断开连接' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '连接金蝶' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '断开连接' }));

    expect(screen.getByText('未连接金蝶')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '连接金蝶' }),
    ).toBeInTheDocument();
    expect(useKingdeeStore.getState().sessionId).toBeNull();
  });

  it('opens aftersale order dialog when connected', async () => {
    const user = userEvent.setup();
    useKingdeeStore.getState().setSession('session-1', '测试用户');
    renderHome();
    await user.click(screen.getByRole('button', { name: /售后包材下单/ }));
    expect(
      screen.getByRole('heading', { name: '售后包材下单' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '上传 Excel' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '提交' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '审核' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下推' }),
    ).not.toBeInTheDocument();
  });

  it('opens packaging order dialog when connected', async () => {
    const user = userEvent.setup();
    useKingdeeStore.getState().setSession('session-1', '测试用户');
    renderHome();
    await user.click(screen.getByRole('button', { name: /^包材下单/ }));
    expect(
      screen.getByRole('heading', { name: '包材下单' }),
    ).toBeInTheDocument();
    expect(screen.getByText('在系统中新增入库申请单')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '上传 Excel' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '提交' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '审核' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下推' }),
    ).not.toBeInTheDocument();
  });

  it('opens subcontract order dialog when connected', async () => {
    const user = userEvent.setup();
    useKingdeeStore.getState().setSession('session-1', '测试用户');
    renderHome();
    await user.click(screen.getByRole('button', { name: /委外下单/ }));
    expect(
      screen.getByRole('heading', { name: '委外下单' }),
    ).toBeInTheDocument();
    expect(screen.getByText('在系统中新增委外订单')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '上传 Excel' }),
    ).toBeInTheDocument();
  });

  it('opens the license import page from header 变更授权', async () => {
    const user = userEvent.setup();
    renderHome();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('授权至 2026-12-05')).toBeInTheDocument();
    await user.click(within(header).getByRole('button', { name: '变更授权' }));

    expect(
      await screen.findByRole('heading', { name: '变更授权' }),
    ).toBeInTheDocument();
    expect(screen.getByText('本机机器码')).toBeInTheDocument();
    expect(await screen.findByText('MACHINE-001')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/粘贴授权文本/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('委外下单')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '变更授权' }),
    ).not.toBeInTheDocument();
  });
});
