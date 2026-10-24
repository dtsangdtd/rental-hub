import { Role } from './core/models';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  roles?: Role[];
  key?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  key?: string;
}

export const READ_PROPERTY: Role[] = ['admin', 'landlord', 'accountant'];
export const MANAGE_PROPERTY: Role[] = ['admin', 'landlord'];
export const FINANCE: Role[] = ['admin', 'accountant', 'landlord'];
export const COMMERCE_MANAGE: Role[] = ['admin', 'landlord'];
export const COMMERCE_ALL: Role[] = ['admin', 'landlord', 'accountant', 'tenant'];
export const TENANT_ONLY: Role[] = ['tenant'];
export const ADMIN_ONLY: Role[] = ['admin'];

/** Sidebar navigation — mirrors the role matrix in AGENTS.md §5. */
export const NAV: NavSection[] = [
  {
    title: 'Overview',
    key: 'nav.overview',
    items: [{ label: 'Dashboard', path: '/dashboard', icon: 'dashboard', key: 'nav.dashboard' }],
  },
  {
    title: 'Rentals',
    key: 'nav.rentals',
    items: [
      { label: 'Properties', path: '/properties', icon: 'building', roles: READ_PROPERTY, key: 'nav.properties' },
      { label: 'Tenants', path: '/tenants', icon: 'users', roles: READ_PROPERTY, key: 'nav.tenants' },
      { label: 'Leases', path: '/leases', icon: 'key', roles: READ_PROPERTY, key: 'nav.leases' },
      { label: 'Tạm trú, tạm vắng', path: '/residence', icon: 'shield', roles: READ_PROPERTY, key: 'nav.residence' },
    ],
  },
  {
    title: 'Accounting',
    key: 'nav.accounting',
    items: [
      { label: 'Invoices', path: '/invoices', icon: 'receipt', key: 'nav.invoices' },
      { label: 'Rental bill (PDF)', path: '/rental-bill', icon: 'file', roles: FINANCE, key: 'nav.rentalBill' },
      { label: 'Expenses', path: '/expenses', icon: 'wallet', roles: FINANCE, key: 'nav.expenses' },
      { label: 'Reports', path: '/reports', icon: 'chart', roles: FINANCE, key: 'nav.reports' },
    ],
  },
  {
    title: 'Commerce',
    key: 'nav.commerce',
    items: [
      { label: 'Máy POS Quầy', path: '/pos', icon: 'barcode', roles: COMMERCE_MANAGE, key: 'nav.pos' },
      { label: 'Cửa hàng & Hubs', path: '/stores', icon: 'building', roles: COMMERCE_MANAGE, key: 'nav.stores' },
      { label: 'Orders', path: '/orders', icon: 'package', roles: COMMERCE_ALL, key: 'nav.orders' },
      { label: 'My products', path: '/products', icon: 'tag', roles: COMMERCE_MANAGE, key: 'nav.products' },
      { label: 'Shop', path: '/shop', icon: 'bag', roles: TENANT_ONLY, key: 'nav.shop' },
      { label: 'Cart', path: '/cart', icon: 'cart', roles: TENANT_ONLY, key: 'nav.cart' },
      { label: 'Tra cứu đơn', path: '/guest-orders', icon: 'search', roles: TENANT_ONLY, key: 'nav.guestOrders' },
    ],
  },
  {
    title: 'Admin',
    key: 'nav.admin',
    items: [
      { label: 'Users', path: '/users', icon: 'shield', roles: ADMIN_ONLY, key: 'nav.users' },
      { label: 'Cửa hàng & Hubs', path: '/stores', icon: 'building', roles: ADMIN_ONLY, key: 'nav.stores' },
    ],
  },
];
