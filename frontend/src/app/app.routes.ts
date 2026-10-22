import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth.guards';
import { FINANCE, READ_PROPERTY, SELLER } from './nav';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], title: 'Sign in · RentalHub', loadComponent: () => import('./pages/auth/login').then((m) => m.LoginPage) },
  { path: 'register', canActivate: [guestGuard], title: 'Create account · RentalHub', loadComponent: () => import('./pages/auth/register').then((m) => m.RegisterPage) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: 'Dashboard · RentalHub', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage) },

      // Rentals (property-service)
      { path: 'properties', title: 'Properties · RentalHub', canActivate: [roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/properties').then((m) => m.PropertiesPage) },
      { path: 'properties/:id', title: 'Property · RentalHub', canActivate: [roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/property-detail').then((m) => m.PropertyDetailPage) },
      { path: 'tenants', title: 'Tenants · RentalHub', canActivate: [roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/tenants').then((m) => m.TenantsPage) },
      { path: 'leases', title: 'Leases · RentalHub', canActivate: [roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/leases').then((m) => m.LeasesPage) },

      // Accounting (accounting-service)
      { path: 'invoices', title: 'Invoices · RentalHub', loadComponent: () => import('./pages/accounting/invoices').then((m) => m.InvoicesPage) },
      { path: 'invoices/:id', title: 'Invoice · RentalHub', loadComponent: () => import('./pages/accounting/invoice-detail').then((m) => m.InvoiceDetailPage) },
      { path: 'rental-bill', title: 'Hóa đơn tiền nhà (PDF) · RentalHub', canActivate: [roleGuard], data: { roles: FINANCE }, loadComponent: () => import('./pages/rental-bill/rental-bill').then((m) => m.RentalBillPage) },
      { path: 'expenses', title: 'Expenses · RentalHub', canActivate: [roleGuard], data: { roles: FINANCE }, loadComponent: () => import('./pages/accounting/expenses').then((m) => m.ExpensesPage) },
      { path: 'reports', title: 'Reports · RentalHub', canActivate: [roleGuard], data: { roles: FINANCE }, loadComponent: () => import('./pages/accounting/reports').then((m) => m.ReportsPage) },

      // Commerce (commerce-service)
      { path: 'shop', title: 'Shop · RentalHub', loadComponent: () => import('./pages/commerce/shop').then((m) => m.ShopPage) },
      { path: 'cart', title: 'Cart · RentalHub', loadComponent: () => import('./pages/commerce/cart').then((m) => m.CartPage) },
      { path: 'orders', title: 'Orders · RentalHub', loadComponent: () => import('./pages/commerce/orders').then((m) => m.OrdersPage) },
      { path: 'orders/:id', title: 'Order · RentalHub', loadComponent: () => import('./pages/commerce/order-detail').then((m) => m.OrderDetailPage) },
      { path: 'products', title: 'My products · RentalHub', canActivate: [roleGuard], data: { roles: SELLER }, loadComponent: () => import('./pages/commerce/products').then((m) => m.ProductsPage) },

      // Admin (auth-service)
      { path: 'users', title: 'Users · RentalHub', canActivate: [roleGuard], data: { roles: ['admin'] }, loadComponent: () => import('./pages/admin/users').then((m) => m.UsersPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
