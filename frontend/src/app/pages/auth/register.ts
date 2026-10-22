import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/ui.services';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly role = signal<'landlord' | 'tenant'>('landlord');
  protected fullName = '';
  protected email = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected async submit() {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.register({ email: this.email, password: this.password, fullName: this.fullName, role: this.role() });
      this.toast.success('Account created — welcome to RentalHub!');
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
