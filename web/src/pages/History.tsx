import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { RecentDispense, RecentReceipt } from '../lib/types';
import { Card, EmptyState, Loading, Modal, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, formatMoney, formatNumber, isoDaysAgo, todayIso } from '../lib/format';

interface ReceiptDetail {
  receipt_no: string;
  received_date: string;
  supplier_name: string | null;
  invoice_no: string | null;
  order_ref: string | null;
  received_by: string | null;
  notes: string | null;
  lines: {
    id: number;
    drug_name: string;
    strength: string | null;
    unit: string;
    batch_number: string;
    expiry_date: string;
    quantity: number;
    unit_cost: number | null;
  }[];
}

interface DispenseDetail {
  dispense_no: string;
  dispensed_at: string;
  patient_ref: string | null;
  patient_name: string | null;
  prescriber: string | null;
  notes: string | null;
  dispensed_by: string | null;
  lines: {
    id: number;
    drug_name: string;
    strength: string | null;
    unit: string;
    batch_number: string;
    expiry_date: string;
    quantity: number;
  }[];
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'dispensed' | 'received'>('dispensed');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [openReceipt, setOpenReceipt] = useState<number | null>(null);
  const [openDispense, setOpenDispense] = useState<number | null>(null);

  const dispenses = useQuery({
    queryKey: ['dispenses', from, to],
    queryFn: () => api.get<{ items: RecentDispense[] }>(`/stock/dispenses${qs({ from, to, limit: 300 })}`),
    enabled: tab === 'dispensed',
  });

  const receipts = useQuery({
    queryKey: ['receipts', from, to],
    queryFn: () => api.get<{ items: RecentReceipt[] }>(`/stock/receipts${qs({ from, to, limit: 300 })}`),
    enabled: tab === 'received',
  });

  const receiptDetail = useQuery({
    queryKey: ['receipt', openReceipt],
    queryFn: () => api.get<ReceiptDetail>(`/stock/receipts/${openReceipt}`),
    enabled: openReceipt !== null,
  });

  const dispenseDetail = useQuery({
    queryKey: ['dispense', openDispense],
    queryFn: () => api.get<DispenseDetail>(`/stock/dispenses/${openDispense}`),
    enabled: openDispense !== null,
  });

  return (
    <>
      <PageHeader title="History" subtitle="Everything received and dispensed" />

      <div className="page-body">
        <Card>
          <div className="filters">
            <div>
              <label className="label" htmlFor="h-from">From</label>
              <input id="h-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="h-to">To</label>
              <input id="h-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="btn-row">
              <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(7)); setTo(todayIso()); }}>Last 7 days</button>
              <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(30)); setTo(todayIso()); }}>Last 30 days</button>
              <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(365)); setTo(todayIso()); }}>Last year</button>
            </div>
          </div>
        </Card>

        <div className="tabs" style={{ marginTop: 18 }}>
          <button className={`tab${tab === 'dispensed' ? ' active' : ''}`} type="button" onClick={() => setTab('dispensed')}>
            💊 Dispensed
          </button>
          <button className={`tab${tab === 'received' ? ' active' : ''}`} type="button" onClick={() => setTab('received')}>
            📦 Received
          </button>
        </div>

        {tab === 'dispensed' && (
          <Card title="Dispensing records" subtitle={`${dispenses.data?.items.length ?? 0} records`} tight>
            {dispenses.isLoading && <Loading />}
            {dispenses.data?.items.length === 0 && (
              <EmptyState icon="💊" title="Nothing dispensed in this period" message="Try widening the date range." />
            )}
            {dispenses.data && dispenses.data.items.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>When</th>
                      <th>Patient</th>
                      <th>Drugs</th>
                      <th className="num">Units</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispenses.data.items.map((row) => (
                      <tr key={row.id} className="row-link" onClick={() => setOpenDispense(row.id)}>
                        <td className="mono strong">{row.dispense_no}</td>
                        <td className="nowrap muted">{formatDateTime(row.dispensed_at)}</td>
                        <td>
                          {row.patient_ref ?? '—'}
                          {row.patient_name && <div className="faint" style={{ fontSize: '0.78rem' }}>{row.patient_name}</div>}
                        </td>
                        <td style={{ maxWidth: 300 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.drug_names ?? '—'}
                          </div>
                        </td>
                        <td className="num" style={{ color: 'var(--red)' }}>−{formatNumber(row.total_quantity ?? 0)}</td>
                        <td className="muted nowrap">{row.dispensed_by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {tab === 'received' && (
          <Card title="Deliveries" subtitle={`${receipts.data?.items.length ?? 0} records`} tight>
            {receipts.isLoading && <Loading />}
            {receipts.data?.items.length === 0 && (
              <EmptyState icon="📦" title="No deliveries in this period" message="Try widening the date range." />
            )}
            {receipts.data && receipts.data.items.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th>Drugs</th>
                      <th className="num">Units</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.data.items.map((row) => (
                      <tr key={row.id} className="row-link" onClick={() => setOpenReceipt(row.id)}>
                        <td className="mono strong">{row.receipt_no}</td>
                        <td className="nowrap muted">{formatDate(row.received_date)}</td>
                        <td>{row.supplier_name ?? '—'}</td>
                        <td style={{ maxWidth: 300 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.drug_names ?? '—'}
                          </div>
                        </td>
                        <td className="num" style={{ color: 'var(--green)' }}>+{formatNumber(row.total_quantity ?? 0)}</td>
                        <td className="muted nowrap">{row.received_by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {openReceipt !== null && (
        <Modal title={receiptDetail.data?.receipt_no ?? 'Delivery'} onClose={() => setOpenReceipt(null)} wide>
          {receiptDetail.isLoading && <Loading />}
          {receiptDetail.data && (
            <>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <div><div className="label">Supplier</div>{receiptDetail.data.supplier_name ?? '—'}</div>
                <div><div className="label">Invoice</div>{receiptDetail.data.invoice_no ?? '—'}</div>
                <div><div className="label">Date</div>{formatDate(receiptDetail.data.received_date)}</div>
                <div><div className="label">Received by</div>{receiptDetail.data.received_by ?? '—'}</div>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Drug</th><th>Batch</th><th>Expiry</th><th className="num">Quantity</th><th className="num">Unit cost</th></tr>
                  </thead>
                  <tbody>
                    {receiptDetail.data.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="strong">{line.drug_name} <span className="muted">{line.strength}</span></td>
                        <td className="mono">{line.batch_number || '—'}</td>
                        <td className="nowrap">{formatDate(line.expiry_date)}</td>
                        <td className="num">{formatNumber(line.quantity)} {line.unit}</td>
                        <td className="num muted">{formatMoney(line.unit_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {receiptDetail.data.notes && <p className="muted" style={{ marginTop: 14 }}>{receiptDetail.data.notes}</p>}
            </>
          )}
        </Modal>
      )}

      {openDispense !== null && (
        <Modal title={dispenseDetail.data?.dispense_no ?? 'Dispense'} onClose={() => setOpenDispense(null)} wide>
          {dispenseDetail.isLoading && <Loading />}
          {dispenseDetail.data && (
            <>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <div><div className="label">Patient reference</div>{dispenseDetail.data.patient_ref ?? '—'}</div>
                <div><div className="label">Patient</div>{dispenseDetail.data.patient_name ?? '—'}</div>
                <div><div className="label">When</div>{formatDateTime(dispenseDetail.data.dispensed_at)}</div>
                <div><div className="label">Dispensed by</div>{dispenseDetail.data.dispensed_by ?? '—'}</div>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Drug</th><th>Batch</th><th>Expiry</th><th className="num">Quantity</th></tr>
                  </thead>
                  <tbody>
                    {dispenseDetail.data.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="strong">{line.drug_name} <span className="muted">{line.strength}</span></td>
                        <td className="mono">{line.batch_number || '—'}</td>
                        <td className="nowrap">{formatDate(line.expiry_date)}</td>
                        <td className="num">{formatNumber(line.quantity)} {line.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dispenseDetail.data.notes && <p className="muted" style={{ marginTop: 14 }}>{dispenseDetail.data.notes}</p>}
              <div className="btn-row" style={{ marginTop: 16 }}>
                <button className="btn small" type="button" onClick={() => { setOpenDispense(null); navigate('/inventory'); }}>
                  Go to inventory
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
