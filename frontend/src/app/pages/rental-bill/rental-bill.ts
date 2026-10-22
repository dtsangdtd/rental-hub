import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Api } from '../../core/api';
import { MeterReadingService, UnitMeterReading } from '../../core/meter-reading.service';
import { Invoice, InvoiceDetail, Lease, Property, Tenant, UnitOccupant } from '../../core/models';
import { vietnameseCurrencyToWords } from '../../core/vietnamese-currency';
import { readFileAsDataUrl } from '../../core/image-util';

export interface BillItem {
  id: string;
  name: string;
  isMeter: boolean;
  meterStart?: number;
  meterEnd?: number;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

@Component({
  selector: 'app-rental-bill',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './rental-bill.html',
  styleUrl: './rental-bill.scss',
})
export class RentalBillPage implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly meterService = inject(MeterReadingService);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('billSheet') billSheet!: ElementRef<HTMLDivElement>;

  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();

  address = '';
  customerName = '';
  customerPhone = '';
  paymentInfo = '';
  bankQrCode = '';
  isUploadingQr = false;
  uploadProgress = 0;

  leases: Lease[] = [];
  selectedLease: Lease | null = null;
  selectedLeaseId = '';

  properties: Property[] = [];
  selectedPropertyId = '';

  tenants: Tenant[] = [];
  selectedTenantId = '';

  occupants: UnitOccupant[] = [];
  isExporting = false;
  savedMessage = '';

  currentInvoice: Invoice | null = null;
  isSyncingInvoice = false;

  // Responsive view mode and zoom controls
  viewMode: 'split' | 'editor' | 'preview' = 'split';
  sheetZoom = 85;

  items: BillItem[] = [];

  get blankRows(): number[] {
    const minRows = 6;
    const diff = minRows - this.items.length;
    return diff > 0 ? Array(diff).fill(0) : [];
  }

  get grandTotal(): number {
    return this.items.reduce((sum, it) => sum + (it.total || 0), 0);
  }

  get amountInWords(): string {
    return vietnameseCurrencyToWords(this.grandTotal);
  }

  get unitKey(): string {
    return this.selectedLease?.unit_id || this.address || 'room_default';
  }

  get unitMeterHistory(): UnitMeterReading[] {
    return this.meterService.getHistoryForUnit(this.unitKey);
  }

  get selectedProperty(): Property | undefined {
    return (
      this.properties.find((p) => p.id === this.selectedPropertyId) ||
      this.properties.find((p) => p.id === this.selectedLease?.property_id)
    );
  }

  isRentItem(item: BillItem): boolean {
    return item.name.toLowerCase().includes('tiền nhà') || item.name.toLowerCase().includes('tiền phòng');
  }

  hasAutoPrevious(item: BillItem): boolean {
    return item.isMeter && item.meterStart !== undefined && item.meterStart > 0;
  }

  async ngOnInit(): Promise<void> {
    this.resetToDefaults();
    await this.loadAllSources();

    // Check query params if prefilling from a specific lease or invoice
    const initialParams = this.route.snapshot.queryParams;
    if (initialParams['leaseId']) {
      const found = this.leases.find((l) => l.id === initialParams['leaseId']);
      if (found) {
        this.selectedLeaseId = found.id;
        this.applyLease(found);
      }
    } else if (initialParams['invoiceId']) {
      await this.loadFromInvoice(initialParams['invoiceId']);
    }

    this.route.queryParams.subscribe(async (params) => {
      const leaseId = params['leaseId'];
      const invoiceId = params['invoiceId'];

      if (leaseId && leaseId !== this.selectedLeaseId) {
        const found = this.leases.find((l) => l.id === leaseId);
        if (found) {
          this.selectedLeaseId = found.id;
          this.applyLease(found);
        }
      } else if (invoiceId) {
        await this.loadFromInvoice(invoiceId);
      }
      this.cdr.detectChanges();
    });

    this.cdr.detectChanges();
  }

  /** Set view mode for split/editor/preview tabs */
  setViewMode(mode: 'split' | 'editor' | 'preview'): void {
    this.viewMode = mode;
    this.cdr.detectChanges();
  }

  /** Set zoom percentage for A4 sheet preview */
  setZoom(zoom: number): void {
    this.sheetZoom = zoom;
    this.cdr.detectChanges();
  }

  getScaleTransform(): string {
    if (this.sheetZoom === 0) {
      return 'scale(0.85)';
    }
    return `scale(${this.sheetZoom / 100})`;
  }

  /** Initialize default items (Tiền thang máy is removed per user request) */
  resetToDefaults(): void {
    const rentPrice = this.selectedLease ? Number(this.selectedLease.monthly_rent) : 3500000;
    const elecPrice = this.selectedProperty?.electricity_rate ?? (this.selectedLease?.electricity_rate ? Number(this.selectedLease.electricity_rate) : 3500);
    const waterPrice = this.selectedProperty?.water_rate ?? (this.selectedLease?.water_rate ? Number(this.selectedLease.water_rate) : 25000);
    const netPrice = this.selectedProperty?.internet_rate ?? (this.selectedLease?.internet_rate ? Number(this.selectedLease.internet_rate) : 100000);
    const cleanPrice = this.selectedProperty?.cleaning_rate ?? (this.selectedLease?.cleaning_rate ? Number(this.selectedLease.cleaning_rate) : 50000);
    const parkPrice = this.selectedProperty?.parking_rate ?? (this.selectedLease?.parking_rate ? Number(this.selectedLease.parking_rate) : 100000);

    this.items = [
      { id: '1', name: 'Tiền nhà', isMeter: false, quantity: 1, unit: 'Tháng', unitPrice: rentPrice, total: rentPrice },
      { id: '2', name: 'Tiền điện', isMeter: true, meterStart: 1420, meterEnd: 1520, quantity: 100, unit: 'Số', unitPrice: elecPrice, total: 100 * elecPrice },
      { id: '3', name: 'Tiền nước', isMeter: true, meterStart: 120, meterEnd: 125, quantity: 5, unit: 'Khối', unitPrice: waterPrice, total: 5 * waterPrice },
      { id: '4', name: 'Tiền mạng', isMeter: false, quantity: 1, unit: 'Phòng', unitPrice: netPrice, total: netPrice },
      { id: '5', name: 'Tiền vệ sinh', isMeter: false, quantity: 1, unit: 'Người', unitPrice: cleanPrice, total: cleanPrice },
      { id: '6', name: 'Tiền giữ xe', isMeter: false, quantity: 1, unit: 'Xe', unitPrice: parkPrice, total: parkPrice },
      { id: '7', name: 'Tiền máy giặt', isMeter: false, quantity: 1, unit: 'Phòng', unitPrice: 50000, total: 50000 },
    ];
    this.syncSavedReadingsForCurrentPeriod();
  }

  async loadAllSources(): Promise<void> {
    try {
      const [leasesRes, propertiesRes, tenantsRes] = await Promise.all([
        this.api.get<{ items: Lease[] }>('/property/leases'),
        this.api.get<{ items: Property[] }>('/property/properties').catch(() => ({ items: [] })),
        this.api.get<{ items: Tenant[] }>('/property/tenants').catch(() => ({ items: [] })),
      ]);

      this.properties = propertiesRes.items || [];
      this.tenants = tenantsRes.items || [];

      const propsMap = new Map(this.properties.map((p) => [p.id, p]));
      const tenantsMap = new Map(this.tenants.map((t) => [t.id, t]));

      this.leases = (leasesRes.items || []).map((l) => {
        const tenant = tenantsMap.get(l.tenant_id);
        const prop = propsMap.get(l.property_id || '') || propsMap.get(l.owner_id);
        return {
          ...l,
          tenant_name: l.tenant_name || tenant?.full_name || 'Khách thuê',
          tenant_phone: l.tenant_phone || tenant?.phone || '',
          property_name: l.property_name || prop?.name || 'Cơ sở',
          property_address: l.property_address || prop?.address,
          bank_name: l.bank_name || prop?.bank_name,
          bank_account_number: l.bank_account_number || prop?.bank_account_number,
          bank_account_name: l.bank_account_name || prop?.bank_account_name,
          bank_qr_code: l.bank_qr_code || prop?.bank_qr_code,
        };
      });

      const qLeaseId = this.route.snapshot.queryParams['leaseId'];
      const qInvoiceId = this.route.snapshot.queryParams['invoiceId'];

      if (qLeaseId) {
        const found = this.leases.find((l) => l.id === qLeaseId);
        if (found) {
          this.selectedLeaseId = found.id;
          this.applyLease(found, tenantsMap);
          this.cdr.detectChanges();
          return;
        }
      }

      if (qInvoiceId) {
        // Will be loaded in ngOnInit
        return;
      }

      if (this.leases.length > 0) {
        const first = this.leases.find((l) => l.status === 'active') || this.leases[0];
        if (first) {
          this.selectedLeaseId = first.id;
          this.applyLease(first, tenantsMap);
          this.cdr.detectChanges();
          return;
        }
      }

      // If no lease exists yet, prefill from first Property and Tenant if available!
      if (this.properties.length > 0) {
        this.selectedPropertyId = this.properties[0].id;
        this.onPropertyChange();
      }
      if (this.tenants.length > 0) {
        this.selectedTenantId = this.tenants[0].id;
        this.onTenantChange();
      }
      this.cdr.detectChanges();
    } catch {
      // offline / mock fallback
    }
  }

  onSelectLeaseById(leaseId: string): void {
    this.selectedLeaseId = leaseId;
    const found = this.leases.find((l) => l.id === leaseId);
    if (found) {
      this.applyLease(found);
    }
    this.cdr.detectChanges();
  }

  onSelectLease(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.onSelectLeaseById(target.value);
  }

  onPropertyChange(): void {
    const prop = this.properties.find((p) => p.id === this.selectedPropertyId);
    if (!prop) return;

    // Auto-populate Address
    const currentRoom = this.selectedLease?.unit_name ? ` - Phòng ${this.selectedLease.unit_name}` : '';
    this.address = `${prop.name}${prop.address ? ' - ' + prop.address : ''}${currentRoom}`;

    // Auto-populate Payment / Bank details of the landlord from Property
    const bankLines: string[] = [];
    if (prop.bank_name) bankLines.push(prop.bank_name);
    if (prop.bank_account_number) bankLines.push(`STK: ${prop.bank_account_number}`);
    if (prop.bank_account_name) bankLines.push(`CTK: ${prop.bank_account_name}`);
    if (this.selectedLease?.unit_name) {
      bankLines.push(`ND: P${this.selectedLease.unit_name} Thang ${this.month}/${this.year}`);
    } else {
      bankLines.push(`ND: Thang ${this.month}/${this.year}`);
    }
    if (bankLines.length > 0) {
      this.paymentInfo = bankLines.join('\n');
    }

    // Auto-populate Banking QR Code if available
    if (prop.bank_qr_code) {
      this.bankQrCode = prop.bank_qr_code;
    }

    // Auto-populate Tariffs from Property Master Data
    this.applyTariffs({
      electricity_rate: prop.electricity_rate,
      water_rate: prop.water_rate,
      internet_rate: prop.internet_rate,
      cleaning_rate: prop.cleaning_rate,
      parking_rate: prop.parking_rate,
    });

    this.cdr.detectChanges();
  }

  onTenantChange(): void {
    const tenant = this.tenants.find((t) => t.id === this.selectedTenantId);
    if (!tenant) return;
    this.customerName = tenant.full_name || '';
    this.customerPhone = tenant.phone || '';
    this.cdr.detectChanges();
  }

  applyLease(lease: Lease, tenantsMap?: Map<string, Tenant>): void {
    this.selectedLease = lease;
    this.selectedLeaseId = lease.id;
    this.selectedPropertyId = lease.property_id || '';
    this.selectedTenantId = lease.tenant_id || '';

    // Customer Name & Phone
    this.customerName = lease.tenant_name || '';
    if (lease.tenant_phone) {
      this.customerPhone = lease.tenant_phone;
    } else if (tenantsMap) {
      const t = tenantsMap.get(lease.tenant_id);
      if (t?.phone) this.customerPhone = t.phone;
    } else {
      const t = this.tenants.find((item) => item.id === lease.tenant_id);
      if (t?.phone) this.customerPhone = t.phone;
    }

    // Auto-fill dynamic address: [Tên Cơ sở] - [Địa chỉ cơ sở] - Phòng [Tên phòng]
    const addrParts: string[] = [];
    if (lease.property_name) addrParts.push(lease.property_name);
    if (lease.property_address) addrParts.push(lease.property_address);
    if (lease.unit_name) addrParts.push(`Phòng ${lease.unit_name}`);
    this.address = addrParts.join(' - ') || 'Cơ sở';

    // Auto-fill dynamic banking payment information from Property master data
    const bankName = lease.bank_name || this.selectedProperty?.bank_name;
    const bankAcc = lease.bank_account_number || this.selectedProperty?.bank_account_number;
    const bankOwner = lease.bank_account_name || this.selectedProperty?.bank_account_name;

    if (bankName || bankAcc || bankOwner) {
      const bankLines: string[] = [];
      if (bankName) bankLines.push(bankName);
      if (bankAcc) bankLines.push(`STK: ${bankAcc}`);
      if (bankOwner) bankLines.push(`CTK: ${bankOwner}`);
      bankLines.push(`ND: P${lease.unit_name || '...'} Thang ${this.month}/${this.year}`);
      this.paymentInfo = bankLines.join('\n');
    }

    // Auto-populate QR Code from lease or property
    if (lease.bank_qr_code) {
      this.bankQrCode = lease.bank_qr_code;
    } else if (this.selectedProperty?.bank_qr_code) {
      this.bankQrCode = this.selectedProperty.bank_qr_code;
    }

    // 1. Auto-fill 'Tiền nhà' directly from lease.monthly_rent (Rent / month)
    const rentItem = this.items.find((i) => this.isRentItem(i));
    if (rentItem) {
      rentItem.unitPrice = Number(lease.monthly_rent);
      rentItem.total = rentItem.unitPrice * (rentItem.quantity || 1);
    }

    // 2. Auto-apply Master Data tariffs
    this.applyTariffs({
      electricity_rate: lease.electricity_rate ?? this.selectedProperty?.electricity_rate,
      water_rate: lease.water_rate ?? this.selectedProperty?.water_rate,
      internet_rate: lease.internet_rate ?? this.selectedProperty?.internet_rate,
      cleaning_rate: lease.cleaning_rate ?? this.selectedProperty?.cleaning_rate,
      parking_rate: lease.parking_rate ?? this.selectedProperty?.parking_rate,
    });

    // Auto-load occupants in this unit and adjust per-person / vehicle counts
    void this.loadUnitOccupants(lease.unit_id);

    // Automatically check and load meter readings history for this unit!
    this.syncSavedReadingsForCurrentPeriod();
    void this.checkInvoiceStatus();

    this.cdr.detectChanges();
  }

  private applyTariffs(tariffs: {
    electricity_rate?: number;
    water_rate?: number;
    internet_rate?: number;
    cleaning_rate?: number;
    parking_rate?: number;
  }): void {
    const elecItem = this.items.find((i) => i.name.toLowerCase().includes('điện'));
    if (elecItem && tariffs.electricity_rate !== undefined) {
      elecItem.unitPrice = Number(tariffs.electricity_rate);
      this.recalculateItem(elecItem);
    }

    const waterItem = this.items.find((i) => i.name.toLowerCase().includes('nước'));
    if (waterItem && tariffs.water_rate !== undefined) {
      waterItem.unitPrice = Number(tariffs.water_rate);
      this.recalculateItem(waterItem);
    }

    const netItem = this.items.find((i) => i.name.toLowerCase().includes('mạng') || i.name.toLowerCase().includes('internet'));
    if (netItem && tariffs.internet_rate !== undefined) {
      netItem.unitPrice = Number(tariffs.internet_rate);
      this.recalculateItem(netItem);
    }

    const cleanItem = this.items.find((i) => i.name.toLowerCase().includes('vệ sinh'));
    if (cleanItem && tariffs.cleaning_rate !== undefined) {
      cleanItem.unitPrice = Number(tariffs.cleaning_rate);
      this.recalculateItem(cleanItem);
    }

    const parkItem = this.items.find((i) => i.name.toLowerCase().includes('giữ xe') || i.name.toLowerCase().includes('gửi xe') || i.name.toLowerCase().includes('xe máy'));
    if (parkItem && tariffs.parking_rate !== undefined) {
      parkItem.unitPrice = Number(tariffs.parking_rate);
      this.recalculateItem(parkItem);
    }
  }

  async loadUnitOccupants(unitId: string): Promise<void> {
    try {
      const res = await this.api.get<{ items: UnitOccupant[] }>(`/property/units/${unitId}/occupants`);
      this.occupants = res.items || [];
      const count = Math.max(1, this.occupants.length);

      // Count occupants who registered a vehicle plate
      const vehicleCount = this.occupants.filter((o) => !!o.vehicle_plate && o.vehicle_plate.trim().length > 0).length;

      // Auto-update per-person fees (e.g. Tiền vệ sinh with unit 'Người')
      for (const item of this.items) {
        if (item.unit.toLowerCase() === 'người' || item.name.toLowerCase().includes('vệ sinh')) {
          item.quantity = count;
          item.total = item.quantity * item.unitPrice;
        }
        if (item.name.toLowerCase().includes('giữ xe') || item.name.toLowerCase().includes('gửi xe')) {
          if (vehicleCount > 0) {
            item.quantity = vehicleCount;
            item.total = item.quantity * item.unitPrice;
          }
        }
      }
      this.cdr.detectChanges();
    } catch {
      this.occupants = [];
    }
  }

  getOccupantNames(): string {
    return this.occupants.map((o) => `${o.full_name}${o.relationship ? ' (' + o.relationship + ')' : ''}`).join(', ');
  }

  onAddressChange(): void {
    this.syncSavedReadingsForCurrentPeriod();
    this.cdr.detectChanges();
  }

  onPeriodChange(): void {
    this.syncSavedReadingsForCurrentPeriod();
    void this.checkInvoiceStatus();
    this.cdr.detectChanges();
  }

  /**
   * Core workflow:
   * 1. Checks if current month has a saved reading -> loads both start and end.
   * 2. If not, gets the latest reading from previous month -> sets meterStart = previous.meterEnd!
   *    And clears meterEnd so user ONLY needs to type the new reading!
   */
  syncSavedReadingsForCurrentPeriod(): void {
    const period = `${this.year}-${String(this.month).padStart(2, '0')}`;
    const electric = this.items.find((i) => i.name.toLowerCase().includes('điện'));
    const water = this.items.find((i) => i.name.toLowerCase().includes('nước'));

    if (!electric || !water) return;

    const all = this.meterService.getAll();
    const currentRecord = all.find(
      (r) => (r.unitId === this.unitKey || r.roomName === this.unitKey) && r.period === period
    );

    if (currentRecord) {
      electric.meterStart = currentRecord.electricityStart;
      electric.meterEnd = currentRecord.electricityEnd;
      water.meterStart = currentRecord.waterStart;
      water.meterEnd = currentRecord.waterEnd;
    } else {
      const latestPrev = this.meterService.getLatestReading(this.unitKey, period);
      if (latestPrev) {
        electric.meterStart = latestPrev.electricityEnd;
        electric.meterEnd = undefined;

        water.meterStart = latestPrev.waterEnd;
        water.meterEnd = undefined;
      }
    }

    this.recalculateItem(electric);
    this.recalculateItem(water);
  }

  /** Step to next month, auto-saving current readings and carrying over end -> start */
  advanceMonth(step = 1): void {
    this.saveMeterReadings(false);

    let nextMonth = this.month + step;
    let nextYear = this.year;
    while (nextMonth > 12) {
      nextMonth -= 12;
      nextYear += 1;
    }
    while (nextMonth < 1) {
      nextMonth += 12;
      nextYear -= 1;
    }

    this.month = nextMonth;
    this.year = nextYear;
    this.syncSavedReadingsForCurrentPeriod();
    void this.checkInvoiceStatus();
    this.savedMessage = `✓ Đã chuyển sang Tháng ${this.month}/${this.year}. Số cũ đã được tự động cập nhật từ số mới kỳ trước.`;
    setTimeout(() => {
      this.savedMessage = '';
      this.cdr.detectChanges();
    }, 5000);
    this.cdr.detectChanges();
  }

  /** Check if an accounting invoice already exists for this room and period */
  async checkInvoiceStatus(): Promise<void> {
    const period = `${this.year}-${String(this.month).padStart(2, '0')}`;
    if (this.selectedLease) {
      try {
        const res = await this.api.get<{ items: Invoice[] }>('/accounting/invoices', {
          referenceId: this.selectedLease.id,
          period,
        });
        this.currentInvoice = res.items?.[0] || null;
      } catch {
        this.currentInvoice = null;
      }
    } else {
      this.currentInvoice = null;
    }
    this.cdr.detectChanges();
  }

  /**
   * Sync/Create invoice in accounting-service.
   * If an unpaid invoice exists, updates amount and items breakdown.
   * If already paid, preserves payment and updates metadata.
   */
  async syncToInvoices(showFeedback = true): Promise<Invoice | null> {
    if (this.grandTotal <= 0) return null;
    this.isSyncingInvoice = true;
    this.cdr.detectChanges();

    try {
      const period = `${this.year}-${String(this.month).padStart(2, '0')}`;
      const roomTitle = this.selectedLease?.unit_name || this.address || 'Phòng';
      const propertyTitle = this.selectedProperty?.name || this.selectedLease?.property_name || '';
      const description = `${roomTitle}${propertyTitle ? ' (' + propertyTitle + ')' : ''} — Tiền phòng & dịch vụ T${this.month}/${this.year}`;

      const payload = {
        leaseId: this.selectedLease?.id || null,
        customerId: this.selectedLease?.tenant_id || this.selectedTenantId || null,
        period,
        description,
        amount: this.grandTotal,
        currency: 'VND',
        dueDate: this.selectedLease?.due_day ? `${period}-${String(this.selectedLease.due_day).padStart(2, '0')}` : undefined,
        metadata: {
          roomName: roomTitle,
          propertyName: propertyTitle,
          customerName: this.customerName,
          customerPhone: this.customerPhone,
          bankInfo: this.paymentInfo,
          items: this.items.map((it) => ({
            id: it.id,
            name: it.name,
            isMeter: it.isMeter,
            meterStart: it.meterStart,
            meterEnd: it.meterEnd,
            quantity: it.quantity,
            unit: it.unit,
            unitPrice: it.unitPrice,
            total: it.total,
          })),
          grandTotal: this.grandTotal,
          syncedAt: new Date().toISOString(),
        },
      };

      const inv = await this.api.post<Invoice>('/accounting/invoices/sync-bill', payload);
      this.currentInvoice = inv;

      if (showFeedback) {
        const statusText = inv.status === 'paid' ? 'ĐÃ THANH TOÁN' : 'CHƯA THANH TOÁN';
        this.savedMessage = `✓ Đã lưu hóa đơn #${inv.number} vào Kế toán (${statusText} — ${this.grandTotal.toLocaleString('vi-VN')} ₫)`;
        setTimeout(() => {
          if (this.savedMessage.includes(inv.number)) this.savedMessage = '';
          this.cdr.detectChanges();
        }, 6000);
      }
      return inv;
    } catch (err) {
      console.error('Lỗi đồng bộ hóa đơn sang Kế toán', err);
      return null;
    } finally {
      this.isSyncingInvoice = false;
      this.cdr.detectChanges();
    }
  }

  async saveAndSyncBill(): Promise<void> {
    await this.saveMeterReadings(false);
    await this.syncToInvoices(true);
  }

  /** Save the current meter readings for this room & sync invoice */
  async saveMeterReadings(showFeedback = true): Promise<void> {
    const electric = this.items.find((i) => i.name.toLowerCase().includes('điện'));
    const water = this.items.find((i) => i.name.toLowerCase().includes('nước'));

    const roomTitle = this.selectedLease?.unit_name || this.address || 'Phòng';
    const period = `${this.year}-${String(this.month).padStart(2, '0')}`;

    const eStart = Number(electric?.meterStart) || 0;
    const eEnd = Number(electric?.meterEnd) || 0;
    const wStart = Number(water?.meterStart) || 0;
    const wEnd = Number(water?.meterEnd) || 0;

    this.meterService.saveReading({
      unitId: this.unitKey,
      roomName: roomTitle,
      period,
      month: this.month,
      year: this.year,
      electricityStart: eStart,
      electricityEnd: eEnd,
      waterStart: wStart,
      waterEnd: wEnd,
      savedAt: new Date().toISOString(),
    });

    const inv = await this.syncToInvoices(false);

    if (showFeedback) {
      const invInfo = inv ? ` · Hóa đơn #${inv.number} (${inv.status === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán'})` : '';
      this.savedMessage = `✓ Đã lưu chỉ số phòng ${roomTitle} kỳ T${this.month}/${this.year}${invInfo}`;
      setTimeout(() => {
        this.savedMessage = '';
        this.cdr.detectChanges();
      }, 6000);
    }
    this.cdr.detectChanges();
  }

  loadHistoryRecord(record: UnitMeterReading): void {
    this.month = record.month;
    this.year = record.year;
    const electric = this.items.find((i) => i.name.toLowerCase().includes('điện'));
    const water = this.items.find((i) => i.name.toLowerCase().includes('nước'));
    if (electric) {
      electric.meterStart = record.electricityStart;
      electric.meterEnd = record.electricityEnd;
      this.recalculateItem(electric);
    }
    if (water) {
      water.meterStart = record.waterStart;
      water.meterEnd = record.waterEnd;
      this.recalculateItem(water);
    }
    this.savedMessage = `✓ Đã tải lại chỉ số kỳ T${record.month}/${record.year}`;
    setTimeout(() => {
      this.savedMessage = '';
      this.cdr.detectChanges();
    }, 4000);
    void this.checkInvoiceStatus();
    this.cdr.detectChanges();
  }

  async loadFromInvoice(invoiceId: string): Promise<void> {
    try {
      const inv = await this.api.get<InvoiceDetail>(`/accounting/invoices/${invoiceId}`);
      this.currentInvoice = inv;
      if (inv.period) {
        const parts = inv.period.split('-');
        if (parts.length === 2) {
          this.year = Number(parts[0]);
          this.month = Number(parts[1]);
        }
      }

      // 1. If invoice links to a lease, populate the whole lease
      if (inv.reference_type === 'lease' && inv.reference_id) {
        const found = this.leases.find((l) => l.id === inv.reference_id);
        if (found) {
          this.selectedLeaseId = found.id;
          this.applyLease(found);
        }
      } else if (inv.customer_id) {
        const tenant = this.tenants.find((t) => t.id === inv.customer_id || t.user_id === inv.customer_id);
        if (tenant) {
          this.selectedTenantId = tenant.id;
          this.customerName = tenant.full_name;
          this.customerPhone = tenant.phone || '';
        }
      }

      // 2. Set rent price from invoice
      const rentItem = this.items.find((i) => this.isRentItem(i));
      if (rentItem) {
        rentItem.unitPrice = Number(inv.amount);
        rentItem.total = rentItem.unitPrice * (rentItem.quantity || 1);
      }

      this.syncSavedReadingsForCurrentPeriod();
      this.cdr.detectChanges();
    } catch {
      // ignore
    }
  }

  onMeterToggle(item: BillItem): void {
    if (item.isMeter) {
      item.meterStart = item.meterStart ?? 0;
      item.meterEnd = item.meterEnd ?? 0;
      this.recalculateItem(item);
    } else {
      item.meterStart = undefined;
      item.meterEnd = undefined;
      this.recalculateItem(item);
    }
    this.cdr.detectChanges();
  }

  recalculateItem(item: BillItem): void {
    if (item.isMeter) {
      const start = Number(item.meterStart) || 0;
      const end = Number(item.meterEnd) || 0;
      item.quantity = Math.max(0, end - start);
    }
    item.total = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    this.cdr.detectChanges();
  }

  addItem(): void {
    this.items.push({
      id: Date.now().toString(),
      name: 'Khoản thu mới',
      isMeter: false,
      quantity: 1,
      unit: 'Tháng',
      unitPrice: 0,
      total: 0,
    });
    this.cdr.detectChanges();
  }

  removeItem(index: number): void {
    this.items.splice(index, 1);
    this.cdr.detectChanges();
  }

  async printBill(): Promise<void> {
    await this.syncToInvoices(false);
    void this.saveMeterReadings(false);
    window.print();
  }

  async downloadPdf(): Promise<void> {
    if (!this.billSheet?.nativeElement) return;
    await this.syncToInvoices(false);
    void this.saveMeterReadings(false);
    this.isExporting = true;
    this.cdr.detectChanges();

    try {
      const element = this.billSheet.nativeElement;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = 210;
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      const safeCustomer = (this.customerName || 'khach').replace(/[^a-zA-Z0-9]/g, '_');
      pdf.save(`Hoa-don-tien-nha-T${this.month}-${this.year}-${safeCustomer}.pdf`);
    } catch (err) {
      console.error('PDF export failed', err);
      window.print();
    } finally {
      this.isExporting = false;
      this.cdr.detectChanges();
    }
  }

  async onBillQrFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.isUploadingQr = true;
    this.uploadProgress = 0;
    this.cdr.detectChanges();
    try {
      this.bankQrCode = await readFileAsDataUrl(file, 800, 0.85, (pct) => {
        this.uploadProgress = pct;
        this.cdr.detectChanges();
      });
      this.savedMessage = '✓ Đã tải và xử lý ảnh mã QR ngân hàng thành công';
      setTimeout(() => {
        if (this.savedMessage.includes('QR')) this.savedMessage = '';
        this.cdr.detectChanges();
      }, 4000);
    } catch (err: any) {
      alert(err.message || 'Không thể đọc file ảnh QR');
    } finally {
      this.isUploadingQr = false;
      this.uploadProgress = 0;
      input.value = '';
      this.cdr.detectChanges();
    }
  }

  removeBillQrCode(): void {
    this.bankQrCode = '';
    this.cdr.detectChanges();
  }
}
