import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import type { Dashboard } from '../lib/types';
import {
  Card, EmptyState, ErrorBanner, KpiTile, Loading, PageHeader,
} from '../components/ui';
import { formatDate, formatDateTime, formatNumber, daysLabel, pluralUnit } from '../lib/format';

export function DashboardPage() {
  const { can, settings, user } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/dashboard?limit=8'),
    refetchInterval: 120_000,
  });

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${greeting}, ${user?.fullName.split(' ')[0]} · ${settings?.pharmacy_name ?? ''}`}
        actions={
          <>
            {can(PERMISSIONS.STOCK_DISPENSE) && (
              <Link className="btn primary" to="/dispense">📤 Dispense</Link>
            )}
            {can(PERMISSIONS.STOCK_RECEIVE) && (
              <Link className="btn" to="/receive">📦 Receive stock</Link>
            )}
            <Link className="btn" to="/inventory">🔍 Search inventory</Link>
          </>
        }
      />

      <div className="page-body">
        {error && <ErrorBanner error={error} onRetry={() => void refetch()} />}
        {isLoading && <Loading label="Loading today's figures…" />}

        {data && (
          <>
            <div className="grid cols-4" style={{ marginBottom: 20 }}>
              <KpiTile
                label="Total drugs"
                value={formatNumber(data.summary.total_drugs)}
                hint={`${formatNumber(data.summary.total_units)} units in stock`}
                tone="neutral"
                onClick={() => navigate('/inventory')}
              />
              <KpiTile
                label="Low stock"
                value={formatNumber(data.summary.low_stock)}
                hint={
                  data.summary.out_of_stock > 0
                    ? `${data.summary.out_of_stock} completely out`
                    : 'need reordering'
                }
                tone={data.summary.low_stock > 0 ? 'amber' : 'green'}
                onClick={() => navigate('/alerts?tab=low')}
              />
              <KpiTile
                label="Expiring soon"
                value={formatNumber(data.summary.expiring_soon)}
                hint={`within ${data.summary.expiry_alert_days} days`}
                tone={data.summary.expiring_soon > 0 ? 'amber' : 'green'}
                onClick={() => navigate('/alerts?tab=soon')}
              />
              <KpiTile
                label="Expired"
                value={formatNumber(data.summary.expired)}
                hint={
                  data.summary.expired > 0
                    ? `${formatNumber(data.summary.expired_units)} units to remove`
                    : 'nothing expired'
                }
                tone={data.summary.expired > 0 ? 'red' : 'green'}
                onClick={() => navigate('/alerts?tab=expired')}
              />
            </div>

            {(data.summary.dispenses_today > 0 || data.summary.receipts_today > 0) && (
              <div className="banner blue" style={{ marginBottom: 20 }}>
                <span aria-hidden="true">📅</span>
                <div className="banner-body">
                  <strong>Today so far</strong>
                  {data.summary.dispenses_today} dispensing record
                  {data.summary.dispenses_today === 1 ? '' : 's'} ({formatNumber(data.summary.units_dispensed_today)} units)
                  {data.summary.receipts_today > 0 && ` · ${data.summary.receipts_today} delivery received`}
                </div>
              </div>
            )}

            <div className="grid cols-2">
              <Card
                title="🔴 Expired drugs"
                subtitle={`${data.summary.expired} batches`}
                action={<Link className="btn small" to="/alerts?tab=expired">View all</Link>}
                tight
              >
                {data.expired.length === 0 ? (
                  <EmptyState icon="✅" ok title="Nothing has expired" message="All stock on the shelf is still in date." />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Drug</th>
                          <th>Batch</th>
                          <th>Expired</th>
                          <th className="num">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.expired.map((batch) => (
                          <tr key={batch.batch_id} className="row-link" onClick={() => navigate(`/inventory/${batch.drug_id}`)}>
                            <td className="strong">{batch.drug_name} <span className="muted">{batch.strength}</span></td>
                            <td className="mono">{batch.batch_number || '—'}</td>
                            <td className="nowrap" style={{ color: 'var(--red)' }}>
                              {formatDate(batch.expiry_date)}
                            </td>
                            <td className="num">{formatNumber(batch.quantity_on_hand)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card
                title="🟡 Expiring soon"
                subtitle={`within ${data.summary.expiry_alert_days} days`}
                action={<Link className="btn small" to="/alerts?tab=soon">View all</Link>}
                tight
              >
                {data.expiringSoon.length === 0 ? (
                  <EmptyState icon="✅" ok title="Nothing is close to expiry" message={`No batch expires within ${data.summary.expiry_alert_days} days.`} />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Drug</th>
                          <th>Batch</th>
                          <th>Expires</th>
                          <th className="num">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.expiringSoon.map((batch) => (
                          <tr key={batch.batch_id} className="row-link" onClick={() => navigate(`/inventory/${batch.drug_id}`)}>
                            <td className="strong">{batch.drug_name} <span className="muted">{batch.strength}</span></td>
                            <td className="mono">{batch.batch_number || '—'}</td>
                            <td className="nowrap">
                              {formatDate(batch.expiry_date)}
                              <div className="faint" style={{ fontSize: '0.78rem' }}>{daysLabel(batch.days_to_expiry)}</div>
                            </td>
                            <td className="num">{formatNumber(batch.quantity_on_hand)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card
                title="🟡 Low stock — order soon"
                subtitle={`${data.summary.low_stock} drugs`}
                action={<Link className="btn small" to="/alerts?tab=low">View all</Link>}
                tight
              >
                {data.lowStock.length === 0 ? (
                  <EmptyState icon="✅" ok title="Stock levels are healthy" message="Nothing is at or below its minimum level." />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Drug</th>
                          <th className="num">Available</th>
                          <th className="num">Minimum</th>
                          <th className="num">Order</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lowStock.map((drug) => (
                          <tr key={drug.drug_id} className="row-link" onClick={() => navigate(`/inventory/${drug.drug_id}`)}>
                            <td className="strong">
                              {drug.drug_name} <span className="muted">{drug.strength}</span>
                              {drug.stock_status === 'OUT_OF_STOCK' && (
                                <span className="chip red" style={{ marginLeft: 6 }}>🔴 Out</span>
                              )}
                            </td>
                            <td className="num" style={{ color: drug.available_qty === 0 ? 'var(--red)' : undefined }}>
                              {formatNumber(drug.available_qty)}
                            </td>
                            <td className="num muted">{formatNumber(drug.min_stock_level)}</td>
                            <td className="num strong">{formatNumber(drug.suggested_order_qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="📦 Recent stock received" subtitle="latest deliveries" tight>
                {data.recentReceipts.length === 0 ? (
                  <EmptyState icon="📦" title="No deliveries recorded yet" message="Received stock will appear here." />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Receipt</th>
                          <th>Drugs</th>
                          <th className="num">Units</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentReceipts.map((receipt) => (
                          <tr key={receipt.id}>
                            <td className="mono strong">{receipt.receipt_no}</td>
                            <td style={{ maxWidth: 240 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {receipt.drug_names ?? '—'}
                              </div>
                              <div className="faint" style={{ fontSize: '0.78rem' }}>
                                {receipt.supplier_name ?? 'No supplier'}
                              </div>
                            </td>
                            <td className="num" style={{ color: 'var(--green)' }}>
                              +{formatNumber(receipt.total_quantity ?? 0)}
                            </td>
                            <td className="nowrap muted">{formatDate(receipt.received_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="💊 Recent dispensing" subtitle="latest records" tight>
                {data.recentDispenses.length === 0 ? (
                  <EmptyState icon="💊" title="Nothing dispensed yet" message="Dispensing records will appear here." />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Drugs</th>
                          <th className="num">Units</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentDispenses.map((dispense) => (
                          <tr key={dispense.id}>
                            <td>
                              <div className="mono strong">{dispense.dispense_no}</div>
                              <div className="faint" style={{ fontSize: '0.78rem' }}>
                                {dispense.patient_ref ?? dispense.patient_name ?? '—'}
                              </div>
                            </td>
                            <td style={{ maxWidth: 220 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {dispense.drug_names ?? '—'}
                              </div>
                            </td>
                            <td className="num" style={{ color: 'var(--red)' }}>
                              −{formatNumber(dispense.total_quantity ?? 0)}
                            </td>
                            <td className="nowrap muted">{formatDateTime(dispense.dispensed_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {data.summary.expired > 0 && can(PERMISSIONS.STOCK_ADJUST) && (
              <div className="banner amber" style={{ marginTop: 20 }}>
                <span aria-hidden="true">🗑️</span>
                <div className="banner-body">
                  <strong>Expired stock is still on the shelf</strong>
                  {pluralUnit(data.summary.expired_units, 'unit')} across {data.summary.expired} batch
                  {data.summary.expired === 1 ? '' : 'es'}. Removing it keeps the available figures honest.
                </div>
                <Link className="btn small" to="/adjustments">Write it off</Link>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
