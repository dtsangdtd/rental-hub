import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, currentPeriod, errorMessage, round2, todayIso } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { GenerateRentResult, Invoice, InvoiceStatus, ListResponse } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { FINANCE } from '../../nav';
import { LabelPipe, MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

type StatusFilter = InvoiceStatus | 'all';

@Component({
  selector: 'app-invoices',
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe, LabelPipe, StatusBadge, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoices.html',
  styleUrl: './invoices.scss',
})
export class InvoicesPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);

  protected readonly statuses: StatusFilter[] = ['all', 'unpaid', 'partial', 'paid', 'void'];
  protected readonly status = signal<StatusFilter>('all');
  protected readonly period = signal('');
  protected readonly items = signal<Invoice[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly isFinance = computed(() => this.auth.hasRole(...FINANCE));
  protected readonly visible = this.items;

  protected readonly currency = computed(() => {
    const cs = this.items().map((i) => i.currency);
    return cs.includes('VND') ? 'VND' : (cs[0] ?? 'VND');
  });
  protected readonly sums = computed(() => {
    const list = this.items().filter((i) => i.currency === this.currency() && i.status !== 'void');
    const billed = round2(list.reduce((s, i) => s + i.amount, 0));
    const paid = round2(list.reduce((s, i) => s + i.amount_paid, 0));
    return { billed, paid, open: round2(billed - paid) };
  });
  protected readonly collectRate = computed(() => (this.sums().billed ? Math.round((this.sums().paid / this.sums().billed) * 100) : 0));
  protected readonly overdueCount = computed(() => this.items().filter((i) => this.isOverdue(i)).length);

  protected readonly showGenerate = signal(false);
  protected readonly genResult = signal<GenerateRentResult | null>(null);
  protected genPeriod = currentPeriod();
  protected readonly showCreate = signal(false);
  protected form = { description: '', amount: null as number | null, currency: 'VND', dueDate: todayIso(), customerId: '' };

  constructor() {
    void this.load();
  }

  protected isOverdue(i: Invoice) {
    return (i.status === 'unpaid' || i.status === 'partial') && i.due_date < todayIso();
  }

  protected setStatus(s: StatusFilter) {
    this.status.set(s);
    void this.load();
  }

  protected setPeriod(p: string) {
    this.period.set(p ?? '');
    void this.load();
  }

  protected openGenerate() {
    this.genResult.set(null);
    this.genPeriod = currentPeriod();
    this.showGenerate.set(true);
  }

  protected async generate() {
    this.saving.set(true);
    try {
      const r = await this.api.post<GenerateRentResult>('/accounting/invoices/generate-rent', { period: this.genPeriod });
      this.genResult.set(r);
      this.toast.success(`${r.created} rent invoice(s) created for ${r.period}`);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected openCreate() {
    this.form = { description: '', amount: null, currency: 'VND', dueDate: todayIso(), customerId: '' };
    this.showCreate.set(true);
  }

  protected async create() {
    this.saving.set(true);
    try {
      const inv = await this.api.post<Invoice>('/accounting/invoices', {
        description: this.form.description.trim(),
        amount: round2(this.form.amount ?? 0),
        currency: this.form.currency.toUpperCase(),
        dueDate: this.form.dueDate,
        customerId: this.form.customerId.trim() || undefined,
      });
      this.toast.success(`Invoice ${inv.number} created`);
      this.showCreate.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async load() {
    this.loading.set(true);
    try {
      const s = this.status();
      const res = await this.api.get<ListResponse<Invoice>>('/accounting/invoices', {
        status: s === 'all' ? undefined : s,
        period: this.period() || undefined,
      });
      this.items.set(res.items);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
