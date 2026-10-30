/**
 * Theme state management
 * Migrated from the original project's src/modules/theme.js
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';
import { STORAGE_KEY_THEME } from '@/utils/constants';

type ResolvedTheme = 'light' | 'dark';
type AppliedTheme = ResolvedTheme | 'white';

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  initializeTheme: () => () => void;
}

const getSystemTheme = (): ResolvedTheme => {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

const resolveAutoTheme = (): AppliedTheme => {
  return getSystemTheme() === 'dark' ? 'dark' : 'light';
};

const normalizeResolvedTheme = (theme: AppliedTheme): ResolvedTheme => {
  return theme === 'dark' ? 'dark' : 'light';
};

const resolveTheme = (theme: Theme): AppliedTheme => {
  if (theme === 'auto') {
    return resolveAutoTheme();
  }
  if (theme === 'white') {
    return 'white';
  }
  return theme;
};

const applyTheme = (resolved: AppliedTheme) => {
  if (resolved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    return;
  }

  if (resolved === 'white') {
    document.documentElement.setAttribute('data-theme', 'white');
    return;
  }

  document.documentElement.removeAttribute('data-theme');
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Dracula is the default design.
      theme: 'dark',
      resolvedTheme: 'dark',

      setTheme: (theme) => {
        const resolved = resolveTheme(theme);
        applyTheme(resolved);
        set({
          theme,
          resolvedTheme: normalizeResolvedTheme(resolved),
        });
      },

      initializeTheme: () => {
        const { theme, setTheme } = get();

        // Apply the saved theme
        setTheme(theme);

        // Listen for system theme changes (only takes effect in auto mode)
        if (!window.matchMedia) {
          return () => {};
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => {
          const { theme: currentTheme } = get();
          if (currentTheme === 'auto') {
            const resolved = resolveAutoTheme();
            applyTheme(resolved);
            set({ resolvedTheme: normalizeResolvedTheme(resolved) });
          }
        };

        mediaQuery.addEventListener('change', listener);

        return () => mediaQuery.removeEventListener('change', listener);
      },
    }),
    {
      name: STORAGE_KEY_THEME,
      // Version 1 made Dracula the default: move people still on the old 'auto' default to it.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<ThemeState>;
        if (version < 1 && (state.theme === undefined || state.theme === 'auto')) {
          return { ...state, theme: 'dark' } as ThemeState;
        }
        return state as ThemeState;
      },
    }
  )
);
