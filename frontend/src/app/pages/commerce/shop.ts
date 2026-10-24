import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { CartService } from '../../core/cart.service';
import {
  BarcodeLookupResult,
  GroceryCategory,
  InventoryHub,
  ListResponse,
  Product,
  ProductUom,
} from '../../core/models';
import { SoundAlertService } from '../../core/sound-alert.service';
import { ToastService } from '../../core/ui.services';
import { MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';
import { Pagination } from '../../shared/pagination';

const CATEGORY_IMAGES: Record<string, string> = {
  beverage: 'images/cat-general.jpg',
  instant_food: 'images/cat-general.jpg',
  spices_oil: 'images/cat-general.jpg',
  snacks: 'images/cat-general.jpg',
  household: 'images/cat-general.jpg',
  hygiene: 'images/cat-service.jpg',
  personal_care: 'images/cat-service.jpg',
  combos: 'images/cat-general.jpg',
  furniture: 'images/cat-furniture.jpg',
  appliance: 'images/cat-appliance.jpg',
  service: 'images/cat-service.jpg',
  general: 'images/cat-general.jpg',
};

interface CategoryForm {
  name: string;
  iconName: string;
  sortOrder: number;
  description: string;
}

@Component({
  selector: 'app-shop',
  imports: [FormsModule, RouterLink, MoneyPipe, Icon, Pagination, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shop.html',
  styleUrl: './shop.scss',
})
export class ShopPage {
  private readonly api = inject(Api);
  protected readonly auth = inject(AuthStore);
  protected readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly sound = inject(SoundAlertService);

  protected readonly items = signal<Product[]>([]);
  protected readonly hubs = signal<InventoryHub[]>([]);
  protected readonly selectedHubId = signal<string>(localStorage.getItem('rh.selected_hub') || '');
  protected readonly categories = signal<GroceryCategory[]>([]);
  protected readonly selectedCategory = signal<string>('all');
  protected readonly isComboFilter = signal<boolean>(false);

  protected readonly page = signal(1);
  protected readonly pageSize = signal(12);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly query = signal('');

  // Selected packaging unit (UOM) per product
  protected readonly selectedUoms = signal<Record<string, ProductUom>>({});

  // Category CRUD for Landlord / Admin
  protected readonly canManageCategories = computed(() => this.auth.hasRole('admin', 'landlord'));
  protected readonly showCategoryModal = signal<boolean>(false);
  protected readonly editingCategory = signal<GroceryCategory | null>(null);
  protected readonly savingCategory = signal<boolean>(false);
  protected catForm: CategoryForm = {
    name: '',
    iconName: 'package',
    sortOrder: 0,
    description: '',
  };

  // Barcode Lookup Modal for Customers / Quick Search
  protected readonly showBarcodeModal = signal<boolean>(false);
  protected barcodeInput = signal<string>('');
  protected barcodeResult = signal<BarcodeLookupResult | null>(null);
  protected barcodeSearching = signal<boolean>(false);

  protected get q() {
    return this.query();
  }
  protected set q(v: string) {
    this.query.set(v);
  }

  protected readonly filtered = computed(() => this.items());

  constructor() {
    void this.initData();
  }

  private async initData() {
    await Promise.all([this.loadHubs(), this.loadCategories()]);
    await this.load();
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

  protected async loadCategories() {
    try {
      const res = await this.api.get<{ items: GroceryCategory[] }>('/commerce/categories');
      this.categories.set(res.items || []);
    } catch {}
  }

  protected onHubChange(hubId: string) {
    this.selectedHubId.set(hubId);
    localStorage.setItem('rh.selected_hub', hubId);
    this.page.set(1);
    void this.load();
  }

  protected imgFor(cat: string, p?: Product): string {
    if (p?.image_url) return p.image_url;
    return CATEGORY_IMAGES[cat.toLowerCase().replace(/-/g, '_')] ?? CATEGORY_IMAGES['general'];
  }

  protected getActiveUom(p: Product): ProductUom | undefined {
    if (!p.uoms || p.uoms.length === 0) return undefined;
    const current = this.selectedUoms()[p.id];
    if (current && p.uoms.some((u) => u.id === current.id)) return current;
    const defaultUom = p.uoms.find((u) => u.is_default) ?? p.uoms[0];
    return defaultUom;
  }

  protected selectUom(p: Product, uom: ProductUom) {
    this.selectedUoms.update((m) => ({ ...m, [p.id]: uom }));
  }

  protected getActivePrice(p: Product): number {
    const uom = this.getActiveUom(p);
    return uom ? Number(uom.retail_price) : Number(p.price);
  }

  protected getActiveUomName(p: Product): string {
    const uom = this.getActiveUom(p);
    return uom?.uom_name || p.base_uom || 'Cái';
  }

  protected getCartQty(p: Product): number {
    const uom = this.getActiveUom(p);
    return this.cart.quantityOf(p.id, uom?.id);
  }

  protected addToCart(p: Product) {
    const uom = this.getActiveUom(p);
    this.cart.add(p, 1, uom);
    this.sound.playBarcodeBeep();
    this.toast.success(`Đã thêm ${p.name} (${this.getActiveUomName(p)}) vào giỏ`);
  }

  protected incCart(p: Product) {
    const uom = this.getActiveUom(p);
    this.cart.add(p, 1, uom);
    this.sound.playBarcodeBeep();
  }

  protected decCart(p: Product) {
    const uom = this.getActiveUom(p);
    const current = this.cart.quantityOf(p.id, uom?.id);
    this.cart.setQuantity(p.id, current - 1, uom?.id);
  }

  protected selectCategory(catSlug: string) {
    this.selectedCategory.set(catSlug);
    this.page.set(1);
    void this.load();
  }

  protected toggleComboFilter() {
    this.isComboFilter.update((v) => !v);
    this.page.set(1);
    void this.load();
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

  private async load() {
    this.loading.set(true);
    try {
      const res = await this.api.get<ListResponse<Product>>('/commerce/products', {
        page: this.page(),
        limit: this.pageSize(),
        hubId: this.selectedHubId() || undefined,
        category: this.selectedCategory() !== 'all' ? this.selectedCategory() : undefined,
        isCombo: this.isComboFilter() ? 'true' : undefined,
        q: this.query().trim() || undefined,
      });
      this.items.set(res.items || []);
      this.total.set(res.total ?? (res.items?.length || 0));
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- Category Management Methods (Chủ nhà thêm/sửa/xóa danh mục) ----------
  protected openCreateCategory() {
    this.catForm = {
      name: '',
      iconName: 'package',
      sortOrder: (this.categories().length + 1),
      description: '',
    };
    this.editingCategory.set(null);
    this.showCategoryModal.set(true);
  }

  protected openEditCategory(cat: GroceryCategory, event?: MouseEvent) {
    event?.stopPropagation();
    this.catForm = {
      name: cat.name,
      iconName: cat.icon_name || 'package',
      sortOrder: cat.sort_order || 0,
      description: cat.description || '',
    };
    this.editingCategory.set(cat);
    this.showCategoryModal.set(true);
  }

  protected async saveCategory() {
    if (!this.catForm.name.trim()) {
      this.toast.error('Vui lòng nhập tên danh mục.');
      return;
    }

    this.savingCategory.set(true);
    const editing = this.editingCategory();

    try {
      if (editing) {
        await this.api.patch<GroceryCategory>(`/commerce/categories/${editing.id}`, {
          name: this.catForm.name.trim(),
          iconName: this.catForm.iconName,
          sortOrder: Number(this.catForm.sortOrder),
          description: this.catForm.description.trim() || undefined,
        });
        this.toast.success(`Đã cập nhật danh mục "${this.catForm.name}"`);
      } else {
        await this.api.post<GroceryCategory>('/commerce/categories', {
          name: this.catForm.name.trim(),
          iconName: this.catForm.iconName,
          sortOrder: Number(this.catForm.sortOrder),
          description: this.catForm.description.trim() || undefined,
        });
        this.toast.success(`Đã tạo danh mục mới "${this.catForm.name}"`);
      }

      this.showCategoryModal.set(false);
      await this.loadCategories();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.savingCategory.set(false);
    }
  }

  protected async deleteCategory(cat: GroceryCategory, event?: MouseEvent) {
    event?.stopPropagation();
    if (!confirm(`Bạn có chắc chắn muốn xóa danh mục "${cat.name}"?`)) return;

    try {
      const res = await this.api.delete<{ message: string }>(`/commerce/categories/${cat.id}`);
      this.toast.success(res.message);
      if (this.selectedCategory() === cat.slug) {
        this.selectedCategory.set('all');
      }
      await this.loadCategories();
      void this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  // ---------- Barcode Search Modal ----------
  protected openBarcodeModal() {
    this.barcodeInput.set('');
    this.barcodeResult.set(null);
    this.showBarcodeModal.set(true);
  }

  protected async searchBarcode() {
    const code = this.barcodeInput().trim();
    if (!code) return;

    this.barcodeSearching.set(true);
    try {
      const res = await this.api.get<BarcodeLookupResult>('/commerce/products/lookup-barcode', {
        code,
        hubId: this.selectedHubId() || undefined,
      });
      this.sound.playBarcodeBeep();
      this.barcodeResult.set(res);
    } catch (err) {
      this.toast.error(errorMessage(err));
      this.barcodeResult.set(null);
    } finally {
      this.barcodeSearching.set(false);
    }
  }

  protected addBarcodeResultToCart() {
    const r = this.barcodeResult();
    if (!r) return;
    this.addToCart(r.product);
    this.showBarcodeModal.set(false);
  }
}
