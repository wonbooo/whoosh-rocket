import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/shared/AppLayout';

const Home = lazy(() => import('@/pages/Home'));
const Analysis = lazy(() =>
  import('@/features/analysis/AnalysisPage').then((module) => ({
    default: module.AnalysisPage,
  })),
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'analysis', element: <Analysis /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
