import { useState } from 'react';
import type { DrugStock, Supplier } from '../lib/types';
import { FORMS, formLabel } from '../lib/format';

/** Shared by the "add drug" and "edit drug" modals. */
export function DrugForm({
  drug,
  suppliers,
  busy,
  onSubmit,
  onCancel,
}: {
  drug: DrugStock | null;
  suppliers: Supplier[];
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    name: drug?.name ?? '',
    generic_name: drug?.generic_name ?? '',
    code: drug?.code ?? '',
    strength: drug?.strength ?? '',
    form: drug?.form ?? 'TABLET',
    unit: drug?.unit ?? 'tablet',
    min_stock_level: String(drug?.min_stock_level ?? 0),
    default_supplier_id: drug?.default_supplier_id ? String(drug.default_supplier_id) : '',
    storage_location: drug?.storage_location ?? '',
    notes: drug?.notes ?? '',
    is_active: drug ? Boolean(drug.is_active) : true,
  });

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({
      ...values,
      min_stock_level: Number(values.min_stock_level) || 0,
      default_supplier_id: values.default_supplier_id || null,
    });
  };

  return (
    <form onSubmit={submit}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="d-name">Drug name *</label>
          <input
            id="d-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            required
            autoFocus
            placeholder="Paracetamol"
          />
        </div>
        <div className="field">
          <label htmlFor="d-generic">Generic name</label>
          <input
            id="d-generic"
            value={values.generic_name}
            onChange={(e) => set('generic_name', e.target.value)}
            placeholder="Acetaminophen"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="d-code">Drug code / barcode</label>
          <input
            id="d-code"
            value={values.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="PAR500"
          />
          <div className="hint">Optional. Must be unique if used.</div>
        </div>
        <div className="field">
          <label htmlFor="d-strength">Strength</label>
          <input
            id="d-strength"
            value={values.strength}
            onChange={(e) => set('strength', e.target.value)}
            placeholder="500mg"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="d-form">Form</label>
          <select id="d-form" value={values.form} onChange={(e) => set('form', e.target.value)}>
            {FORMS.map((f) => <option key={f} value={f}>{formLabel(f)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-unit">Counted in</label>
          <input
            id="d-unit"
            value={values.unit}
            onChange={(e) => set('unit', e.target.value)}
            placeholder="tablet"
          />
          <div className="hint">tablet, capsule, bottle, vial, tube…</div>
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="d-min">Minimum stock level</label>
          <input
            id="d-min"
            type="number"
            min={0}
            value={values.min_stock_level}
            onChange={(e) => set('min_stock_level', e.target.value)}
          />
          <div className="hint">A low-stock alert appears at or below this. 0 turns the alert off.</div>
        </div>
        <div className="field">
          <label htmlFor="d-supplier">Usual supplier</label>
          <select
            id="d-supplier"
            value={values.default_supplier_id}
            onChange={(e) => set('default_supplier_id', e.target.value)}
          >
            <option value="">Not set</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="d-location">Storage location</label>
        <input
          id="d-location"
          value={values.storage_location}
          onChange={(e) => set('storage_location', e.target.value)}
          placeholder="Shelf A1 / Fridge 1"
        />
      </div>

      <div className="field">
        <label htmlFor="d-notes">Notes</label>
        <textarea id="d-notes" value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      {drug && (
        <label className="checkbox" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={values.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
          />
          <span>
            Active
            <div className="hint" style={{ marginTop: 2 }}>
              Turning this off hides the drug from the inventory list and alerts but keeps all its stock history.
            </div>
          </span>
        </label>
      )}

      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : drug ? 'Save changes' : 'Add drug'}
        </button>
      </div>
    </form>
  );
}
