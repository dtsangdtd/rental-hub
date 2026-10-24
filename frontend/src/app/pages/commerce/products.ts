import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { GroceryCategory, InventoryHub, ListResponse, Product } from '../../core/models';
import { SoundAlertService } from '../../core/sound-alert.service';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { LabelPipe, MoneyPipe } from '../../shared/format';
import { AVAILABLE_ICONS, Icon } from '../../shared/icon';
import { IconPicker } from '../../shared/icon-picker';
import { Modal } from '../../shared/overlays';
import { Pagination } from '../../shared/pagination';

interface ProductForm {
  sku: string;
  name: string;
  description: string;
  category: string;
  categoryId?: string | null;
  price: number | null;
  currency: string;
  stock: number | null;
  barcode?: string;
  active: boolean;
}

interface CategoryForm {
  id?: string;
  name: string;
  slug?: string;
  iconName: string;
  sortOrder: number;
  description?: string;
}

@Component({
  selector: 'app-products',
  imports: [FormsModule, MoneyPipe, LabelPipe, Icon, Modal, Pagination, IconPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class ProductsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly sound = inject(SoundAlertService);

  // Tabs
  protected readonly activeTab = signal<'products' | 'categories'>('products');

  // Products
  protected readonly items = signal<Product[]>([]);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly query = signal('');

  protected get q() { return this.query(); }
  protected set q(v: string) { this.query.set(v); }

  // Categories
  protected readonly categories = signal<GroceryCategory[]>([]);
  protected readonly catLoading = signal(false);
  protected readonly editingCategory = signal<CategoryForm | null | undefined>(undefined);
  protected catForm: CategoryForm = {
    name: '',
    iconName: 'package',
    sortOrder: 10,
    description: '',
  };

  protected readonly editingProduct = signal<Product | null | undefined>(undefined);
  protected form: ProductForm = {
    sku: '',
    name: '',
    description: '',
    category: 'general',
    categoryId: null,
    price: null,
    currency: 'VND',
    stock: 0,
    barcode: '',
    active: true,
  };

  // Barcode Inbound Stocking Modal
  protected readonly showInboundModal = signal(false);
  protected readonly hubs = signal<InventoryHub[]>([]);
  protected selectedHubId = signal<string>('');
  protected inboundBarcode = '';
  protected inboundQty = 1;
  protected inboundBatchNo = '';
  protected inboundExpDate = '';
  protected inboundCostPrice = 0;
  protected readonly inboundLoading = signal(false);

  protected readonly availableIcons = AVAILABLE_ICONS;

  // Inline Category Quick Creation inside Product Form Modal
  protected readonly showInlineCatCreate = signal(false);
  protected inlineCatName = '';
  protected inlineCatIcon = 'package';

  protected readonly filtered = computed(() => this.items());

  ngOnInit() {
    void this.load();
    void this.loadCategories();
    void this.loadHubs();

    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    this.inboundExpDate = d.toISOString().slice(0, 10);
  }

  protected isOwner(c: GroceryCategory): boolean {
    const user = this.auth.user();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return c.created_by === user.id;
  }

  // ---------- Products Methods ----------
  protected openCreate() {
    this.form = this.blankForm();
    this.showInlineCatCreate.set(false);
    this.editingProduct.set(null);
  }

  protected openEdit(p: Product) {
    this.form = {
      sku: p.sku,
      name: p.name,
      description: p.description ?? '',
      category: p.category_slug || p.category,
      categoryId: p.category_id || (this.categories().find((c) => c.slug === p.category)?.id ?? null),
      price: p.price,
      currency: p.currency,
      stock: p.stock,
      barcode: p.barcode ?? '',
      active: p.active,
    };
    this.showInlineCatCreate.set(false);
    this.editingProduct.set(p);
  }

  protected toggleInlineCategoryCreate() {
    this.showInlineCatCreate.update((v) => !v);
  }

  protected async createInlineCategory() {
    if (!this.inlineCatName.trim()) {
      this.toast.error('Vui lòng nhập tên danh mục.');
      return;
    }
    try {
      const res = await this.api.post<GroceryCategory>('/commerce/categories', {
        name: this.inlineCatName.trim(),
        iconName: this.inlineCatIcon,
        sortOrder: (this.categories().length + 1) * 10,
      });
      this.toast.success(`Đã tạo danh mục "${res.name}" (Do chủ nhà tạo)`);
      await this.loadCategories();
      this.form.categoryId = res.id;
      this.form.category = res.slug;
      this.inlineCatName = '';
      this.showInlineCatCreate.set(false);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async saveProduct() {
    if (!this.form.categoryId) {
      this.toast.error('Vui lòng chọn danh mục liên kết (Category) cho sản phẩm.');
      return;
    }

    this.saving.set(true);
    const editing = this.editingProduct();

    const matchedCat = this.categories().find((c) => c.id === this.form.categoryId);
    const catSlug = matchedCat?.slug || this.form.category || 'general';

    try {
      if (editing) {
        await this.api.patch<Product>(`/commerce/products/${editing.id}`, {
          name: this.form.name.trim(),
          description: this.form.description.trim() || undefined,
          category: catSlug,
          categoryId: this.form.categoryId,
          price: Number(this.form.price),
          currency: this.form.currency.toUpperCase(),
          stock: Number(this.form.stock),
          barcode: this.form.barcode?.trim() || undefined,
          active: this.form.active,
        });
        this.toast.success('Đã cập nhật sản phẩm');
      } else {
        await this.api.post<Product>('/commerce/products', {
          sku: this.form.sku.trim(),
          name: this.form.name.trim(),
          description: this.form.description.trim() || undefined,
          category: catSlug,
          categoryId: this.form.categoryId,
          price: Number(this.form.price),
          currency: this.form.currency.toUpperCase(),
          stock: Number(this.form.stock ?? 0),
          barcode: this.form.barcode?.trim() || undefined,
        });
        this.toast.success('Đã tạo sản phẩm mới');
      }
      this.editingProduct.set(undefined);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected onSearchChange() {
    this.page.set(1);
    void this.load();
  }

  protected onPageChange(p: number) {
    this.page.set(p);
    void this.load();
  }

  protected onPageSizeChange(s: number) {
    this.pageSize.set(s);
    this.page.set(1);
    void this.load();
  }

  protected async load() {
    this.loading.set(true);
    try {
      const res = await this.api.get<ListResponse<Product>>('/commerce/products', {
        page: this.page(),
        limit: this.pageSize(),
        q: this.query().trim() || undefined,
        all: true,
      });
      this.items.set(res.items || []);
      this.total.set(res.total ?? (res.items?.length || 0));
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- Categories Methods ----------
  protected async loadCategories() {
    this.catLoading.set(true);
    try {
      const res = await this.api.get<{ items: GroceryCategory[] }>('/commerce/categories');
      this.categories.set(res.items || []);
    } catch (err) {
      console.warn('Could not load categories:', err);
    } finally {
      this.catLoading.set(false);
    }
  }

  protected openCreateCategory() {
    this.catForm = this.blankCatForm();
    this.editingCategory.set(null);
  }

  protected openEditCategory(c: GroceryCategory) {
    this.catForm = {
      id: c.id,
      name: c.name,
      slug: c.slug,
      iconName: c.icon_name || 'package',
      sortOrder: c.sort_order ?? 0,
      description: c.description ?? '',
    };
    this.editingCategory.set(this.catForm);
  }

  protected async saveCategory() {
    if (!this.catForm.name.trim()) {
      this.toast.error('Vui lòng nhập tên danh mục.');
      return;
    }

    try {
      if (this.catForm.id) {
        await this.api.patch(`/commerce/categories/${this.catForm.id}`, {
          name: this.catForm.name.trim(),
          iconName: this.catForm.iconName,
          sortOrder: Number(this.catForm.sortOrder),
          description: this.catForm.description?.trim() || null,
        });
        this.toast.success('Đã cập nhật danh mục');
      } else {
        await this.api.post('/commerce/categories', {
          name: this.catForm.name.trim(),
          iconName: this.catForm.iconName,
          sortOrder: Number(this.catForm.sortOrder),
          description: this.catForm.description?.trim() || null,
        });
        this.toast.success('Đã tạo danh mục mới');
      }
      this.editingCategory.set(undefined);
      await this.loadCategories();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async deleteCategory(c: GroceryCategory) {
    const ok = await this.confirm.ask({
      title: `Xác nhận xóa danh mục "${c.name}"?`,
      message: 'Danh mục sẽ bị ẩn khỏi cửa hàng và hệ thống sản phẩm.',
      confirmText: 'Xác nhận xóa',
      danger: true,
    });
    if (!ok) return;

    try {
      await this.api.delete(`/commerce/categories/${c.id}`);
      this.toast.success(`Đã xóa danh mục "${c.name}"`);
      await this.loadCategories();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  // ---------- Inbound Barcode Stocking ----------
  protected async loadHubs() {
    try {
      const res = await this.api.get<{ items: InventoryHub[] }>('/commerce/hubs');
      this.hubs.set(res.items || []);
      if (!this.selectedHubId() && res.items?.length) {
        this.selectedHubId.set(res.items[0].id);
      }
    } catch {}
  }

  protected openInboundStock() {
    this.inboundBarcode = '';
    this.inboundQty = 1;
    this.inboundBatchNo = 'LOT-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
    this.inboundCostPrice = 0;
    this.showInboundModal.set(true);
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
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.inboundLoading.set(false);
    }
  }

  private blankForm(): ProductForm {
    const cats = typeof this.categories === 'function' ? (this.categories() || []) : [];
    return {
      sku: '',
      name: '',
      description: '',
      category: cats[0]?.slug || 'general',
      categoryId: cats[0]?.id || null,
      price: null,
      currency: 'VND',
      stock: 0,
      barcode: '',
      active: true,
    };
  }

  private blankCatForm(): CategoryForm {
    const cats = typeof this.categories === 'function' ? (this.categories() || []) : [];
    return {
      name: '',
      iconName: 'package',
      sortOrder: (cats.length + 1) * 10,
      description: '',
    };
  }
}
