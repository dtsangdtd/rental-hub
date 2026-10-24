import { ChangeDetectionStrategy, Component, Pipe, PipeTransform, computed, inject, input } from '@angular/core';
import { I18nService } from '../core/i18n.service';
export { TranslatePipe } from './translate.pipe';

/** `{{ amount | money: currency }}` — VND without decimals, others with 2. */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency = 'VND'): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const zeroDecimals = ['VND', 'JPY', 'KRW'].includes(currency);
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: zeroDecimals ? 0 : 2,
        minimumFractionDigits: zeroDecimals ? 0 : 2,
      }).format(value);
    } catch {
      return `${value.toLocaleString('en-US')} ${currency}`;
    }
  }
}

/** `{{ 'bank_transfer' | label }}` → "Bank transfer" */
@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const kindTrans = this.i18n.t('kind.' + value);
    if (kindTrans !== 'kind.' + value) return kindTrans;
    const statusTrans = this.i18n.t('status.' + value);
    if (statusTrans !== 'status.' + value) return statusTrans;
    const s = value.replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

const TONES: Record<string, string> = {
  paid: 'success', active: 'success', vacant: 'success', fulfilled: 'success', registered: 'success',
  partial: 'info', occupied: 'primary', temporary_absence: 'info', order: 'info',
  unpaid: 'warning', pending: 'warning', maintenance: 'warning', expiring_soon: 'warning',
  void: 'neutral', cancelled: 'neutral', terminated: 'neutral', not_registered: 'neutral', expired: 'danger',
  admin: 'danger', landlord: 'primary', accountant: 'info', tenant: 'success',
};

@Component({
  selector: 'app-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="tone()">{{ displayLabel() }}</span>`,
})
export class StatusBadge {
  private readonly i18n = inject(I18nService);
  readonly value = input.required<string>();
  protected readonly tone = computed(() => 'badge ' + (TONES[this.value()] ?? 'neutral'));
  protected readonly displayLabel = computed(() => {
    const val = this.value();
    const statusTrans = this.i18n.t('status.' + val);
    if (statusTrans !== 'status.' + val) return statusTrans;
    const roleTrans = this.i18n.t('roles.' + val);
    if (roleTrans !== 'roles.' + val) return roleTrans;
    const s = val.replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}
