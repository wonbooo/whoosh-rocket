import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '@/components/shared/Header';

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <Header />
      <main className="flex-1">
        <Suspense
          fallback={
            <div className="p-8 text-center text-muted-foreground">
              加载中...
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
