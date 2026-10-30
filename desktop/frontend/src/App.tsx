import { useEffect } from 'react';
import { Navigate, Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { MainLayout } from '@/components/layout/MainLayout';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { DesktopGate } from '@/features/desktop/DesktopGate';
import { isDesktopApp } from '@/utils/desktop';
import { useLanguageStore, useThemeStore } from '@/stores';

function RootShell() {
  return (
    <>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </>
  );
}

// The desktop app has no login: it connects to the local service on its own.
const router = createHashRouter([
  {
    element: <RootShell />,
    children: isDesktopApp()
      ? [
          { path: '/login', element: <Navigate to="/" replace /> },
          {
            path: '/*',
            element: (
              <DesktopGate>
                <MainLayout />
              </DesktopGate>
            ),
          },
        ]
      : [
          { path: '/login', element: <LoginPage /> },
          {
            path: '/*',
            element: (
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            ),
          },
        ],
  },
]);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  useEffect(() => {
    const cleanupTheme = initializeTheme();
    return cleanupTheme;
  }, [initializeTheme]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Sync the i18n language once on first render

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <RouterProvider router={router} />;
}

export default App;
