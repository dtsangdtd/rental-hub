import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Order } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';

const LOOKUP_PHONE_KEY = 'rh.guest_lookup_phone';

@Component({
  selector: 'app-guest-orders',
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe, StatusBadge, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './guest-orders.html',
  styleUrl: './guest-orders.scss',
})
export class GuestOrdersPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);

  protected phone = signal<string>(localStorage.getItem(LOOKUP_PHONE_KEY) || '');
  protected readonly loading = signal(false);
  protected readonly searched = signal(false);
  protected readonly orders = signal<Order[]>([]);

  constructor() {
    if (this.phone().trim()) {
      void this.lookup();
    }
  }

  protected async lookup() {
    const p = this.phone().trim();
    if (!p || p.length < 8) {
      this.toast.error('Vui lòng nhập số điện thoại hợp lệ (tối thiểu 8 chữ số)');
      return;
    }

    localStorage.setItem(LOOKUP_PHONE_KEY, p);
    this.loading.set(true);
    this.searched.set(true);

    try {
      const res = await this.api.get<{ items: Order[] }>('/commerce/guest/orders', { phone: p });
      this.orders.set(res.items || []);
    } catch (err) {
      this.toast.error(errorMessage(err));
      this.orders.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
