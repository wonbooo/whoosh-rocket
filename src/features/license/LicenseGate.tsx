import { useEffect, useState } from 'react';
import { fetchLicenseStatus, isLicenseEnforced } from '@/features/license/api';
import { LicenseProvider } from '@/features/license/LicenseContext';
import { LicenseImportPage } from '@/features/license/LicenseImportPage';
import type { LicenseStatus } from '@/features/license/types';

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

  const refresh = async () => {
    const next = await fetchLicenseStatus();
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

  return (
    <LicenseImportPage
      title="需要授权"
      description={status.reason || '请先导入授权'}
      onImported={(next) => {
        setStatus(next);
      }}
    />
  );
}
