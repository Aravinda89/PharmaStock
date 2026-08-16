/**
 * The whole permission system, in one file, on purpose.
 *
 * The server is the authority - every mutating route is guarded by
 * requirePermission(). The UI reads the same map to hide buttons, which is a
 * convenience for the user, never a security control.
 */

export const PERMISSIONS = {
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage', // add/edit drugs and suppliers
  STOCK_RECEIVE: 'stock.receive',
  STOCK_DISPENSE: 'stock.dispense',
  STOCK_ADJUST: 'stock.adjust',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  BACKUP_MANAGE: 'backup.manage',
};

const ALL = Object.values(PERMISSIONS);

const ROLE_PERMISSIONS = {
  DOCTOR: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EXPORT],

  PHARMACIST: ALL,

  ASSISTANT: [
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.STOCK_DISPENSE,
    PERMISSIONS.STOCK_RECEIVE, // additionally gated by users.can_receive_stock
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
  ],
};

export const ROLES = Object.keys(ROLE_PERMISSIONS);

export const ROLE_LABELS = {
  DOCTOR: 'Doctor',
  PHARMACIST: 'Pharmacist',
  ASSISTANT: 'Pharmacy Assistant',
};

/**
 * Effective permissions for a user, after per-user overrides.
 * The `can_receive_stock` flag is the "record received stock if permitted"
 * requirement - a pharmacist can turn it off for an individual assistant.
 */
export function permissionsFor(user) {
  if (!user) return [];
  const base = ROLE_PERMISSIONS[user.role] || [];
  if (user.role === 'ASSISTANT' && !user.can_receive_stock) {
    return base.filter((p) => p !== PERMISSIONS.STOCK_RECEIVE);
  }
  return base;
}

export function can(user, permission) {
  return permissionsFor(user).includes(permission);
}
