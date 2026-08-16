import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import type { AlertBatch, DashboardSummary, LowStockDrug } from '../lib/types';
import { Card, EmptyState, ErrorBanner, Loading, PageHeader, StockChip } from '../components/ui';
import { daysLabel, formatDate, formatNumber } from '../lib/format';

interface AlertsResponse {
  summary: DashboardSummary;
  expired: AlertBatch[];
  expiringSoon: AlertBatch[];
  lowStock: LowStockDrug[];
}

export function AlertsPage() {
  const navigate = useNavigate();
  const { can, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'expired';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.get<AlertsResponse>('/alerts'),
  });

  const setTab = (value: string) => setParams({ tab: value }, { replace: true });

  const exportKey = tab === 'expired' ? 'expired' : tab === 'soon' ? 'expiring-soon' : 'low-stock';

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={`Expiry warnings appear ${settings?.expiry_alert_days ?? 90} days ahead — change this in Settings`}
        actions={
          can(PERMISSIONS.REPORTS_EXPORT) && (
            <>
              <button className="btn" type="button" onClick={() => downloadFile(`/reports/${exportKey}/export/xlsx`)}>
                ⬇ Excel
              </button>
              <button className="btn" type="button" onClick={() => downloadFile(`/reports/${exportKey}/export/pdf`)}>
                ⬇ PDF
              </button>
            </>
          )
        }
      />

      <div className="page-body">
        {error && <ErrorBanner error={error} onRetry={() => void refetch()} />}
        {isLoading && <Loading />}

        {data && (
          <>
            <div className="tabs">
              <button className={`tab${tab === 'expired' ? ' active' : ''}`} onClick={() => setTab('expired')} type="button">
                🔴 Expired
                <span className="tab-count">{data.expired.length}</span>
              </button>
              <button className={`tab${tab === 'soon' ? ' active' : ''}`} onClick={() => setTab('soon')} type="button">
                🟡 Expiring soon
                <span className="tab-count">{data.expiringSoon.length}</span>
              </button>
              <button className={`tab${tab === 'low' ? ' active' : ''}`} onClick={() => setTab('low')} type="button">
                🟡 Low stock
                <span className="tab-count">{data.lowStock.length}</span>
              </button>
            </div>

            {tab === 'expired' && (
              <Card
                title="🔴 Expired stock"
                subtitle="already past its expiry date and still on the shelf"
                action={
                  can(PERMISSIONS.STOCK_ADJUST) && data.expired.length > 0 ? (
                    <button className="btn small primary" type="button" onClick={() => navigate('/adjustments')}>
                      Write off expired stock
                    </button>
                  ) : undefined
                }
                tight
              >
                {data.expired.length === 0 ? (
                  <EmptyState icon="✅" ok title="Nothing has expired" message="Every batch on the shelf is still in date." />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Drug</th>
                          <th>Batch</th>
                          <th>Expired on</th>
                          <th className="num">Quantity</th>
                          <th>Supplier</th>
                          <th>Location</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.expired.map((batch) => (
                          <tr key={batch.batch_id} className="row-link" onClick={() => navigate(`/inventory/${batch.drug_id}`)}>
                            <td className="strong">{batch.drug_name} <span className="muted">{batch.strength}</span></td>
                            <td className="mono">{batch.batch_number || '—'}</td>
                            <td className="nowrap" style={{ color: 'var(--red)' }}>
                              {formatDate(batch.expiry_date)}
                              <div className="faint" style={{ fontSize: '0.78rem' }}>{daysLabel(batch.days_to_expiry)}</div>
                            </td>
                            <td className="num strong tabnum">{formatNumber(batch.quantity_on_hand)} {batch.unit}</td>
                            <td className="muted">{batch.supplier_name ?? '—'}</td>
                            <td className="muted">{batch.storage_location ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'soon' && (
              <Card
                title="🟡 Expiring soon"
                subtitle={`within ${data.summary.expiry_alert_days} days — soonest first`}
                tight
              >
                {data.expiringSoon.length === 0 ? (
                  <EmptyState
                    icon="✅"
                    ok
                    title="Nothing is close to expiry"
                    message={`No batch expires within the next ${data.summary.expiry_alert_days} days.`}
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Drug</th>
                          <th>Batch</th>
                          <th>Expires on</th>
                          <th className="num">Days left</th>
                          <th className="num">Quantity</th>
                          <th>Supplier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.expiringSoon.map((batch) => (
                          <tr key={batch.batch_id} className="row-link" onClick={() => navigate(`/inventory/${batch.drug_id}`)}>
                            <td className="strong">{batch.drug_name} <span className="muted">{batch.strength}</span></td>
                            <td className="mono">{batch.batch_number || '—'}</td>
                            <td className="nowrap">{formatDate(batch.expiry_date)}</td>
                            <td className="num tabnum" style={{ color: batch.days_to_expiry <= 30 ? 'var(--amber)' : undefined, fontWeight: 650 }}>
                              {batch.days_to_expiry}
                            </td>
                            <td className="num tabnum">{formatNumber(batch.quantity_on_hand)} {batch.unit}</td>
                            <td className="muted">{batch.supplier_name ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'low' && (
              <Card
                title="🟡 Low stock — order soon"
                subtitle="at or below the minimum level. Suggested quantity tops each drug up to twice its minimum."
                tight
              >
                {data.lowStock.length === 0 ? (
                  <EmptyState icon="✅" ok title="Stock levels are healthy" message="Nothing needs reordering right now." />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Drug</th>
                          <th>Code</th>
                          <th className="num">Available</th>
                          <th className="num">Minimum</th>
                          <th>Status</th>
                          <th className="num">Suggested order</th>
                          <th>Supplier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lowStock.map((drug) => (
                          <tr key={drug.drug_id} className="row-link" onClick={() => navigate(`/inventory/${drug.drug_id}`)}>
                            <td className="strong">{drug.drug_name} <span className="muted">{drug.strength}</span></td>
                            <td className="mono muted">{drug.code ?? '—'}</td>
                            <td className="num strong tabnum" style={{ color: drug.available_qty === 0 ? 'var(--red)' : undefined }}>
                              {formatNumber(drug.available_qty)} {drug.unit}
                            </td>
                            <td className="num muted tabnum">{formatNumber(drug.min_stock_level)}</td>
                            <td><StockChip status={drug.stock_status} /></td>
                            <td className="num strong tabnum">{formatNumber(drug.suggested_order_qty)}</td>
                            <td className="muted">{drug.supplier_name ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
