import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth.store';
import { CartService } from '../core/cart.service';
import { VersionCheckService } from '../core/version-check.service';
import { I18nService } from '../core/i18n.service';
import { OrderNotificationItem, OrderNotificationService } from '../core/order-notification.service';
import { NAV } from '../nav';
import { Icon } from '../shared/icon';
import { MoneyPipe, StatusBadge } from '../shared/format';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, StatusBadge, DatePipe, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly auth = inject(AuthStore);
  protected readonly cart = inject(CartService);
  protected readonly versionService = inject(VersionCheckService);
  protected readonly i18n = inject(I18nService);
  protected readonly notifService = inject(OrderNotificationService);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);
  protected readonly notificationsOpen = signal(false);

  protected readonly canReceiveOrderAlerts = computed(() => {
    return this.auth.hasRole('admin', 'landlord', 'accountant');
  });

  protected toggleNotifications() {
    this.notificationsOpen.update((v) => !v);
  }

  protected onNotificationClick(item: OrderNotificationItem) {
    this.notificationsOpen.set(false);
    this.notifService.navigateToOrder(item);
  }
  protected readonly nav = computed(() => {
    // Read currentLang so signal reactivity triggers re-computation on language switch
    this.i18n.currentLang();
    return NAV.map((s) => ({
      title: s.key ? this.i18n.t(s.key) : s.title,
      items: s.items
        .filter((i) => {
          if (!this.auth.isLoggedIn()) {
            return i.path === '/shop' || i.path === '/cart' || i.path === '/guest-orders';
          }
          return !i.roles || this.auth.hasRole(...i.roles);
        })
        .map((i) => ({
          ...i,
          label: i.key ? this.i18n.t(i.key) : i.label,
        })),
    })).filter((s) => s.items.length > 0);
  });

  protected readonly initials = computed(() =>
    (this.auth.user()?.fullName ?? '?')
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  );

  constructor() {
    // Close the mobile drawer after navigating.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.menuOpen.set(false));
    // Keep profile fresh (role/name may have been changed by an admin).
    this.auth.refresh().catch(() => undefined);
  }
}
