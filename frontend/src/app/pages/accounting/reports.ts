import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage, todayIso } from '../../core/api';
import { ReportSummary } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { LabelPipe, MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-reports',
  imports: [FormsModule, MoneyPipe, LabelPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class ReportsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly report = signal<ReportSummary | null>(null);

  protected from = todayIso().slice(0, 8) + '01';
  protected to = todayIso();

  protected readonly activeCurrency = signal('VND');

  protected readonly currencies = computed(() => {
    const keys = Object.keys(this.report()?.totals ?? {});
    return keys.length ? keys : ['VND'];
  });

  protected readonly currentTotals = computed(() => {
    return this.report()?.totals[this.activeCurrency()] ?? { income: 0, expenses: 0, profit: 0 };
  });

  protected readonly currentIncomeByKind = computed(() => {
    return (this.report()?.incomeByKind ?? []).filter((i) => i.currency === this.activeCurrency());
  });

  protected readonly currentExpensesByCategory = computed(() => {
    return (this.report()?.expensesByCategory ?? []).filter((e) => e.currency === this.activeCurrency());
  });

  constructor() {
    void this.load();
  }

  protected incomePct(val: number): number {
    const total = this.currentTotals().income;
    return total > 0 ? (val / total) * 100 : 0;
  }

  protected expensePct(val: number): number {
    const total = this.currentTotals().expenses;
    return total > 0 ? (val / total) * 100 : 0;
  }

  protected applyFilter() {
    if (this.from > this.to) {
      this.toast.error('Start date must be before or equal to End date');
      return;
    }
    void this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const data = await this.api.get<ReportSummary>('/accounting/reports/summary', {
        from: this.from,
        to: this.to,
      });
      this.report.set(data);
      const keys = Object.keys(data.totals);
      if (keys.length && !keys.includes(this.activeCurrency())) {
        this.activeCurrency.set(keys.includes('VND') ? 'VND' : keys[0]);
      }
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
