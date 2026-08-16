import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { DrugStock, Supplier } from '../lib/types';
import { Banner, Card, ConfirmDialog, PageHeader } from '../components/ui';
import { DrugPicker } from '../components/DrugPicker';
import { formatDate, formatNumber, todayIso } from '../lib/format';

interface Line {
  key: number;
  drug: DrugStock | null;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  unitCost: string;
}

interface ReceiveResult {
  receiptNo: string;
  lines: {
    drugName: string;
    strength: string | null;
    unit: string;
    quantity: number;
    batchNumber: string;
    expiryDate: string;
    batchPrevious: number;
    batchNow: number;
    drugAvailableNow: number;
  }[];
}

let nextKey = 1;
const emptyLine = (drug: DrugStock | null = null): Line => ({
  key: nextKey++,
  drug,
  batchNumber: '',
  expiryDate: '',
  quantity: '',
  unitCost: '',
});

export function ReceivePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ReceiveResult | null>(null);

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<{ items: Supplier[] }>('/suppliers'),
  });

  // Deep link from a drug page: /receive?drugId=12
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

  const filled = lines.filter((l) => l.drug && l.quantity && l.expiryDate);
  const totalUnits = filled.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const totalCost = filled.reduce(
    (sum, l) => sum + (Number(l.unitCost) || 0) * (Number(l.quantity) || 0),
    0
  );

  const incomplete = lines.filter(
    (l) => (l.drug || l.quantity || l.expiryDate || l.batchNumber) && !(l.drug && l.quantity && l.expiryDate)
  );

  const save = useMutation({
    mutationFn: () =>
      api.post<ReceiveResult>('/stock/receipts', {
        supplierId: supplierId || null,
        invoiceNo: invoiceNo || null,
        orderRef: orderRef || null,
        receivedDate,
        notes: notes || null,
        lines: filled.map((l) => ({
          drugId: l.drug!.drug_id,
          batchNumber: l.batchNumber,
          expiryDate: l.expiryDate,
          quantity: Number(l.quantity),
          unitCost: l.unitCost ? Number(l.unitCost) : null,
        })),
      }),
    onSuccess: (data) => {
      setConfirming(false);
      setResult(data);
      toast.success(
        `Delivery ${data.receiptNo} saved — stock increased.`,
        data.lines.map((l) => `${l.drugName}: ${formatNumber(l.batchPrevious)} → ${formatNumber(l.batchNow)} in batch`)
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
    setInvoiceNo('');
    setOrderRef('');
    setNotes('');
  };

  if (result) {
    return (
      <>
        <PageHeader title="Delivery saved" subtitle={`Receipt ${result.receiptNo}`} />
        <div className="page-body" style={{ maxWidth: 820 }}>
          <Banner tone="green" icon="✅" title="Stock has been increased">
            Every line below was added to the inventory and recorded in the stock history.
          </Banner>

          <Card title="What changed" tight>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Drug</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th className="num">Received</th>
                    <th className="num">Batch now</th>
                    <th className="num">Total available</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((line, i) => (
                    <tr key={i}>
                      <td className="strong">{line.drugName} <span className="muted">{line.strength}</span></td>
                      <td className="mono">{line.batchNumber || '—'}</td>
                      <td className="nowrap">{formatDate(line.expiryDate)}</td>
                      <td className="num" style={{ color: 'var(--green)' }}>+{formatNumber(line.quantity)}</td>
                      <td className="num tabnum">
                        <span className="muted">{formatNumber(line.batchPrevious)}</span>
                        <span className="arrow"> → </span>
                        <strong>{formatNumber(line.batchNow)}</strong>
                      </td>
                      <td className="num strong tabnum">{formatNumber(line.drugAvailableNow)} {line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button className="btn primary" type="button" onClick={startAnother}>Record another delivery</button>
            <button className="btn" type="button" onClick={() => navigate('/inventory')}>Go to inventory</button>
            <button className="btn ghost" type="button" onClick={() => navigate('/')}>Back to dashboard</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Receive stock"
        subtitle="Record a delivery — stock increases automatically when you save"
      />

      <div className="page-body">
        <Card title="Delivery details">
          <div className="form-row">
            <div className="field">
              <label htmlFor="r-supplier">Supplier</label>
              <select id="r-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Not recorded</option>
                {suppliers?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-invoice">Invoice number</label>
              <input id="r-invoice" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-8841" />
            </div>
            <div className="field">
              <label htmlFor="r-order">Order reference</label>
              <input id="r-order" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="PO-2026-014" />
            </div>
            <div className="field">
              <label htmlFor="r-date">Date received *</label>
              <input id="r-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} required />
            </div>
          </div>
        </Card>

        <Card
          title="Drugs received"
          subtitle="a different expiry date is always kept as a separate batch"
          action={<button className="btn small" type="button" onClick={addLine}>＋ Add line</button>}
        >
          <div className="table-wrap">
            <table className="line-grid">
              <thead>
                <tr>
                  <th style={{ minWidth: 240 }}>Drug *</th>
                  <th style={{ minWidth: 130 }}>Batch number</th>
                  <th style={{ minWidth: 150 }}>Expiry date *</th>
                  <th style={{ minWidth: 100 }}>Quantity *</th>
                  <th style={{ minWidth: 100 }}>Unit cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <DrugPicker value={line.drug} onChange={(drug) => setLine(line.key, { drug })} />
                    </td>
                    <td>
                      <input
                        value={line.batchNumber}
                        onChange={(e) => setLine(line.key, { batchNumber: e.target.value })}
                        placeholder="Optional"
                        aria-label="Batch number"
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={line.expiryDate}
                        onChange={(e) => setLine(line.key, { expiryDate: e.target.value })}
                        aria-label="Expiry date"
                      />
                      {line.expiryDate && line.expiryDate < todayIso() && (
                        <div className="stock-preview bad">⚠️ This date has already passed</div>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        aria-label="Quantity received"
                      />
                      {line.drug && line.quantity && (
                        <div className="stock-preview good">
                          {formatNumber(line.drug.available_qty)}
                          <span className="arrow">→</span>
                          <strong>{formatNumber(line.drug.available_qty + (Number(line.quantity) || 0))}</strong>
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitCost}
                        onChange={(e) => setLine(line.key, { unitCost: e.target.value })}
                        aria-label="Unit cost"
                      />
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
                ))}
              </tbody>
            </table>
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="r-notes">Notes</label>
            <textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this delivery" />
          </div>
        </Card>

        {incomplete.length > 0 && (
          <Banner tone="amber" icon="⚠️" title="Some lines are incomplete">
            {incomplete.length} line{incomplete.length === 1 ? '' : 's'} still need a drug, quantity and expiry
            date. Incomplete lines are ignored when you save.
          </Banner>
        )}

        <div
          className="card"
          style={{ marginTop: 18, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
        >
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Ready to save</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 650 }}>
              {filled.length} line{filled.length === 1 ? '' : 's'} · {formatNumber(totalUnits)} units
              {totalCost > 0 && <span className="muted" style={{ fontWeight: 400 }}> · cost {totalCost.toFixed(2)}</span>}
            </div>
          </div>
          <button
            className="btn primary big"
            type="button"
            disabled={filled.length === 0 || save.isPending}
            onClick={() => setConfirming(true)}
          >
            Save delivery &amp; increase stock
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Save this delivery?"
          confirmLabel="Yes, save and increase stock"
          busy={save.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => save.mutate()}
          message={
            <p>
              {filled.length} line{filled.length === 1 ? '' : 's'} totalling{' '}
              <strong>{formatNumber(totalUnits)} units</strong> will be added to the inventory
              and recorded in the stock history.
            </p>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Drug</th><th>Batch</th><th>Expiry</th><th className="num">Quantity</th></tr>
              </thead>
              <tbody>
                {filled.map((line) => (
                  <tr key={line.key}>
                    <td className="strong">{line.drug!.name} <span className="muted">{line.drug!.strength}</span></td>
                    <td className="mono">{line.batchNumber || '—'}</td>
                    <td className="nowrap">{formatDate(line.expiryDate)}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>+{formatNumber(Number(line.quantity))}</td>
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
