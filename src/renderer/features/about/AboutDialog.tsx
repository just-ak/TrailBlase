import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, LicenceEntry } from '@shared/ipc/api';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api, callOr } from '../../lib/client';
import { useUiStore } from '../../stores/uiStore';

/**
 * About window.
 *
 * This is a licence compliance surface, not decoration. GPL-3.0 obliges us to
 * state the licence, carry third-party notices, and offer the source — so the
 * component list is generated from the installed dependency tree rather than
 * hand-maintained. Requirement 14.2 and 14.3.
 */
export function AboutDialog(): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [licences, setLicences] = useState<LicenceEntry[]>([]);

  useEffect(() => {
    void (async () => {
      setInfo(await callOr(api().app.info(), null));
      setLicences(await callOr(api().app.licences(), []));
    })();
  }, []);

  const openRepo = (): void => {
    if (info === null) return;
    void callOr(api().app.openExternal({ url: info.repositoryUrl }), null);
  };

  return (
    <Dialog
      title="About TrailRT"
      width={520}
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={openRepo}>Source code</Button>
          <Button variant="primary" onClick={closeDialog}>
            Close
          </Button>
        </>
      }
    >
      <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
        TrailRT {info?.version ?? ''}
      </p>
      <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
        A modern desktop replacement for Garmin BaseCamp. Local-first: your
        trips stay on this machine, and no account is required.
      </p>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <p className="text-[12px] text-[var(--color-text-primary)]">
        Licensed under the{' '}
        <strong>GNU General Public License, version 3 or later</strong>.
      </p>
      <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
        This program comes with absolutely no warranty. You are free to
        redistribute it and change it under the terms of the GPL. The complete
        corresponding source for this build is published alongside every release
        at{' '}
        <button
          type="button"
          onClick={openRepo}
          className="text-[var(--color-accent)] underline"
        >
          {info?.repositoryUrl ?? 'the project repository'}
        </button>
        .
      </p>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Runtime
      </p>
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Electron {info?.electron} · Chromium {info?.chrome} · Node {info?.node}
      </p>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Third-party components
      </p>
      <table className="w-full text-[12px]">
        <tbody>
          {licences.map((entry) => (
            <tr key={entry.name} className="align-top">
              <td className="py-0.5 pr-2 text-[var(--color-text-primary)]">
                {entry.name}
              </td>
              <td className="py-0.5 pr-2 text-[var(--color-text-muted)]">
                {entry.version}
              </td>
              <td className="py-0.5 text-right text-[var(--color-text-secondary)]">
                {entry.licence}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
        Map data © OpenStreetMap contributors, available under the Open Database
        License.
      </p>
    </Dialog>
  );
}
