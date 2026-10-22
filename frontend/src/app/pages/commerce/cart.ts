import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { CartService } from '../../core/cart.service';
import { Order } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-cart',
  imports: [FormsModule, RouterLink, MoneyPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cart.html',
  styleUrl: './cart.scss',
})
export class CartPage {
  private readonly api = inject(Api);
  protected readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected note = '';

  protected mainCurrency(): string {
    return this.cart.currencies()[0] ?? 'VND';
  }

  protected async checkout() {
    if (this.cart.mixedCurrency()) {
      this.toast.error('All items must have the same currency');
      return;
    }

    this.submitting.set(true);
    try {
      const items = this.cart.lines().map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
      }));

      const order = await this.api.post<Order>('/commerce/orders', {
        items,
        note: this.note.trim() || undefined,
      });

      this.toast.success(`Order placed! Order #${order.id.slice(0, 8)}`);
      this.cart.clear();
      await this.router.navigate(['/orders', order.id]);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
