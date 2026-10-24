import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import {
  BarcodeLookupResult,
  InventoryHub,
  POSReceipt,
  Product,
  ProductUom,
} from '../../core/models';
import { SoundAlertService } from '../../core/sound-alert.service';
import { ToastService } from '../../core/ui.services';
import { MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

export interface PosCartLine {
  product: Product;
  uom: ProductUom | null;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

@Component({
  selector: 'app-pos',
  imports: [FormsModule, RouterLink, DatePipe, CurrencyPipe, MoneyPipe, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.html',
  styleUrl: './pos.scss',
})
export class PosPage {
  private readonly api = inject(Api);
  protected readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly sound = inject(SoundAlertService);

  private readonly barcodeInputRef = viewChild<ElementRef<HTMLInputElement>>('barcodeInput');

  // Active Store / Hub
  protected readonly hubs = signal<InventoryHub[]>([]);
  protected readonly selectedHubId = signal<string>(localStorage.getItem('rh.selected_hub') || '');

  // Barcode Scanning State
  protected barcodeCode = '';
  protected isScanning = signal<boolean>(false);
  protected scanError = signal<string>('');

  // Cart / Items on counter
  protected readonly cart = signal<PosCartLine[]>([]);

  // Customer & Payment
  protected customerType = signal<'RETAIL' | 'TENANT'>('RETAIL');
  protected roomNumber = signal<string>('');
  protected customerName = signal<string>('');
  protected customerPhone = signal<string>('');
  protected paymentMethod = signal<'CASH' | 'VIETQR' | 'DEBT_ADDED_TO_RENT'>('CASH');
  protected cashGiven = signal<number | null>(null);
  protected orderNote = signal<string>('');

  // Quick Pick Popular Items
  protected readonly quickProducts = signal<Product[]>([]);
  protected readonly loading = signal(false);
  protected readonly checkingOut = signal(false);

  // Completed Receipt Modal
  protected readonly showReceiptModal = signal(false);
  protected readonly receiptData = signal<POSReceipt | null>(null);
  protected readonly receiptItems = signal<PosCartLine[]>([]);

  // Barcode Inbound Stocking Modal
  protected readonly showInboundModal = signal(false);
  protected inboundBarcode = '';
  protected inboundProduct = signal<Product | null>(null);
  protected inboundUom = signal<ProductUom | null>(null);
  protected inboundQty = 1;
  protected inboundBatchNo = '';
  protected inboundExpDate = '';
  protected inboundCostPrice = 0;
  protected inboundLoading = signal(false);

  // Computed Totals
  protected readonly totalAmount = computed(() =>
    this.cart().reduce((sum, item) => sum + item.subtotal, 0),
  );

  protected readonly totalItemsCount = computed(() =>
    this.cart().reduce((sum, item) => sum + item.quantity, 0),
  );

  protected readonly cashReturned = computed(() => {
    const given = this.cashGiven();
    const total = this.totalAmount();
    if (!given || given < total) return 0;
    return Math.round((given - total) * 100) / 100;
  });

  // Dynamic VietQR payment URL for counter QR display
  protected readonly counterVietQrUrl = computed(() => {
    const total = this.totalAmount();
    if (total <= 0) return '';
    // VietQR standard quicklink format
    const bankId = 'MB';
    const accountNo = '0988776655';
    const template = 'compact2';
    const accountName = encodeURIComponent('RENTALHUB CONVENIENCE');
    const memo = encodeURIComponent(`POS TT ${total}D`);
    return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?amount=${total}&addInfo=${memo}&accountName=${accountName}`;
  });

  constructor() {
    this.setDefaultExpDate();
    void this.initPos();
  }

  private setDefaultExpDate() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    this.inboundExpDate = d.toISOString().slice(0, 10);
  }

  private async initPos() {
    this.loading.set(true);
    try {
      await Promise.all([this.loadHubs(), this.loadQuickProducts()]);
      this.focusBarcode();
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadHubs() {
    try {
      const res = await this.api.get<{ items: InventoryHub[] }>('/commerce/hubs');
      this.hubs.set(res.items || []);
      if (!this.selectedHubId() && res.items?.length) {
        this.selectedHubId.set(res.items[0].id);
        localStorage.setItem('rh.selected_hub', res.items[0].id);
      }
    } catch {}
  }

  protected async loadQuickProducts() {
    try {
      const res = await this.api.get<{ items: Product[] }>('/commerce/products', {
        limit: 12,
        hubId: this.selectedHubId() || undefined,
      });
      this.quickProducts.set(res.items || []);
    } catch {}
  }

  protected onHubChange(hubId: string) {
    this.selectedHubId.set(hubId);
    localStorage.setItem('rh.selected_hub', hubId);
    void this.loadQuickProducts();
    this.focusBarcode();
  }

  protected focusBarcode() {
    setTimeout(() => {
      this.barcodeInputRef()?.nativeElement?.focus();
    }, 100);
  }

  /**
   * Hardware Scanner Barcode Handler (fires on Enter key from USB/Bluetooth scanner)
   */
  protected async onBarcodeScanSubmit() {
    const code = this.barcodeCode.trim();
    if (!code) return;

    this.scanError.set('');
    this.isScanning.set(true);

    try {
      const res = await this.api.get<BarcodeLookupResult>('/commerce/products/lookup-barcode', {
        code,
        hubId: this.selectedHubId() || undefined,
      });

      this.sound.playBarcodeBeep();
      this.addItemToCart(res.product, res.matchedUom);
      this.barcodeCode = '';
      this.toast.success(`+1 ${res.product.name} (${res.activeUomName})`);
    } catch (err) {
      const msg = errorMessage(err);
      this.scanError.set(msg);
      this.toast.error(msg);
    } finally {
      this.isScanning.set(false);
      this.focusBarcode();
    }
  }

  protected addItemToCart(prod: Product, uom?: ProductUom | null) {
    const targetUom = uom ?? (prod.uoms?.find((u) => u.is_default) || prod.uoms?.[0] || null);
    const unitPrice = targetUom ? Number(targetUom.retail_price) : Number(prod.price);

    this.cart.update((items) => {
      const existingIdx = items.findIndex(
        (i) => i.product.id === prod.id && (i.uom?.id ?? null) === (targetUom?.id ?? null),
      );

      if (existingIdx >= 0) {
        const copy = [...items];
        const cur = copy[existingIdx];
        const newQty = cur.quantity + 1;
        copy[existingIdx] = {
          ...cur,
          quantity: newQty,
          subtotal: Math.round(newQty * cur.unitPrice * 100) / 100,
        };
        return copy;
      }

      return [
        ...items,
        {
          product: prod,
          uom: targetUom,
          unitPrice,
          quantity: 1,
          subtotal: unitPrice,
        },
      ];
    });

    if (this.paymentMethod() === 'CASH' && this.cashGiven()) {
      // Auto adjust if needed
    }
  }

  protected updateQuantity(idx: number, delta: number) {
    this.cart.update((items) => {
      const copy = [...items];
      const item = copy[idx];
      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        copy.splice(idx, 1);
        return copy;
      }
      copy[idx] = {
        ...item,
        quantity: newQty,
        subtotal: Math.round(newQty * item.unitPrice * 100) / 100,
      };
      return copy;
    });
  }

  protected removeItem(idx: number) {
    this.cart.update((items) => items.filter((_, i) => i !== idx));
  }

  protected clearCart() {
    this.cart.set([]);
    this.cashGiven.set(null);
    this.focusBarcode();
  }

  protected setQuickCash(amount: number) {
    this.cashGiven.set(amount);
  }

  protected setExactCash() {
    this.cashGiven.set(this.totalAmount());
  }

  /**
   * Finalize Counter Checkout
   */
  protected async processCheckout() {
    if (this.cart().length === 0) {
      this.toast.error('Giỏ hàng trống! Vui lòng quét mã vạch sản phẩm.');
      return;
    }

    if (this.customerType() === 'TENANT' && !this.roomNumber().trim()) {
      this.toast.error('Vui lòng nhập số phòng của khách thuê.');
      return;
    }

    if (this.paymentMethod() === 'CASH' && this.cashGiven() && this.cashGiven()! < this.totalAmount()) {
      this.toast.error('Số tiền khách đưa chưa đủ để thanh toán.');
      return;
    }

    this.checkingOut.set(true);

    try {
      const itemsPayload = this.cart().map((i) => ({
        productId: i.product.id,
        uomId: i.uom?.id ?? undefined,
        quantity: i.quantity,
      }));

      const res = await this.api.post<{
        success: boolean;
        order: any;
        receipt: POSReceipt;
      }>('/commerce/pos/checkout', {
        hubId: this.selectedHubId() || undefined,
        customerType: this.customerType(),
        roomNumber: this.customerType() === 'TENANT' ? this.roomNumber().trim() : undefined,
        recipientName: this.customerName().trim() || undefined,
        recipientPhone: this.customerPhone().trim() || undefined,
        paymentMethod: this.paymentMethod(),
        cashGiven: this.paymentMethod() === 'CASH' ? this.cashGiven() : undefined,
        items: itemsPayload,
        note: this.orderNote().trim() || undefined,
      });

      this.sound.playPaymentSuccess();
      this.receiptData.set(res.receipt);
      this.receiptItems.set([...this.cart()]);
      this.showReceiptModal.set(true);

      // Reset transaction
      this.cart.set([]);
      this.cashGiven.set(null);
      this.orderNote.set('');
      if (this.customerType() === 'RETAIL') {
        this.customerName.set('');
        this.customerPhone.set('');
      }

      this.toast.success(`Đã thanh toán thành công đơn #${res.receipt.orderNumber}!`);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.checkingOut.set(false);
      this.focusBarcode();
    }
  }

  protected printReceipt() {
    window.print();
  }

  // ---------- Barcode Inbound Stocking (Nhập Kho) ----------
  protected openInboundModal() {
    this.inboundBarcode = '';
    this.inboundProduct.set(null);
    this.inboundUom.set(null);
    this.inboundQty = 1;
    this.inboundCostPrice = 0;
    this.inboundBatchNo = `LOT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    this.setDefaultExpDate();
    this.showInboundModal.set(true);
  }

  protected async onInboundBarcodeScan() {
    const code = this.inboundBarcode.trim();
    if (!code) return;

    try {
      const res = await this.api.get<BarcodeLookupResult>('/commerce/products/lookup-barcode', {
        code,
        hubId: this.selectedHubId() || undefined,
      });
      this.sound.playBarcodeBeep();
      this.inboundProduct.set(res.product);
      this.inboundUom.set(res.matchedUom || null);
      this.toast.success(`Tìm thấy sản phẩm: ${res.product.name} (${res.activeUomName})`);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async submitInboundStock() {
    if (!this.selectedHubId()) {
      this.toast.error('Vui lòng chọn Kho Hub trước khi nhập hàng.');
      return;
    }
    if (!this.inboundBarcode.trim()) {
      this.toast.error('Vui lòng quét hoặc nhập mã vạch sản phẩm.');
      return;
    }
    if (!this.inboundExpDate) {
      this.toast.error('Vui lòng nhập hạn sử dụng (EXP Date).');
      return;
    }

    this.inboundLoading.set(true);
    try {
      const res = await this.api.post<{ message: string; newHubStock: number }>(
        '/commerce/inventory/barcode-import',
        {
          hubId: this.selectedHubId(),
          barcode: this.inboundBarcode.trim(),
          quantity: Number(this.inboundQty),
          batchNumber: this.inboundBatchNo.trim() || undefined,
          expDate: this.inboundExpDate,
          costPrice: Number(this.inboundCostPrice) || 0,
        },
      );

      this.sound.playPaymentSuccess();
      this.toast.success(res.message);
      this.showInboundModal.set(false);
      void this.loadQuickProducts();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.inboundLoading.set(false);
      this.focusBarcode();
    }
  }
}
