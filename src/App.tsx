import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/apis/queryClient';
import { Toaster } from '@/components/ui/toaster';
import { LicenseGate } from '@/features/license/LicenseGate';
import { IssueLicenseHotkey } from '@/features/license/IssueLicenseHotkey';
import { router } from '@/router';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LicenseGate>
        <RouterProvider router={router} />
      </LicenseGate>
      <IssueLicenseHotkey />
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
