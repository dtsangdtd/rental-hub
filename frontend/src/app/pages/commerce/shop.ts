import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { CartService } from '../../core/cart.service';
import { ListResponse, Product } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';

const CATEGORY_IMAGES: Record<string, string> = {
  furniture: 'images/cat-furniture.jpg',
  appliance: 'images/cat-appliance.jpg',
  service: 'images/cat-service.jpg',
  general: 'images/cat-general.jpg',
};

@Component({
  selector: 'app-shop',
  imports: [FormsModule, RouterLink, MoneyPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shop.html',
  styleUrl: './shop.scss',
})
export class ShopPage {
  private readonly api = inject(Api);
  protected readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<Product[]>([]);
  protected readonly loading = signal(true);
  protected readonly query = signal('');
  protected readonly selectedCategory = signal('all');

  protected get q() { return this.query(); }
  protected set q(v: string) { this.query.set(v); }

  protected readonly categories = computed(() => {
    const set = new Set<string>(['all']);
    for (const p of this.items()) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set);
  });

  protected readonly filtered = computed(() => {
    let list = this.items();
    const cat = this.selectedCategory();
    if (cat !== 'all') {
      list = list.filter((p) => p.category === cat);
    }
    const q = this.query().toLowerCase().trim();
    if (q) {
      list = list.filter((p) => (p.name + ' ' + (p.description ?? '') + ' ' + p.sku).toLowerCase().includes(q));
    }
    return list;
  });

  constructor() {
    void this.load();
  }

  protected imgFor(cat: string): string {
    return CATEGORY_IMAGES[cat.toLowerCase()] ?? CATEGORY_IMAGES['general'];
  }

  protected addToCart(p: Product) {
    this.cart.add(p, 1);
    this.toast.success(`Added ${p.name} to cart`);
  }

  private async load() {
    try {
      const res = await this.api.get<ListResponse<Product>>('/commerce/products');
      this.items.set(res.items);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
