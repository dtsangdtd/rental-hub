import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { InventoryHub, ListResponse, Property } from '../../core/models';
import { SoundAlertService } from '../../core/sound-alert.service';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

interface StoreForm {
  id?: string;
  propertyId: string;
  name: string;
  address: string;
  managerUserId?: string | null;
  isActive: boolean;
}

@Component({
  selector: 'app-stores',
  imports: [FormsModule, RouterLink, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stores.html',
  styleUrl: './stores.scss',
})
export class StoresPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly sound = inject(SoundAlertService);

  protected readonly items = signal<InventoryHub[]>([]);
  protected readonly properties = signal<Property[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly saving = signal<boolean>(false);
  protected readonly searchQuery = signal<string>('');
  protected readonly statusFilter = signal<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  protected readonly editingStore = signal<StoreForm | null | undefined>(undefined);
  protected form: StoreForm = this.blankForm();

  // Statistics
  protected readonly totalStores = computed(() => (this.items() || []).length);
  protected readonly activeStores = computed(() => (this.items() || []).filter((h) => h?.is_active).length);
  protected readonly totalInventoryUnits = computed(() =>
    (this.items() || []).reduce((acc, h) => acc + (Number(h?.total_inventory_qty) || 0), 0),
  );
  protected readonly totalProductsCount = computed(() =>
    (this.items() || []).reduce((acc, h) => acc + (Number(h?.total_products) || 0), 0),
  );

  protected readonly filtered = computed(() => {
    const q = this.searchQuery()?.toLowerCase().trim() || '';
    const st = this.statusFilter();
    const propMap = new Map<string, Property>((this.properties() || []).map((p) => [p.id, p]));

    return (this.items() || []).filter((h) => {
      if (!h) return false;
      if (st === 'ACTIVE' && !h.is_active) return false;
      if (st === 'INACTIVE' && h.is_active) return false;

      if (!q) return true;
      const prop = propMap.get(h.property_id);
      const propName = prop?.name?.toLowerCase() || '';
      const name = h.name?.toLowerCase() || '';
      const address = h.address?.toLowerCase() || '';
      const id = h.id?.toLowerCase() || '';
      return (
        name.includes(q) ||
        address.includes(q) ||
        id.includes(q) ||
        propName.includes(q)
      );
    });
  });

  ngOnInit() {
    void this.loadProperties();
    void this.load();
  }

  protected async load() {
    this.loading.set(true);
    try {
      const res = await this.api.get<{ items: InventoryHub[] }>('/commerce/hubs?all=true');
      this.items.set(res.items || []);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadProperties() {
    try {
      const res = await this.api.get<ListResponse<Property>>('/property/properties?all=true');
      this.properties.set(res.items || []);
    } catch {
      // Non-blocking if property service is slow
    }
  }

  protected getPropertyName(propertyId: string): string {
    const p = this.properties().find((x) => x.id === propertyId);
    return p ? p.name : 'Tòa nhà / KTX';
  }

  protected getPropertyAddress(propertyId: string): string {
    const p = this.properties().find((x) => x.id === propertyId);
    return p ? p.address : '';
  }

  protected openCreate() {
    this.form = this.blankForm();
    if (this.properties().length > 0) {
      this.form.propertyId = this.properties()[0].id;
      this.onPropertySelected(this.properties()[0].id);
    }
    this.editingStore.set(null);
  }

  protected openEdit(h: InventoryHub) {
    this.form = {
      id: h.id,
      propertyId: h.property_id,
      name: h.name,
      address: h.address,
      managerUserId: h.manager_user_id ?? null,
      isActive: h.is_active,
    };
    this.editingStore.set(this.form);
  }

  protected onPropertySelected(propertyId: string) {
    const p = this.properties().find((x) => x.id === propertyId);
    if (p) {
      if (!this.form.id || !this.form.name.trim()) {
        this.form.name = `Cửa hàng Tiện Lợi - ${p.name}`;
      }
      if (!this.form.id || !this.form.address.trim()) {
        this.form.address = `Sảnh tầng 1, ${p.address}`;
      }
    }
  }

  protected async save() {
    if (!this.form.propertyId) {
      this.toast.error('Vui lòng chọn Tòa nhà / Ký túc xá cho Cửa hàng.');
      return;
    }
    if (!this.form.name.trim()) {
      this.toast.error('Vui lòng nhập tên Cửa Hàng / Hub.');
      return;
    }
    if (!this.form.address.trim()) {
      this.toast.error('Vui lòng nhập địa chỉ / vị trí quầy bán.');
      return;
    }

    this.saving.set(true);
    try {
      if (this.form.id) {
        await this.api.patch<InventoryHub>(`/commerce/hubs/${this.form.id}`, {
          propertyId: this.form.propertyId,
          name: this.form.name.trim(),
          address: this.form.address.trim(),
          isActive: this.form.isActive,
        });
        this.toast.success(`Đã cập nhật cửa hàng "${this.form.name}"`);
      } else {
        await this.api.post<InventoryHub>('/commerce/hubs', {
          propertyId: this.form.propertyId,
          name: this.form.name.trim(),
          address: this.form.address.trim(),
        });
        this.sound.playPaymentSuccess();
        this.toast.success(`Đã tạo cửa hàng mới "${this.form.name}"`);
      }
      this.editingStore.set(undefined);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleStatus(h: InventoryHub) {
    const targetStatus = !h.is_active;
    const actionLabel = targetStatus ? 'kích hoạt hoạt động' : 'tạm ngưng hoạt động';

    const ok = await this.confirm.ask({
      title: `Xác nhận ${actionLabel}?`,
      message: `Cửa hàng "${h.name}" sẽ ${targetStatus ? 'mở lại' : 'tạm đóng'} trên ứng dụng mua hàng và quầy POS.`,
      confirmText: targetStatus ? 'Kích hoạt' : 'Tạm ngưng',
      danger: !targetStatus,
    });
    if (!ok) return;

    try {
      await this.api.patch(`/commerce/hubs/${h.id}`, { isActive: targetStatus });
      this.toast.success(`Đã ${actionLabel} cửa hàng "${h.name}"`);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  private blankForm(): StoreForm {
    return {
      propertyId: '',
      name: '',
      address: '',
      isActive: true,
    };
  }
}
