import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage, todayIso } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { Lease, ListResponse, Property, PropertyDetail, Tenant, Unit, UnitOccupant } from '../../core/models';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { MANAGE_PROPERTY } from '../../nav';
import { MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';
import { Pagination } from '../../shared/pagination';

interface LeaseForm {
  propertyId: string; unitId: string; tenantId: string; startDate: string; endDate: string;
  monthlyRent: number | null; deposit: number | null; currency: string; dueDay: number;
}
const STATUS_FILTERS = ['all', 'active', 'terminated'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

@Component({
  selector: 'app-leases',
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe, StatusBadge, Icon, Modal, Pagination],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './leases.html',
  styleUrl: './leases.scss',
})
export class LeasesPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** Pre-fill from the property page "Lease" button (?propertyId=&unitId=). */
  readonly propertyId = input<string>();
  readonly unitId = input<string>();

  protected readonly items = signal<Lease[]>([]);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly query = signal('');
  protected readonly filters = STATUS_FILTERS;
  protected readonly filter = signal<StatusFilter>('all');
  protected readonly canManage = computed(() => this.auth.hasRole(...MANAGE_PROPERTY));
  protected readonly filtered = computed(() => this.items());
  protected readonly activeCount = computed(() => this.items().filter((l) => l.status === 'active').length);

  get q(): string {
    return this.query();
  }
  set q(v: string) {
    this.query.set(v);
  }

  protected onSearchChange() {
    this.page.set(1);
    void this.load();
  }

  protected readonly properties = signal<Property[]>([]);
  protected readonly tenants = signal<Tenant[]>([]);
  protected readonly units = signal<Unit[]>([]);
  protected readonly vacantUnits = computed(() => this.units().filter((u) => u.status === 'vacant'));
  protected form: LeaseForm = this.blank();

  constructor() {
    void this.init();
  }

  private async init() {
    await this.load();
    const pid = this.propertyId();
    if (pid && this.canManage()) {
      await this.openCreate();
      await this.selectProperty(pid);
      const uid = this.unitId();
      if (uid) this.selectUnit(uid);
    }
  }

  protected async openCreate() {
    this.form = this.blank();
    this.units.set([]);
    this.showCreate.set(true);
    try {
      const [p, t] = await Promise.all([
        this.api.get<ListResponse<Property>>('/property/properties'),
        this.api.get<ListResponse<Tenant>>('/property/tenants'),
      ]);
      this.properties.set(p.items);
      this.tenants.set(t.items);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async selectProperty(id: string) {
    this.form.propertyId = id;
    this.form.unitId = '';
    this.units.set([]);
    try {
      this.units.set((await this.api.get<PropertyDetail>(`/property/properties/${id}`)).units);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected selectUnit(id: string) {
    this.form.unitId = id;
    const unit = this.units().find((u) => u.id === id);
    if (unit && this.form.monthlyRent === null) this.form.monthlyRent = unit.base_rent;
  }

  protected async create() {
    const f = this.form;
    this.saving.set(true);
    try {
      await this.api.post<Lease>('/property/leases', {
        unitId: f.unitId,
        tenantId: f.tenantId,
        startDate: f.startDate,
        endDate: f.endDate || undefined,
        monthlyRent: f.monthlyRent ?? undefined,
        deposit: f.deposit ?? 0,
        currency: f.currency.toUpperCase(),
        dueDay: f.dueDay,
      });
      this.toast.success('Lease created — deposit and first-month invoices are being issued');
      this.showCreate.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async terminate(l: Lease) {
    const ok = await this.confirm.ask({
      title: 'Terminate lease?',
      message: `${l.tenant_name} · ${l.unit_name}. The unit becomes vacant and monthly billing stops.`,
      confirmText: 'Terminate',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.post<Lease>(`/property/leases/${l.id}/terminate`);
      this.toast.success('Lease terminated');
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected readonly activeOccupantLease = signal<Lease | null>(null);
  protected readonly occupants = signal<UnitOccupant[]>([]);
  protected readonly loadingOccupants = signal(false);
  protected readonly addingOcc = signal(false);
  protected occForm = {
    fullName: '',
    phone: '',
    idNumber: '',
    relationship: 'Ở ghép',
    vehiclePlate: '',
    gender: 'Nam',
    notes: '',
  };

  protected async openOccupants(l: Lease) {
    this.activeOccupantLease.set(l);
    this.occForm = {
      fullName: '',
      phone: '',
      idNumber: '',
      relationship: 'Ở ghép',
      vehiclePlate: '',
      gender: 'Nam',
      notes: '',
    };
    await this.loadOccupants(l.unit_id);
  }

  protected closeOccupants() {
    this.activeOccupantLease.set(null);
  }

  protected async loadOccupants(unitId: string) {
    this.loadingOccupants.set(true);
    try {
      const res = await this.api.get<{ items: UnitOccupant[] }>(`/property/units/${unitId}/occupants`);
      this.occupants.set(res.items || []);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loadingOccupants.set(false);
    }
  }

  protected async addOccupant() {
    const l = this.activeOccupantLease();
    if (!l) return;
    this.addingOcc.set(true);
    try {
      await this.api.post<UnitOccupant>(`/property/units/${l.unit_id}/occupants`, {
        fullName: this.occForm.fullName,
        phone: this.occForm.phone || undefined,
        idNumber: this.occForm.idNumber || undefined,
        relationship: this.occForm.relationship || 'Ở ghép',
        vehiclePlate: this.occForm.vehiclePlate || undefined,
        gender: this.occForm.gender || undefined,
        notes: this.occForm.notes || undefined,
        isPrimary: false,
      });
      this.toast.success(`Đã thêm ${this.occForm.fullName} vào phòng`);
      this.occForm.fullName = '';
      this.occForm.phone = '';
      this.occForm.idNumber = '';
      this.occForm.vehiclePlate = '';
      this.occForm.notes = '';
      await this.loadOccupants(l.unit_id);
      await this.load(); // Refresh occupant_count on lease list
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.addingOcc.set(false);
    }
  }

  protected async deleteOccupant(occ: UnitOccupant) {
    const ok = await this.confirm.ask({
      title: 'Xóa người ở?',
      message: `Xóa ${occ.full_name} khỏi danh sách phòng này?`,
      confirmText: 'Xóa',
      danger: true,
    });
    if (!ok) return;

    try {
      await this.api.delete(`/property/occupants/${occ.id}`);
      this.toast.success(`Đã xóa ${occ.full_name}`);
      const l = this.activeOccupantLease();
      if (l) {
        await this.loadOccupants(l.unit_id);
        await this.load();
      }
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  private blank(): LeaseForm {
    return { propertyId: '', unitId: '', tenantId: '', startDate: todayIso(), endDate: '', monthlyRent: null, deposit: 0, currency: 'VND', dueDay: 5 };
  }

  protected setFilter(s: StatusFilter) {
    this.filter.set(s);
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
      const res = await this.api.get<ListResponse<Lease>>('/property/leases', {
        page: this.page(),
        limit: this.pageSize(),
        status: this.filter() === 'all' ? undefined : this.filter(),
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
}
