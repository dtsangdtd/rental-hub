import { ChangeDetectionStrategy, Component, Pipe, PipeTransform, computed, input } from '@angular/core';

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
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const s = value.replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

const TONES: Record<string, string> = {
  paid: 'success', active: 'success', vacant: 'success', fulfilled: 'success',
  partial: 'info', occupied: 'primary',
  unpaid: 'warning', pending: 'warning', maintenance: 'warning',
  void: 'neutral', cancelled: 'neutral', terminated: 'neutral',
  admin: 'danger', landlord: 'primary', accountant: 'info', tenant: 'success',
};

@Component({
  selector: 'app-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="tone()">{{ value() }}</span>`,
})
export class StatusBadge {
  readonly value = input.required<string>();
  protected readonly tone = computed(() => 'badge ' + (TONES[this.value()] ?? 'neutral'));
}
