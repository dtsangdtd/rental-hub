/**
 * API models — mirror the backend responses exactly.
 * Auth DTOs are camelCase; other services return DB rows (snake_case). See docs/api.md.
 */
export type Role = 'admin' | 'landlord' | 'accountant' | 'tenant';
export const ROLES: Role[] = ['admin', 'landlord', 'accountant', 'tenant'];

export interface ListResponse<T> { items: T[]; }

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ---------- Auth ----------
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
}
export interface LoginResponse { accessToken: string; tokenType: 'Bearer'; user: User; }

// ---------- Property ----------
export type UnitStatus = 'vacant' | 'occupied' | 'maintenance';
export interface Property {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  description: string | null;
  electricity_rate?: number;
  water_rate?: number;
  internet_rate?: number;
  cleaning_rate?: number;
  parking_rate?: number;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  bank_qr_code?: string | null;
  created_at: string;
  unit_count?: number;
  occupied_count?: number;
}
export interface Unit {
  id: string;
  property_id: string;
  name: string;
  area_m2: number | null;
  base_rent: number;
  status: UnitStatus;
  created_at: string;
  occupant_count?: number;
}
export interface PropertyDetail extends Property { units: Unit[]; }

export interface UnitOccupant {
  id: string;
  unit_id: string;
  tenant_id?: string | null;
  full_name: string;
  phone?: string | null;
  id_number?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  relationship?: string | null;
  vehicle_plate?: string | null;
  is_primary: boolean;
  notes?: string | null;
  created_at: string;
}

export interface Tenant {
  id: string;
  owner_id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  id_number: string | null;
  street_address?: string | null;
  ward?: string | null;
  district?: string | null;
  city?: string | null;
  id_issue_date?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  nationality?: string | null;
  created_at: string;
}
export type LeaseStatus = 'active' | 'terminated';
export interface Lease {
  id: string;
  owner_id: string;
  unit_id: string;
  tenant_id: string;
  start_date: string;
  end_date: string | null;
  monthly_rent: number;
  deposit: number;
  currency: string;
  due_day: number;
  status: LeaseStatus;
  terminated_at: string | null;
  created_at: string;
  unit_name?: string;
  property_name?: string;
  property_address?: string;
  tenant_name?: string;
  tenant_phone?: string;
  property_id?: string;
  electricity_rate?: number;
  water_rate?: number;
  internet_rate?: number;
  cleaning_rate?: number;
  parking_rate?: number;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  bank_qr_code?: string | null;
  occupant_count?: number;
}

// ---------- Accounting ----------
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';
export type InvoiceKind = 'rent' | 'deposit' | 'order' | 'other';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'ewallet';
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'card', 'ewallet'];
export interface Invoice {
  id: string;
  number: string;
  owner_id: string | null;
  customer_id: string | null;
  reference_type: 'lease' | 'order' | 'manual';
  reference_id: string | null;
  kind: InvoiceKind;
  period: string | null;
  description: string;
  amount: number;
  amount_paid: number;
  currency: string;
  due_date: string;
  status: InvoiceStatus;
  created_at: string;
}
export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  recorded_by: string;
  paid_at: string;
}
export interface InvoiceDetail extends Invoice { payments: Payment[]; }
export interface PaymentResult { invoice: Invoice; payment: Payment; }

export type ExpenseCategory = 'maintenance' | 'utilities' | 'tax' | 'insurance' | 'salary' | 'other';
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['maintenance', 'utilities', 'tax', 'insurance', 'salary', 'other'];
export interface Expense {
  id: string;
  owner_id: string;
  property_id: string | null;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  spent_on: string;
  created_by: string;
  created_at: string;
}
export interface ReportSummary {
  from: string;
  to: string;
  totals: Record<string, { income: number; expenses: number; profit: number }>;
  incomeByKind: { currency: string; kind: InvoiceKind; total: number }[];
  expensesByCategory: { currency: string; category: ExpenseCategory; total: number }[];
  outstanding: { currency: string; total: number; count: number }[];
}
export interface GenerateRentResult { period: string; activeLeases: number; created: number; }

// ---------- Commerce ----------
export interface Product {
  id: string;
  seller_id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  currency: string;
  stock: number;
  active: boolean;
  created_at: string;
}
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'fulfilled';
export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total: number;
  currency: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}
export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
}
export interface OrderDetail extends Order { items: OrderItem[]; }
