import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../core/i18n.service';

/**
 * Pipe for translating i18n keys: `{{ 'common.save' | t }}`
 * or with parameters: `{{ 'topbar.updateAvailable' | t:{ version: '1.2.0' } }}`
 * pure: false ensures instant re-evaluation whenever the language signal changes.
 */
@Pipe({
  name: 't',
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string, params?: Record<string, string | number>): string {
    if (!key) return '';
    return this.i18n.t(key, params);
  }
}
