import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from './icon';
import { TranslatePipe } from './translate.pipe';

@Component({
  selector: 'app-pagination',
  imports: [Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() > 0) {
      <div class="pagination-bar">
        <div class="pagination-info muted small">
          {{ 'pagination.showing' | t: { from: fromIndex(), to: toIndex(), total: total() } }}
        </div>

        <div class="pagination-controls row">
          <!-- Page size selector -->
          <div class="row page-size-row">
            <span class="muted small">{{ 'pagination.perPage' | t }}:</span>
            <select class="input page-size-select" [value]="pageSize()" (change)="onPageSizeChange($event)">
              @for (size of pageSizeOptions(); track size) {
                <option [value]="size">{{ size }}</option>
              }
            </select>
          </div>

          <!-- Page buttons -->
          <div class="pagination-buttons row">
            <button
              class="btn btn-ghost btn-sm btn-icon"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
              [title]="'pagination.prev' | t"
            >
              <app-icon name="back" [size]="14" />
            </button>

            @for (p of visiblePages(); track $index) {
              @if (p === -1) {
                <span class="pagination-ellipsis">…</span>
              } @else {
                <button
                  class="btn btn-sm btn-page"
                  [class.btn-primary]="p === page()"
                  [class.btn-ghost]="p !== page()"
                  (click)="goToPage(p)"
                >
                  {{ p }}
                </button>
              }
            }

            <button
              class="btn btn-ghost btn-sm btn-icon"
              [disabled]="page() >= totalPages()"
              (click)="goToPage(page() + 1)"
              [title]="'pagination.next' | t"
            >
              <app-icon name="arrow" [size]="14" />
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .page-size-row {
      gap: 8px;
      align-items: center;
    }
    .page-size-select {
      height: 30px !important;
      padding: 0 24px 0 10px !important;
      font-size: 12px !important;
      width: auto !important;
      border-radius: var(--radius-sm) !important;
      cursor: pointer;
    }
    .pagination-controls {
      gap: 16px;
      align-items: center;
    }
    .pagination-buttons {
      gap: 4px;
      align-items: center;
    }
    .btn-page {
      min-width: 32px;
      height: 30px;
      padding: 0 8px;
      font-size: 12.5px;
      font-weight: 600;
    }
    .pagination-ellipsis {
      padding: 0 4px;
      color: var(--text-3);
      user-select: none;
    }
  `,
})
export class Pagination {
  readonly total = input.required<number>();
  readonly page = input<number>(1);
  readonly pageSize = input<number>(10);
  readonly pageSizeOptions = input<number[]>([10, 20, 50]);

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / (this.pageSize() || 10))),
  );

  protected readonly fromIndex = computed(() => {
    if (this.total() === 0) return 0;
    return (this.page() - 1) * this.pageSize() + 1;
  });

  protected readonly toIndex = computed(() => {
    return Math.min(this.total(), this.page() * this.pageSize());
  });

  protected readonly visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.page();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: number[] = [];
    pages.push(1);
    if (current > 3) pages.push(-1);

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (current < total - 2) pages.push(-1);
    pages.push(total);
    return pages;
  });

  protected goToPage(p: number): void {
    if (p >= 1 && p <= this.totalPages() && p !== this.page()) {
      this.pageChange.emit(p);
    }
  }

  protected onPageSizeChange(e: Event): void {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (!isNaN(val) && val > 0) {
      this.pageSizeChange.emit(val);
    }
  }
}
