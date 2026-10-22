import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { PropertyDetail, Unit } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { MANAGE_PROPERTY } from '../../nav';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

interface UnitForm { name: string; baseRent: number | null; areaM2: number | null; status: 'vacant' | 'maintenance' | ''; }
const UNIT_FILTERS = ['all', 'vacant', 'occupied', 'maintenance'] as const;
type UnitFilter = (typeof UNIT_FILTERS)[number];

@Component({
  selector: 'app-property-detail',
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, MoneyPipe, StatusBadge, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './property-detail.html',
  styleUrl: './property-detail.scss',
})
export class PropertyDetailPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly id = input.required<string>();
  protected readonly property = signal<PropertyDetail | null>(null);
  protected readonly canManage = computed(() => this.auth.hasRole(...MANAGE_PROPERTY));
  protected readonly filters = UNIT_FILTERS;
  protected readonly filter = signal<UnitFilter>('all');
  protected readonly units = computed(() => {
    const units = this.property()?.units ?? [];
    return this.filter() === 'all' ? units : units.filter((u) => u.status === this.filter());
  });
  /** undefined = closed, null = creating, Unit = editing */
  protected readonly editing = signal<Unit | null | undefined>(undefined);
  protected readonly saving = signal(false);
  protected form: UnitForm = { name: '', baseRent: null, areaM2: null, status: '' };

  protected readonly showTariffModal = signal(false);
  protected readonly savingTariff = signal(false);
  protected tariffForm = {
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

  protected openTariffModal() {
    const p = this.property();
    if (p) {
      this.tariffForm = {
        electricityRate: Number(p.electricity_rate) || 3500,
        waterRate: Number(p.water_rate) || 25000,
        internetRate: Number(p.internet_rate) || 100000,
        cleaningRate: Number(p.cleaning_rate) || 50000,
        parkingRate: Number(p.parking_rate) || 100000,
        bankName: p.bank_name || '',
        bankAccountNumber: p.bank_account_number || '',
        bankAccountName: p.bank_account_name || '',
        bankQrCode: p.bank_qr_code || '',
      };
    }
    this.showTariffModal.set(true);
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
      this.tariffForm.bankQrCode = await readFileAsDataUrl(file, 800, 0.85, (pct) => {
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
    this.tariffForm.bankQrCode = '';
  }

  protected async saveTariffs() {
    this.savingTariff.set(true);
    try {
      await this.api.patch<PropertyDetail>(`/property/properties/${this.id()}`, {
        electricityRate: Number(this.tariffForm.electricityRate) || 3500,
        waterRate: Number(this.tariffForm.waterRate) || 25000,
        internetRate: Number(this.tariffForm.internetRate) || 100000,
        cleaningRate: Number(this.tariffForm.cleaningRate) || 50000,
        parkingRate: Number(this.tariffForm.parkingRate) || 100000,
        bankName: this.tariffForm.bankName.trim() || undefined,
        bankAccountNumber: this.tariffForm.bankAccountNumber.trim() || undefined,
        bankAccountName: this.tariffForm.bankAccountName.trim() || undefined,
        bankQrCode: this.tariffForm.bankQrCode,
      });
      this.toast.success('Đã cập nhật biểu phí dịch vụ & tài khoản ngân hàng');
      this.showTariffModal.set(false);
      await this.load(this.id());
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.savingTariff.set(false);
    }
  }

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected count(status: Unit['status']) {
    return this.property()?.units.filter((u) => u.status === status).length ?? 0;
  }

  protected openUnit(u: Unit | null) {
    this.form = u
      ? { name: u.name, baseRent: u.base_rent, areaM2: u.area_m2, status: u.status === 'occupied' ? '' : u.status }
      : { name: '', baseRent: null, areaM2: null, status: '' };
    this.editing.set(u);
  }

  protected lease(u: Unit) {
    void this.router.navigate(['/leases'], { queryParams: { propertyId: this.id(), unitId: u.id } });
  }

  protected async saveUnit() {
    const editing = this.editing();
    const body = {
      name: this.form.name.trim() || undefined,
      baseRent: this.form.baseRent ?? undefined,
      areaM2: this.form.areaM2 || undefined,
      status: editing && this.form.status && this.form.status !== editing.status ? this.form.status : undefined,
    };
    this.saving.set(true);
    try {
      if (editing) await this.api.patch<Unit>(`/property/units/${editing.id}`, body);
      else await this.api.post<Unit>(`/property/properties/${this.id()}/units`, body);
      this.toast.success(editing ? 'Unit updated' : 'Unit added');
      this.editing.set(undefined);
      await this.load(this.id());
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(id: string) {
    try {
      this.property.set(await this.api.get<PropertyDetail>(`/property/properties/${id}`));
    } catch (err) {
      this.toast.error(errorMessage(err));
      void this.router.navigate(['/properties']);
    }
  }
}
