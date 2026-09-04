import { useState } from 'react';
import { Cloud, LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  formatKingdeeError,
  formatLoginSuccessToast,
  loginByPassword,
} from '@/apis/kingdee/client';
import { SettingsDialog } from '@/components/shared/SettingsDialog';
import { Button } from '@/components/ui/button';
import { useLicense } from '@/features/license/LicenseContext';
import { useToast } from '@/hooks/use-toast';
import { useKingdeeStore } from '@/store/useKingdeeStore';

export function Header() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const clearSession = useKingdeeStore((state) => state.clearSession);
  const license = useLicense();
  const canConnect = useKingdeeStore((state) =>
    Boolean(
      state.serverUrl && state.acctName && state.username && state.password,
    ),
  );
  const { toast } = useToast();

  const connected = Boolean(sessionId);

  const handleConnect = async () => {
    if (!canConnect) {
      setSettingsOpen(true);
      toast({
        title: '请先填写连接信息',
        description: '在设置中保存金蝶 URL、账套 ID、用户名和密码',
      });
      return;
    }

    setConnecting(true);
    try {
      const result = await loginByPassword();
      toast(
        formatLoginSuccessToast(result, useKingdeeStore.getState().username),
      );
    } catch (error) {
      toast({
        title: '连接失败',
        description: formatKingdeeError(error),
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    clearSession();
    toast({ title: '已退出登录' });
  };

  return (
    <header className="border-b bg-white">
      <div className="flex h-14 items-center justify-between px-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
        >
          <img src="/icon.png" alt="" className="h-7 w-7 rounded-sm" />
          咻咻小火箭
        </Link>
        <div className="flex items-center gap-3">
          {license?.status.expiresAt ? (
            <span className="text-sm text-zinc-500">
              授权至 {license.status.expiresAt}
            </span>
          ) : null}
          <span
            className={
              connected ? 'text-sm text-emerald-600' : 'text-sm text-red-500'
            }
          >
            {connected ? '已连接金蝶' : '未连接金蝶'}
          </span>
          {connected ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg px-4 shadow-none"
              onClick={handleDisconnect}
            >
              <LogOut className="h-4 w-4" />
              断开连接
            </Button>
          ) : (
            <Button
              type="button"
              className="h-9 rounded-lg bg-blue-600 px-4 text-white shadow-none hover:bg-blue-700"
              disabled={connecting}
              onClick={() => {
                void handleConnect();
              }}
            >
              <Cloud className="h-4 w-4" />
              {connecting ? '连接中...' : '连接金蝶'}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="设置"
            className="h-9 w-9 text-zinc-500 hover:text-zinc-800"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  );
}
