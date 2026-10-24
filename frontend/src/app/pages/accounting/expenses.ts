import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage, todayIso } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { I18nService } from '../../core/i18n.service';
import { EXPENSE_CATEGORIES, Expense, ExpenseCategory, ListResponse, Property } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { FINANCE } from '../../nav';
import { MoneyPipe } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';
import { Pagination } from '../../shared/pagination';
import { TranslatePipe } from '../../shared/translate.pipe';

@Component({
  selector: 'app-expenses',
  imports: [FormsModule, DatePipe, MoneyPipe, Icon, Modal, Pagination, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './expenses.html',
  styleUrl: './expenses.scss',
})
export class ExpensesPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly items = signal<Expense[]>([]);
  protected readonly properties = signal<Property[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly canManage = computed(() => this.auth.hasRole(...FINANCE));

  // Pagination & Filters
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);

  protected readonly categories = EXPENSE_CATEGORIES;
  protected readonly categoryFilters = ['all', ...EXPENSE_CATEGORIES] as const;
  protected readonly selectedCategory = signal<string>('all');
  protected readonly query = signal('');

  protected get q() { return this.query(); }
  protected set q(v: string) { this.query.set(v); }

  protected readonly currency = computed(() => {
    const cs = this.items().map((e) => e.currency);
    return cs.includes('VND') ? 'VND' : (cs[0] ?? 'VND');
  });

  protected readonly totalExpense = computed(() => {
    return this.items()
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
    void this.loadProperties();
  }

  protected onFilterChange() {
    this.page.set(1);
    void this.load();
  }

  protected onCategorySelect(cat: string) {
    this.selectedCategory.set(cat);
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

  protected getCategoryLabel(cat: string): string {
    const keyMap: Record<string, string> = {
      maintenance: 'expenses.catMaintenance',
      utilities: 'expenses.catUtilities',
      tax: 'expenses.catTax',
      insurance: 'expenses.catInsurance',
      salary: 'expenses.catSalary',
      other: 'expenses.catOther',
    };
    const key = keyMap[cat];
    return key ? this.i18n.t(key) : cat;
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
      this.toast.success(this.i18n.isVi() ? 'Đã lưu khoản chi thành công' : 'Expense recorded successfully');
      this.showCreate.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async load() {
    this.loading.set(true);
    try {
      const query: Record<string, string | number> = {
        page: this.page(),
        limit: this.pageSize(),
      };
      if (this.selectedCategory() !== 'all') {
        query['category'] = this.selectedCategory();
      }
      if (this.query().trim()) {
        query['search'] = this.query().trim();
      }

      const res = await this.api.get<ListResponse<Expense>>('/accounting/expenses', query);
      this.items.set(res.items || []);
      this.total.set(res.total ?? (res.items?.length || 0));
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadProperties() {
    try {
      const res = await this.api.get<ListResponse<Property>>('/property/properties');
      this.properties.set(res.items || []);
    } catch (err) {
      console.error('Failed to load properties for expenses', err);
    }
  }
}
