import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ListResponse, Property } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { MANAGE_PROPERTY } from '../../nav';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

@Component({
  selector: 'app-properties',
  imports: [FormsModule, RouterLink, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './properties.html',
  styleUrl: './properties.scss',
})
export class PropertiesPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly items = signal<Property[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly canManage = computed(() => this.auth.hasRole(...MANAGE_PROPERTY));
  protected readonly query = signal('');
  protected get q() { return this.query(); }
  protected set q(v: string) { this.query.set(v); }
  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    return q ? this.items().filter((p) => (p.name + ' ' + p.address).toLowerCase().includes(q)) : this.items();
  });
  protected readonly totalUnits = computed(() => this.items().reduce((n, p) => n + (p.unit_count ?? 0), 0));
  protected form = {
    name: '',
    address: '',
    description: '',
    electricityRate: 3500,
    waterRate: 25000,
    internetRate: 100000,
    cleaningRate: 50000,
    parkingRate: 100000,
    bankName: '',
    bankAccountNumber: '',
    bankAccountName: '',
    bankQrCode: '',
  };

  constructor() {
    void this.load();
  }

  protected pct(p: Property) {
    return p.unit_count ? ((p.occupied_count ?? 0) / p.unit_count) * 100 : 0;
  }

  protected openCreate() {
    this.form = {
      name: '',
      address: '',
      description: '',
      electricityRate: 3500,
      waterRate: 25000,
      internetRate: 100000,
      cleaningRate: 50000,
      parkingRate: 100000,
      bankName: '',
      bankAccountNumber: '',
      bankAccountName: '',
      bankQrCode: '',
    };
    this.showCreate.set(true);
  }

  protected readonly isUploadingQr = signal(false);
  protected readonly uploadProgress = signal(0);

  protected async onQrFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.isUploadingQr.set(true);
    this.uploadProgress.set(10);
    this.cdr.markForCheck();
    try {
      const { readFileAsDataUrl } = await import('../../core/image-util');
      this.form.bankQrCode = await readFileAsDataUrl(file, 800, 0.85, (pct) => {
        this.uploadProgress.set(pct);
        this.cdr.markForCheck();
      });
      this.toast.success('Đã tải và xử lý ảnh mã QR thành công');
    } catch (err: unknown) {
      this.toast.error(err instanceof Error ? err.message : 'Lỗi khi đọc file ảnh');
    } finally {
      this.isUploadingQr.set(false);
      this.uploadProgress.set(0);
      input.value = '';
      this.cdr.markForCheck();
    }
  }

  protected removeQrCode() {
    this.form.bankQrCode = '';
  }

  protected async create() {
    this.saving.set(true);
    try {
      await this.api.post<Property>('/property/properties', {
        name: this.form.name.trim(),
        address: this.form.address.trim(),
        description: this.form.description.trim() || undefined,
        electricityRate: Number(this.form.electricityRate) || 3500,
        waterRate: Number(this.form.waterRate) || 25000,
        internetRate: Number(this.form.internetRate) || 100000,
        cleaningRate: Number(this.form.cleaningRate) || 50000,
        parkingRate: Number(this.form.parkingRate) || 100000,
        bankName: this.form.bankName.trim() || undefined,
        bankAccountNumber: this.form.bankAccountNumber.trim() || undefined,
        bankAccountName: this.form.bankAccountName.trim() || undefined,
        bankQrCode: this.form.bankQrCode.trim() || undefined,
      });
      this.toast.success('Property created');
      this.showCreate.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async load() {
    try {
      this.items.set((await this.api.get<ListResponse<Property>>('/property/properties')).items);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
