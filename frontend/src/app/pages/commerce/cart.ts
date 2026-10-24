import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { CartService } from '../../core/cart.service';
import { InventoryHub } from '../../core/models';
import { SoundAlertService } from '../../core/sound-alert.service';
import { ToastService } from '../../core/ui.services';
import { MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';

export interface CheckoutSuccessResponse {
  orderId: string;
  orderNumber: string;
  status: string;
  deliveryType: string;
  paymentMethod: string;
  totalAmount: number;
  currency: string;
  roomNumber: string;
  estimatedDelivery: string;
  message: string;
}

const PROFILE_KEY = 'rh.tenant_profile';

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
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly soundAlert = inject(SoundAlertService);
  private readonly router = inject(Router);

  protected readonly hubs = signal<InventoryHub[]>([]);
  protected readonly customerType = signal<'TENANT' | 'RETAIL'>('TENANT');
  protected readonly propertyId = signal<string>('');
  protected readonly roomNumber = signal<string>('');
  protected readonly recipientAddress = signal<string>('');
  protected readonly recipientName = signal<string>('');
  protected readonly recipientPhone = signal<string>('');
  protected readonly deliveryType = signal<'ROOM_DELIVERY' | 'LOBBY_PICKUP' | 'STANDARD'>('ROOM_DELIVERY');
  protected readonly paymentMethod = signal<'DEBT_ADDED_TO_RENT' | 'VIETQR' | 'COD'>('DEBT_ADDED_TO_RENT');
  protected note = '';

  protected readonly submitting = signal(false);
  protected readonly orderSuccess = signal<CheckoutSuccessResponse | null>(null);

  protected mainCurrency(): string {
    return this.cart.currencies()[0] ?? 'VND';
  }

  constructor() {
    this.loadCachedProfile();
    void this.loadHubs();
  }

  private loadCachedProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.customerType) this.customerType.set(p.customerType);
        if (p.propertyId) this.propertyId.set(p.propertyId);
        if (p.roomNumber) this.roomNumber.set(p.roomNumber);
        if (p.recipientAddress) this.recipientAddress.set(p.recipientAddress);
        if (p.recipientName) this.recipientName.set(p.recipientName);
        if (p.recipientPhone) this.recipientPhone.set(p.recipientPhone);
        if (p.deliveryType) this.deliveryType.set(p.deliveryType);
        if (p.paymentMethod) this.paymentMethod.set(p.paymentMethod);
      }
    } catch {
      // ignore
    }

    const u = this.auth.user();
    if (u) {
      if (!this.recipientName() && u.fullName) this.recipientName.set(u.fullName);
    }
  }

  protected setCustomerType(type: 'TENANT' | 'RETAIL') {
    this.customerType.set(type);
    if (type === 'RETAIL') {
      if (this.paymentMethod() === 'DEBT_ADDED_TO_RENT') {
        this.paymentMethod.set('VIETQR');
      }
      this.deliveryType.set('STANDARD');
    } else {
      this.deliveryType.set('ROOM_DELIVERY');
    }
  }

  private saveProfile() {
    try {
      const p = {
        customerType: this.customerType(),
        propertyId: this.propertyId(),
        roomNumber: this.roomNumber().trim(),
        recipientAddress: this.recipientAddress().trim(),
        recipientName: this.recipientName().trim(),
        recipientPhone: this.recipientPhone().trim(),
        deliveryType: this.deliveryType(),
        paymentMethod: this.paymentMethod(),
      };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      // ignore
    }
  }

  protected async loadHubs() {
    try {
      const res = await this.api.get<{ items: InventoryHub[] }>('/commerce/hubs');
      this.hubs.set(res.items || []);
      if (!this.propertyId() && res.items?.length) {
        this.propertyId.set(res.items[0].property_id);
      }
    } catch {
      // non-blocking
    }
  }

  protected async checkout() {
    if (this.cart.mixedCurrency()) {
      this.toast.error('Tất cả sản phẩm phải có cùng đơn vị tiền tệ');
      return;
    }

    if (this.customerType() === 'TENANT') {
      if (!this.propertyId()) {
        this.toast.error('Vui lòng chọn tòa nhà / ký túc xá');
        return;
      }
      if (!this.roomNumber().trim()) {
        this.toast.error('Vui lòng nhập số phòng (Ví dụ: P.302, 101)');
        return;
      }
    } else {
      if (!this.recipientAddress().trim()) {
        this.toast.error('Vui lòng nhập địa chỉ nhận hàng chi tiết');
        return;
      }
      if (this.paymentMethod() === 'DEBT_ADDED_TO_RENT') {
        this.toast.error('Khách vãng lai chỉ áp dụng VietQR hoặc COD');
        return;
      }
    }

    if (!this.recipientPhone().trim()) {
      this.toast.error('Vui lòng nhập số điện thoại người nhận');
      return;
    }
    if (!this.recipientName().trim()) {
      this.toast.error('Vui lòng nhập tên người nhận');
      return;
    }

    this.submitting.set(true);
    this.saveProfile();

    try {
      const items = this.cart.lines().map((l) => ({
        productId: l.product.id,
        uomId: l.uom?.id,
        quantity: l.quantity,
      }));

      const res = await this.api.post<CheckoutSuccessResponse>('/commerce/checkout', {
        customerType: this.customerType(),
        propertyId: this.propertyId() || undefined,
        roomNumber: this.customerType() === 'TENANT' ? this.roomNumber().trim() : undefined,
        recipientAddress: this.customerType() === 'RETAIL' ? this.recipientAddress().trim() : undefined,
        recipientName: this.recipientName().trim(),
        recipientPhone: this.recipientPhone().trim(),
        deliveryType: this.deliveryType(),
        paymentMethod: this.paymentMethod(),
        note: this.note.trim() || undefined,
        items,
      });

      this.soundAlert.playNewOrderChime();
      this.toast.success(`Đặt hàng thành công! Mã đơn: ${res.orderNumber}`);
      this.orderSuccess.set(res);
      this.cart.clear();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }

  protected resetOrder() {
    this.orderSuccess.set(null);
    void this.router.navigate(['/shop']);
  }
}
