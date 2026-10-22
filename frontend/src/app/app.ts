import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmHost, ToastHost } from './shared/overlays';
import { UpdateDialog } from './shared/update-dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost, ConfirmHost, UpdateDialog],
  template: `<router-outlet /><app-toast-host /><app-confirm-host /><app-update-dialog />`,
})
export class App {}
