import { create } from 'zustand';
import { desktopApi, type DesktopUpdateInfo } from '@/utils/desktop';
import { getErrorMessage } from '@/utils/helpers';
import {
  readAutoCheck,
  readSkippedVersion,
  shouldShowUpdatePopup,
  writeAutoCheck,
  writeSkippedVersion,
  type UpdateCheckKind,
} from './updateLogic';

export type UpdateInstallState =
  | { phase: 'idle' }
  | { phase: 'installing' }
  | { phase: 'installed'; version: string }
  | { phase: 'cancelled' }
  /** `message` may be empty; the UI shows a generic error then. */
  | { phase: 'error'; message: string };

interface UpdatesState {
  /** The last check result, or null before the first one. */
  info: DesktopUpdateInfo | null;
  checking: boolean;
  /** The request itself failed (null when it didn't); `info.error` covers failed checks. */
  checkError: string | null;
  /** The popup is open. */
  visible: boolean;
  install: UpdateInstallState;
  relaunching: boolean;
  relaunchError: string | null;
  autoCheck: boolean;
  check: (kind: UpdateCheckKind) => Promise<void>;
  open: () => void;
  close: () => void;
  skip: () => void;
  installUpdate: () => Promise<void>;
  relaunch: () => Promise<void>;
  setAutoCheck: (enabled: boolean) => void;
}

/** Only the newest check may write its result, so a slow one can't overwrite a newer one. */
let checkSeq = 0;

/** Update state shared by the popup (mounted in MainLayout) and the Home section. */
export const useUpdates = create<UpdatesState>((set, get) => ({
  info: null,
  checking: false,
  checkError: null,
  visible: false,
  install: { phase: 'idle' },
  relaunching: false,
  relaunchError: null,
  autoCheck: readAutoCheck(),

  async check(kind) {
    const state = get();
    if (state.install.phase === 'installing') return;
    if (kind !== 'manual' && state.checking) return;
    const seq = ++checkSeq;
    set({ checking: true });
    try {
      const info = await desktopApi.checkUpdate(kind === 'manual');
      if (seq !== checkSeq) return;
      const show = shouldShowUpdatePopup({
        info,
        kind,
        autoCheck: get().autoCheck,
        skipped: readSkippedVersion(),
      });
      set({ info, checking: false, checkError: null, ...(show ? { visible: true } : {}) });
    } catch (err) {
      if (seq !== checkSeq) return;
      set({ checking: false, checkError: getErrorMessage(err) });
    }
  },

  open() {
    if (get().info?.available) set({ visible: true });
  },

  close() {
    const { phase } = get().install;
    if (phase === 'installing') return;
    set({
      visible: false,
      relaunchError: null,
      ...(phase === 'cancelled' || phase === 'error' ? { install: { phase: 'idle' } } : {}),
    });
  },

  skip() {
    const latest = get().info?.latest;
    if (latest) writeSkippedVersion(latest);
    get().close();
  },

  async installUpdate() {
    if (get().install.phase === 'installing') return;
    set({ install: { phase: 'installing' } });
    try {
      const result = await desktopApi.installUpdate();
      set({
        install:
          result.status === 'installed'
            ? { phase: 'installed', version: result.version || get().info?.latest || '' }
            : { phase: 'cancelled' },
      });
    } catch (err) {
      set({ install: { phase: 'error', message: getErrorMessage(err) } });
    }
  },

  async relaunch() {
    if (get().relaunching) return;
    set({ relaunching: true, relaunchError: null });
    try {
      // The app quits right after accepting, so the spinner stays until then.
      await desktopApi.relaunch();
    } catch (err) {
      set({ relaunching: false, relaunchError: getErrorMessage(err) });
    }
  },

  setAutoCheck(enabled) {
    writeAutoCheck(enabled);
    set({ autoCheck: enabled });
  },
}));
