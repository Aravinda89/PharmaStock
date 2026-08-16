import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import type { Report } from '../lib/types';
import { Card, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { formatNumber, isoDaysAgo, todayIso } from '../lib/format';

interface CatalogueEntry {
  key: string;
  title: string;
  description: string;
  needsRange: boolean;
}

const STATUS_TONE: Record<string, string> = {
  EXPIRED: 'var(--red)',
  OUT_OF_STOCK: 'var(--red)',
  EXPIRING_SOON: 'var(--amber)',
  LOW: 'var(--amber)',
  GOOD: 'var(--green)',
  OK: 'var(--green)',
};

export function ReportsPage() {
  const { can } = useAuth();
  const [selected, setSelected] = useState('inventory');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());

  const { data: catalogue } = useQuery({
    queryKey: ['report-catalogue'],
    queryFn: () => api.get<{ reports: CatalogueEntry[] }>('/reports'),
  });

  const current = catalogue?.reports.find((r) => r.key === selected);
  const params = current?.needsRange ? { from, to } : {};

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: ['report', selected, current?.needsRange ? from : null, current?.needsRange ? to : null],
    queryFn: () => api.get<Report>(`/reports/${selected}${qs(params)}`),
    enabled: Boolean(current),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="View on screen, or export to Excel or PDF"
        actions={
          can(PERMISSIONS.REPORTS_EXPORT) && (
            <>
              <button className="btn" type="button" onClick={() => downloadFile(`/reports/${selected}/export/xlsx${qs(params)}`)}>
                ⬇ Export Excel
              </button>
              <button className="btn" type="button" onClick={() => downloadFile(`/reports/${selected}/export/pdf${qs(params)}`)}>
                ⬇ Export PDF
              </button>
              <button className="btn ghost" type="button" onClick={() => window.print()}>🖨 Print</button>
            </>
          )
        }
      />

      <div className="page-body">
        <Card>
          <div className="field">
            <label htmlFor="rep-select">Report</label>
            <select id="rep-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {catalogue?.reports.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
            </select>
            {current && <div className="hint">{current.description}</div>}
          </div>

          {current?.needsRange && (
            <div className="filters" style={{ marginTop: 8 }}>
              <div>
                <label className="label" htmlFor="rep-from">From</label>
                <input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="rep-to">To</label>
                <input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="btn-row">
                <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(7)); setTo(todayIso()); }}>7 days</button>
                <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(30)); setTo(todayIso()); }}>30 days</button>
                <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(90)); setTo(todayIso()); }}>90 days</button>
                <button className="btn small" type="button" onClick={() => { setFrom(isoDaysAgo(365)); setTo(todayIso()); }}>1 year</button>
              </div>
            </div>
          )}
        </Card>

        {error && <ErrorBanner error={error} onRetry={() => void refetch()} />}
        {isLoading && <Card><Loading label="Building report…" /></Card>}

        {report && (
          <Card title={report.title} subtitle={report.subtitle} tight>
            <div className="print-only" style={{ padding: '12px 18px 0' }}>
              <strong>{report.pharmacyName}</strong> — {report.title}
              <div className="faint">Generated {report.generatedAt}</div>
            </div>

            {report.rows.length === 0 ? (
              <EmptyState icon="📄" title="No records match this report" message="Try a different date range." />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      {report.columns.map((col) => (
                        <th key={col.key} className={col.align === 'right' ? 'num' : ''}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr key={i}>
                        {report.columns.map((col) => {
                          const value = row[col.key];
                          const tone = typeof value === 'string' ? STATUS_TONE[value] : undefined;
                          return (
                            <td
                              key={col.key}
                              className={col.align === 'right' ? 'num tabnum' : ''}
                              style={tone ? { color: tone, fontWeight: 600 } : undefined}
                            >
                              {value === null || value === undefined || value === ''
                                ? '—'
                                : col.type === 'number'
                                  ? formatNumber(Number(value))
                                  : String(value)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  {Object.keys(report.totals ?? {}).length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border-strong)', fontWeight: 700 }}>
                        {report.columns.map((col, i) => (
                          <td key={col.key} className={col.align === 'right' ? 'num tabnum' : ''} style={{ padding: '10px 14px' }}>
                            {i === 0 ? 'TOTAL' : report.totals[col.key] !== undefined ? formatNumber(report.totals[col.key]) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>
        )}

        {can(PERMISSIONS.REPORTS_EXPORT) && (
          <Card title="Export everything" subtitle="A safety net you can read without this software">
            <p className="muted">
              One Excel workbook with every drug, batch, stock movement, delivery, dispensing record
              and adjustment. Worth keeping alongside your database backups.
            </p>
            <button className="btn" type="button" onClick={() => downloadFile('/reports/export/full-data')}>
              ⬇ Download all data as Excel
            </button>
          </Card>
        )}
      </div>
    </>
  );
}
