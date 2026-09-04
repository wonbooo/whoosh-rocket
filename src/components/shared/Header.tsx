import { Link, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/useAuthStore';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? 'text-sm font-medium text-foreground'
    : 'text-sm text-muted-foreground transition-colors hover:text-foreground';

export function Header() {
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <img src="/icon.png" alt="" className="h-6 w-6 rounded-sm" />
          咻咻小火箭
        </Link>
        <nav className="flex items-center gap-4">
          <NavLink to="/" className={navClass} end>
            首页
          </NavLink>
          <NavLink to="/about" className={navClass}>
            关于
          </NavLink>
          {token ? (
            <Button variant="outline" size="sm" onClick={() => logout()}>
              退出
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/login">登录</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
