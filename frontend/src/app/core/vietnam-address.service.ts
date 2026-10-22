import { Injectable, signal } from '@angular/core';

export interface VietmapProvince {
  code: string;
  name: string;
  slug: string;
  type: string;
  name_with_type: string;
}

export interface VietmapWard {
  code: string;
  name: string;
  type: string;
  slug: string;
  name_with_type: string;
  path: string;
  path_with_type: string;
  parent_code: string;
}

@Injectable({
  providedIn: 'root',
})
export class VietnamAddressService {
  private provincesMap = new Map<string, VietmapProvince>();
  private wardsList: VietmapWard[] = [];
  private wardsByProvince = new Map<string, VietmapWard[]>();

  readonly isLoaded = signal(false);
  readonly provinces = signal<VietmapProvince[]>([]);

  constructor() {
    void this.init();
  }

  async init(): Promise<void> {
    try {
      const [pRes, wRes] = await Promise.all([
        fetch('/data/vietnam-address/province.json'),
        fetch('/data/vietnam-address/ward.json'),
      ]);

      if (pRes.ok && wRes.ok) {
        const pData: Record<string, VietmapProvince> = await pRes.json();
        const wData: Record<string, VietmapWard> = await wRes.json();

        const pList = Object.values(pData).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        this.provinces.set(pList);
        for (const p of pList) {
          this.provincesMap.set(p.code, p);
          this.provincesMap.set(p.name, p);
          this.provincesMap.set(p.name_with_type, p);
        }

        this.wardsList = Object.values(wData);
        this.wardsByProvince.clear();
        for (const w of this.wardsList) {
          const arr = this.wardsByProvince.get(w.parent_code) || [];
          arr.push(w);
          this.wardsByProvince.set(w.parent_code, arr);
        }

        // Sort wards within each province
        for (const [, list] of this.wardsByProvince.entries()) {
          list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        }

        this.isLoaded.set(true);
      }
    } catch (err) {
      console.warn('Could not load VietMap address data from public folder, using fallback', err);
    }
  }

  /**
   * Get list of wards for a given province (by name or by code).
   * If province is empty, returns common or empty list.
   */
  getWards(provinceNameOrCode?: string): VietmapWard[] {
    if (!provinceNameOrCode) {
      return this.wardsList;
    }

    const prov = this.provincesMap.get(provinceNameOrCode);
    if (!prov) {
      // Try search by partial name
      for (const p of this.provinces()) {
        if (p.name.includes(provinceNameOrCode) || provinceNameOrCode.includes(p.name)) {
          return this.wardsByProvince.get(p.code) || [];
        }
      }
      return [];
    }

    return this.wardsByProvince.get(prov.code) || [];
  }

  /**
   * Find province of a specific ward
   */
  findProvinceByWard(wardNameWithType: string): VietmapProvince | undefined {
    const found = this.wardsList.find(
      (w) => w.name_with_type === wardNameWithType || w.name === wardNameWithType
    );
    if (found) {
      return this.provincesMap.get(found.parent_code);
    }
    return undefined;
  }
}
