/**
 * EVENT CONTRACTS — the single source of truth for cross-service messages.
 *
 * Rules (see AGENTS.md):
 *  - Event names: "<service>.<entity>.<pastTenseVerb>".
 *  - Changes must be BACKWARD COMPATIBLE: only add optional fields.
 *  - Breaking change => new event name with a version suffix (e.g. ".v2").
 *  - Update docs/events.md whenever this file changes.
 */
import type { Role } from './auth';

export const Events = {
  UserRegistered: 'auth.user.registered',
  LeaseCreated: 'property.lease.created',
  LeaseTerminated: 'property.lease.terminated',
  PropertyAutoInvoiceToggled: 'property.autoinvoice.toggled',
  InvoicePaid: 'accounting.invoice.paid',
  OrderPlaced: 'commerce.order.placed',
  OrderPaid: 'commerce.order.paid',
  OrderCancelled: 'commerce.order.cancelled',
  GroceryOrderCreated: 'grocery.order.created',
  TenantDebtChargeRequested: 'tenant.debt.charge_requested',
  InventoryThresholdDepleted: 'inventory.threshold.depleted',
  NotificationLandlordAlert: 'notification.order.landlord_alert',
} as const;

export type EventType = (typeof Events)[keyof typeof Events];

export interface UserRegisteredData {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface LeaseCreatedData {
  leaseId: string;
  ownerId: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  tenantUserId: string | null;
  monthlyRent: number;
  deposit: number;
  currency: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  dueDay: number; // 1..28
  autoInvoice?: boolean;
  autoInvoiceDay?: number;
}

export interface PropertyAutoInvoiceToggledData {
  propertyId: string;
  ownerId: string;
  autoInvoice: boolean;
  autoInvoiceDay?: number;
}

export interface LeaseTerminatedData {
  leaseId: string;
  ownerId: string;
  terminatedAt: string;
}

export interface InvoicePaidData {
  invoiceId: string;
  referenceType: 'lease' | 'order' | 'manual';
  referenceId: string | null;
  amount: number;
  currency: string;
  paidAt: string;
}

export interface OrderPlacedData {
  orderId: string;
  orderNumber?: string;
  customerId: string;
  propertyId?: string;
  hubId?: string;
  ownerId?: string | null;
  total: number;
  currency: string;
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number }>;
  paymentMethod?: string;
  isPaid?: boolean;
  paidMethod?: 'cash' | 'bank_transfer' | 'card' | 'ewallet';
  recordedBy?: string;
  customerName?: string | null;
  roomNumber?: string | null;
}

export interface OrderPaidData {
  orderId: string;
  orderNumber?: string;
  customerId?: string;
  propertyId?: string;
  ownerId?: string | null;
  amount: number;
  currency: string;
  paymentMethod?: string;
  paidMethod?: 'cash' | 'bank_transfer' | 'card' | 'ewallet';
  recordedBy?: string;
  paidAt: string;
}

export interface OrderCancelledData {
  orderId: string;
  customerId: string;
}

export interface GroceryOrderCreatedData {
  orderId: string;
  orderNumber: string;
  propertyId: string;
  hubId: string;
  roomNumber: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  currency: string;
  deliveryType: 'ROOM_DELIVERY' | 'LOBBY_PICKUP' | 'STANDARD';
  paymentMethod: 'DEBT_ADDED_TO_RENT' | 'VIETQR' | 'COD';
  items: Array<{
    productName: string;
    uomName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  note?: string;
  createdAt: string;
}

export interface TenantDebtChargeRequestedData {
  orderId: string;
  orderNumber: string;
  tenantId: string;
  contractId: string;
  propertyId: string;
  amount: number;
  currency: string;
  description: string;
  period: string; // YYYY-MM
  requestedAt: string;
}

export interface InventoryThresholdDepletedData {
  hubId: string;
  propertyId: string;
  propertyName: string;
  productId: string;
  productName: string;
  currentBaseQty: number;
  minThreshold: number;
  baseUom: string;
  alertLevel: 'WARNING' | 'CRITICAL';
}

export interface NotificationLandlordAlertData {
  eventType: string;
  propertyId: string;
  managerUserIds: string[];
  orderId: string;
  orderNumber: string;
  roomNumber: string;
  customerName: string;
  customerPhone: string;
  itemsSummary: string;
  totalAmount: number;
  deliveryType: string;
  paymentMethod: string;
  zaloWebhookUrl?: string | null;
  zaloGroupId?: string | null;
  telegramChatId?: string | null;
  note?: string | null;
  createdAt: string;
}

