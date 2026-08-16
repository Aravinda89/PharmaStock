import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { Batch, DispensePreviewLine, DrugStock } from '../lib/types';
import { Banner, Card, ConfirmDialog, Modal, PageHeader } from '../components/ui';
import { DrugPicker } from '../components/DrugPicker';
import { daysLabel, formatDate, formatNumber } from '../lib/format';

interface Line {
  key: number;
  drug: DrugStock | null;
  quantity: string;
  /** Set only when the user opens "Change batches" and picks manually. */
  allocation: { batchId: number; quantity: number }[] | null;
}

interface DispenseResult {
  dispenseNo: string;
  lines: {
    drugName: string;
    strength: string | null;
    unit: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    batches: { batchNumber: string; expiryDate: string; quantity: number }[];
  }[];
}

let nextKey = 1;
const emptyLine = (drug: DrugStock | null = null): Line => ({
  key: nextKey++,
  drug,
  quantity: '',
  allocation: null,
});

export function DispensePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const [patientRef, setPatientRef] = useState('');
  const [patientName, setPatientName] = useState('');
  const [prescriber, setPrescriber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [confirming, setConfirming] = useState(false);
  const [batchPickerFor, setBatchPickerFor] = useState<Line | null>(null);
  const [result, setResult] = useState<DispenseResult | null>(null);

  const preselectId = params.get('drugId');
  useEffect(() => {
    if (!preselectId) return;
    void api.get<{ drug: DrugStock }>(`/drugs/${preselectId}`).then((data) => {
      setLines([emptyLine(data.drug)]);
    });
  }, [preselectId]);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const addLine = () => setLines((current) => [...current, emptyLine()]);
  const removeLine = (key: number) =>
    setLines((current) => (current.length === 1 ? [emptyLine()] : current.filter((l) => l.key !== key)));

  const filled = useMemo(
    () => lines.filter((l) => l.drug && Number(l.quantity) > 0),
    [lines]
  );

  const previewPayload = useMemo(
    () => filled.map((l) => ({ drugId: l.drug!.drug_id, quantity: Number(l.quantity) })),
    [filled]
  );

  // Live "Current -> New" preview, and the FEFO batches that would be used.
  // Nothing here writes to the database.
  const { data: preview } = useQuery({
    queryKey: ['dispense-preview', JSON.stringify(previewPayload)],
    queryFn: () => api.post<{ ok: boolean; lines: DispensePreviewLine[] }>('/stock/dispenses/preview', { lines: previewPayload }),
    enabled: previewPayload.length > 0,
    staleTime: 0,
  });

  const previewFor = (drugId: number) => preview?.lines.find((l) => l.drugId === drugId);

  const blocked = preview ? !preview.ok : false;
  const totalUnits = filled.reduce((sum, l) => sum + Number(l.quantity), 0);

  const save = useMutation({
    mutationFn: () =>
      api.post<DispenseResult>('/stock/dispenses', {
        patientRef: patientRef || null,
        patientName: patientName || null,
        prescriber: prescriber || null,
        notes: notes || null,
        lines: filled.map((l) => ({
          drugId: l.drug!.drug_id,
          quantity: Number(l.quantity),
          ...(l.allocation ? { allocation: l.allocation } : {}),
        })),
      }),
    onSuccess: (data) => {
      setConfirming(false);
      setResult(data);
      toast.success(
        `Dispensed — ${data.dispenseNo}`,
        data.lines.map((l) => `${l.drugName}: ${formatNumber(l.stockBefore)} → ${formatNumber(l.stockAfter)} ${l.unit}`)
      );
      void queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setConfirming(false);
      toast.error(err.message);
    },
  });

  const startAnother = () => {
    setResult(null);
    setLines([emptyLine()]);
    setPatientRef('');
    setPatientName('');
    setPrescriber('');
    setNotes('');
  };

  if (result) {
    return (
      <>
        <PageHeader title="Dispensing recorded" subtitle={result.dispenseNo} />
        <div className="page-body" style={{ maxWidth: 820 }}>
          <Banner tone="green" icon="✅" title="Stock has been reduced">
            The available quantities below are up to date.
          </Banner>

          <Card title="What changed" tight>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Drug</th>
                    <th>Batches used</th>
                    <th className="num">Dispensed</th>
                    <th className="num">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((line, i) => (
                    <tr key={i}>
                      <td className="strong">{line.drugName} <span className="muted">{line.strength}</span></td>
                      <td>
                        {line.batches.map((b, j) => (
                          <div key={j} className="faint" style={{ fontSize: '0.82rem' }}>
                            <span className="mono">{b.batchNumber || '(none)'}</span> · exp {formatDate(b.expiryDate)} · {b.quantity}
                          </div>
                        ))}
                      </td>
                      <td className="num" style={{ color: 'var(--red)' }}>−{formatNumber(line.quantity)}</td>
                      <td className="num tabnum">
                        <span className="muted">{formatNumber(line.stockBefore)}</span>
                        <span className="arrow"> → </span>
                        <strong>{formatNumber(line.stockAfter)}</strong> {line.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button className="btn primary" type="button" onClick={startAnother}>Dispense to another patient</button>
            <button className="btn ghost" type="button" onClick={() => navigate('/')}>Back to dashboard</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dispense drugs"
        subtitle="Stock decreases automatically when you save. Batches are chosen earliest-expiry-first."
      />

      <div className="page-body">
        <Card title="Patient / reference">
          <div className="form-row">
            <div className="field">
              <label htmlFor="d-ref">Patient reference</label>
              <input id="d-ref" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} placeholder="OP-1125" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="d-name">Patient name</label>
              <input id="d-name" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="field">
              <label htmlFor="d-presc">Prescriber</label>
              <input id="d-presc" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </Card>

        <Card
          title="Drugs to dispense"
          action={<button className="btn small" type="button" onClick={addLine}>＋ Add line</button>}
        >
          <div className="table-wrap">
            <table className="line-grid">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>Drug *</th>
                  <th style={{ minWidth: 120 }}>Quantity *</th>
                  <th style={{ minWidth: 280 }}>Stock &amp; batches</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const linePreview = line.drug ? previewFor(line.drug.drug_id) : undefined;
                  return (
                    <tr key={line.key}>
                      <td>
                        <DrugPicker
                          value={line.drug}
                          onChange={(drug) => setLine(line.key, { drug, allocation: null })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) => setLine(line.key, { quantity: e.target.value, allocation: null })}
                          aria-label="Quantity to dispense"
                        />
                      </td>
                      <td>
                        {!line.drug && <span className="faint" style={{ fontSize: '0.85rem' }}>Choose a drug first</span>}

                        {line.drug && !line.quantity && (
                          <span className="muted" style={{ fontSize: '0.85rem' }}>
                            {formatNumber(line.drug.available_qty)} {line.drug.unit} available
                          </span>
                        )}

                        {line.drug && line.quantity && linePreview && (
                          <>
                            <div className={`stock-preview ${linePreview.ok ? 'good' : 'bad'}`}>
                              {linePreview.ok ? (
                                <>
                                  {formatNumber(linePreview.available)}
                                  <span className="arrow">→</span>
                                  <strong>{formatNumber(linePreview.availableAfter ?? 0)}</strong> {linePreview.unit}
                                </>
                              ) : (
                                <>⚠️ {linePreview.message}</>
                              )}
                            </div>

                            {linePreview.ok && (
                              <div style={{ marginTop: 5 }}>
                                {(line.allocation
                                  ? linePreview.allocation.filter((a) =>
                                      line.allocation!.some((m) => m.batchId === a.batchId))
                                  : linePreview.allocation
                                ).length > 0 && (
                                  <div className="faint" style={{ fontSize: '0.78rem' }}>
                                    {line.allocation ? 'Chosen batches:' : 'Will use (earliest expiry first):'}
                                  </div>
                                )}
                                {(line.allocation ?? linePreview.allocation).map((alloc) => {
                                  const detail = linePreview.allocation.find((a) => a.batchId === alloc.batchId);
                                  return (
                                    <div key={alloc.batchId} style={{ fontSize: '0.8rem' }}>
                                      <span className="mono">{detail?.batchNumber || '(no batch)'}</span>
                                      <span className="faint"> · exp {formatDate(detail?.expiryDate ?? '')} · </span>
                                      <strong>{alloc.quantity}</strong>
                                    </div>
                                  );
                                })}
                                <button
                                  className="btn small ghost"
                                  type="button"
                                  style={{ marginTop: 4 }}
                                  onClick={() => setBatchPickerFor(line)}
                                >
                                  Change batches
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <button
                          className="btn small ghost"
                          type="button"
                          onClick={() => removeLine(line.key)}
                          aria-label="Remove this line"
                          title="Remove this line"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="d-notes">Notes</label>
            <textarea id="d-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </Card>

        {blocked && (
          <Banner tone="red" icon="⛔" title="Not enough stock for this dispense">
            Reduce the highlighted quantities. Nothing will be saved until every line fits the
            available stock.
          </Banner>
        )}

        <div
          className="card"
          style={{ marginTop: 18, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
        >
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Ready to dispense</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 650 }}>
              {filled.length} drug{filled.length === 1 ? '' : 's'} · {formatNumber(totalUnits)} units
            </div>
          </div>
          <button
            className="btn primary big"
            type="button"
            disabled={filled.length === 0 || blocked || save.isPending}
            onClick={() => setConfirming(true)}
          >
            Dispense &amp; reduce stock
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Record this dispense?"
          confirmLabel="Yes, dispense"
          busy={save.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => save.mutate()}
          message={
            <p>
              Stock will be reduced immediately and recorded against{' '}
              <strong>{patientRef || patientName || 'no patient reference'}</strong>.
            </p>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Drug</th><th className="num">Quantity</th><th className="num">Stock after</th></tr>
              </thead>
              <tbody>
                {filled.map((line) => {
                  const p = previewFor(line.drug!.drug_id);
                  return (
                    <tr key={line.key}>
                      <td className="strong">{line.drug!.name} <span className="muted">{line.drug!.strength}</span></td>
                      <td className="num" style={{ color: 'var(--red)' }}>−{formatNumber(Number(line.quantity))}</td>
                      <td className="num tabnum">
                        <span className="muted">{formatNumber(p?.available ?? 0)}</span>
                        <span className="arrow"> → </span>
                        <strong>{formatNumber(p?.availableAfter ?? 0)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ConfirmDialog>
      )}

      {batchPickerFor && (
        <BatchPicker
          line={batchPickerFor}
          suggested={previewFor(batchPickerFor.drug!.drug_id)?.allocation ?? []}
          onClose={() => setBatchPickerFor(null)}
          onSave={(allocation) => {
            setLine(batchPickerFor.key, { allocation });
            setBatchPickerFor(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Manual batch override. Opens pre-filled with the FEFO suggestion so the
 * common case is "look, confirm, close" rather than re-entering everything.
 */
function BatchPicker({
  line,
  suggested,
  onClose,
  onSave,
}: {
  line: Line;
  suggested: { batchId: number; quantity: number }[];
  onClose: () => void;
  onSave: (allocation: { batchId: number; quantity: number }[]) => void;
}) {
  const required = Number(line.quantity);
  const [amounts, setAmounts] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const alloc of line.allocation ?? suggested) initial[alloc.batchId] = String(alloc.quantity);
    return initial;
  });

  const { data } = useQuery({
    queryKey: ['batches', line.drug?.drug_id],
    queryFn: () => api.get<{ items: Batch[] }>(`/stock/batches?drugId=${line.drug!.drug_id}`),
    enabled: Boolean(line.drug),
  });

  const batches = (data?.items ?? []).filter((b) => b.expiry_status !== 'EXPIRED');
  const allocated = Object.values(amounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const balanced = allocated === required;

  const overAllocated = batches.some((b) => (Number(amounts[b.id]) || 0) > b.quantity_on_hand);

  return (
    <Modal
      title={`Choose batches — ${line.drug?.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            type="button"
            disabled={!balanced || overAllocated}
            onClick={() =>
              onSave(
                Object.entries(amounts)
                  .filter(([, v]) => Number(v) > 0)
                  .map(([batchId, v]) => ({ batchId: Number(batchId), quantity: Number(v) }))
              )
            }
          >
            Use these batches
          </button>
        </>
      }
    >
      <p className="muted">
        The quantities below must add up to <strong>{required}</strong>. Batches are listed
        earliest expiry first — dispensing in this order is usually the right choice.
      </p>

      {batches.length === 0 && <p className="muted">No usable batches are in stock.</p>}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Expiry</th>
              <th className="num">On hand</th>
              <th style={{ width: 130 }}>Take</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const taking = Number(amounts[batch.id]) || 0;
              return (
                <tr key={batch.id}>
                  <td className="mono strong">{batch.batch_number || '(none)'}</td>
                  <td className="nowrap">
                    {formatDate(batch.expiry_date)}
                    <div className="faint" style={{ fontSize: '0.78rem' }}>{daysLabel(batch.days_to_expiry)}</div>
                  </td>
                  <td className="num tabnum">{formatNumber(batch.quantity_on_hand)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={batch.quantity_on_hand}
                      value={amounts[batch.id] ?? ''}
                      onChange={(e) => setAmounts((current) => ({ ...current, [batch.id]: e.target.value }))}
                      aria-label={`Quantity from batch ${batch.batch_number}`}
                    />
                    {taking > batch.quantity_on_hand && (
                      <div className="stock-preview bad">Only {batch.quantity_on_hand} in this batch</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`banner ${balanced && !overAllocated ? 'green' : 'amber'}`} style={{ marginTop: 16, marginBottom: 0 }}>
        <span aria-hidden="true">{balanced && !overAllocated ? '✅' : '⚠️'}</span>
        <div className="banner-body">
          Allocated <strong>{allocated}</strong> of <strong>{required}</strong>
          {!balanced && ` — ${Math.abs(required - allocated)} ${allocated > required ? 'too many' : 'still to allocate'}`}
        </div>
      </div>
    </Modal>
  );
}
