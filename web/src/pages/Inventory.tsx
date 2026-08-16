import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { DrugStock, Supplier } from '../lib/types';
import {
  Card, EmptyState, ErrorBanner, ExpiryChip, Loading, Modal, PageHeader, StockChip,
} from '../components/ui';
import { FORMS, formLabel, formatDate, formatNumber } from '../lib/format';
import { DrugForm } from './DrugForm';

export function InventoryPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [editing, setEditing] = useState<DrugStock | null>(null);
  const [creating, setCreating] = useState(false);

  const form = params.get('form') ?? '';
  const stockStatus = params.get('stockStatus') ?? '';
  const expiryStatus = params.get('expiryStatus') ?? '';
  const supplierId = params.get('supplierId') ?? '';
  const sort = params.get('sort') ?? 'name';
  const includeInactive = params.get('includeInactive') === 'true';

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['drugs', debounced, form, stockStatus, expiryStatus, supplierId, sort, includeInactive],
    queryFn: () =>
      api.get<{ items: DrugStock[]; total: number }>(
        `/drugs${qs({
          search: debounced, form, stockStatus, expiryStatus,
          supplierId, sort, includeInactive, limit: 1000,
        })}`
      ),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<{ items: Supplier[] }>('/suppliers'),
  });

  const saveDrug = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      editing
        ? api.put<DrugStock>(`/drugs/${editing.drug_id}`, values)
        : api.post<DrugStock>('/drugs', values),
    onSuccess: (drug) => {
      toast.success(editing ? `${drug.name} updated.` : `${drug.name} added to the catalogue.`);
      setEditing(null);
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ['drugs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtersActive = Boolean(debounced || form || stockStatus || expiryStatus || supplierId);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={data ? `${formatNumber(data.total)} drugs` : 'Search and filter the drug catalogue'}
        actions={
          can(PERMISSIONS.INVENTORY_MANAGE) && (
            <button className="btn primary" type="button" onClick={() => setCreating(true)}>
              ＋ Add drug
            </button>
          )
        }
      />

      <div className="page-body">
        <Card>
          <div className="search-big" style={{ marginBottom: 14 }}>
            <span className="icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              value={search}
              autoFocus
              placeholder="Search by drug name, generic name, drug code or batch number…"
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search inventory"
            />
          </div>

          <div className="filters">
            <div>
              <label className="label" htmlFor="f-form">Form</label>
              <select id="f-form" value={form} onChange={(e) => setParam('form', e.target.value)}>
                <option value="">All forms</option>
                {FORMS.map((f) => <option key={f} value={f}>{formLabel(f)}</option>)}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-stock">Stock status</label>
              <select id="f-stock" value={stockStatus} onChange={(e) => setParam('stockStatus', e.target.value)}>
                <option value="">Any stock level</option>
                <option value="OK">🟢 In stock</option>
                <option value="LOW">🟡 Low stock</option>
                <option value="OUT_OF_STOCK">🔴 Out of stock</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-expiry">Expiry</label>
              <select id="f-expiry" value={expiryStatus} onChange={(e) => setParam('expiryStatus', e.target.value)}>
                <option value="">Any expiry</option>
                <option value="GOOD">🟢 Good</option>
                <option value="EXPIRING_SOON">🟡 Expiring soon</option>
                <option value="EXPIRED">🔴 Expired</option>
                <option value="NONE">No stock</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-supplier">Supplier</label>
              <select id="f-supplier" value={supplierId} onChange={(e) => setParam('supplierId', e.target.value)}>
                <option value="">All suppliers</option>
                {suppliers?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-sort">Sort by</label>
              <select id="f-sort" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
                <option value="name">Name</option>
                <option value="urgency">Most urgent first</option>
                <option value="stock_asc">Lowest stock first</option>
                <option value="expiry">Earliest expiry first</option>
              </select>
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setParam('includeInactive', e.target.checked ? 'true' : '')}
              />
              Show inactive drugs
            </label>
            {filtersActive && (
              <button
                className="btn small ghost"
                type="button"
                onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}
              >
                Clear filters
              </button>
            )}
          </div>
        </Card>

        <Card tight>
          {error && <div style={{ padding: 16 }}><ErrorBanner error={error} onRetry={() => void refetch()} /></div>}
          {isLoading && <Loading />}

          {data && data.items.length === 0 && (
            <EmptyState
              icon="🔍"
              title={filtersActive ? 'No drug matches those filters' : 'The catalogue is empty'}
              message={
                filtersActive
                  ? 'Try a shorter search term or clear the filters.'
                  : 'Add your first drug to start tracking stock.'
              }
            />
          )}

          {data && data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Drug</th>
                    <th>Code</th>
                    <th>Form</th>
                    <th className="num">Available</th>
                    <th className="num">Minimum</th>
                    <th>Stock</th>
                    <th>Next expiry</th>
                    <th>Expiry status</th>
                    <th className="num">Batches</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((drug) => (
                    <tr
                      key={drug.drug_id}
                      className="row-link"
                      onClick={() => navigate(`/inventory/${drug.drug_id}`)}
                    >
                      <td className="strong">
                        {drug.name} <span className="muted">{drug.strength}</span>
                        {!drug.is_active && <span className="chip grey" style={{ marginLeft: 6 }}>Inactive</span>}
                        {drug.generic_name && drug.generic_name !== drug.name && (
                          <div className="faint" style={{ fontSize: '0.78rem' }}>{drug.generic_name}</div>
                        )}
                      </td>
                      <td className="mono muted">{drug.code ?? '—'}</td>
                      <td className="muted">{formLabel(drug.form)}</td>
                      <td className="num strong tabnum">
                        {formatNumber(drug.available_qty)}
                        <div className="faint" style={{ fontSize: '0.76rem', fontWeight: 400 }}>{drug.unit}</div>
                      </td>
                      <td className="num muted tabnum">{formatNumber(drug.min_stock_level)}</td>
                      <td><StockChip status={drug.stock_status} /></td>
                      <td className="nowrap">
                        {formatDate(drug.earliest_expiry)}
                        {drug.expired_qty > 0 && (
                          <div className="faint" style={{ fontSize: '0.76rem', color: 'var(--red)' }}>
                            +{formatNumber(drug.expired_qty)} expired
                          </div>
                        )}
                      </td>
                      <td><ExpiryChip status={drug.expiry_status} /></td>
                      <td className="num muted">{drug.batch_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {(creating || editing) && (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'Add a drug to the catalogue'}
          onClose={() => { setCreating(false); setEditing(null); }}
        >
          <DrugForm
            drug={editing}
            suppliers={suppliers?.items ?? []}
            busy={saveDrug.isPending}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSubmit={(values) => saveDrug.mutate(values)}
          />
        </Modal>
      )}
    </>
  );
}
