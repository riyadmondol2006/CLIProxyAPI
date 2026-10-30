import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useThemeStore } from '@/stores';
import iconVertex from '@/assets/icons/vertex.svg';
import iconCodex from '@/assets/icons/codex.svg';
import { OAuthHeader } from './components/OAuthHeader';
import { ProviderTile } from './components/ProviderTile';
import { OAuthFlowDialog, type DialogHeading } from './components/OAuthFlowDialog';
import { VertexImportDialog } from './components/VertexImportDialog';
import { SiwcBindDialog } from './components/SiwcBindDialog';
import {
  useOAuthFlows,
  usePluginOAuthProviders,
  type ProviderFlowState,
} from './hooks/useOAuthFlows';
import { useVertexImport } from './hooks/useVertexImport';
import {
  OAUTH_PROVIDERS,
  resolveThemedIcon,
  supportsManualCallback,
  type OAuthProviderCard,
} from './providers';
import styles from './OAuthPage.module.scss';

/** Dialog focus id: Vertex isn't an OAuth provider, so a reserved id avoids provider clashes. */
const VERTEX_DIALOG_ID = '__vertex__';
const VERTEX_LABEL = 'Vertex AI';

type DialogTarget = { kind: 'oauth'; id: string } | { kind: 'vertex' };

/**
 * OAuth sign-in: a provider gallery (everything on one screen) + a focused authorization dialog.
 *
 * Clicking a tile starts sign-in; the dialog can be closed at any time while authorization
 * continues in the background, and the tile's secondary line shows progress live.
 * After the dialog closes, the last target is kept so content doesn't vanish during the exit
 * animation.
 */
export function OAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const apiBase = useAuthStore((state) => state.apiBase);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const revealRef = useRevealGroup<HTMLDivElement>();
  const otherMethodsId = useId();

  const pluginProviders = usePluginOAuthProviders(apiBase);
  const providerCards = useMemo<OAuthProviderCard[]>(
    () => [...OAUTH_PROVIDERS, ...pluginProviders],
    [pluginProviders]
  );

  const focusedRef = useRef<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [siwcOpen, setSiwcOpen] = useState(false);
  // Each open remounts with a new key (fresh selection and session); stays mounted after close
  // so the exit animation can finish
  const [siwcKey, setSiwcKey] = useState(0);
  const openSiwc = () => {
    setSiwcKey((key) => key + 1);
    setSiwcOpen(true);
  };

  const flows = useOAuthFlows({
    providerCards,
    isFocused: (provider) => focusedRef.current === provider,
  });
  const vertexImport = useVertexImport({
    isFocused: () => focusedRef.current === VERTEX_DIALOG_ID,
    onCredentialAdded: flows.recordCredentialAdded,
  });

  const labelOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin'
      ? card.title
      : typeof card.label === 'string'
        ? card.label
        : t(card.label.key);

  const captionOf = (card: OAuthProviderCard) => {
    if (card.kind === 'plugin') return t('auth_login.method_plugin');
    const method = t(
      card.flow === 'device' ? 'auth_login.method_device' : 'auth_login.method_browser'
    );
    return card.domain ? `${card.domain} · ${method}` : method;
  };

  const iconOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin' ? card.icon : resolveThemedIcon(card.icon, resolvedTheme);

  const headingOf = (card: OAuthProviderCard): DialogHeading => ({
    title:
      card.kind === 'plugin'
        ? t('auth_login.plugin_oauth_title', { name: card.title })
        : t(card.titleKey),
    caption: captionOf(card),
    icon: iconOf(card),
  });

  const tileStatusLabel = (status: ProviderFlowState['status']) =>
    status === 'waiting'
      ? t('auth_login.tile_waiting')
      : status === 'success'
        ? t('auth_login.tile_success')
        : status === 'error'
          ? t('auth_login.tile_error')
          : undefined;

  const openProvider = (card: OAuthProviderCard) => {
    focusedRef.current = card.id;
    setDialog({ kind: 'oauth', id: card.id });
    setDialogOpen(true);
    // An in-progress/failed/just-succeeded attempt exists → just reopen to view it; otherwise
    // start sign-in immediately
    if (!flows.states[card.id]?.status) void flows.startAuth(card.id);
  };

  const openVertex = () => {
    focusedRef.current = VERTEX_DIALOG_ID;
    setDialog({ kind: 'vertex' });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (dialog?.kind === 'oauth') flows.dismissSuccess(dialog.id);
    if (dialog?.kind === 'vertex' && vertexImport.vertex.result) vertexImport.resetForAnother();
    focusedRef.current = null;
    setDialogOpen(false);
  };

  const viewAuthFiles = () => navigate('/auth-files');

  const dialogCard =
    dialog?.kind === 'oauth' ? providerCards.find((card) => card.id === dialog.id) : undefined;
  const providerCount = providerCards.length;
  const renderTile = (card: OAuthProviderCard, index: number) => {
    const status = flows.states[card.id]?.status;
    return (
      <ProviderTile
        key={card.id}
        label={labelOf(card)}
        caption={captionOf(card)}
        icon={iconOf(card)}
        index={index}
        status={status}
        statusLabel={tileStatusLabel(status)}
        onOpen={() => openProvider(card)}
      />
    );
  };
  const waitingCount = Object.values(flows.states).filter(
    (state) => state.status === 'waiting'
  ).length;

  return (
    <div className={styles.page} ref={revealRef}>
      <OAuthHeader
        providerCount={providerCount}
        waitingCount={waitingCount}
        addedCount={flows.addedCount}
      />

      <div className={styles.grid}>{providerCards.map(renderTile)}</div>

      <section className={styles.section} aria-labelledby={otherMethodsId}>
        <h2 className={styles.sectionLabel} id={otherMethodsId} data-reveal>
          {t('auth_login.other_login_methods')}
        </h2>
        <div className={styles.grid}>
          <ProviderTile
            label={VERTEX_LABEL}
            caption={t('vertex_import.file_label')}
            icon={iconVertex}
            index={providerCards.length}
            onOpen={openVertex}
          />
          <ProviderTile
            label={t('siwc.bind')}
            caption={t('siwc.tile_caption')}
            icon={iconCodex}
            index={providerCards.length + 1}
            onOpen={openSiwc}
          />
        </div>
      </section>

      {dialogCard && (
        <OAuthFlowDialog
          open={dialogOpen && dialog?.kind === 'oauth'}
          providerId={dialogCard.id}
          heading={headingOf(dialogCard)}
          state={flows.states[dialogCard.id] ?? {}}
          text={(suffix) => flows.providerText(dialogCard.id, suffix)}
          supportsCallback={supportsManualCallback(dialogCard)}
          onStart={() => void flows.startAuth(dialogCard.id)}
          onCancel={() => void flows.cancelAuth(dialogCard.id)}
          onCallbackChange={(value) => flows.setCallbackInput(dialogCard.id, value)}
          onCallbackSubmit={() => void flows.submitCallback(dialogCard.id)}
          onViewAuthFiles={viewAuthFiles}
          onClose={closeDialog}
        />
      )}

      <VertexImportDialog
        open={dialogOpen && dialog?.kind === 'vertex'}
        heading={{
          title: t('vertex_import.title'),
          caption: t('vertex_import.file_label'),
          icon: iconVertex,
        }}
        vertex={vertexImport.vertex}
        onPickFile={vertexImport.pickFile}
        onLocationChange={vertexImport.setLocation}
        onImport={() => void vertexImport.importCredential()}
        onImportAnother={vertexImport.resetForAnother}
        onViewAuthFiles={viewAuthFiles}
        onClose={closeDialog}
      />

      {siwcKey > 0 && (
        <SiwcBindDialog
          key={siwcKey}
          open={siwcOpen}
          onClose={() => setSiwcOpen(false)}
          onViewAuthFiles={viewAuthFiles}
        />
      )}
    </div>
  );
}
