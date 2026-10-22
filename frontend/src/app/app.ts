import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmHost, ToastHost } from './shared/overlays';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost, ConfirmHost],
  template: `<router-outlet /><app-toast-host /><app-confirm-host />`,
})
export class App {}
