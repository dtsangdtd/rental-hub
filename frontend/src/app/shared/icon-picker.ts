import { ChangeDetectionStrategy, Component, computed, forwardRef, input, model, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AVAILABLE_ICONS, Icon } from './icon';

interface IconCategoryGroup {
  id: string;
  label: string;
  icons: string[];
}

const COMMON_EMOJIS = [
  '🍜', '🧃', '🥪', '🍞', '🧼', '🧻', '🥤', '🍎',
  '🍕', '🍪', '🍫', '🧴', '📦', '🛒', '🏷️', '⭐',
  '💡', '🔧', '☕', '🧹', '🧺', '🍳', '🥛', '🧊'
];

const PRESET_GROUPS: IconCategoryGroup[] = [
  {
    id: 'commerce',
    label: 'Bán hàng & Kho',
    icons: ['package', 'box', 'tag', 'bag', 'cart', 'barcode', 'scan', 'truck', 'gift', 'receipt', 'wallet', 'money']
  },
  {
    id: 'property',
    label: 'Nhà trọ & Dịch vụ',
    icons: ['building', 'home', 'key', 'users', 'sparkle', 'zap', 'wifi', 'wrench', 'tv', 'droplet', 'phone', 'mapPin', 'calendar']
  },
  {
    id: 'fnb',
    label: 'Ẩm thực & Tiêu dùng',
    icons: ['coffee', 'utensils', 'cup', 'heart', 'star']
  },
  {
    id: 'emojis',
    label: 'Emoji phổ biến',
    icons: COMMON_EMOJIS
  }
];

@Component({
  selector: 'app-icon-picker',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IconPicker),
      multi: true
    }
  ],
  template: `
    <div class="icon-picker-container">
      <!-- Trigger button showing currently selected icon -->
      <button
        type="button"
        class="picker-trigger-btn"
        [class.compact]="compact()"
        (click)="toggleOpen()"
        [attr.aria-expanded]="isOpen()">
        <span class="preview-badge">
          <app-icon [name]="value()" [size]="compact() ? 16 : 18" />
        </span>
        @if (!compact()) {
          <span class="preview-name">{{ value() || 'Chọn biểu tượng...' }}</span>
          <span class="chevron">▼</span>
        }
      </button>

      <!-- Dropdown / Popover -->
      @if (isOpen()) {
        <div class="picker-backdrop" (click)="isOpen.set(false)"></div>
        <div class="picker-dropdown card">
          <div class="picker-header">
            <span class="picker-title font-bold small">Chọn biểu tượng danh mục</span>
            <button type="button" class="btn-close-sm" (click)="isOpen.set(false)">✕</button>
          </div>

          <!-- Dynamic Search Bar -->
          <div class="search-box">
            <app-icon name="search" [size]="14" class="search-icon" />
            <input
              type="text"
              class="search-input"
              placeholder="Tìm kiếm icon (vd: cart, box, coffee...)"
              [ngModel]="searchQuery()"
              (ngModelChange)="searchQuery.set($event)"
              autofocus />
            @if (searchQuery()) {
              <button type="button" class="btn-clear-search" (click)="searchQuery.set('')">✕</button>
            }
          </div>

          <!-- Filter category chips -->
          <div class="filter-chips">
            <button
              type="button"
              class="chip-btn"
              [class.active]="selectedGroup() === 'all'"
              (click)="selectedGroup.set('all')">
              Tất cả ({{ allIcons.length }})
            </button>
            @for (g of groups; track g.id) {
              <button
                type="button"
                class="chip-btn"
                [class.active]="selectedGroup() === g.id"
                (click)="selectedGroup.set(g.id)">
                {{ g.label }}
              </button>
            }
          </div>

          <!-- Dynamic Custom Input (Emoji or custom string) -->
          <div class="custom-icon-row">
            <input
              type="text"
              class="custom-input"
              placeholder="Hoặc gõ/dán emoji bất kỳ: 🍜, 🧃, 🧼..."
              [ngModel]="customInput()"
              (ngModelChange)="customInput.set($event)"
              (keydown.enter)="applyCustom()" />
            <button
              type="button"
              class="btn btn-xs btn-primary"
              [disabled]="!customInput().trim()"
              (click)="applyCustom()">
              Áp dụng
            </button>
          </div>

          <!-- Icon Grid -->
          <div class="icons-grid">
            @for (ic of displayedIcons(); track ic) {
              <button
                type="button"
                class="icon-tile"
                [class.selected]="value() === ic"
                [title]="ic"
                (click)="selectIcon(ic)">
                <app-icon [name]="ic" [size]="20" />
                <span class="icon-label">{{ ic }}</span>
              </button>
            }
            @if (displayedIcons().length === 0) {
              <div class="no-icons small muted">
                Không tìm thấy biểu tượng phù hợp với "{{ searchQuery() }}".
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .icon-picker-container {
      position: relative;
      display: inline-block;
      width: 100%;
    }

    .picker-trigger-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 12px;
      background: var(--surface-2, #1b203c);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
      border-radius: var(--radius, 10px);
      color: var(--text, #f1f5f9);
      cursor: pointer;
      font-size: 13.5px;
      font-family: inherit;
      transition: all 0.2s ease;

      &:hover {
        border-color: var(--primary, #6366f1);
        background: rgba(99, 102, 241, 0.08);
      }

      &.compact {
        padding: 5px 8px;
        gap: 6px;
        width: auto;
      }
    }

    .preview-badge {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(99, 102, 241, 0.18);
      color: var(--primary, #818cf8);
      flex-shrink: 0;
    }

    .preview-name {
      flex: 1;
      text-align: left;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .chevron {
      font-size: 9px;
      color: var(--text-muted, #94a3b8);
      margin-left: auto;
    }

    .picker-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1050;
      background: transparent;
    }

    .picker-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 1060;
      width: 320px;
      max-width: 90vw;
      background: #15182e;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.25);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      animation: pop 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .picker-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 6px;
    }

    .picker-title {
      color: var(--text, #e2e8f0);
    }

    .btn-close-sm {
      background: transparent;
      border: none;
      color: var(--text-muted, #94a3b8);
      cursor: pointer;
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 4px;
      &:hover { color: #fff; background: rgba(255,255,255,0.1); }
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      color: var(--text-muted, #94a3b8);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 6px 28px 6px 32px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 12.5px;
      outline: none;

      &:focus {
        border-color: var(--primary, #6366f1);
      }
    }

    .btn-clear-search {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 11px;
    }

    .filter-chips {
      display: flex;
      gap: 5px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: thin;
    }

    .chip-btn {
      white-space: nowrap;
      padding: 3px 8px;
      font-size: 11px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted, #cbd5e1);
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }

      &.active {
        background: var(--primary, #6366f1);
        border-color: var(--primary, #6366f1);
        color: #fff;
        font-weight: 600;
      }
    }

    .custom-icon-row {
      display: flex;
      gap: 6px;
      align-items: center;
      background: rgba(99, 102, 241, 0.06);
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px dashed rgba(99, 102, 241, 0.3);
    }

    .custom-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 12px;
      outline: none;

      &::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }
    }

    .icons-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      max-height: 200px;
      overflow-y: auto;
      padding: 2px;
      scrollbar-width: thin;
    }

    .icon-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 4px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text, #cbd5e1);
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: rgba(99, 102, 241, 0.2);
        border-color: rgba(99, 102, 241, 0.4);
        color: #fff;
        transform: translateY(-1px);
      }

      &.selected {
        background: rgba(99, 102, 241, 0.3);
        border-color: var(--primary, #6366f1);
        color: #fff;
        box-shadow: 0 0 0 1px var(--primary, #6366f1);
      }
    }

    .icon-label {
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 58px;
      opacity: 0.8;
    }

    .no-icons {
      grid-column: span 4;
      text-align: center;
      padding: 18px 0;
    }
  `
})
export class IconPicker implements ControlValueAccessor {
  readonly compact = input(false);
  readonly value = model<string>('package');

  protected readonly isOpen = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly selectedGroup = signal<string>('all');
  protected readonly customInput = signal('');

  protected readonly allIcons = AVAILABLE_ICONS;
  protected readonly groups = PRESET_GROUPS;

  private onChange: (val: string) => void = () => {};
  private onTouched: () => void = () => {};

  protected readonly displayedIcons = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const grp = this.selectedGroup();

    let list: string[] = [];
    if (grp === 'all') {
      list = [...this.allIcons, ...COMMON_EMOJIS];
    } else {
      const match = PRESET_GROUPS.find(g => g.id === grp);
      list = match ? match.icons : this.allIcons;
    }

    if (!q) return list;
    return list.filter(name => name.toLowerCase().includes(q));
  });

  writeValue(val: string): void {
    if (val !== undefined && val !== null) {
      this.value.set(val || 'package');
    }
  }

  registerOnChange(fn: (val: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  protected toggleOpen(): void {
    this.isOpen.update(v => !v);
  }

  protected selectIcon(name: string): void {
    this.value.set(name);
    this.onChange(name);
    this.onTouched();
    this.isOpen.set(false);
  }

  protected applyCustom(): void {
    const custom = this.customInput().trim();
    if (custom) {
      this.selectIcon(custom);
      this.customInput.set('');
    }
  }
}
