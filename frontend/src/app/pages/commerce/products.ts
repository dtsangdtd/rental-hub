import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ListResponse, Product } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { LabelPipe, MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

interface ProductForm {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number | null;
  currency: string;
  stock: number | null;
  active: boolean;
}

@Component({
  selector: 'app-products',
  imports: [FormsModule, MoneyPipe, LabelPipe, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class ProductsPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<Product[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly query = signal('');

  protected get q() { return this.query(); }
  protected set q(v: string) { this.query.set(v); }

  protected readonly editingProduct = signal<Product | null | undefined>(undefined);

  protected form: ProductForm = this.blankForm();

  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.items();
    return this.items().filter((p) => (p.name + ' ' + p.sku + ' ' + p.category).toLowerCase().includes(q));
  });

  constructor() {
    void this.load();
  }

  protected openCreate() {
    this.form = this.blankForm();
    this.editingProduct.set(null);
  }

  protected openEdit(p: Product) {
    this.form = {
      sku: p.sku,
      name: p.name,
      description: p.description ?? '',
      category: p.category,
      price: p.price,
      currency: p.currency,
      stock: p.stock,
      active: p.active,
    };
    this.editingProduct.set(p);
  }

  protected async saveProduct() {
    this.saving.set(true);
    const editing = this.editingProduct();

    try {
      if (editing) {
        await this.api.patch<Product>(`/commerce/products/${editing.id}`, {
          name: this.form.name.trim(),
          description: this.form.description.trim() || undefined,
          category: this.form.category,
          price: Number(this.form.price),
          currency: this.form.currency.toUpperCase(),
          stock: Number(this.form.stock),
          active: this.form.active,
        });
        this.toast.success('Product updated');
      } else {
        await this.api.post<Product>('/commerce/products', {
          sku: this.form.sku.trim(),
          name: this.form.name.trim(),
          description: this.form.description.trim() || undefined,
          category: this.form.category,
          price: Number(this.form.price),
          currency: this.form.currency.toUpperCase(),
          stock: Number(this.form.stock ?? 0),
        });
        this.toast.success('Product created');
      }
      this.editingProduct.set(undefined);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private blankForm(): ProductForm {
    return {
      sku: '',
      name: '',
      description: '',
      category: 'general',
      price: null,
      currency: 'VND',
      stock: 0,
      active: true,
    };
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
