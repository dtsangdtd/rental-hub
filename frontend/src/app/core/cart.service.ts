import { Injectable, computed, effect, signal } from '@angular/core';
import { round2 } from './api';
import { Product, ProductUom } from './models';

export interface CartLine {
  product: Product;
  quantity: number;
  uom?: ProductUom;
}

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
  readonly total = computed(() =>
    round2(
      this.lines().reduce(
        (s, l) => s + (l.uom ? Number(l.uom.retail_price) : Number(l.product.price)) * l.quantity,
        0,
      ),
    ),
  );

  constructor() {
    effect(() => localStorage.setItem(CART_KEY, JSON.stringify(this.lines())));
  }

  quantityOf(productId: string, uomId?: string): number {
    return (
      this.lines().find(
        (l) => l.product.id === productId && (!uomId || l.uom?.id === uomId),
      )?.quantity ?? 0
    );
  }

  add(product: Product, quantity = 1, uom?: ProductUom) {
    this.lines.update((lines) => {
      const existing = lines.find(
        (l) => l.product.id === product.id && ((!l.uom && !uom) || l.uom?.id === uom?.id),
      );
      if (existing) {
        return lines.map((l) =>
          l === existing
            ? { ...l, product, uom: uom ?? l.uom, quantity: clampQty(l.quantity + quantity, product) }
            : l,
        );
      }
      if (lines.length >= MAX_LINES) return lines;
      return [...lines, { product, uom, quantity: clampQty(quantity, product) }];
    });
  }

  setQuantity(productId: string, quantity: number, uomId?: string) {
    if (quantity <= 0) return this.remove(productId, uomId);
    this.lines.update((lines) =>
      lines.map((l) =>
        l.product.id === productId && (!uomId || l.uom?.id === uomId)
          ? { ...l, quantity: clampQty(quantity, l.product) }
          : l,
      ),
    );
  }

  remove(productId: string, uomId?: string) {
    this.lines.update((lines) =>
      lines.filter((l) => !(l.product.id === productId && (!uomId || l.uom?.id === uomId))),
    );
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
