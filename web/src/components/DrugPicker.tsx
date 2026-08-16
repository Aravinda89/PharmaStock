import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { DrugStock } from '../lib/types';
import { formatNumber } from '../lib/format';

/**
 * Type-ahead drug search used on the Receive and Dispense screens.
 *
 * It searches name, generic name, code and batch number, so the user can type
 * whatever is printed on the box in front of them. Keyboard-first: arrows to
 * move, Enter to choose, Escape to close.
 */
export function DrugPicker({
  value,
  onChange,
  placeholder = 'Type a drug name, code or batch number…',
  autoFocus = false,
}: {
  value: DrugStock | null;
  onChange: (drug: DrugStock | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['drug-search', query],
    queryFn: () => api.get<{ items: DrugStock[] }>(`/drugs${qs({ search: query, limit: 20 })}`),
    enabled: open,
    staleTime: 15_000,
  });

  const options = useMemo(() => data?.items ?? [], [data]);

  useEffect(() => {
    const onClickAway = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const choose = (drug: DrugStock) => {
    onChange(drug);
    setQuery('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className="btn-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value.name} {value.strength}
          </div>
          <div className="faint" style={{ fontSize: '0.78rem' }}>
            {formatNumber(value.available_qty)} {value.unit} available
          </div>
        </div>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => onChange(null)}
          aria-label="Choose a different drug"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && options[highlight]) {
            e.preventDefault();
            choose(options[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />

      {open && options.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            margin: '4px 0 0',
            padding: 4,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {options.map((drug, i) => (
            <li key={drug.drug_id}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(drug)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  border: 0,
                  background: i === highlight ? 'var(--brand-light)' : 'transparent',
                  padding: '7px 9px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{drug.name}</span>{' '}
                  <span className="muted">{drug.strength}</span>
                  {drug.code && <span className="faint mono"> · {drug.code}</span>}
                </span>
                <span
                  className="nowrap"
                  style={{
                    fontSize: '0.82rem',
                    color: drug.available_qty === 0 ? 'var(--red)' : 'var(--text-muted)',
                  }}
                >
                  {formatNumber(drug.available_qty)} {drug.unit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query.length > 0 && options.length === 0 && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            padding: '10px 12px',
            background: '#fff',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.88rem',
          }}
          className="muted"
        >
          No drug matches “{query}”.
        </div>
      )}
    </div>
  );
}
