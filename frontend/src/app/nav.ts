import { Role } from './core/models';

export interface NavItem { label: string; path: string; icon: string; roles?: Role[]; }
export interface NavSection { title: string; items: NavItem[]; }

export const READ_PROPERTY: Role[] = ['admin', 'landlord', 'accountant'];
export const MANAGE_PROPERTY: Role[] = ['admin', 'landlord'];
export const FINANCE: Role[] = ['admin', 'accountant', 'landlord'];
export const SELLER: Role[] = ['admin', 'landlord'];

/** Sidebar navigation — mirrors the role matrix in AGENTS.md §5. */
export const NAV: NavSection[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', path: '/dashboard', icon: 'dashboard' }] },
  {
    title: 'Rentals',
    items: [
      { label: 'Properties', path: '/properties', icon: 'building', roles: READ_PROPERTY },
      { label: 'Tenants', path: '/tenants', icon: 'users', roles: READ_PROPERTY },
      { label: 'Leases', path: '/leases', icon: 'key', roles: READ_PROPERTY },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { label: 'Invoices', path: '/invoices', icon: 'receipt' },
      { label: 'Rental bill (PDF)', path: '/rental-bill', icon: 'file', roles: FINANCE },
      { label: 'Expenses', path: '/expenses', icon: 'wallet', roles: FINANCE },
      { label: 'Reports', path: '/reports', icon: 'chart', roles: FINANCE },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { label: 'Shop', path: '/shop', icon: 'bag' },
      { label: 'Orders', path: '/orders', icon: 'package' },
      { label: 'My products', path: '/products', icon: 'tag', roles: SELLER },
    ],
  },
  { title: 'Admin', items: [{ label: 'Users', path: '/users', icon: 'shield', roles: ['admin'] }] },
];
