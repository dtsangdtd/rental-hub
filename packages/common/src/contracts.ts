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
  InvoicePaid: 'accounting.invoice.paid',
  OrderPlaced: 'commerce.order.placed',
  OrderCancelled: 'commerce.order.cancelled',
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
  customerId: string;
  total: number;
  currency: string;
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number }>;
}

export interface OrderCancelledData {
  orderId: string;
  customerId: string;
}
