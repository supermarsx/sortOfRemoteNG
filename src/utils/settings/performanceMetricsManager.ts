import { PerformanceMetrics, GlobalSettings } from '../../types/settings';
import { IndexedDbService } from '../indexedDbService';

export class PerformanceMetricsManager {
  private performanceMetrics: PerformanceMetrics[] = [];

  constructor(private getSettings: () => GlobalSettings) {}

  async load(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<PerformanceMetrics[]>('mremote-performance-metrics');
      if (stored) {
        this.performanceMetrics = stored;
      }
    } catch (error) {
      console.error('Failed to load performance metrics:', error);
    }
  }

  recordPerformanceMetric(metric: PerformanceMetrics): void {
    if (!this.getSettings().enablePerformanceTracking) return;

    this.performanceMetrics.unshift(metric);
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(0, 1000);
    }
    void this.save();
  }

  getPerformanceMetrics(): PerformanceMetrics[] {
    return this.performanceMetrics;
  }

  private async save(): Promise<void> {
    try {
      await IndexedDbService.setItem('mremote-performance-metrics', this.performanceMetrics);
    } catch (error) {
      console.error('Failed to save performance metrics:', error);
    }
  }
}

