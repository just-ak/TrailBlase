import { useEffect, useState, type ReactNode } from "react";
import { Toast } from "../components/Toast";
import { AboutDialog } from "../features/about/AboutDialog";
import { RestoreDialog } from "../features/backup/RestoreDialog";
import { ConfirmDeleteDialog } from "../features/library/ConfirmDeleteDialog";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import * as actions from "../lib/actions";
import { api, callOr, describeError } from "../lib/client";
import { useLibraryStore } from "../stores/libraryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useUndoStore } from "../stores/undoStore";
import { Layout } from "./Layout";

/**
 * Root component: hydration, theme, global menu wiring and dialog hosting.
 *
 * Nothing renders until settings have loaded, because panel widths, theme and
 * the map's starting position all come from them and a flash of defaults
 * followed by a jump looks like a bug.
 */
export function App(): ReactNode {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const dialog = useUiStore((s) => s.dialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const isDark = useUiStore((s) => s.isDark());
  const setSystemPrefersDark = useUiStore((s) => s.setSystemPrefersDark);
  const showToast = useUiStore((s) => s.showToast);

  // --- hydrate from persisted settings
  useEffect(() => {
    void (async () => {
      try {
        const settings = await useSettingsStore.getState().load();
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        useUiStore.getState().hydrate(settings, prefersDark);
        useLibraryStore.getState().hydrate(settings);
        setReady(true);
      } catch (cause) {
        setFatal(describeError(cause));
      }
    })();
  }, []);

  // --- theme: a class on <html> drives the Tailwind dark variant
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  // The main process is authoritative for system theme, since nativeTheme sees
  // changes the renderer's media query can lag behind.
  useEffect(() => {
    return api().events.onThemeChanged(setSystemPrefersDark);
  }, [setSystemPrefersDark]);

  // The undo stack lives in the main process; this mirror drives the Edit
  // menu's enabled state and labels.
  useEffect(() => {
    void useUndoStore.getState().load();
    return api().events.onUndoStateChanged((state) => {
      useUndoStore.getState().apply(state);
    });
  }, []);

  // --- native menu actions that belong to the shell rather than a feature
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      const ui = useUiStore.getState();
      switch (action) {
        case "panel:toggleLibrary":
          ui.toggleLibrary();
          break;
        case "panel:togglePanelProperties":
          ui.toggleProperties();
          break;
        case "settings:open":
          openDialog({ kind: "settings" });
          break;
        case "about:open":
          openDialog({ kind: "about" });
          break;
        case "backup:restore":
          openDialog({ kind: "restore" });
          break;
        case "edit:undo":
          void actions.undo();
          break;
        case "edit:redo":
          void actions.redo();
          break;
        case "backup:create":
          void (async () => {
            const entry = await callOr(api().backup.create(), null);
            showToast(
              entry === null
                ? "The backup could not be created."
                : "Backup created.",
              entry === null ? "error" : "info",
            );
          })();
          break;
        case "export:copy":
          void (async () => {
            const result = await callOr(api().backup.createTo(), null);
            if (result !== null && !result.cancelled) {
              showToast("Copy saved.");
            }
          })();
          break;
        default:
          // Other actions are handled by the feature that owns them.
          break;
      }
    });
  }, [openDialog, showToast]);

  if (fatal !== null) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-[15px] font-semibold text-[var(--color-danger)]">
            TrailRT could not start
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            {fatal}
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-muted)]">
        Loading your collection…
      </div>
    );
  }

  return (
    <>
      <Layout />

      {dialog.kind === "settings" && <SettingsDialog />}
      {dialog.kind === "about" && <AboutDialog />}
      {dialog.kind === "restore" && <RestoreDialog />}
      {dialog.kind === "confirmDelete" && (
        <ConfirmDeleteDialog target={dialog.target} counts={dialog.counts} />
      )}

      <Toast />
    </>
  );
}
