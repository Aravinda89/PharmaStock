import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PERMISSIONS, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { Supplier } from '../lib/types';
import { Card, ConfirmDialog, EmptyState, Loading, Modal, PageHeader } from '../components/ui';

export function SuppliersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const manage = can(PERMISSIONS.INVENTORY_MANAGE);

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', includeInactive],
    queryFn: () => api.get<{ items: Supplier[] }>(`/suppliers?includeInactive=${includeInactive}`),
  });

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      editing ? api.put<Supplier>(`/suppliers/${editing.id}`, values) : api.post<Supplier>('/suppliers', values),
    onSuccess: (supplier) => {
      toast.success(editing ? `${supplier.name} updated.` : `${supplier.name} added.`);
      setEditing(null);
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (supplier: Supplier) => api.del(`/suppliers/${supplier.id}`),
    onSuccess: () => {
      toast.success('Supplier deleted.');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (err: Error) => {
      setDeleting(null);
      toast.error(err.message);
    },
  });

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={data ? `${data.items.length} suppliers` : 'Who you order from'}
        actions={
          manage && (
            <button className="btn primary" type="button" onClick={() => setCreating(true)}>＋ Add supplier</button>
          )
        }
      />

      <div className="page-body">
        <Card tight>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
            <label className="checkbox">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Show inactive suppliers
            </label>
          </div>

          {isLoading && <Loading />}
          {data?.items.length === 0 && (
            <EmptyState icon="🚚" title="No suppliers yet" message="Add the companies you order stock from." />
          )}

          {data && data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th className="num">Drugs</th>
                    <th className="num">Deliveries</th>
                    {manage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((supplier) => (
                    <tr key={supplier.id}>
                      <td className="strong">
                        {supplier.name}
                        {!supplier.is_active && <span className="chip grey" style={{ marginLeft: 6 }}>Inactive</span>}
                      </td>
                      <td className="muted">{supplier.contact_person ?? '—'}</td>
                      <td className="muted nowrap">{supplier.phone ?? '—'}</td>
                      <td className="muted">{supplier.email ?? '—'}</td>
                      <td className="num muted">{supplier.drug_count ?? 0}</td>
                      <td className="num muted">{supplier.receipt_count ?? 0}</td>
                      {manage && (
                        <td className="nowrap">
                          <button className="btn small ghost" type="button" onClick={() => setEditing(supplier)}>Edit</button>
                          <button className="btn small ghost" type="button" onClick={() => setDeleting(supplier)}>Delete</button>
                        </td>
                      )}
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
          title={editing ? `Edit ${editing.name}` : 'Add a supplier'}
          onClose={() => { setCreating(false); setEditing(null); }}
        >
          <SupplierForm
            supplier={editing}
            busy={save.isPending}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSubmit={(values) => save.mutate(values)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          tone="danger"
          confirmLabel="Delete supplier"
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
          message={
            <p>
              If this supplier appears in past deliveries it cannot be deleted — mark it inactive
              instead so the delivery records stay intact.
            </p>
          }
        />
      )}
    </>
  );
}

function SupplierForm({
  supplier,
  busy,
  onSubmit,
  onCancel,
}: {
  supplier: Supplier | null;
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    name: supplier?.name ?? '',
    contact_person: supplier?.contact_person ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    notes: supplier?.notes ?? '',
    is_active: supplier ? Boolean(supplier.is_active) : true,
  });

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}>
      <div className="field">
        <label htmlFor="s-name">Supplier name *</label>
        <input id="s-name" value={values.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="s-contact">Contact person</label>
          <input id="s-contact" value={values.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-phone">Phone</label>
          <input id="s-phone" value={values.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="s-email">Email</label>
        <input id="s-email" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="s-address">Address</label>
        <textarea id="s-address" value={values.address} onChange={(e) => set('address', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="s-notes">Notes</label>
        <textarea id="s-notes" value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      {supplier && (
        <label className="checkbox" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={values.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active
        </label>
      )}

      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : supplier ? 'Save changes' : 'Add supplier'}
        </button>
      </div>
    </form>
  );
}
