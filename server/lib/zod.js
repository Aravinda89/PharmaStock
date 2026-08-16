import { z } from 'zod';

/**
 * z.coerce.boolean() turns the *string* "false" into true, which silently
 * breaks query flags like ?includeInactive=false. This reads the value the way
 * a user means it.
 */
export const boolish = (defaultValue = false) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  }, z.boolean());

/** Empty string / "null" from a form field means "not set", not zero. */
export const optionalId = () =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '' || value === 'null') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }, z.number().int().positive().nullable());

/**
 * An absent number stays absent. Without the explicit null check, `Number(null)`
 * is 0, which turns "no expiry filter" into "expiring in exactly 0 days".
 */
export const optionalInt = ({ min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '' || value === 'null') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }, z.number().int().min(min).max(max).nullable());

export const optionalText = (max = 200) =>
  z.preprocess(
    (value) => (value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim()),
    z.string().max(max).nullable()
  );

export const isoDate = (message = 'Enter a valid date (YYYY-MM-DD).') =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);
