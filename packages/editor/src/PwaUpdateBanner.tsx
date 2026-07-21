import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * PwaUpdateBanner — notifica minimale per lo stato del service worker
 * (Fase 4D).
 *
 * `registerType: "prompt"` in vite.config.ts significa che il plugin NON
 * ricarica da solo la pagina quando trova una versione più recente: un
 * editor visuale può avere una scena con modifiche non salvate in memoria
 * (nessuna persistenza ancora, arriva in Fase 5) — un reload automatico
 * perderebbe silenziosamente quello stato. Questo banner lascia
 * all'utente la scelta di quando aggiornare.
 *
 * `offlineReady` invece è puramente informativo (nessuna azione
 * richiesta): conferma che il precache di Workbox è completo e l'editor
 * può essere usato offline da questo momento in poi.
 */
export function PwaUpdateBanner(): JSX.Element | null {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (error: unknown) => {
      // Non bloccante: se la registrazione del service worker fallisce
      // (es. sviluppo senza build, o ambiente senza supporto SW) l'editor
      // deve restare pienamente utilizzabile online — solo l'installabilità
      // offline viene a mancare.
      console.error("[editor] registrazione service worker fallita:", error);
    },
  });

  if (!offlineReady && !needRefresh) return null;

  function dismiss(): void {
    setOfflineReady(false);
    setNeedRefresh(false);
  }

  return (
    <div className="pwa-banner" role="status">
      {needRefresh ? (
        <>
          <span>È disponibile una nuova versione dell'editor.</span>
          <button type="button" className="pwa-banner-action" onClick={() => void updateServiceWorker(true)}>
            Aggiorna
          </button>
        </>
      ) : (
        <span>Editor pronto per l'uso offline.</span>
      )}
      <button type="button" className="pwa-banner-dismiss" onClick={dismiss} aria-label="Chiudi notifica">
        ×
      </button>
    </div>
  );
}
