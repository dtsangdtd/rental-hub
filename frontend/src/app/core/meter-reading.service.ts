import { Injectable } from '@angular/core';

export interface UnitMeterReading {
  unitId: string;
  roomName: string;
  period: string; // e.g. "2026-10"
  month: number;
  year: number;
  electricityStart: number;
  electricityEnd: number;
  waterStart: number;
  waterEnd: number;
  savedAt: string;
}

const STORAGE_KEY = 'rental_unit_meter_readings';

@Injectable({ providedIn: 'root' })
export class MeterReadingService {
  /** Get all stored meter readings */
  getAll(): UnitMeterReading[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /** Get history for a specific unit (or room name) sorted latest first */
  getHistoryForUnit(unitIdOrName: string): UnitMeterReading[] {
    if (!unitIdOrName) return [];
    return this.getAll()
      .filter((r) => r.unitId === unitIdOrName || r.roomName === unitIdOrName)
      .sort((a, b) => b.period.localeCompare(a.period));
  }

  /**
   * Get the latest saved reading for a unit before or up to the given period.
   * This is used to automatically populate the 'Chỉ số đầu' for the new month.
   */
  getLatestReading(unitIdOrName: string, currentPeriod?: string): UnitMeterReading | null {
    const list = this.getHistoryForUnit(unitIdOrName);
    if (list.length === 0) return null;

    if (currentPeriod) {
      // Find the most recent reading strictly before currentPeriod
      const prev = list.find((r) => r.period < currentPeriod);
      if (prev) return prev;
      // Or find reading of currentPeriod
      const current = list.find((r) => r.period === currentPeriod);
      if (current) return current;
    }

    return list[0] ?? null;
  }

  /** Save a reading for a unit & period. Overwrites if same unit & period exists. */
  saveReading(record: UnitMeterReading): void {
    const list = this.getAll().filter(
      (r) => !( (r.unitId === record.unitId || r.roomName === record.roomName) && r.period === record.period )
    );
    list.unshift(record);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('Failed to save meter reading to localStorage', e);
    }
  }
}
