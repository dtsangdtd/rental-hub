import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage, round2, todayIso } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { InvoiceDetail, PAYMENT_METHODS, PaymentMethod, PaymentResult } from '../../core/models';
import { ConfirmService, ToastService } from '../../core/ui.services';
import { FINANCE } from '../../nav';
import { LabelPipe, MoneyPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { TranslatePipe } from '../../shared/translate.pipe';

const METHOD_ICONS: Record<PaymentMethod, string> = { cash: 'money', bank_transfer: 'building', card: 'wallet', ewallet: 'sparkle' };

@Component({
  selector: 'app-invoice-detail',
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe, LabelPipe, StatusBadge, Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-detail.html',
  styleUrl: './invoice-detail.scss',
})
export class InvoiceDetailPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  protected readonly invoice = signal<InvoiceDetail | null>(null);
  protected readonly saving = signal(false);
  protected readonly methods = PAYMENT_METHODS;
  protected readonly method = signal<PaymentMethod>('bank_transfer');
  protected amount: number | null = null;
  protected note = '';

  private readonly isFinance = computed(() => this.auth.hasRole(...FINANCE));
  protected readonly remaining = computed(() => {
    const i = this.invoice();
    return i ? round2(i.amount - i.amount_paid) : 0;
  });
  protected readonly half = computed(() => round2(this.remaining() / 2));
  protected readonly paidPct = computed(() => {
    const i = this.invoice();
    return i && i.amount ? Math.min(100, Math.round((i.amount_paid / i.amount) * 100)) : 0;
  });
  protected readonly overdue = computed(() => {
    const i = this.invoice();
    return !!i && (i.status === 'unpaid' || i.status === 'partial') && i.due_date < todayIso();
  });
  /** Mirrors backend checks: finance role, owner (landlord) or staff, invoice still open. */
  private readonly canWrite = computed(() => {
    const i = this.invoice();
    const u = this.auth.user();
    if (!i || !u || !this.isFinance()) return false;
    return u.role !== 'landlord' || i.owner_id === u.id;
  });
  protected readonly canPay = computed(() => this.canWrite() && (this.invoice()!.status === 'unpaid' || this.invoice()!.status === 'partial'));
  protected readonly canVoid = computed(() => this.canWrite() && this.invoice()!.amount_paid === 0 && this.invoice()!.status !== 'void');

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected methodIcon(m: PaymentMethod) {
    return METHOD_ICONS[m];
  }

  protected async pay() {
    const inv = this.invoice();
    if (!inv || !this.amount) return;
    this.saving.set(true);
    try {
      const r = await this.api.post<PaymentResult>(`/accounting/invoices/${inv.id}/payments`, {
        amount: round2(this.amount),
        method: this.method(),
        note: this.note.trim() || undefined,
      });
      this.toast.success(r.invoice.status === 'paid' ? 'Invoice fully paid 🎉' : 'Payment recorded');
      this.amount = null;
      this.note = '';
      await this.load(inv.id);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async voidInvoice() {
    const inv = this.invoice();
    if (!inv) return;
    const ok = await this.confirm.ask({ title: `Void ${inv.number}?`, message: 'The invoice will no longer be collectable. This cannot be undone.', confirmText: 'Void invoice', danger: true });
    if (!ok) return;
    try {
      await this.api.post(`/accounting/invoices/${inv.id}/void`);
      this.toast.success('Invoice voided');
      await this.load(inv.id);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  private async load(id: string) {
    try {
      this.invoice.set(await this.api.get<InvoiceDetail>(`/accounting/invoices/${id}`));
    } catch (err) {
      this.toast.error(errorMessage(err));
      void this.router.navigate(['/invoices']);
    }
  }
}
