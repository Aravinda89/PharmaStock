import type { ExpiryStatus, StockStatus } from './types';

/** '2026-08-16' -> '16 Aug 2026'. Dates from the API are already local text. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = formatDate(value);
  const time = value.slice(11, 16);
  return time ? `${date}, ${time}` : date;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Plural that reads naturally: '1 tablet', '90 tablets', '1 box' -> '2 boxes'. */
export function pluralUnit(count: number, unit: string): string {
  if (count === 1) return `${count} ${unit}`;
  const plural = /(s|x|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`;
  return `${count.toLocaleString()} ${plural}`;
}

export function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export const FORMS = [
  'TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'OINTMENT',
  'DROPS', 'INHALER', 'SUPPOSITORY', 'PATCH', 'OTHER',
] as const;

export const formLabel = (form: string) =>
  form.charAt(0) + form.slice(1).toLowerCase();

export const ADJUSTMENT_REASONS = [
  { value: 'COUNT_CORRECTION', label: 'Stock count correction' },
  { value: 'DAMAGE', label: 'Damaged / broken' },
  { value: 'EXPIRED_DISPOSAL', label: 'Expired - disposed of' },
  { value: 'RETURN_TO_SUPPLIER', label: 'Returned to supplier' },
  { value: 'LOST', label: 'Lost / missing' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const reasonLabel = (value: string) =>
  ADJUSTMENT_REASONS.find((r) => r.value === value)?.label ?? value;

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Opening balance',
  RECEIVE: 'Received',
  DISPENSE: 'Dispensed',
  ADJUST_IN: 'Adjustment (in)',
  ADJUST_OUT: 'Adjustment (out)',
  WRITE_OFF_EXPIRED: 'Expired write-off',
  RETURN: 'Returned to supplier',
};

/** Chip colour + label. Text always accompanies colour - never colour alone. */
export function expiryChip(status: ExpiryStatus, days?: number) {
  switch (status) {
    case 'EXPIRED':
      return { tone: 'red' as const, icon: '🔴', label: 'Expired' };
    case 'EXPIRING_SOON':
      return {
        tone: 'amber' as const,
        icon: '🟡',
        label: days === undefined ? 'Expires soon' : `Expires in ${days}d`,
      };
    case 'GOOD':
      return { tone: 'green' as const, icon: '🟢', label: 'Good' };
    default:
      return { tone: 'grey' as const, icon: '⚪', label: 'No stock' };
  }
}

export function stockChip(status: StockStatus) {
  switch (status) {
    case 'OUT_OF_STOCK':
      return { tone: 'red' as const, icon: '🔴', label: 'Out of stock' };
    case 'LOW':
      return { tone: 'amber' as const, icon: '🟡', label: 'Low stock' };
    default:
      return { tone: 'green' as const, icon: '🟢', label: 'In stock' };
  }
}

/** Today as YYYY-MM-DD in local time - used to default date inputs. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
