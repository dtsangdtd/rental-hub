import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VersionCheckService } from '../core/version-check.service';
import { Icon } from './icon';

@Component({
  selector: 'app-update-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Modal Dialog when update is detected or opened -->
    @if (versionService.showUpdateDialog()) {
      <div class="update-backdrop" (click)="versionService.dismissDialog()">
        <div class="update-modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <div class="update-badge">
            <span class="sparkle-icon">🚀</span>
            <span>PHIÊN BẢN MỚI CỦA RENTALHUB</span>
          </div>

          <h2 class="update-title">Đã có bản cập nhật hệ thống!</h2>
          <p class="update-subtitle">
            Hệ thống vừa được phát hành phiên bản mới. Hãy làm mới ứng dụng để trải nghiệm các tính năng và sửa lỗi mới nhất.
          </p>

          <div class="version-diff-card">
            <div class="diff-row">
              <span class="label">Phiên bản hiện tại:</span>
              <span class="val old mono">v{{ versionService.currentVersion().version }} ({{ versionService.currentVersion().hash.slice(0, 12) }})</span>
            </div>
            <div class="diff-row">
              <span class="label">Phiên bản mới:</span>
              <span class="val new mono">v{{ versionService.latestVersion()?.version || 'Mới' }} ({{ (versionService.latestVersion()?.hash || '').slice(0, 12) }})</span>
            </div>
            @if (versionService.latestVersion()?.notes; as notes) {
              <div class="notes-box">
                <div class="notes-title">Nội dung cập nhật:</div>
                <div class="notes-content">{{ notes }}</div>
              </div>
            }
          </div>

          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" (click)="versionService.dismissDialog()">
              Để sau
            </button>
            <button type="button" class="btn btn-primary btn-update" (click)="versionService.applyUpdate()">
              <app-icon name="sparkle" [size]="16" />
              <span>Cập nhật & Tải lại ngay</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Floating Persistent Notification Pill (shown if dismissed but update still pending) -->
    @if (versionService.hasNewVersion() && !versionService.showUpdateDialog()) {
      <div class="floating-update-pill" (click)="versionService.openDialog()" title="Bấm để mở hộp thoại cập nhật">
        <span class="pulse-dot"></span>
        <span class="pill-text">Đã có bản cập nhật mới (v{{ versionService.latestVersion()?.version }})</span>
        <button type="button" class="btn-pill-action" (click)="versionService.applyUpdate(); $event.stopPropagation()">
          Cập nhật
        </button>
      </div>
    }
  `,
  styles: `
    .update-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(3, 7, 18, 0.78);
      backdrop-filter: blur(8px);
      animation: fadeIn 0.2s ease both;
    }

    .update-modal {
      width: 100%;
      max-width: 480px;
      background: linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%);
      border: 1px solid rgba(129, 140, 248, 0.35);
      border-radius: 18px;
      padding: 26px 24px 22px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      animation: modalPop 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .update-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(99, 102, 241, 0.18);
      border: 1px solid rgba(129, 140, 248, 0.4);
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #a5b4fc;
      margin-bottom: 14px;
    }

    .update-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: #f8fafc;
      margin: 0 0 8px;
      line-height: 1.3;
    }

    .update-subtitle {
      font-size: 0.86rem;
      color: #94a3b8;
      margin: 0 0 18px;
      line-height: 1.5;
    }

    .version-diff-card {
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 22px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .diff-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.82rem;

      .label {
        color: #94a3b8;
      }

      .val {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.8rem;

        &.old {
          background: rgba(255, 255, 255, 0.06);
          color: #cbd5e1;
        }

        &.new {
          background: rgba(34, 197, 94, 0.15);
          color: #4ade80;
          font-weight: 600;
          border: 1px solid rgba(34, 197, 94, 0.3);
        }
      }
    }

    .notes-box {
      margin-top: 6px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);

      .notes-title {
        font-size: 0.72rem;
        text-transform: uppercase;
        font-weight: 600;
        color: #818cf8;
        margin-bottom: 4px;
      }

      .notes-content {
        font-size: 0.82rem;
        color: #e2e8f0;
        line-height: 1.4;
      }
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
    }

    .btn-update {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #ffffff;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
      transition: all 0.2s;

      &:hover {
        background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(79, 70, 229, 0.5);
      }
    }

    /* Floating Persistent Pill */
    .floating-update-pill {
      position: fixed;
      bottom: 24px;
      left: 24px;
      z-index: 9998;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: rgba(30, 27, 75, 0.95);
      border: 1px solid #818cf8;
      border-radius: 9999px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      cursor: pointer;
      animation: floatSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
      transition: transform 0.2s;

      &:hover {
        transform: translateY(-2px);
      }
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
      animation: pulse 1.6s infinite;
    }

    .pill-text {
      font-size: 0.82rem;
      font-weight: 600;
      color: #e0e7ff;
    }

    .btn-pill-action {
      background: #6366f1;
      border: none;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 9999px;
      cursor: pointer;
      transition: background 0.15s;

      &:hover {
        background: #4f46e5;
      }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes modalPop {
      from { opacity: 0; transform: scale(0.92) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    @keyframes floatSlide {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
      70% { box-shadow: 0 0 0 7px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }
  `,
})
export class UpdateDialog {
  readonly versionService = inject(VersionCheckService);
}
