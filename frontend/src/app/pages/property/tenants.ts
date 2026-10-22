import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ListResponse, Tenant } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { VietnamAddressService, VietmapWard } from '../../core/vietnam-address.service';
import { MANAGE_PROPERTY } from '../../nav';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

interface TenantFormData {
  fullName: string;
  phone: string;
  email: string;
  idNumber: string;
  userId: string;
  streetAddress: string;
  ward: string;
  city: string;
  idIssueDate: string;
  gender: string;
  birthDate: string;
  nationality: string;
}

@Component({
  selector: 'app-tenants',
  imports: [FormsModule, DatePipe, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tenants.html',
  styleUrl: './tenants.scss',
})
export class TenantsPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  readonly addressService = inject(VietnamAddressService);

  protected readonly items = signal<Tenant[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showModal = signal(false);
  protected readonly editingTenant = signal<Tenant | null>(null);
  protected readonly query = signal('');
  protected readonly canManage = computed(() => this.auth.hasRole(...MANAGE_PROPERTY));

  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.items();
    return this.items().filter((t) => {
      const searchStr = [
        t.full_name,
        t.phone,
        t.email,
        t.id_number,
        t.street_address,
        t.ward,
        t.city,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchStr.includes(q);
    });
  });

  protected form: TenantFormData = this.emptyForm();

  /** Dynamic list of Wards based on selected Province/City (Vietmap new administrative address) */
  readonly availableWards = computed<VietmapWard[]>(() => {
    return this.addressService.getWards(this.form.city);
  });

  constructor() {
    void this.load();
  }

  private emptyForm(): TenantFormData {
    return {
      fullName: '',
      phone: '',
      email: '',
      idNumber: '',
      userId: '',
      streetAddress: '',
      ward: '',
      city: 'Hồ Chí Minh',
      idIssueDate: '',
      gender: 'Nam',
      birthDate: '',
      nationality: 'Việt Nam',
    };
  }

  onProvinceChange(provinceName: string): void {
    // If the currently selected ward does not belong to this province, reset ward
    if (this.form.ward) {
      const wards = this.addressService.getWards(provinceName);
      const exists = wards.some((w) => w.name_with_type === this.form.ward);
      if (!exists) {
        this.form.ward = '';
      }
    }
  }

  onWardChange(wardName: string): void {
    if (!wardName) return;
    // Auto-detect and fill city/province if not selected
    if (!this.form.city) {
      const prov = this.addressService.findProvinceByWard(wardName);
      if (prov) {
        this.form.city = prov.name;
      }
    }
  }

  openCreate(): void {
    this.editingTenant.set(null);
    this.form = this.emptyForm();
    this.showModal.set(true);
  }

  openEdit(t: Tenant): void {
    this.editingTenant.set(t);
    this.form = {
      fullName: t.full_name,
      phone: t.phone || '',
      email: t.email || '',
      idNumber: t.id_number || '',
      userId: t.user_id || '',
      streetAddress: t.street_address || '',
      ward: t.ward || '',
      city: t.city || '',
      idIssueDate: t.id_issue_date ? t.id_issue_date.substring(0, 10) : '',
      gender: t.gender || '',
      birthDate: t.birth_date ? t.birth_date.substring(0, 10) : '',
      nationality: t.nationality || 'Việt Nam',
    };
    this.showModal.set(true);
  }

  formatFullAddress(t: Tenant): string {
    const parts = [t.street_address, t.ward, t.city].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  previewAddress(): string {
    const parts = [this.form.streetAddress, this.form.ward, this.form.city].filter(Boolean);
    return parts.join(', ');
  }

  async save(): Promise<void> {
    const opt = (v?: string) => (v && v.trim() ? v.trim() : undefined);
    this.saving.set(true);

    const payload = {
      fullName: this.form.fullName.trim(),
      phone: opt(this.form.phone),
      email: opt(this.form.email),
      idNumber: opt(this.form.idNumber),
      userId: opt(this.form.userId),
      streetAddress: opt(this.form.streetAddress),
      ward: opt(this.form.ward),
      city: opt(this.form.city),
      idIssueDate: opt(this.form.idIssueDate),
      gender: opt(this.form.gender),
      birthDate: opt(this.form.birthDate),
      nationality: opt(this.form.nationality) || 'Việt Nam',
    };

    try {
      const current = this.editingTenant();
      if (current) {
        await this.api.patch<Tenant>(`/property/tenants/${current.id}`, payload);
        this.toast.success('Đã cập nhật thông tin khách thuê');
      } else {
        await this.api.post<Tenant>('/property/tenants', payload);
        this.toast.success('Đã thêm khách thuê mới');
      }
      this.showModal.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteTenant(t: Tenant): Promise<void> {
    if (!confirm(`Bạn có chắc chắn muốn xóa khách thuê "${t.full_name}"?`)) {
      return;
    }
    try {
      await this.api.delete(`/property/tenants/${t.id}`);
      this.toast.success(`Đã xóa khách thuê "${t.full_name}"`);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  private async load(): Promise<void> {
    try {
      const res = await this.api.get<ListResponse<Tenant>>('/property/tenants');
      this.items.set(res.items);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
