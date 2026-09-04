import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/shared/AppLayout';

const Home = lazy(() => import('@/pages/Home'));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
