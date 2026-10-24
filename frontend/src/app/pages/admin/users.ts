import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { ListResponse, ROLES, Role, User } from '../../core/models';
import { ToastService } from '../../core/ui.services';
import { LabelPipe, StatusBadge } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Modal } from '../../shared/overlays';
import { Pagination } from '../../shared/pagination';

@Component({
  selector: 'app-users',
  imports: [FormsModule, DatePipe, LabelPipe, StatusBadge, Icon, Modal, Pagination],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class UsersPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);

  protected readonly users = signal<User[]>([]);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly query = signal('');

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

  protected readonly roles = ROLES;

  protected form: {
    fullName: string;
    email: string;
    password: string;
    role: Role;
  } = {
    fullName: '',
    email: '',
    password: '',
    role: 'landlord',
  };

  constructor() {
    void this.load();
  }

  protected openCreate() {
    this.form = {
      fullName: '',
      email: '',
      password: '',
      role: 'landlord',
    };
    this.showCreate.set(true);
  }

  protected async create() {
    this.saving.set(true);
    try {
      await this.api.post<User>('/auth/users', {
        fullName: this.form.fullName.trim(),
        email: this.form.email.trim().toLowerCase(),
        password: this.form.password,
        role: this.form.role,
      });
      this.toast.success('User account created');
      this.showCreate.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
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
      const res = await this.api.get<ListResponse<User>>('/auth/users', {
        page: this.page(),
        limit: this.pageSize(),
        q: this.query().trim() || undefined,
      });
      this.users.set(res.items || []);
      this.total.set(res.total ?? (res.items?.length || 0));
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
