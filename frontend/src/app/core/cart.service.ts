import { Injectable, computed, effect, signal } from '@angular/core';
import { round2 } from './api';
import { Product } from './models';

export interface CartLine { product: Product; quantity: number; }

const CART_KEY = 'rh.cart';
/** Backend limits: quantity ≤ 100 per line, ≤ 50 lines, single currency per order. */
export const MAX_QTY = 100;
export const MAX_LINES = 50;

@Injectable({ providedIn: 'root' })
export class CartService {
  readonly lines = signal<CartLine[]>(load());
  readonly count = computed(() => this.lines().reduce((n, l) => n + l.quantity, 0));
  readonly currencies = computed(() => [...new Set(this.lines().map((l) => l.product.currency))]);
  readonly mixedCurrency = computed(() => this.currencies().length > 1);
  readonly total = computed(() => round2(this.lines().reduce((s, l) => s + l.product.price * l.quantity, 0)));

  constructor() {
    effect(() => localStorage.setItem(CART_KEY, JSON.stringify(this.lines())));
  }

  quantityOf(productId: string): number {
    return this.lines().find((l) => l.product.id === productId)?.quantity ?? 0;
  }

  add(product: Product, quantity = 1) {
    this.lines.update((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      if (existing) {
        return lines.map((l) => (l === existing ? { ...l, product, quantity: clampQty(l.quantity + quantity, product) } : l));
      }
      if (lines.length >= MAX_LINES) return lines;
      return [...lines, { product, quantity: clampQty(quantity, product) }];
    });
  }

  setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) return this.remove(productId);
    this.lines.update((lines) =>
      lines.map((l) => (l.product.id === productId ? { ...l, quantity: clampQty(quantity, l.product) } : l)),
    );
  }

  remove(productId: string) {
    this.lines.update((lines) => lines.filter((l) => l.product.id !== productId));
  }

  clear() {
    this.lines.set([]);
  }
}

function clampQty(q: number, p: Product) {
  return Math.max(1, Math.min(Math.floor(q), MAX_QTY, Math.max(p.stock, 1)));
}

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}
