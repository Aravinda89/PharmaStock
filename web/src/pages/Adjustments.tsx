import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { AlertBatch, Batch, DrugStock } from '../lib/types';
import { Banner, Card, ConfirmDialog, EmptyState, Loading, PageHeader } from '../components/ui';
import { DrugPicker } from '../components/DrugPicker';
import { ADJUSTMENT_REASONS, formatDate, formatDateTime, formatNumber, reasonLabel } from '../lib/format';

interface AdjustmentRow {
  id: number;
  adjustment_no: string;
  created_at: string;
  drug_name: string;
  strength: string | null;
  unit: string;
  batch_number: string;
  expiry_date: string;
  quantity_delta: number;
  reason: string;
  notes: string | null;
  user_name: string | null;
}

export function AdjustmentsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [drug, setDrug] = useState<DrugStock | null>(null);
  const [batchId, setBatchId] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('COUNT_CORRECTION');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmWriteOff, setConfirmWriteOff] = useState(false);

  const { data: batches } = useQuery({
    queryKey: ['batches', drug?.drug_id, 'all'],
    queryFn: () => api.get<{ items: Batch[] }>(`/stock/batches?drugId=${drug!.drug_id}&includeEmpty=true`),
    enabled: Boolean(drug),
  });

  const { data: expired } = useQuery({
    queryKey: ['alerts', 'expired-only'],
    queryFn: () => api.get<{ expired: AlertBatch[] }>('/alerts'),
  });

  const { data: history, isLoading } = useQuery({
    queryKey: ['adjustments'],
    queryFn: () => api.get<{ items: AdjustmentRow[] }>('/stock/adjustments?limit=50'),
  });

  const selectedBatch = batches?.items.find((b) => String(b.id) === batchId);
  const delta = (direction === 'out' ? -1 : 1) * (Number(quantity) || 0);
  const resultingQty = (selectedBatch?.quantity_on_hand ?? 0) + delta;
  const wouldGoNegative = Boolean(selectedBatch) && resultingQty < 0;

  const reset = () => {
    setDrug(null);
    setBatchId('');
    setQuantity('');
    setNotes('');
    setDirection('out');
    setReason('COUNT_CORRECTION');
  };

  const adjust = useMutation({
    mutationFn: () =>
      api.post<{ adjustmentNo: string; previous: number; balanceAfter: number }>('/stock/adjustments', {
        batchId: Number(batchId),
        quantityDelta: delta,
        reason,
        notes: notes || null,
      }),
    onSuccess: (data) => {
      setConfirming(false);
      toast.success(`Adjustment ${data.adjustmentNo} recorded.`, [
        `Batch stock: ${formatNumber(data.previous)} → ${formatNumber(data.balanceAfter)}`,
      ]);
      reset();
      void queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setConfirming(false);
      toast.error(err.message);
    },
  });

  const writeOff = useMutation({
    mutationFn: () => api.post<{ count: number; totalQuantity: number }>('/stock/adjustments/write-off-expired', { notes: null }),
    onSuccess: (data) => {
      setConfirmWriteOff(false);
      if (data.count === 0) {
        toast.warning('There was no expired stock to write off.');
      } else {
        toast.success(
          `Wrote off ${data.count} expired batch${data.count === 1 ? '' : 'es'}.`,
          [`${formatNumber(data.totalQuantity)} units removed from stock`]
        );
      }
      void queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setConfirmWriteOff(false);
      toast.error(err.message);
    },
  });

  const expiredCount = expired?.expired.length ?? 0;
  const expiredUnits = expired?.expired.reduce((sum, b) => sum + b.quantity_on_hand, 0) ?? 0;

  const canSubmit = Boolean(batchId) && Number(quantity) > 0 && !wouldGoNegative;

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        subtitle="Correct a count, record damage, or write off expired stock — every change is logged with a reason"
      />

      <div className="page-body">
        <Banner tone="blue" icon="ℹ️" title="Adjustments never rewrite history">
          A mistake is corrected by recording an offsetting adjustment, not by editing the original
          entry. The stock history stays a true record of what happened.
        </Banner>

        {expiredCount > 0 && (
          <Banner
            tone="amber"
            icon="🗑️"
            title={`${expiredCount} expired batch${expiredCount === 1 ? '' : 'es'} still counted on the shelf`}
            action={
              <button className="btn small primary" type="button" onClick={() => setConfirmWriteOff(true)}>
                Write off all expired
              </button>
            }
          >
            {formatNumber(expiredUnits)} units have passed their expiry date. Writing them off removes
            them from stock and records the disposal.
          </Banner>
        )}

        <Card title="Record an adjustment">
          <div className="form-row">
            <div className="field">
              <label>Drug *</label>
              <DrugPicker
                value={drug}
                onChange={(next) => { setDrug(next); setBatchId(''); }}
                placeholder="Search for the drug…"
              />
            </div>

            <div className="field">
              <label htmlFor="a-batch">Batch *</label>
              <select
                id="a-batch"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                disabled={!drug}
              >
                <option value="">{drug ? 'Choose a batch' : 'Choose a drug first'}</option>
                {batches?.items.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batch_number || '(no batch no.)'} · exp {batch.expiry_date} · {batch.quantity_on_hand} on hand
                    {batch.expiry_status === 'EXPIRED' ? ' · EXPIRED' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="a-dir">Direction</label>
              <select id="a-dir" value={direction} onChange={(e) => setDirection(e.target.value as 'out' | 'in')}>
                <option value="out">Decrease stock (−)</option>
                <option value="in">Increase stock (+)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="a-qty">Quantity *</label>
              <input
                id="a-qty"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="a-reason">Reason *</label>
              <select id="a-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {selectedBatch && Number(quantity) > 0 && (
            <div className={`stock-preview ${wouldGoNegative ? 'bad' : 'good'}`} style={{ marginBottom: 14 }}>
              {wouldGoNegative ? (
                <>⚠️ This batch only has {formatNumber(selectedBatch.quantity_on_hand)} — stock cannot go below zero.</>
              ) : (
                <>
                  Batch {selectedBatch.batch_number || '(no batch no.)'}:{' '}
                  {formatNumber(selectedBatch.quantity_on_hand)}
                  <span className="arrow">→</span>
                  <strong>{formatNumber(resultingQty)}</strong>
                </>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="a-notes">Notes</label>
            <textarea
              id="a-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened? This is kept permanently in the stock history."
            />
          </div>

          <div className="btn-row">
            <button className="btn primary" type="button" disabled={!canSubmit} onClick={() => setConfirming(true)}>
              Record adjustment
            </button>
            <button className="btn ghost" type="button" onClick={reset}>Clear</button>
          </div>
        </Card>

        <Card title="Recent adjustments" subtitle="last 50" tight>
          {isLoading && <Loading />}
          {history && history.items.length === 0 && (
            <EmptyState icon="⚖️" title="No adjustments recorded" message="Corrections and write-offs will appear here." />
          )}
          {history && history.items.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>When</th>
                    <th>Drug</th>
                    <th>Batch</th>
                    <th className="num">Change</th>
                    <th>Reason</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((row) => (
                    <tr key={row.id}>
                      <td className="mono strong">{row.adjustment_no}</td>
                      <td className="nowrap muted">{formatDateTime(row.created_at)}</td>
                      <td className="strong">{row.drug_name} <span className="muted">{row.strength}</span></td>
                      <td className="mono muted">
                        {row.batch_number || '—'}
                        <div className="faint" style={{ fontSize: '0.76rem' }}>exp {formatDate(row.expiry_date)}</div>
                      </td>
                      <td className={`num tabnum timeline-delta ${row.quantity_delta > 0 ? 'in' : 'out'}`}>
                        {row.quantity_delta > 0 ? '+' : '−'}{formatNumber(Math.abs(row.quantity_delta))}
                      </td>
                      <td>
                        {reasonLabel(row.reason)}
                        {row.notes && <div className="faint" style={{ fontSize: '0.78rem' }}>{row.notes}</div>}
                      </td>
                      <td className="muted nowrap">{row.user_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {confirming && selectedBatch && (
        <ConfirmDialog
          title="Record this adjustment?"
          confirmLabel="Yes, record it"
          tone={direction === 'out' ? 'danger' : 'primary'}
          busy={adjust.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => adjust.mutate()}
          message={
            <p>
              <strong>{drug?.name} {drug?.strength}</strong>, batch{' '}
              <span className="mono">{selectedBatch.batch_number || '(no batch no.)'}</span> will change from{' '}
              <strong>{formatNumber(selectedBatch.quantity_on_hand)}</strong> to{' '}
              <strong>{formatNumber(resultingQty)}</strong>, recorded as “{reasonLabel(reason)}”.
            </p>
          }
        />
      )}

      {confirmWriteOff && (
        <ConfirmDialog
          title="Write off all expired stock?"
          confirmLabel={`Yes, write off ${expiredCount} batch${expiredCount === 1 ? '' : 'es'}`}
          tone="danger"
          busy={writeOff.isPending}
          onCancel={() => setConfirmWriteOff(false)}
          onConfirm={() => writeOff.mutate()}
          message={
            <p>
              {formatNumber(expiredUnits)} units across {expiredCount} batch
              {expiredCount === 1 ? '' : 'es'} will be removed from stock. Each batch gets its own
              disposal record, so the write-off is fully traceable. This cannot be undone — but it
              can be reversed with a new adjustment if needed.
            </p>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Drug</th><th>Batch</th><th>Expired</th><th className="num">Quantity</th></tr></thead>
              <tbody>
                {expired?.expired.map((batch) => (
                  <tr key={batch.batch_id}>
                    <td className="strong">{batch.drug_name}</td>
                    <td className="mono">{batch.batch_number || '—'}</td>
                    <td className="nowrap">{formatDate(batch.expiry_date)}</td>
                    <td className="num">{formatNumber(batch.quantity_on_hand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
