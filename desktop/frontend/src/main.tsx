import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import App from './App.tsx';
import { useThemeStore } from '@/stores/useThemeStore';
import { installExternalLinkHandler, isDesktopApp } from '@/utils/desktop';

document.title = 'CLIProxyAPI';
// Apply the saved theme before the first paint so the window doesn't flash another theme.
useThemeStore.getState().setTheme(useThemeStore.getState().theme);
if (isDesktopApp()) {
  installExternalLinkHandler();
  document.documentElement.classList.add('desktop-app');
}
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = INLINE_LOGO_JPEG;
  faviconEl.type = 'image/jpeg';
} else {
  const newFavicon = document.createElement('link');
  newFavicon.rel = 'icon';
  newFavicon.type = 'image/jpeg';
  newFavicon.href = INLINE_LOGO_JPEG;
  document.head.appendChild(newFavicon);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
