import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ListResponse, Order, RevenueStats } from '../../core/models';
import { OrderNotificationService } from '../../core/order-notification.service';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Pagination } from '../../shared/pagination';

const ORDER_FILTERS = ['all', 'pending', 'paid', 'fulfilled', 'cancelled'] as const;
type OrderFilter = (typeof ORDER_FILTERS)[number];

type PeriodType = 'today' | 'month' | 'year' | 'all' | 'custom';
type SourceType = 'ALL' | 'POS' | 'TENANT' | 'ONLINE';

@Component({
  selector: 'app-orders',
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe, StatusBadge, Icon, Pagination],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifService = inject(OrderNotificationService);

  protected readonly items = signal<Order[]>([]);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly statsLoading = signal(false);
  protected readonly query = signal('');
  protected readonly filters = ORDER_FILTERS;
  protected readonly filter = signal<OrderFilter>('all');

  // Revenue analytics & date filters
  protected readonly stats = signal<RevenueStats | null>(null);
  protected readonly period = signal<PeriodType>('month');
  protected readonly source = signal<SourceType>('ALL');
  protected readonly startDate = signal<string>('');
  protected readonly endDate = signal<string>('');

  get q(): string {
    return this.query();
  }
  set q(v: string) {
    this.query.set(v);
  }

  protected readonly isManager = computed(() => {
    const role = this.auth.role();
    return role === 'admin' || role === 'accountant' || role === 'landlord';
  });

  protected readonly isStaff = computed(() => {
    const role = this.auth.role();
    return role === 'admin' || role === 'accountant';
  });

  protected readonly filtered = computed(() => this.items());

  ngOnInit() {
    this.initDefaultDates('month');
    void this.load();
    if (this.isManager()) {
      void this.loadStats();
    }
  }

  private initDefaultDates(p: PeriodType) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');

    if (p === 'today') {
      const todayStr = `${y}-${m}-${d}`;
      this.startDate.set(todayStr);
      this.endDate.set(todayStr);
    } else if (p === 'month') {
      this.startDate.set(`${y}-${m}-01`);
      this.endDate.set(`${y}-${m}-${d}`);
    } else if (p === 'year') {
      this.startDate.set(`${y}-01-01`);
      this.endDate.set(`${y}-${m}-${d}`);
    } else if (p === 'all') {
      this.startDate.set('');
      this.endDate.set('');
    }
  }

  protected setPeriod(p: PeriodType) {
    this.period.set(p);
    this.initDefaultDates(p);
    this.page.set(1);
    void this.load();
    if (this.isManager()) void this.loadStats();
  }

  protected setSource(s: SourceType) {
    this.source.set(s);
    this.page.set(1);
    void this.load();
    if (this.isManager()) void this.loadStats();
  }

  protected onCustomDateChange() {
    this.period.set('custom');
    this.page.set(1);
    void this.load();
    if (this.isManager()) void this.loadStats();
  }

  protected onSearchChange() {
    this.page.set(1);
    void this.load();
  }

  protected setFilter(f: OrderFilter) {
    this.filter.set(f);
    this.page.set(1);
    void this.load();
  }

  protected onPageChange(p: number) {
    this.page.set(p);
    void this.load();
  }

  protected onPageSizeChange(s: number) {
    this.pageSize.set(s);
    this.page.set(1);
    void this.load();
  }

  protected async deliver(o: Order, ev: Event) {
    ev.stopPropagation();
    const ok = await this.confirm.ask({
      title: `Xác nhận đã giao đơn #${o.order_number || o.id.slice(0, 8)}?`,
      message:
        o.payment_method === 'DEBT_ADDED_TO_RENT'
          ? `Đơn hàng sẽ được chuyển thành Đã giao và tự động gộp vào công nợ hóa đơn phòng tháng này của khách thuê.`
          : `Xác nhận đã bàn giao hàng thành công tận phòng cho khách.`,
      confirmText: 'Xác nhận đã giao',
    });
    if (!ok) return;

    try {
      await this.api.post(`/commerce/orders/${o.id}/deliver`);
      this.toast.success(`Đã xác nhận giao đơn #${o.order_number || o.id.slice(0, 8)}`);
      await this.load();
      if (this.isManager()) await this.loadStats();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async cancel(o: Order, ev: Event) {
    ev.stopPropagation();
    const ok = await this.confirm.ask({
      title: `Hủy đơn #${o.order_number || o.id.slice(0, 8)}?`,
      message: 'Các sản phẩm sẽ được hoàn lại kho và hóa đơn (nếu có) sẽ được hủy.',
      confirmText: 'Hủy đơn hàng',
      danger: true,
    });
    if (!ok) return;

    try {
      await this.api.post(`/commerce/orders/${o.id}/cancel`);
      this.toast.success('Đã hủy đơn hàng');
      await this.load();
      if (this.isManager()) await this.loadStats();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async loadStats() {
    this.statsLoading.set(true);
    try {
      const res = await this.api.get<RevenueStats>('/commerce/orders/revenue-stats', {
        startDate: this.startDate() || undefined,
        endDate: this.endDate() || undefined,
        source: this.source() === 'ALL' ? undefined : this.source(),
      });
      this.stats.set(res);
    } catch (err) {
      console.warn('Could not load revenue stats:', err);
    } finally {
      this.statsLoading.set(false);
    }
  }

  protected async load() {
    this.loading.set(true);
    try {
      const res = await this.api.get<ListResponse<Order>>('/commerce/orders', {
        page: this.page(),
        limit: this.pageSize(),
        status: this.filter() === 'all' ? undefined : this.filter(),
        q: this.query().trim() || undefined,
        startDate: this.startDate() || undefined,
        endDate: this.endDate() || undefined,
        source: this.source() === 'ALL' ? undefined : this.source(),
      });
      this.items.set(res.items || []);
      this.total.set(res.total ?? (res.items?.length || 0));
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
