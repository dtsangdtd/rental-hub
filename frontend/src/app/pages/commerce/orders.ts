import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ListResponse, Order, OrderStatus } from '../../core/models';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';

const ORDER_FILTERS = ['all', 'pending', 'paid', 'fulfilled', 'cancelled'] as const;
type OrderFilter = (typeof ORDER_FILTERS)[number];

@Component({
  selector: 'app-orders',
  imports: [RouterLink, DatePipe, MoneyPipe, StatusBadge, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly items = signal<Order[]>([]);
  protected readonly loading = signal(true);
  protected readonly filters = ORDER_FILTERS;
  protected readonly filter = signal<OrderFilter>('all');

  protected readonly isStaff = computed(() => {
    const role = this.auth.role();
    return role === 'admin' || role === 'accountant';
  });

  protected readonly filtered = computed(() => {
    const f = this.filter();
    if (f === 'all') return this.items();
    return this.items().filter((o) => o.status === f);
  });

  constructor() {
    void this.load();
  }

  protected async cancel(o: Order, ev: Event) {
    ev.stopPropagation();
    const ok = await this.confirm.ask({
      title: `Cancel Order #${o.id.slice(0, 8)}?`,
      message: 'Items will be restored to store inventory and the unpaid invoice will be voided.',
      confirmText: 'Cancel Order',
      danger: true,
    });
    if (!ok) return;

    try {
      await this.api.post(`/commerce/orders/${o.id}/cancel`);
      this.toast.success('Order cancelled and inventory restored');
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  private async load() {
    try {
      const res = await this.api.get<ListResponse<Order>>('/commerce/orders');
      this.items.set(res.items);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
