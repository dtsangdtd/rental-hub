import { inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ToastService } from './ui.services';

export interface AppVersionInfo {
  version: string;
  buildTime: string;
  hash: string;
  notes?: string;
}

const LOCAL_STORAGE_KEY = 'rental_hub_app_version';

@Injectable({
  providedIn: 'root',
})
export class VersionCheckService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly currentVersion = signal<AppVersionInfo>({
    version: '1.1.0',
    buildTime: '2026-10-22T15:35:00.000Z',
    hash: 'v1.1.0-437b349',
    notes: 'Cập nhật hệ thống mới',
  });

  readonly latestVersion = signal<AppVersionInfo | null>(null);
  readonly hasNewVersion = signal<boolean>(false);
  readonly isChecking = signal<boolean>(false);
  readonly showUpdateDialog = signal<boolean>(false);
  readonly lastCheckedAt = signal<Date | null>(null);

  private checkIntervalTimer: any = null;
  private lastCheckTime = 0;

  constructor() {
    this.init();
  }

  private init(): void {
    // 1. Restore previously recorded version or save current default
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AppVersionInfo;
        if (parsed?.hash) {
          this.currentVersion.set(parsed);
        }
      }
    } catch {
      // Ignore storage errors
    }

    // 2. Perform initial check shortly after app startup
    setTimeout(() => {
      void this.checkForUpdates(false, true);
    }, 3000);

    // 3. Periodic polling every 60 seconds
    this.checkIntervalTimer = setInterval(() => {
      void this.checkForUpdates(false);
    }, 60000);

    // 4. Check when user switches back to the application tab
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          const now = Date.now();
          if (now - this.lastCheckTime > 30000) {
            void this.checkForUpdates(false);
          }
        }
      });
    }

    // 5. Check on route navigation (at most once every 45s)
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        const now = Date.now();
        if (now - this.lastCheckTime > 45000) {
          void this.checkForUpdates(false);
        }
      });
  }

  /**
   * Check for new application version on the server.
   * @param isManual Triggered directly by the user via button.
   * @param isInitial First check on startup to sync current version if needed.
   */
  async checkForUpdates(isManual = false, isInitial = false): Promise<boolean> {
    if (this.isChecking()) return false;
    this.isChecking.set(true);
    this.lastCheckTime = Date.now();

    try {
      const res = await fetch(`/version.json?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });

      if (!res.ok) {
        if (isManual) {
          this.toast.info('Không thể kiểm tra phiên bản lúc này.');
        }
        return false;
      }

      const remote = (await res.json()) as AppVersionInfo;
      this.lastCheckedAt.set(new Date());

      const current = this.currentVersion();

      // On initial boot, if no previous version was stored, register the server's current version
      if (isInitial && !localStorage.getItem(LOCAL_STORAGE_KEY)) {
        this.currentVersion.set(remote);
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remote));
        } catch {}
        return false;
      }

      // Check if remote version or hash differs from current running version
      const isDifferent =
        remote.hash !== current.hash ||
        remote.version !== current.version ||
        new Date(remote.buildTime).getTime() > new Date(current.buildTime).getTime() + 1000;

      if (isDifferent) {
        this.latestVersion.set(remote);
        this.hasNewVersion.set(true);
        this.showUpdateDialog.set(true);

        if (isManual) {
          this.toast.success(`Đã phát hiện phiên bản mới: v${remote.version}!`);
        }
        return true;
      } else {
        if (isManual) {
          this.toast.info('Bạn đang sử dụng phiên bản mới nhất!');
        }
        return false;
      }
    } catch (err) {
      if (isManual) {
        this.toast.error('Lỗi khi kiểm tra phiên bản mới.');
      }
      return false;
    } finally {
      this.isChecking.set(false);
    }
  }

  /**
   * Clears browser caches and immediately reloads the application.
   */
  async applyUpdate(): Promise<void> {
    const next = this.latestVersion();
    if (next) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
      } catch {}
    }

    // Clear caches if Cache API exists
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      } catch {}
    }

    // Force hard reload from server
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  openDialog(): void {
    this.showUpdateDialog.set(true);
  }

  dismissDialog(): void {
    this.showUpdateDialog.set(false);
  }
}
