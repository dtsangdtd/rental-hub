import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { ConfirmService, ToastService } from '../core/ui.services';
import { Icon } from './icon';

/** Render conditionally from the parent: `@if (open()) { <app-modal title="..." (closed)="open.set(false)"> }` */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="modal" role="dialog" aria-modal="true" [style.max-width.px]="width()" (click)="$event.stopPropagation()">
        <header>
          <div>
            <h2>{{ title() }}</h2>
            @if (subtitle()) { <p class="muted small">{{ subtitle() }}</p> }
          </div>
          <button type="button" class="btn btn-ghost btn-icon" (click)="closed.emit()" aria-label="Close"><app-icon name="x" /></button>
        </header>
        <div class="body"><ng-content /></div>
      </div>
    </div>`,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px;
      background: rgba(5, 6, 15, 0.65); backdrop-filter: blur(6px); animation: fadeIn .2s ease both; }
    .modal { width: 100%; max-height: calc(100vh - 40px); overflow: auto; border-radius: var(--radius-lg);
      background: linear-gradient(180deg, #171a33, #11142a); border: 1px solid var(--border-strong);
      box-shadow: 0 30px 80px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.03) inset; animation: pop .3s var(--ease) both; }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 20px 22px 0; }
    .body { padding: 18px 22px 22px; }
  `,
})
export class Modal {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly width = input(560);
  readonly closed = output<void>();
}

@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast ' + t.kind" (click)="toast.dismiss(t.id)">
          <span class="dot"><app-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'sparkle'" [size]="14" /></span>
          <span>{{ t.message }}</span>
        </div>
      }
    </div>`,
  styles: `
    .toasts { position: fixed; right: 20px; top: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; max-width: 420px; pointer-events: none; }
    .toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; border-radius: 14px; cursor: pointer; pointer-events: auto;
      background: rgba(23, 26, 51, .96); border: 1px solid var(--border-strong); backdrop-filter: blur(14px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset; animation: pop .3s var(--ease) both; font-weight: 500; }
    .dot { width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; color: #fff; }
    .success .dot { background: var(--success); } .error .dot { background: var(--danger); } .info .dot { background: var(--primary); }
  `,
})
export class ToastHost {
  protected readonly toast = inject(ToastService);
}

@Component({
  selector: 'app-confirm-host',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (confirm.current(); as c) {
      <app-modal [title]="c.title" [width]="440" (closed)="confirm.answer(false)">
        <p class="muted">{{ c.message }}</p>
        <div class="row mt" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="confirm-cancel" (click)="confirm.answer(false)">Cancel</button>
          <button class="btn" id="confirm-ok" [class.btn-danger]="c.danger" [class.btn-primary]="!c.danger" (click)="confirm.answer(true)">
            {{ c.confirmText || 'Confirm' }}
          </button>
        </div>
      </app-modal>
    }`,
})
export class ConfirmHost {
  protected readonly confirm = inject(ConfirmService);
}
