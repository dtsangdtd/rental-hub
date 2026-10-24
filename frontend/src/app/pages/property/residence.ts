import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { I18nService } from '../../core/i18n.service';
import {
  Ct01Data,
  ListResponse,
  Property,
  ResidenceItem,
  ResidenceStats,
  ResidenceStatus,
  ResidenceUpdatePayload,
} from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { MANAGE_PROPERTY } from '../../nav';
import { StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';
import { Pagination } from '../../shared/pagination';
import { TranslatePipe } from '../../shared/translate.pipe';

@Component({
  selector: 'app-residence',
  imports: [FormsModule, DatePipe, Icon, Modal, Pagination, StatusBadge, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './residence.html',
  styleUrl: './residence.scss',
})
export class ResidencePage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly items = signal<ResidenceItem[]>([]);
  protected readonly properties = signal<Property[]>([]);
  protected readonly stats = signal<ResidenceStats>({
    total: 0,
    notRegistered: 0,
    pending: 0,
    registered: 0,
    expiringSoon: 0,
    expired: 0,
    temporaryAbsence: 0,
  });

  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  // Filters
  protected readonly selectedPropertyId = signal('');
  protected readonly selectedStatus = signal('');
  protected readonly searchQuery = signal('');

  protected readonly canManage = computed(() => this.auth.hasRole(...MANAGE_PROPERTY));

  // Modals state
  protected readonly showUpdateModal = signal(false);
  protected readonly showPoliceReportModal = signal(false);
  protected readonly showCt01Modal = signal(false);

  // Active editing resident
  protected readonly activeResident = signal<ResidenceItem | null>(null);
  protected readonly ct01Data = signal<Ct01Data | null>(null);
  protected readonly loadingCt01 = signal(false);

  // Update form state
  protected updateForm: ResidenceUpdatePayload = {
    tempRegStatus: 'registered',
    tempRegStartDate: '',
    tempRegEndDate: '',
    tempRegCode: '',
    tempRegNotes: '',
    tempAbsenceReason: '',
    tempAbsenceDestination: '',
  };

  constructor() {
    this.init();
  }

  async init(): Promise<void> {
    this.loading.set(true);
    try {
      await Promise.all([this.loadProperties(), this.loadStats(), this.loadItems()]);
    } finally {
      this.loading.set(false);
    }
  }

  async loadProperties(): Promise<void> {
    try {
      const res = await this.api.get<{ items: Property[] }>('/property/properties');
      this.properties.set(res.items || []);
    } catch (err) {
      console.error('Failed to load properties', err);
    }
  }

  async loadStats(): Promise<void> {
    try {
      const query: Record<string, string> = {};
      if (this.selectedPropertyId()) query['propertyId'] = this.selectedPropertyId();
      const res = await this.api.get<ResidenceStats>('/property/residence/stats', query);
      this.stats.set(res);
    } catch (err) {
      console.error('Failed to load residence stats', err);
    }
  }

  async loadItems(): Promise<void> {
    try {
      const query: Record<string, string | number> = {
        page: this.page(),
        limit: this.pageSize(),
      };
      if (this.selectedPropertyId()) query['propertyId'] = this.selectedPropertyId();
      if (this.selectedStatus()) query['status'] = this.selectedStatus();
      if (this.searchQuery().trim()) query['search'] = this.searchQuery().trim();

      const res = await this.api.get<ListResponse<ResidenceItem>>('/property/residence', query);
      this.items.set(res.items || []);
      this.total.set(res.total ?? (res.items?.length || 0));
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  onFilterChange(): void {
    this.page.set(1);
    this.loadStats();
    this.loadItems();
  }

  quickFilterStatus(status: string): void {
    this.selectedStatus.set(this.selectedStatus() === status ? '' : status);
    this.page.set(1);
    this.loadItems();
  }

  onPageChange(p: number): void {
    this.page.set(p);
    void this.loadItems();
  }

  onPageSizeChange(s: number): void {
    this.pageSize.set(s);
    this.page.set(1);
    void this.loadItems();
  }

  openUpdateModal(item: ResidenceItem): void {
    this.activeResident.set(item);
    this.updateForm = {
      tempRegStatus: item.temp_reg_status || 'not_registered',
      tempRegStartDate: item.temp_reg_start_date ? String(item.temp_reg_start_date).slice(0, 10) : '',
      tempRegEndDate: item.temp_reg_end_date ? String(item.temp_reg_end_date).slice(0, 10) : '',
      tempRegCode: item.temp_reg_code || '',
      tempRegNotes: item.temp_reg_notes || '',
      tempAbsenceReason: item.temp_absence_reason || '',
      tempAbsenceDestination: item.temp_absence_destination || '',
    };
    this.showUpdateModal.set(true);
  }

  async saveUpdate(): Promise<void> {
    const resident = this.activeResident();
    if (!resident) return;

    this.saving.set(true);
    try {
      await this.api.put(`/property/residence/${resident.resident_type}/${resident.id}`, {
        tempRegStatus: this.updateForm.tempRegStatus,
        tempRegStartDate: this.updateForm.tempRegStartDate || null,
        tempRegEndDate: this.updateForm.tempRegEndDate || null,
        tempRegCode: this.updateForm.tempRegCode || null,
        tempRegNotes: this.updateForm.tempRegNotes || null,
        tempAbsenceReason: this.updateForm.tempAbsenceReason || null,
        tempAbsenceDestination: this.updateForm.tempAbsenceDestination || null,
      });

      this.toast.success(
        this.i18n.isVi()
          ? 'Đã cập nhật thông tin tạm trú / tạm vắng thành công'
          : 'Residence status updated successfully',
      );
      this.showUpdateModal.set(false);
      await Promise.all([this.loadStats(), this.loadItems()]);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async openCt01Modal(item: ResidenceItem): Promise<void> {
    this.activeResident.set(item);
    this.loadingCt01.set(true);
    this.showCt01Modal.set(true);
    try {
      const data = await this.api.get<Ct01Data>(`/property/residence/${item.resident_type}/${item.id}/ct01`);
      this.ct01Data.set(data);
    } catch (err) {
      this.toast.error(errorMessage(err));
      this.showCt01Modal.set(false);
    } finally {
      this.loadingCt01.set(false);
    }
  }

  openPoliceReportModal(): void {
    this.showPoliceReportModal.set(true);
  }

  printCurrentView(): void {
    window.print();
  }

  /** Helper to set default 1 year / 2 year duration */
  setTermYears(years: number): void {
    const today = new Date();
    const startStr = this.updateForm.tempRegStartDate || today.toISOString().slice(0, 10);
    const startDate = new Date(startStr);
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + years);
    endDate.setDate(endDate.getDate() - 1);

    this.updateForm.tempRegStartDate = startStr;
    this.updateForm.tempRegEndDate = endDate.toISOString().slice(0, 10);
  }
}
