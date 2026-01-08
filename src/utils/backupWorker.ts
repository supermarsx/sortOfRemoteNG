/**
 * Backup Worker - Runs backup operations on a dedicated Web Worker thread
 * 
 * This service manages backup operations off the main thread to prevent UI blocking
 * during large backup operations. It handles:
 * - Creating backup archives (JSON/XML/encrypted)
 * - Compressing backups
 * - Cleaning up old backups based on retention policy
 * - Scheduling automatic backups
 */

import { invoke } from '@tauri-apps/api/core';
import { BackupConfig, GlobalSettings, BackupFormat, BackupEncryptionAlgorithm } from '../types/settings';
import { appDataDir, documentDir, homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, remove, writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';

export interface BackupJob {
  id: string;
  type: 'full' | 'differential';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  startTime?: number;
  endTime?: number;
  error?: string;
  filePath?: string;
}

export interface BackupWorkerState {
  isRunning: boolean;
  lastBackupTime?: number;
  lastFullBackupTime?: number;
  nextScheduledBackup?: number;
  currentJob?: BackupJob;
  recentJobs: BackupJob[];
}

type BackupWorkerCallback = (state: BackupWorkerState) => void;

class BackupWorkerService {
  private state: BackupWorkerState = {
    isRunning: false,
    recentJobs: [],
  };
  
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private config: BackupConfig | null = null;
  private listeners: Set<BackupWorkerCallback> = new Set();
  
  /**
   * Initialize the backup worker with configuration
   */
  async initialize(config: BackupConfig): Promise<void> {
    this.config = config;
    
    // Start scheduler if automatic backups are enabled
    if (config.enabled && config.frequency !== 'manual') {
      this.startScheduler();
    }
    
    this.notifyListeners();
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: BackupConfig): void {
    const wasEnabled = this.config?.enabled && this.config?.frequency !== 'manual';
    const isEnabled = config.enabled && config.frequency !== 'manual';
    
    this.config = config;
    
    // Restart scheduler if needed
    if (wasEnabled && !isEnabled) {
      this.stopScheduler();
    } else if (!wasEnabled && isEnabled) {
      this.startScheduler();
    } else if (isEnabled) {
      // Recalculate next backup time
      this.stopScheduler();
      this.startScheduler();
    }
    
    this.notifyListeners();
  }
  
  /**
   * Subscribe to state changes
   */
  subscribe(callback: BackupWorkerCallback): () => void {
    this.listeners.add(callback);
    callback(this.state);
    return () => this.listeners.delete(callback);
  }
  
  private notifyListeners(): void {
    this.listeners.forEach(cb => cb({ ...this.state }));
  }
  
  /**
   * Start the backup scheduler
   */
  private startScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }
    
    this.calculateNextBackupTime();
    
    // Check every minute if a backup should run
    this.schedulerInterval = setInterval(() => {
      this.checkScheduledBackup();
    }, 60000);
    
    // Also check immediately
    this.checkScheduledBackup();
  }
  
  /**
   * Stop the backup scheduler
   */
  private stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.state.nextScheduledBackup = undefined;
    this.notifyListeners();
  }
  
  /**
   * Calculate the next scheduled backup time
   */
  private calculateNextBackupTime(): void {
    if (!this.config || !this.config.enabled || this.config.frequency === 'manual') {
      this.state.nextScheduledBackup = undefined;
      return;
    }
    
    const now = Date.now();
    const [hours, minutes] = this.config.scheduledTime.split(':').map(Number);
    
    let nextBackup = new Date();
    nextBackup.setHours(hours, minutes, 0, 0);
    
    switch (this.config.frequency) {
      case 'hourly':
        // Next hour
        nextBackup = new Date(now + 3600000);
        nextBackup.setMinutes(0, 0, 0);
        break;
        
      case 'daily':
        // Next occurrence of scheduled time
        if (nextBackup.getTime() <= now) {
          nextBackup.setDate(nextBackup.getDate() + 1);
        }
        break;
        
      case 'weekly':
        // Find next occurrence of the scheduled day
        const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
          .indexOf(this.config.weeklyDay);
        const currentDay = nextBackup.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil < 0 || (daysUntil === 0 && nextBackup.getTime() <= now)) {
          daysUntil += 7;
        }
        nextBackup.setDate(nextBackup.getDate() + daysUntil);
        break;
        
      case 'monthly':
        // Next occurrence of the scheduled day of month
        nextBackup.setDate(this.config.monthlyDay);
        if (nextBackup.getTime() <= now) {
          nextBackup.setMonth(nextBackup.getMonth() + 1);
        }
        break;
    }
    
    this.state.nextScheduledBackup = nextBackup.getTime();
  }
  
  /**
   * Check if a scheduled backup should run
   */
  private checkScheduledBackup(): void {
    if (!this.state.nextScheduledBackup || this.state.isRunning) {
      return;
    }
    
    const now = Date.now();
    if (now >= this.state.nextScheduledBackup) {
      // Time to run a backup!
      this.runBackup().catch(console.error);
    }
  }
  
  /**
   * Generate a unique backup filename
   */
  private generateBackupFilename(type: 'full' | 'differential'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = this.config?.format === 'xml' ? 'xml' : 'json';
    const suffix = type === 'differential' ? '-diff' : '';
    const encrypted = this.config?.encryptBackups ? '-encrypted' : '';
    const compressed = this.config?.compressBackups ? '.gz' : '';
    
    return `sortOfRemoteNG-backup-${timestamp}${suffix}${encrypted}.${extension}${compressed}`;
  }
  
  /**
   * Run a backup operation (off-thread via Tauri command)
   */
  async runBackup(forceFull: boolean = false): Promise<BackupJob> {
    if (!this.config) {
      throw new Error('Backup worker not initialized');
    }
    
    if (this.state.isRunning) {
      throw new Error('Backup already in progress');
    }
    
    // Determine if this should be a full or differential backup
    const shouldBeFull = forceFull || 
      !this.config.differentialEnabled ||
      !this.state.lastFullBackupTime ||
      (this.config.differentialEnabled && 
        this.state.recentJobs.filter(j => j.type === 'differential' && j.status === 'completed').length >= this.config.fullBackupInterval);
    
    const job: BackupJob = {
      id: `backup-${Date.now()}`,
      type: shouldBeFull ? 'full' : 'differential',
      status: 'pending',
      progress: 0,
      startTime: Date.now(),
    };
    
    this.state.currentJob = job;
    this.state.isRunning = true;
    this.notifyListeners();
    
    try {
      // Update status to running
      job.status = 'running';
      job.progress = 10;
      this.notifyListeners();
      
      // Ensure destination directory exists
      const destPath = this.config.destinationPath;
      if (destPath && !(await exists(destPath))) {
        await mkdir(destPath, { recursive: true });
      }
      
      job.progress = 20;
      this.notifyListeners();
      
      // Generate filename
      const filename = this.generateBackupFilename(job.type);
      const filePath = await join(destPath, filename);
      
      job.progress = 30;
      this.notifyListeners();
      
      // Run the actual backup via Tauri command (runs in Rust thread)
      await invoke('run_backup', {
        config: {
          destination_path: filePath,
          format: this.config.format,
          include_passwords: this.config.includePasswords,
          include_settings: this.config.includeSettings,
          include_ssh_keys: this.config.includeSSHKeys,
          encrypt: this.config.encryptBackups,
          encryption_algorithm: this.config.encryptionAlgorithm,
          encryption_password: this.config.encryptionPassword,
          compress: this.config.compressBackups,
          is_differential: job.type === 'differential',
          last_backup_time: job.type === 'differential' ? this.state.lastBackupTime : undefined,
        },
      });
      
      job.progress = 80;
      this.notifyListeners();
      
      // Clean up old backups based on retention policy
      if (this.config.maxBackupsToKeep > 0) {
        await this.cleanupOldBackups();
      }
      
      job.progress = 100;
      job.status = 'completed';
      job.endTime = Date.now();
      job.filePath = filePath;
      
      // Update timestamps
      this.state.lastBackupTime = Date.now();
      if (job.type === 'full') {
        this.state.lastFullBackupTime = Date.now();
      }
      
      // Recalculate next backup time
      this.calculateNextBackupTime();
      
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.endTime = Date.now();
    } finally {
      this.state.isRunning = false;
      this.state.currentJob = undefined;
      
      // Add to recent jobs (keep last 10)
      this.state.recentJobs = [job, ...this.state.recentJobs].slice(0, 10);
      
      this.notifyListeners();
    }
    
    return job;
  }
  
  /**
   * Clean up old backups based on retention policy
   */
  private async cleanupOldBackups(): Promise<void> {
    if (!this.config || this.config.maxBackupsToKeep <= 0) {
      return;
    }
    
    try {
      const destPath = this.config.destinationPath;
      if (!destPath || !(await exists(destPath))) {
        return;
      }
      
      // List all backup files
      const entries = await readDir(destPath);
      const backupFiles = entries
        .filter(entry => {
          const name = entry.name || '';
          return name.startsWith('sortOfRemoteNG-backup-') && 
                 (name.endsWith('.json') || name.endsWith('.xml') || name.endsWith('.gz'));
        })
        .map(entry => ({
          name: entry.name || '',
          // Extract timestamp from filename
          timestamp: this.extractTimestampFromFilename(entry.name || ''),
        }))
        .filter(f => f.timestamp > 0)
        .sort((a, b) => b.timestamp - a.timestamp); // Newest first
      
      // Delete files beyond the retention limit
      const filesToDelete = backupFiles.slice(this.config.maxBackupsToKeep);
      
      for (const file of filesToDelete) {
        try {
          const filePath = await join(destPath, file.name);
          await remove(filePath);
          console.log(`Deleted old backup: ${file.name}`);
        } catch (err) {
          console.error(`Failed to delete backup ${file.name}:`, err);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
    }
  }
  
  /**
   * Extract timestamp from backup filename
   */
  private extractTimestampFromFilename(filename: string): number {
    // Format: sortOfRemoteNG-backup-2024-01-08T12-30-00-000Z[-diff][-encrypted].json[.gz]
    const match = filename.match(/sortOfRemoteNG-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
    if (match) {
      const isoString = match[1].replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
      return new Date(isoString).getTime();
    }
    return 0;
  }
  
  /**
   * Get current state
   */
  getState(): BackupWorkerState {
    return { ...this.state };
  }
  
  /**
   * Trigger a backup on app close
   */
  async backupOnClose(): Promise<void> {
    if (this.config?.backupOnClose && this.config?.enabled) {
      await this.runBackup();
    }
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    this.stopScheduler();
    this.listeners.clear();
  }
}

// Export singleton instance
export const backupWorker = new BackupWorkerService();
