import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile, uploadFile } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { BackupFile, SampleDataSummary, Settings } from '../lib/types';
import { Banner, Card, ConfirmDialog, EmptyState, Loading, PageHeader } from '../components/ui';
import { formatBytes, formatDateTime } from '../lib/format';

interface SystemInfo {
  version: string;
  hostname: string;
  localUrl: string;
  networkUrls: string[];
  node: string;
}

interface IntegrityResult {
  ok: boolean;
  checked: number;
  discrepancies: {
    batch_id: number;
    drug_name: string;
    batch_number: string;
    quantity_on_hand: number;
    ledger_balance: number;
  }[];
}

export function SettingsPage() {
  const { can, settings, refresh } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const canManage = can(PERMISSIONS.SETTINGS_MANAGE);
  const canBackup = can(PERMISSIONS.BACKUP_MANAGE);

  const [pharmacyName, setPharmacyName] = useState(settings?.pharmacy_name ?? '');
  const [expiryDays, setExpiryDays] = useState(settings?.expiry_alert_days ?? '90');
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const [restoringUpload, setRestoringUpload] = useState<File | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [clearingSample, setClearingSample] = useState(false);

  const { data: system } = useQuery({
    queryKey: ['system'],
    queryFn: () => api.get<SystemInfo>('/system'),
  });

  const { data: backups, isLoading: backupsLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ items: BackupFile[] }>('/backups'),
    enabled: canBackup,
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.put<Settings>('/settings', {
        pharmacy_name: pharmacyName,
        expiry_alert_days: Number(expiryDays),
      }),
    onSuccess: async () => {
      toast.success('Settings saved. Expiry alerts updated everywhere.');
      await refresh();
      void queryClient.invalidateQueries();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const backupNow = useMutation({
    mutationFn: () => api.post<{ filename: string; size: number }>('/backups'),
    onSuccess: (data) => {
      toast.success('Backup created.', [`${data.filename} (${formatBytes(data.size)})`]);
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const restore = useMutation({
    mutationFn: (filename: string) => api.post<{ message: string }>(`/backups/${filename}/restore`),
    onSuccess: (data) => {
      setRestoring(null);
      toast.warning('Database restored', [data.message]);
    },
    onError: (err: Error) => {
      setRestoring(null);
      toast.error(err.message);
    },
  });

  const restoreUpload = useMutation({
    mutationFn: (file: File) => uploadFile<{ message: string }>('/backups/upload-restore', 'backup', file),
    onSuccess: (data) => {
      setRestoringUpload(null);
      toast.warning('Database restored', [data.message]);
    },
    onError: (err: Error) => {
      setRestoringUpload(null);
      toast.error(err.message);
    },
  });

  const { data: sample } = useQuery({
    queryKey: ['sample-data'],
    queryFn: () => api.get<SampleDataSummary>('/sample-data'),
  });

  const clearSample = useMutation({
    mutationFn: () => api.del<{ message: string }>('/sample-data'),
    onSuccess: (data) => {
      setClearingSample(false);
      toast.success('Sample data removed', [data.message]);
      void queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setClearingSample(false);
      toast.error(err.message);
    },
  });

  const checkIntegrity = useMutation({
    mutationFn: () => api.get<IntegrityResult>('/stock/integrity'),
    onSuccess: (data) => {
      setIntegrity(data);
      if (data.ok) toast.success(`All ${data.checked} batches reconcile with the stock history.`);
      else toast.error(`${data.discrepancies.length} batches do not match their history.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader title="Settings" subtitle="Alerts, backups and system information" />

      <div className="page-body">
        <div className="grid cols-2">
          <Card title="Pharmacy &amp; alerts">
            <div className="field">
              <label htmlFor="s-pharmacy">Pharmacy name</label>
              <input
                id="s-pharmacy"
                value={pharmacyName}
                onChange={(e) => setPharmacyName(e.target.value)}
                disabled={!canManage}
              />
              <div className="hint">Shown in the sidebar and at the top of every report.</div>
            </div>

            <div className="field">
              <label htmlFor="s-expiry">Warn about expiry this many days ahead</label>
              <div className="btn-row" style={{ marginBottom: 8 }}>
                {['30', '60', '90'].map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`btn small${expiryDays === days ? ' primary' : ''}`}
                    onClick={() => setExpiryDays(days)}
                    disabled={!canManage}
                  >
                    {days} days
                  </button>
                ))}
              </div>
              <input
                id="s-expiry"
                type="number"
                min={1}
                max={730}
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                disabled={!canManage}
              />
              <div className="hint">
                A batch turns 🟡 <strong>Expires soon</strong> once it is within this many days of its
                expiry date. Changing it updates every screen and report immediately.
              </div>
            </div>

            {canManage && (
              <button className="btn primary" type="button" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                {saveSettings.isPending ? 'Saving…' : 'Save settings'}
              </button>
            )}
            {!canManage && <p className="muted">Only the pharmacist can change these settings.</p>}
          </Card>

          <Card title="Check stock integrity">
            <p className="muted">
              Confirms that every batch quantity still equals the sum of its recorded movements —
              in other words, that <em>opening + received − dispensed − adjustments</em> really does
              add up to what the system shows.
            </p>

            <button className="btn" type="button" onClick={() => checkIntegrity.mutate()} disabled={checkIntegrity.isPending}>
              {checkIntegrity.isPending ? 'Checking…' : 'Run the check'}
            </button>

            {integrity && integrity.ok && (
              <div className="banner green" style={{ marginTop: 14, marginBottom: 0 }}>
                <span aria-hidden="true">✅</span>
                <div className="banner-body">
                  <strong>Everything reconciles</strong>
                  All {integrity.checked} batches match their stock history exactly.
                </div>
              </div>
            )}

            {integrity && !integrity.ok && (
              <div className="banner red" style={{ marginTop: 14, marginBottom: 0 }}>
                <span aria-hidden="true">⚠️</span>
                <div className="banner-body">
                  <strong>{integrity.discrepancies.length} batches do not match</strong>
                  {integrity.discrepancies.map((d) => (
                    <div key={d.batch_id}>
                      {d.drug_name} ({d.batch_number || 'no batch no.'}): shows {d.quantity_on_hand},
                      history says {d.ledger_balance}
                    </div>
                  ))}
                  Restore the most recent good backup, then tell whoever maintains the system.
                </div>
              </div>
            )}
          </Card>
        </div>

        {sample?.present && (
          <Card title="Sample data">
            <Banner tone="amber" icon="👋" title="Your inventory is currently example data">
              PharmaStock filled itself with a worked example on first start so you could see how it
              behaves. It is real, working data — you can dispense it, receive against it and run
              reports on it while you learn the system.
            </Banner>

            <p className="muted">
              Currently {sample.drugs} drugs, {sample.batches} batches, {sample.receipts} deliveries,{' '}
              {sample.dispenses} dispensing records and {sample.movements} stock movements.
            </p>

            {can(PERMISSIONS.INVENTORY_MANAGE) ? (
              <>
                <button className="btn danger" type="button" onClick={() => setClearingSample(true)}>
                  🧹 Remove all sample data
                </button>
                <div className="hint" style={{ marginTop: 6 }}>
                  Do this once, when you are ready to enter your real stock. Anything you have added
                  yourself is kept.
                </div>
              </>
            ) : (
              <p className="muted">Only the pharmacist can remove the sample data.</p>
            )}
          </Card>
        )}

        {canBackup && (
          <Card
            title="Backups"
            subtitle={settings?.last_backup_at ? `Last backup ${formatDateTime(settings.last_backup_at.replace('T', ' ').slice(0, 19))}` : 'No backup recorded yet'}
            action={
              <div className="btn-row">
                <button className="btn primary small" type="button" onClick={() => backupNow.mutate()} disabled={backupNow.isPending}>
                  {backupNow.isPending ? 'Backing up…' : '💾 Back up now'}
                </button>
                <button className="btn small" type="button" onClick={() => fileInput.current?.click()}>
                  ⬆ Restore from file
                </button>
              </div>
            }
          >
            <Banner tone="blue" icon="💡" title="How backups work here">
              The whole system is one file. A backup is taken automatically when PharmaStock starts
              and once a day after that, keeping the newest {settings?.backup_retention_count ?? 30}.
              To keep a copy off the laptop, download one below onto a USB stick.
            </Banner>

            <input
              ref={fileInput}
              type="file"
              accept=".db"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setRestoringUpload(file);
                e.target.value = '';
              }}
            />

            {backupsLoading && <Loading />}
            {backups?.items.length === 0 && <EmptyState icon="💾" title="No backups yet" message="Create the first one now." />}

            {backups && backups.items.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Backup file</th><th>Created</th><th className="num">Size</th><th /></tr>
                  </thead>
                  <tbody>
                    {backups.items.map((backup) => (
                      <tr key={backup.filename}>
                        <td className="mono">{backup.filename}</td>
                        <td className="muted nowrap">{new Date(backup.createdAt).toLocaleString()}</td>
                        <td className="num muted">{formatBytes(backup.size)}</td>
                        <td className="nowrap">
                          <button
                            className="btn small ghost"
                            type="button"
                            onClick={() => downloadFile(`/backups/${backup.filename}/download`)}
                          >
                            ⬇ Download
                          </button>
                          <button className="btn small ghost" type="button" onClick={() => setRestoring(backup)}>
                            Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        <Card title="System information">
          <div className="form-row">
            <div>
              <div className="label">Version</div>
              <div className="muted">PharmaStock {system?.version ?? '—'}</div>
            </div>
            <div>
              <div className="label">This laptop</div>
              <div className="mono muted">{system?.localUrl}</div>
            </div>
            <div>
              <div className="label">From another computer on the same network</div>
              {system?.networkUrls.length ? (
                system.networkUrls.map((url) => <div key={url} className="mono muted">{url}</div>)
              ) : (
                <div className="muted">Not connected to a network</div>
              )}
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <Link className="btn small" to="/change-password">Change my password</Link>
          </div>
        </Card>
      </div>

      {clearingSample && sample && (
        <ConfirmDialog
          title="Remove all sample data?"
          tone="danger"
          confirmLabel="Yes, remove the sample data"
          busy={clearSample.isPending}
          onCancel={() => setClearingSample(false)}
          onConfirm={() => clearSample.mutate()}
          message={
            <>
              <p>
                This permanently deletes the {sample.drugs} example drugs and everything recorded
                against them — {sample.batches} batches, {sample.receipts} deliveries,{' '}
                {sample.dispenses} dispensing records and {sample.movements} stock movements.
              </p>
              <p>
                Drugs, suppliers and stock <strong>you</strong> added are kept. It will not come back
                on the next restart.
              </p>
              <p className="muted">
                If you have recorded real stock against one of the example drugs, that stock goes
                too. In that case, edit the drug and keep it instead of removing everything.
              </p>
            </>
          }
        />
      )}

      {restoring && (
        <ConfirmDialog
          title="Restore this backup?"
          tone="danger"
          confirmLabel="Yes, replace the current data"
          busy={restore.isPending}
          onCancel={() => setRestoring(null)}
          onConfirm={() => restore.mutate(restoring.filename)}
          message={
            <p>
              The current database will be <strong>replaced</strong> by{' '}
              <span className="mono">{restoring.filename}</span>. Any stock recorded since that
              backup was taken will be lost. A safety copy of the current data is saved first, and
              PharmaStock must be restarted afterwards.
            </p>
          }
        />
      )}

      {restoringUpload && (
        <ConfirmDialog
          title="Restore from this file?"
          tone="danger"
          confirmLabel="Yes, replace the current data"
          busy={restoreUpload.isPending}
          onCancel={() => setRestoringUpload(null)}
          onConfirm={() => restoreUpload.mutate(restoringUpload)}
          message={
            <p>
              The current database will be <strong>replaced</strong> by{' '}
              <span className="mono">{restoringUpload.name}</span>. The file is checked first and
              rejected if it is not a PharmaStock backup. A safety copy of the current data is saved
              before anything is replaced, and PharmaStock must be restarted afterwards.
            </p>
          }
        />
      )}
    </>
  );
}
