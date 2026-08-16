import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { Batch, DrugStock, LedgerEntry, Supplier } from '../lib/types';
import {
  Banner, Card, EmptyState, ErrorBanner, ExpiryChip, Loading, Modal, PageHeader, StockChip,
} from '../components/ui';
import {
  MOVEMENT_LABELS, daysLabel, formLabel, formatDate, formatDateTime, formatMoney, formatNumber,
} from '../lib/format';
import { DrugForm } from './DrugForm';

interface DrugDetailResponse {
  drug: DrugStock;
  batches: Batch[];
  ledger: LedgerEntry[];
}

export function DrugDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showEmptyBatches, setShowEmptyBatches] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['drug', id, showEmptyBatches],
    queryFn: () => api.get<DrugDetailResponse>(`/drugs/${id}?includeEmpty=${showEmptyBatches}`),
    enabled: Boolean(id),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<{ items: Supplier[] }>('/suppliers'),
  });

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.put<DrugStock>(`/drugs/${id}`, values),
    onSuccess: (drug) => {
      toast.success(`${drug.name} updated.`);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['drug', id] });
      void queryClient.invalidateQueries({ queryKey: ['drugs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <><PageHeader title="Loading…" /><div className="page-body"><Loading /></div></>;
  if (error) return <><PageHeader title="Drug" /><div className="page-body"><ErrorBanner error={error} onRetry={() => void refetch()} /></div></>;
  if (!data) return null;

  const { drug, batches, ledger } = data;

  return (
    <>
      <PageHeader
        title={<>{drug.name} <span className="muted" style={{ fontWeight: 500 }}>{drug.strength}</span></>}
        subtitle={
          <>
            {formLabel(drug.form)} · counted in {drug.unit}
            {drug.code && <> · <span className="mono">{drug.code}</span></>}
            {drug.generic_name && <> · {drug.generic_name}</>}
          </>
        }
        actions={
          <>
            <button className="btn ghost" type="button" onClick={() => navigate('/inventory')}>← Inventory</button>
            {can(PERMISSIONS.STOCK_DISPENSE) && (
              <Link className="btn" to={`/dispense?drugId=${drug.drug_id}`}>📤 Dispense</Link>
            )}
            {can(PERMISSIONS.STOCK_RECEIVE) && (
              <Link className="btn" to={`/receive?drugId=${drug.drug_id}`}>📦 Receive</Link>
            )}
            {can(PERMISSIONS.INVENTORY_MANAGE) && (
              <button className="btn primary" type="button" onClick={() => setEditing(true)}>Edit</button>
            )}
          </>
        }
      />

      <div className="page-body">
        {drug.stock_status === 'OUT_OF_STOCK' && (
          <Banner tone="red" icon="🔴" title="Out of stock">
            {drug.expired_qty > 0
              ? `The only remaining stock (${formatNumber(drug.expired_qty)} ${drug.unit}) has expired and cannot be dispensed.`
              : 'There is nothing available to dispense.'}
          </Banner>
        )}
        {drug.stock_status === 'LOW' && (
          <Banner tone="amber" icon="🟡" title="Low stock — order soon">
            {formatNumber(drug.available_qty)} {drug.unit} available, minimum level is {formatNumber(drug.min_stock_level)}.
          </Banner>
        )}
        {drug.expired_qty > 0 && drug.available_qty > 0 && (
          <Banner tone="amber" icon="🗑️" title="Expired stock present">
            {formatNumber(drug.expired_qty)} {drug.unit} have expired. They are excluded from the available
            figure and cannot be dispensed.
          </Banner>
        )}

        <div className="grid cols-4" style={{ marginBottom: 18 }}>
          <div className="kpi tone-neutral">
            <div className="kpi-label">Available now</div>
            <div className="kpi-value">{formatNumber(drug.available_qty)}</div>
            <div className="kpi-hint">{drug.unit} ready to dispense</div>
          </div>
          <div className="kpi tone-neutral">
            <div className="kpi-label">Minimum level</div>
            <div className="kpi-value">{formatNumber(drug.min_stock_level)}</div>
            <div className="kpi-hint"><StockChip status={drug.stock_status} /></div>
          </div>
          <div className="kpi tone-neutral">
            <div className="kpi-label">Next expiry</div>
            <div className="kpi-value" style={{ fontSize: '1.35rem', paddingTop: 8 }}>
              {formatDate(drug.earliest_expiry)}
            </div>
            <div className="kpi-hint"><ExpiryChip status={drug.expiry_status} /></div>
          </div>
          <div className="kpi tone-neutral">
            <div className="kpi-label">Batches in stock</div>
            <div className="kpi-value">{drug.batch_count}</div>
            <div className="kpi-hint">
              {drug.expired_qty > 0 ? `${formatNumber(drug.expired_qty)} expired units` : 'all in date'}
            </div>
          </div>
        </div>

        <Card
          title="Batches"
          subtitle="earliest expiry first — the order they will be dispensed"
          action={
            <label className="checkbox" style={{ fontSize: '0.84rem' }}>
              <input
                type="checkbox"
                checked={showEmptyBatches}
                onChange={(e) => setShowEmptyBatches(e.target.checked)}
              />
              Show used-up batches
            </label>
          }
          tight
        >
          {batches.length === 0 ? (
            <EmptyState icon="📦" title="No batches in stock" message="Record a delivery to add stock." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Batch number</th>
                    <th>Expiry date</th>
                    <th>Status</th>
                    <th className="num">On hand</th>
                    <th>Supplier</th>
                    <th>Location</th>
                    <th className="num">Unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id} style={{ opacity: batch.quantity_on_hand === 0 ? 0.55 : 1 }}>
                      <td className="mono strong">{batch.batch_number || <span className="faint">(none)</span>}</td>
                      <td className="nowrap">
                        {formatDate(batch.expiry_date)}
                        <div className="faint" style={{ fontSize: '0.78rem' }}>{daysLabel(batch.days_to_expiry)}</div>
                      </td>
                      <td><ExpiryChip status={batch.expiry_status} days={batch.days_to_expiry >= 0 ? batch.days_to_expiry : undefined} /></td>
                      <td className="num strong tabnum">{formatNumber(batch.quantity_on_hand)}</td>
                      <td className="muted">{batch.supplier_name ?? '—'}</td>
                      <td className="muted">{batch.storage_location ?? '—'}</td>
                      <td className="num muted tabnum">{formatMoney(batch.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Stock movement history"
          subtitle="every change, newest first — this is why the quantity is what it is"
          tight
        >
          {ledger.length === 0 ? (
            <EmptyState icon="🕑" title="No movements recorded yet" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Movement</th>
                    <th>Batch</th>
                    <th className="num">Change</th>
                    <th className="num">Batch balance</th>
                    <th>Reason</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap muted">{formatDateTime(entry.occurred_at)}</td>
                      <td className="strong">{MOVEMENT_LABELS[entry.change_type] ?? entry.change_type}</td>
                      <td className="mono muted">{entry.batch_number || '—'}</td>
                      <td className={`num tabnum timeline-delta ${entry.quantity_delta > 0 ? 'in' : 'out'}`}>
                        {entry.quantity_delta > 0 ? '+' : '−'}{formatNumber(Math.abs(entry.quantity_delta))}
                      </td>
                      <td className="num tabnum">{formatNumber(entry.balance_after)}</td>
                      <td className="muted" style={{ maxWidth: 260 }}>{entry.reason ?? '—'}</td>
                      <td className="muted nowrap">{entry.user_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {drug.notes && (
          <Card title="Notes">
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{drug.notes}</p>
          </Card>
        )}
      </div>

      {editing && (
        <Modal title={`Edit ${drug.name}`} onClose={() => setEditing(false)}>
          <DrugForm
            drug={drug}
            suppliers={suppliers?.items ?? []}
            busy={save.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={(values) => save.mutate(values)}
          />
        </Modal>
      )}
    </>
  );
}
