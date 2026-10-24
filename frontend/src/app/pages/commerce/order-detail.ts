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
  protected readonly isLoggedIn = computed(() => this.auth.isLoggedIn());

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

  protected readonly canDeliver = computed(() => {
    const o = this.order();
    if (!o || o.status !== 'pending') return false;
    const u = this.auth.user();
    if (!u) return false;
    return u.role === 'admin' || u.role === 'landlord';
  });

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected async deliver() {
    const o = this.order();
    if (!o) return;
    const ok = await this.confirm.ask({
      title: `Xác nhận đã giao đơn #${o.order_number || o.id.slice(0, 8)}?`,
      message:
        o.payment_method === 'DEBT_ADDED_TO_RENT'
          ? 'Đơn hàng sẽ chuyển sang Đã giao và tự động gộp vào công nợ hóa đơn phòng tháng này của khách thuê.'
          : 'Xác nhận đã bàn giao hàng thành công tận phòng.',
      confirmText: 'Xác nhận đã giao',
    });
    if (!ok) return;

    try {
      await this.api.post(`/commerce/orders/${o.id}/deliver`);
      this.toast.success('Đã xác nhận giao hàng thành công!');
      await this.load(o.id);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async cancel() {
    const o = this.order();
    if (!o) return;
    const ok = await this.confirm.ask({
      title: 'Hủy đơn hàng này?',
      message: 'Các sản phẩm sẽ được hoàn lại kho và hóa đơn liên kết (nếu có) sẽ được hủy.',
      confirmText: 'Hủy đơn hàng',
      danger: true,
    });
    if (!ok) return;

    try {
      await this.api.post(`/commerce/orders/${o.id}/cancel`);
      this.toast.success('Đã hủy đơn hàng');
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
      void this.router.navigate([this.auth.isLoggedIn() ? '/orders' : '/guest-orders']);
    }
  }
}
