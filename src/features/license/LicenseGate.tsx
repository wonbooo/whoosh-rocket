import { useEffect, useRef, useState } from 'react';
import {
  fetchLicenseStatus,
  fetchMachineId,
  importLicense,
  isLicenseEnforced,
} from '@/features/license/api';
import { LicenseProvider } from '@/features/license/LicenseContext';
import type { LicenseStatus } from '@/features/license/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const idleStatus: LicenseStatus = {
  valid: true,
  machineId: '',
  expiresAt: null,
  reason: '',
};

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const enforced = isLicenseEnforced();
  const [status, setStatus] = useState<LicenseStatus | null>(
    enforced ? null : idleStatus,
  );
  const [machineId, setMachineId] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const refresh = async () => {
    const next = await fetchLicenseStatus();
    const id = next.machineId || (await fetchMachineId());
    setMachineId(id);
    setStatus(next);
  };

  useEffect(() => {
    if (!enforced) {
      return;
    }
    void refresh().catch((error) => {
      setStatus({
        valid: false,
        machineId: '',
        expiresAt: null,
        reason: error instanceof Error ? error.message : '无法读取授权',
      });
    });
  }, [enforced]);

  if (!enforced) {
    return <>{children}</>;
  }

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        正在检查授权...
      </div>
    );
  }

  if (status.valid) {
    return (
      <LicenseProvider value={{ status, refresh }}>{children}</LicenseProvider>
    );
  }

  const handleCopy = async () => {
    if (!machineId) {
      return;
    }
    await navigator.clipboard.writeText(machineId);
    toast({ title: '已复制机器码' });
  };

  const handleImport = async (content: string) => {
    setBusy(true);
    try {
      const next = await importLicense(content);
      setStatus(next);
      setMachineId(next.machineId || machineId);
      if (next.valid) {
        toast({
          title: '授权成功',
          description: next.expiresAt
            ? `有效期至 ${next.expiresAt}`
            : undefined,
        });
      } else {
        toast({
          title: '导入失败',
          description: next.reason,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: '导入失败',
        description: error instanceof Error ? error.message : '授权文件无效',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const text = await file.text();
    await handleImport(text);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-lg rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">需要授权</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {status.reason || '请先导入授权'}
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <div className="text-sm font-medium">本机机器码</div>
            <div className="mt-1 flex gap-2">
              <code className="flex-1 break-all rounded-md border bg-zinc-50 px-3 py-2 text-sm">
                {machineId || '读取中...'}
              </code>
              <Button
                type="button"
                variant="outline"
                disabled={!machineId}
                onClick={() => {
                  void handleCopy();
                }}
              >
                复制
              </Button>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">导入 license</div>
            <textarea
              className="mt-1 h-28 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
              placeholder="粘贴授权文本，或选择 .lic 文件"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".lic,.json,text/plain"
                className="hidden"
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                选择文件
              </Button>
              <Button
                type="button"
                disabled={busy || !paste.trim()}
                onClick={() => {
                  void handleImport(paste);
                }}
              >
                {busy ? '导入中...' : '导入'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
