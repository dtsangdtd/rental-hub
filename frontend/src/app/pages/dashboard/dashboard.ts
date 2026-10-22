import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, todayIso } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { CartService } from '../../core/cart.service';
import { Invoice, ListResponse, Order, Property, ReportSummary } from '../../core/models';
import { FINANCE, MANAGE_PROPERTY, READ_PROPERTY } from '../../nav';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';

interface QuickAction { label: string; path: string; icon: string; }

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, MoneyPipe, StatusBadge, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  private readonly api = inject(Api);
  protected readonly auth = inject(AuthStore);
  protected readonly cart = inject(CartService);

  protected readonly loading = signal(true);
  protected readonly report = signal<ReportSummary | null>(null);
  protected readonly properties = signal<Property[]>([]);
  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly orders = signal<Order[]>([]);

  protected readonly isFinance = computed(() => this.auth.hasRole(...FINANCE));
  protected readonly canReadProperty = computed(() => this.auth.hasRole(...READ_PROPERTY));
  protected readonly today = new Date();
  protected readonly greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();

  /** Prefer VND (the platform default) when several currencies exist. */
  protected readonly currency = computed(() => {
    const keys = Object.keys(this.report()?.totals ?? {});
    return keys.includes('VND') ? 'VND' : (keys[0] ?? 'VND');
  });
  protected readonly totals = computed(() => this.report()?.totals[this.currency()] ?? { income: 0, expenses: 0, profit: 0 });
  protected readonly outstanding = computed(() => this.report()?.outstanding.find((o) => o.currency === this.currency()) ?? { total: 0, count: 0 });

  protected readonly units = computed(() => this.properties().reduce((n, p) => n + (p.unit_count ?? 0), 0));
  protected readonly occupied = computed(() => this.properties().reduce((n, p) => n + (p.occupied_count ?? 0), 0));
  protected readonly occupancy = computed(() => (this.units() ? Math.round((this.occupied() / this.units()) * 100) : 0));

  protected readonly openInvoices = computed(() => this.invoices().filter((i) => i.status === 'unpaid' || i.status === 'partial'));
  protected readonly amountDue = computed(() => this.openInvoices().reduce((s, i) => s + i.amount - i.amount_paid, 0));
  protected readonly dueCurrency = computed(() => this.openInvoices()[0]?.currency ?? 'VND');
  protected readonly barMax = computed(() => Math.max(this.totals().income, this.totals().expenses, 1));

  protected readonly actions = computed<QuickAction[]>(() => {
    const a: QuickAction[] = [];
    if (this.auth.hasRole(...MANAGE_PROPERTY)) a.push({ label: 'Add property', path: '/properties', icon: 'building' }, { label: 'New lease', path: '/leases', icon: 'key' });
    if (this.isFinance()) a.push({ label: 'Invoices', path: '/invoices', icon: 'receipt' }, { label: 'Reports', path: '/reports', icon: 'chart' });
    if (!this.isFinance()) a.push({ label: 'My invoices', path: '/invoices', icon: 'receipt' });
    a.push({ label: 'Shop', path: '/shop', icon: 'bag' });
    return a.slice(0, 4);
  });

  constructor() {
    void this.load();
  }

  private async load() {
    const monthStart = todayIso().slice(0, 8) + '01';
    const [report, props, invoices, orders] = await Promise.allSettled([
      this.isFinance() ? this.api.get<ReportSummary>('/accounting/reports/summary', { from: monthStart, to: todayIso() }) : Promise.resolve(null),
      this.canReadProperty() ? this.api.get<ListResponse<Property>>('/property/properties') : Promise.resolve({ items: [] }),
      this.api.get<ListResponse<Invoice>>('/accounting/invoices'),
      this.api.get<ListResponse<Order>>('/commerce/orders'),
    ]);
    if (report.status === 'fulfilled') this.report.set(report.value);
    if (props.status === 'fulfilled') this.properties.set(props.value.items);
    if (invoices.status === 'fulfilled') this.invoices.set(invoices.value.items);
    if (orders.status === 'fulfilled') this.orders.set(orders.value.items);
    this.loading.set(false);
  }
}
