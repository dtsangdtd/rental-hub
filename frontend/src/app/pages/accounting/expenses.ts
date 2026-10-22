import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage, todayIso } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { EXPENSE_CATEGORIES, Expense, ExpenseCategory, ListResponse, Property } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { FINANCE } from '../../nav';
import { LabelPipe, MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';

@Component({
  selector: 'app-expenses',
  imports: [FormsModule, DatePipe, MoneyPipe, LabelPipe, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './expenses.html',
  styleUrl: './expenses.scss',
})
export class ExpensesPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<Expense[]>([]);
  protected readonly properties = signal<Property[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly canManage = computed(() => this.auth.hasRole(...FINANCE));

  protected readonly categories = EXPENSE_CATEGORIES;
  protected readonly categoryFilters = ['all', ...EXPENSE_CATEGORIES] as const;
  protected readonly selectedCategory = signal<string>('all');
  protected readonly query = signal('');

  protected get q() { return this.query(); }
  protected set q(v: string) { this.query.set(v); }

  protected readonly filtered = computed(() => {
    let res = this.items();
    const cat = this.selectedCategory();
    if (cat !== 'all') {
      res = res.filter((e) => e.category === cat);
    }
    const q = this.query().toLowerCase().trim();
    if (q) {
      res = res.filter((e) => e.description.toLowerCase().includes(q));
    }
    return res;
  });

  protected readonly currency = computed(() => {
    const cs = this.items().map((e) => e.currency);
    return cs.includes('VND') ? 'VND' : (cs[0] ?? 'VND');
  });

  protected readonly totalExpense = computed(() => {
    return this.filtered()
      .filter((e) => e.currency === this.currency())
      .reduce((sum, e) => sum + e.amount, 0);
  });

  protected form: {
    description: string;
    category: ExpenseCategory;
    propertyId: string;
    amount: number | null;
    currency: string;
    spentOn: string;
  } = {
    description: '',
    category: 'maintenance',
    propertyId: '',
    amount: null,
    currency: 'VND',
    spentOn: todayIso(),
  };

  constructor() {
    void this.load();
  }

  protected openCreate() {
    this.form = {
      description: '',
      category: 'maintenance',
      propertyId: '',
      amount: null,
      currency: 'VND',
      spentOn: todayIso(),
    };
    this.showCreate.set(true);
  }

  protected async create() {
    this.saving.set(true);
    try {
      await this.api.post<Expense>('/accounting/expenses', {
        description: this.form.description.trim(),
        category: this.form.category,
        amount: Number(this.form.amount),
        currency: this.form.currency.toUpperCase(),
        spentOn: this.form.spentOn,
        propertyId: this.form.propertyId.trim() || undefined,
      });
      this.toast.success('Expense recorded');
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
      const [expensesRes, propsRes] = await Promise.allSettled([
        this.api.get<ListResponse<Expense>>('/accounting/expenses'),
        this.api.get<ListResponse<Property>>('/property/properties'),
      ]);
      if (expensesRes.status === 'fulfilled') {
        this.items.set(expensesRes.value.items);
      }
      if (propsRes.status === 'fulfilled') {
        this.properties.set(propsRes.value.items);
      }
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
