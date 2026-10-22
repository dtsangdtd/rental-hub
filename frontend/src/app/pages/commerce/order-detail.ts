import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { Invoice, ListResponse, OrderDetail } from '../../core/models';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, DatePipe, MoneyPipe, StatusBadge, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetailPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  protected readonly order = signal<OrderDetail | null>(null);
  protected readonly invoice = signal<Invoice | null>(null);

  protected readonly isAdmin = computed(() => this.auth.hasRole('admin'));

  protected readonly canCancel = computed(() => {
    const o = this.order();
    if (!o || o.status !== 'pending') return false;
    const u = this.auth.user();
    if (!u) return false;
    return u.role === 'admin' || u.role === 'accountant' || o.customer_id === u.id;
  });

  protected readonly canFulfill = computed(() => {
    const o = this.order();
    return this.isAdmin() && o?.status === 'paid';
  });

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected async cancel() {
    const o = this.order();
    if (!o) return;
    const ok = await this.confirm.ask({
      title: 'Cancel this order?',
      message: 'Pending items will be returned to stock, and the linked invoice will be voided.',
      confirmText: 'Cancel Order',
      danger: true,
    });
    if (!ok) return;

    try {
      await this.api.post(`/commerce/orders/${o.id}/cancel`);
      this.toast.success('Order cancelled');
      await this.load(o.id);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async fulfill() {
    const o = this.order();
    if (!o) return;
    try {
      await this.api.post(`/commerce/orders/${o.id}/fulfill`);
      this.toast.success('Order fulfilled successfully');
      await this.load(o.id);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  private async load(id: string) {
    try {
      const order = await this.api.get<OrderDetail>(`/commerce/orders/${id}`);
      this.order.set(order);

      // Search for linked invoice
      try {
        const invRes = await this.api.get<ListResponse<Invoice>>('/accounting/invoices');
        const match = invRes.items.find(
          (i) => i.reference_type === 'order' && i.reference_id === id,
        );
        if (match) this.invoice.set(match);
      } catch {
        // Accounting might be restricted for certain tenants
      }
    } catch (err) {
      this.toast.error(errorMessage(err));
      void this.router.navigate(['/orders']);
    }
  }
}
