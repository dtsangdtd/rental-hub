import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth.guards';
import { AuthStore } from './core/auth.store';
import { ADMIN_ONLY, COMMERCE_ALL, COMMERCE_MANAGE, FINANCE, READ_PROPERTY } from './nav';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], title: 'Sign in · RentalHub', loadComponent: () => import('./pages/auth/login').then((m) => m.LoginPage) },
  { path: 'register', canActivate: [guestGuard], title: 'Create account · RentalHub', loadComponent: () => import('./pages/auth/register').then((m) => m.RegisterPage) },
  {
    path: '',
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: () => (inject(AuthStore).isLoggedIn() ? 'dashboard' : 'shop') },
      { path: 'dashboard', canActivate: [authGuard], title: 'Dashboard · RentalHub', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage) },

      // Rentals (property-service)
      { path: 'properties', title: 'Properties · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/properties').then((m) => m.PropertiesPage) },
      { path: 'properties/:id', title: 'Property · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/property-detail').then((m) => m.PropertyDetailPage) },
      { path: 'tenants', title: 'Tenants · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/tenants').then((m) => m.TenantsPage) },
      { path: 'leases', title: 'Leases · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/leases').then((m) => m.LeasesPage) },
      { path: 'residence', title: 'Tạm trú, tạm vắng · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: READ_PROPERTY }, loadComponent: () => import('./pages/property/residence').then((m) => m.ResidencePage) },

      // Accounting (accounting-service)
      { path: 'invoices', title: 'Invoices · RentalHub', canActivate: [authGuard], loadComponent: () => import('./pages/accounting/invoices').then((m) => m.InvoicesPage) },
      { path: 'invoices/:id', title: 'Invoice · RentalHub', canActivate: [authGuard], loadComponent: () => import('./pages/accounting/invoice-detail').then((m) => m.InvoiceDetailPage) },
      { path: 'rental-bill', title: 'Hóa đơn tiền nhà (PDF) · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: FINANCE }, loadComponent: () => import('./pages/rental-bill/rental-bill').then((m) => m.RentalBillPage) },
      { path: 'expenses', title: 'Expenses · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: FINANCE }, loadComponent: () => import('./pages/accounting/expenses').then((m) => m.ExpensesPage) },
      { path: 'reports', title: 'Reports · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: FINANCE }, loadComponent: () => import('./pages/accounting/reports').then((m) => m.ReportsPage) },

      // Commerce (commerce-service) - Public for both retail guests and tenants
      { path: 'shop', title: 'Cửa hàng tiện lợi · RentalHub', loadComponent: () => import('./pages/commerce/shop').then((m) => m.ShopPage) },
      { path: 'pos', title: 'Máy POS Bán Hàng · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: COMMERCE_MANAGE }, loadComponent: () => import('./pages/commerce/pos').then((m) => m.PosPage) },
      { path: 'cart', title: 'Giỏ hàng · RentalHub', loadComponent: () => import('./pages/commerce/cart').then((m) => m.CartPage) },
      { path: 'guest-orders', title: 'Tra cứu đơn hàng · RentalHub', loadComponent: () => import('./pages/commerce/guest-orders').then((m) => m.GuestOrdersPage) },
      { path: 'orders', title: 'Orders · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: COMMERCE_ALL }, loadComponent: () => import('./pages/commerce/orders').then((m) => m.OrdersPage) },
      { path: 'orders/:id', title: 'Chi tiết đơn hàng · RentalHub', loadComponent: () => import('./pages/commerce/order-detail').then((m) => m.OrderDetailPage) },
      { path: 'products', title: 'My products · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: COMMERCE_MANAGE }, loadComponent: () => import('./pages/commerce/products').then((m) => m.ProductsPage) },

      // Admin (auth-service)
      { path: 'users', title: 'Users · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: ADMIN_ONLY }, loadComponent: () => import('./pages/admin/users').then((m) => m.UsersPage) },
      { path: 'stores', title: 'Cửa hàng & Hubs · RentalHub', canActivate: [authGuard, roleGuard], data: { roles: COMMERCE_MANAGE }, loadComponent: () => import('./pages/admin/stores').then((m) => m.StoresPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
