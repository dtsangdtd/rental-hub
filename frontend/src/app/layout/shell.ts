import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth.store';
import { CartService } from '../core/cart.service';
import { VersionCheckService } from '../core/version-check.service';
import { NAV } from '../nav';
import { Icon } from '../shared/icon';
import { StatusBadge } from '../shared/format';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly auth = inject(AuthStore);
  protected readonly cart = inject(CartService);
  protected readonly versionService = inject(VersionCheckService);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);
  protected readonly nav = computed(() =>
    NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || this.auth.hasRole(...i.roles)) })).filter(
      (s) => s.items.length > 0,
    ),
  );
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
