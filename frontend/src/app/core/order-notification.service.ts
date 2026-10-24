import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { SoundAlertService } from './sound-alert.service';
import { ToastService } from './ui.services';

export interface OrderNotificationItem {
  id: string;
  orderId: string;
  orderNumber: string;
  title: string;
  summary: string;
  totalAmount: number;
  roomNumber?: string;
  customerName?: string;
  customerType?: string;
  isPosCounter?: boolean;
  paymentMethod?: string;
  createdAt: string;
  read: boolean;
}

const STORAGE_KEY = 'rh.order_notifications';

@Injectable({ providedIn: 'root' })
export class OrderNotificationService {
  private readonly auth = inject(AuthStore);
  private readonly sound = inject(SoundAlertService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly notifications = signal<OrderNotificationItem[]>(this.loadFromStorage());
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  private eventSource: EventSource | null = null;

  constructor() {
    // Automatically manage SSE connection based on logged-in user role
    effect(() => {
      const user = this.auth.user();
      const role = user?.role;
      const isManager = role === 'admin' || role === 'landlord' || role === 'accountant';

      if (isManager) {
        this.connectSSE();
      } else {
        this.disconnectSSE();
      }
    });
  }

  private connectSSE() {
    if (this.eventSource || typeof window === 'undefined') return;

    try {
      this.eventSource = new EventSource('/api/commerce/events/orders-stream');

      this.eventSource.addEventListener('NEW_ORDER', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          this.handleIncomingOrder(data);
        } catch (err) {
          console.error('[SSE] Failed to parse order event:', err);
        }
      });

      this.eventSource.onerror = () => {
        // Native EventSource auto-reconnects
      };
    } catch (err) {
      console.warn('[SSE] Could not establish orders stream:', err);
    }
  }

  private disconnectSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private handleIncomingOrder(data: {
    id: string;
    orderNumber?: string;
    roomNumber?: string;
    customerName?: string;
    customerPhone?: string;
    itemsSummary?: string;
    totalAmount?: number;
    paymentMethod?: string;
    customerType?: string;
    isPosCounter?: boolean;
    createdAt?: string;
  }) {
    const isPos = Boolean(data.isPosCounter);
    const room = data.roomNumber && data.roomNumber !== 'Tại quầy' ? `Phòng ${data.roomNumber}` : null;
    const customer = data.customerName || (room ? `Cư dân ${room}` : (isPos ? 'Khách mua tại quầy' : 'Khách vãng lai'));
    const title = room ? `Đơn mới từ ${room}` : (isPos ? 'Đơn thanh toán tại quầy POS' : `Đơn mới từ ${customer}`);
    const summary = data.itemsSummary || 'Đơn hàng tạp hóa';
    const amount = Number(data.totalAmount) || 0;

    const notifItem: OrderNotificationItem = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orderId: data.id,
      orderNumber: data.orderNumber || data.id.slice(0, 8),
      title,
      summary,
      totalAmount: amount,
      roomNumber: data.roomNumber,
      customerName: data.customerName,
      customerType: data.customerType,
      isPosCounter: isPos,
      paymentMethod: data.paymentMethod,
      createdAt: data.createdAt || new Date().toISOString(),
      read: false,
    };

    // Add to list and save
    this.notifications.update((list) => {
      const updated = [notifItem, ...list].slice(0, 30);
      this.saveToStorage(updated);
      return updated;
    });

    // Play chime sound
    this.sound.playNewOrderChime();

    // Show toast alert on top right
    const formattedAmount = new Intl.NumberFormat('vi-VN').format(amount) + ' đ';
    this.toast.info(`🛎️ ${title}: ${summary} (${formattedAmount})`);
  }

  markAsRead(id: string) {
    this.notifications.update((list) => {
      const updated = list.map((n) => (n.id === id ? { ...n, read: true } : n));
      this.saveToStorage(updated);
      return updated;
    });
  }

  markAllAsRead() {
    this.notifications.update((list) => {
      const updated = list.map((n) => ({ ...n, read: true }));
      this.saveToStorage(updated);
      return updated;
    });
  }

  remove(id: string) {
    this.notifications.update((list) => {
      const updated = list.filter((n) => n.id !== id);
      this.saveToStorage(updated);
      return updated;
    });
  }

  clearAll() {
    this.notifications.set([]);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  navigateToOrder(item: OrderNotificationItem) {
    this.markAsRead(item.id);
    void this.router.navigate(['/orders', item.orderId]);
  }

  private loadFromStorage(): OrderNotificationItem[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveToStorage(list: OrderNotificationItem[]) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }
}
