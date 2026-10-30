import i18n from '@/i18n';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { desktopApi, isDesktopApp } from '@/utils/desktop';

export type DownloadBlobOptions = {
  filename: string;
  blob: Blob;
  revokeDelayMs?: number;
};

/** The app window can't handle browser downloads, so the app saves the file instead. */
async function saveInDesktopApp(filename: string, blob: Blob) {
  const { showNotification } = useNotificationStore.getState();
  try {
    const path = await desktopApi.save(filename, blob);
    if (path) showNotification(i18n.t('desktop.saved_to', { path }), 'success');
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    showNotification(`${i18n.t('desktop.save_failed')}${reason ? ` ${reason}` : ''}`, 'error');
  }
}

export function downloadBlob({ filename, blob, revokeDelayMs = 1000 }: DownloadBlobOptions) {
  if (isDesktopApp()) {
    void saveInDesktopApp(filename, blob);
    return;
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
    link.remove();
  }, revokeDelayMs);
}
