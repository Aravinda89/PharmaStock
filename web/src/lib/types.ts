export type Role = 'DOCTOR' | 'PHARMACIST' | 'ASSISTANT';

export type StockStatus = 'OK' | 'LOW' | 'OUT_OF_STOCK';
export type ExpiryStatus = 'GOOD' | 'EXPIRING_SOON' | 'EXPIRED' | 'NONE';

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  canReceiveStock: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  permissions: string[];
}

export interface Settings {
  pharmacy_name: string;
  expiry_alert_days: string;
  backup_retention_count: string;
  auto_backup_enabled: string;
  last_backup_at: string;
}

export interface DrugStock {
  drug_id: number;
  code: string | null;
  name: string;
  generic_name: string | null;
  strength: string | null;
  form: string;
  unit: string;
  min_stock_level: number;
  default_supplier_id: number | null;
  supplier_name: string | null;
  storage_location: string | null;
  is_active: number;
  available_qty: number;
  expired_qty: number;
  expiring_soon_qty: number;
  total_qty: number;
  earliest_expiry: string | null;
  batch_count: number;
  stock_status: StockStatus;
  expiry_status: ExpiryStatus;
  notes?: string | null;
}

export interface Batch {
  id: number;
  drug_id: number;
  batch_number: string;
  expiry_date: string;
  supplier_id: number | null;
  supplier_name: string | null;
  quantity_received: number;
  quantity_on_hand: number;
  unit_cost: number | null;
  storage_location: string | null;
  days_to_expiry: number;
  expiry_status: Exclude<ExpiryStatus, 'NONE'>;
}

export interface LedgerEntry {
  id: number;
  occurred_at: string;
  change_type: 'OPENING' | 'RECEIVE' | 'DISPENSE' | 'ADJUST_IN' | 'ADJUST_OUT' | 'WRITE_OFF_EXPIRED' | 'RETURN';
  quantity_delta: number;
  balance_after: number;
  reason: string | null;
  batch_number: string;
  expiry_date: string;
  user_name: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: number;
  drug_count?: number;
  receipt_count?: number;
}

export interface AlertBatch {
  batch_id: number;
  drug_id: number;
  drug_name: string;
  code: string | null;
  strength: string | null;
  form: string;
  unit: string;
  batch_number: string;
  expiry_date: string;
  quantity_on_hand: number;
  days_to_expiry: number;
  supplier_name: string | null;
  storage_location: string | null;
}

export interface LowStockDrug {
  drug_id: number;
  code: string | null;
  drug_name: string;
  strength: string | null;
  form: string;
  unit: string;
  available_qty: number;
  min_stock_level: number;
  stock_status: StockStatus;
  earliest_expiry: string | null;
  supplier_name: string | null;
  suggested_order_qty: number;
}

export interface DashboardSummary {
  total_drugs: number;
  total_units: number;
  low_stock: number;
  out_of_stock: number;
  expiring_soon: number;
  expired: number;
  expired_units: number;
  expiry_alert_days: number;
  dispenses_today: number;
  units_dispensed_today: number;
  receipts_today: number;
}

export interface Dashboard {
  summary: DashboardSummary;
  expired: AlertBatch[];
  expiringSoon: AlertBatch[];
  lowStock: LowStockDrug[];
  recentReceipts: RecentReceipt[];
  recentDispenses: RecentDispense[];
}

export interface RecentReceipt {
  id: number;
  receipt_no: string;
  received_date: string;
  supplier_name: string | null;
  received_by: string | null;
  total_quantity: number | null;
  line_count: number;
  drug_names: string | null;
}

export interface RecentDispense {
  id: number;
  dispense_no: string;
  dispensed_at: string;
  patient_ref: string | null;
  patient_name: string | null;
  dispensed_by: string | null;
  total_quantity: number | null;
  drug_names: string | null;
}

export interface DispensePreviewLine {
  drugId: number;
  drugName: string;
  strength: string | null;
  unit: string;
  requested: number;
  available: number;
  availableAfter?: number;
  ok: boolean;
  message?: string;
  allocation: {
    batchId: number;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    availableBefore: number;
  }[];
}

export interface ReportColumn {
  key: string;
  label: string;
  width: number;
  align: 'left' | 'right';
  type: 'text' | 'number';
}

export interface Report {
  key: string;
  title: string;
  subtitle: string;
  pharmacyName: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
}

export interface SampleDataSummary {
  present: boolean;
  drugs: number;
  batches: number;
  movements: number;
  receipts: number;
  dispenses: number;
  suppliers: number;
}

export interface BackupFile {
  filename: string;
  size: number;
  createdAt: string;
}
