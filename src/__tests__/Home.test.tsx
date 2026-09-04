import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '@/components/shared/Header';
import Home from '@/pages/Home';
import { useKingdeeStore } from '@/store/useKingdeeStore';

afterEach(() => {
  useKingdeeStore.setState({
    serverUrl: '',
    acctName: '',
    username: '',
    password: '',
    sessionId: null,
    userName: null,
    orgId: null,
  });
  localStorage.removeItem('kingdee-session');
});

function renderHome() {
  return render(
    <MemoryRouter>
      <Header />
      <Home />
    </MemoryRouter>,
  );
}

describe('Home page', () => {
  it('renders order types and connect action', () => {
    renderHome();
    expect(screen.getByText('咻咻小火箭')).toBeInTheDocument();
    expect(screen.getByText('未连接金蝶')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '连接金蝶' }),
    ).toBeInTheDocument();
    expect(screen.getByText('委外下单')).toBeInTheDocument();
    expect(screen.getByText('包材下单')).toBeInTheDocument();
    expect(screen.getByText('售后包材下单')).toBeInTheDocument();
  });

  it('opens settings dialog from the gear button', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByLabelText(/金蝶URL/)).toBeInTheDocument();
    expect(screen.getByLabelText(/账套ID/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  it('switches connect button to disconnect after login and logs out on click', async () => {
    const user = userEvent.setup();
    useKingdeeStore.getState().setSession('session-1', '高依婷');
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
    useKingdeeStore.getState().setSession('session-1', '高依婷');
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
    useKingdeeStore.getState().setSession('session-1', '高依婷');
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
    useKingdeeStore.getState().setSession('session-1', '高依婷');
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
});
