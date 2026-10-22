import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; message: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  success(message: string) { this.push('success', message); }
  error(message: string) { this.push('error', message, 6000); }
  info(message: string) { this.push('info', message); }

  dismiss(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: ToastKind, message: string, ttl = 3500) {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), ttl);
  }
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

/** Promise-based confirm dialog rendered by <app-confirm-host>. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);

  ask(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => this.current.set({ ...opts, resolve }));
  }

  answer(ok: boolean) {
    this.current()?.resolve(ok);
    this.current.set(null);
  }
}
