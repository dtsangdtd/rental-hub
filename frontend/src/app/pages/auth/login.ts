import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/ui.services';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly returnUrl = input<string>();
  protected email = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected fillDemo() {
    this.email = 'admin@rental.local';
    this.password = 'admin12345';
  }

  protected async submit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const user = await this.auth.login(this.email, this.password);
      this.toast.success(`Welcome back, ${user.fullName}!`);
      await this.router.navigateByUrl(this.returnUrl() || '/dashboard');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
