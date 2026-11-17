import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from 'react-router-dom';
import { isTauriRuntime } from '@/apis/kingdee/transport';
import { queryClient } from '@/apis/queryClient';
import { Toaster } from '@/components/ui/toaster';
import { LicenseGate } from '@/features/license/LicenseGate';
import { IssueLicenseHotkey } from '@/features/license/IssueLicenseHotkey';
import { BlockInspect } from '@/features/security/BlockInspect';
import { router } from '@/router';

export default function App() {
  const inTauri = isTauriRuntime();

  return (
    <QueryClientProvider client={queryClient}>
      {inTauri || import.meta.env.PROD ? <BlockInspect /> : null}
      <LicenseGate>
        <RouterProvider router={router} />
      </LicenseGate>
      <IssueLicenseHotkey />
      <Toaster />
      {import.meta.env.DEV && !inTauri ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  );
}
