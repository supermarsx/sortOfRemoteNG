/**
 * React hook wrapping the 52 `cups_*` Tauri commands exposed by the
 * `sorng-cups` backend crate (see t3-e54 wiring).
 *
 * Connection identified by `sessionId`; open it via
 * `connect(sessionId, config)` before other calls.
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  CupsClass,
  CupsConnectionConfig,
  CupsDiscoveredDevice,
  CupsDriver,
  CupsEvent,
  CupsJob,
  CupsPPD,
  CupsPrinter,
  CupsPrinterStatistics,
  CupsServerSettings,
  CupsSubscription,
} from "../../types/cups";

export const cupsApi = {
  // Connection (3)
  connect: (sessionId: string, config: CupsConnectionConfig): Promise<void> =>
    invoke("cups_connect", { sessionId, config }),
  disconnect: (sessionId: string): Promise<void> =>
    invoke("cups_disconnect", { sessionId }),
  listSessions: (): Promise<string[]> => invoke("cups_list_sessions"),

  // Printers (12)
  listPrinters: (sessionId: string): Promise<CupsPrinter[]> =>
    invoke("cups_list_printers", { sessionId }),
  getPrinter: (sessionId: string, name: string): Promise<CupsPrinter> =>
    invoke("cups_get_printer", { sessionId, name }),
  modifyPrinter: (sessionId: string, name: string, args: unknown): Promise<void> =>
    invoke("cups_modify_printer", { sessionId, name, args }),
  deletePrinter: (sessionId: string, name: string): Promise<void> =>
    invoke("cups_delete_printer", { sessionId, name }),
  pausePrinter: (sessionId: string, name: string): Promise<void> =>
    invoke("cups_pause_printer", { sessionId, name }),
  resumePrinter: (sessionId: string, name: string): Promise<void> =>
    invoke("cups_resume_printer", { sessionId, name }),
  setDefaultPrinter: (sessionId: string, name: string): Promise<void> =>
    invoke("cups_set_default_printer", { sessionId, name }),
  getDefaultPrinter: (sessionId: string): Promise<string | null> =>
    invoke("cups_get_default_printer", { sessionId }),
  acceptJobs: (sessionId: string, name: string): Promise<void> =>
    invoke("cups_accept_jobs", { sessionId, name }),
  rejectJobs: (sessionId: string, name: string, reason?: string): Promise<void> =>
    invoke("cups_reject_jobs", { sessionId, name, reason }),
  discoverPrinters: (sessionId: string): Promise<CupsDiscoveredDevice[]> =>
    invoke("cups_discover_printers", { sessionId }),

  // Jobs (9)
  listJobs: (sessionId: string, printer?: string, which?: string): Promise<CupsJob[]> =>
    invoke("cups_list_jobs", { sessionId, printer, which }),
  getJob: (sessionId: string, jobId: number): Promise<CupsJob> =>
    invoke("cups_get_job", { sessionId, jobId }),
  submitJob: (
    sessionId: string,
    printer: string,
    title: string,
    data: number[],
    options?: unknown,
  ): Promise<number> =>
    invoke("cups_submit_job", { sessionId, printer, title, data, options }),
  submitJobUri: (
    sessionId: string,
    printer: string,
    title: string,
    uri: string,
    options?: unknown,
  ): Promise<number> =>
    invoke("cups_submit_job_uri", { sessionId, printer, title, uri, options }),
  cancelJob: (sessionId: string, jobId: number): Promise<void> =>
    invoke("cups_cancel_job", { sessionId, jobId }),
  holdJob: (sessionId: string, jobId: number): Promise<void> =>
    invoke("cups_hold_job", { sessionId, jobId }),
  releaseJob: (sessionId: string, jobId: number): Promise<void> =>
    invoke("cups_release_job", { sessionId, jobId }),
  cancelAllJobs: (sessionId: string, printer?: string): Promise<void> =>
    invoke("cups_cancel_all_jobs", { sessionId, printer }),
  moveJob: (sessionId: string, jobId: number, destPrinter: string): Promise<void> =>
    invoke("cups_move_job", { sessionId, jobId, destPrinter }),

  // Classes (7)
  listClasses: (sessionId: string): Promise<CupsClass[]> =>
    invoke("cups_list_classes", { sessionId }),
  getClass: (sessionId: string, name: string): Promise<CupsClass> =>
    invoke("cups_get_class", { sessionId, name }),
  createClass: (sessionId: string, name: string, members: string[]): Promise<void> =>
    invoke("cups_create_class", { sessionId, name, members }),
  modifyClass: (sessionId: string, name: string, args: unknown): Promise<void> =>
    invoke("cups_modify_class", { sessionId, name, args }),
  deleteClass: (sessionId: string, name: string): Promise<void> =>
    invoke("cups_delete_class", { sessionId, name }),
  addClassMember: (sessionId: string, className: string, printer: string): Promise<void> =>
    invoke("cups_add_class_member", { sessionId, className, printer }),
  removeClassMember: (sessionId: string, className: string, printer: string): Promise<void> =>
    invoke("cups_remove_class_member", { sessionId, className, printer }),

  // PPD (6)
  listPpds: (sessionId: string): Promise<CupsPPD[]> =>
    invoke("cups_list_ppds", { sessionId }),
  searchPpds: (sessionId: string, query: string): Promise<CupsPPD[]> =>
    invoke("cups_search_ppds", { sessionId, query }),
  getPpd: (sessionId: string, printer: string): Promise<string> =>
    invoke("cups_get_ppd", { sessionId, printer }),
  getPpdOptions: (sessionId: string, printer: string): Promise<unknown> =>
    invoke("cups_get_ppd_options", { sessionId, printer }),
  uploadPpd: (sessionId: string, name: string, content: string): Promise<void> =>
    invoke("cups_upload_ppd", { sessionId, name, content }),
  assignPpd: (sessionId: string, printer: string, ppdName: string): Promise<void> =>
    invoke("cups_assign_ppd", { sessionId, printer, ppdName }),

  // Drivers (4)
  listDrivers: (sessionId: string): Promise<CupsDriver[]> =>
    invoke("cups_list_drivers", { sessionId }),
  getDriver: (sessionId: string, name: string): Promise<CupsDriver> =>
    invoke("cups_get_driver", { sessionId, name }),
  recommendDriver: (sessionId: string, make: string, model: string): Promise<CupsDriver[]> =>
    invoke("cups_recommend_driver", { sessionId, make, model }),
  getDriverOptions: (sessionId: string, name: string): Promise<unknown> =>
    invoke("cups_get_driver_options", { sessionId, name }),

  // Admin (6)
  getServerSettings: (sessionId: string): Promise<CupsServerSettings> =>
    invoke("cups_get_server_settings", { sessionId }),
  updateServerSettings: (sessionId: string, settings: unknown): Promise<void> =>
    invoke("cups_update_server_settings", { sessionId, settings }),
  getErrorLog: (sessionId: string, lines?: number): Promise<string> =>
    invoke("cups_get_error_log", { sessionId, lines }),
  testPage: (sessionId: string, printer: string): Promise<number> =>
    invoke("cups_test_page", { sessionId, printer }),
  getSubscriptionsStatus: (sessionId: string): Promise<unknown> =>
    invoke("cups_get_subscriptions_status", { sessionId }),
  cleanupJobs: (sessionId: string): Promise<number> =>
    invoke("cups_cleanup_jobs", { sessionId }),
  restart: (sessionId: string): Promise<void> =>
    invoke("cups_restart", { sessionId }),

  // Subscriptions (4)
  createSubscription: (sessionId: string, target: string, events: string[]): Promise<number> =>
    invoke("cups_create_subscription", { sessionId, target, events }),
  cancelSubscription: (sessionId: string, subscriptionId: number): Promise<void> =>
    invoke("cups_cancel_subscription", { sessionId, subscriptionId }),
  listSubscriptions: (sessionId: string): Promise<CupsSubscription[]> =>
    invoke("cups_list_subscriptions", { sessionId }),
  getEvents: (sessionId: string, subscriptionId: number): Promise<CupsEvent[]> =>
    invoke("cups_get_events", { sessionId, subscriptionId }),
  renewSubscription: (sessionId: string, subscriptionId: number, leaseSecs: number): Promise<void> =>
    invoke("cups_renew_subscription", { sessionId, subscriptionId, leaseSecs }),
};

export function useCups() {
  return useMemo(() => ({ api: cupsApi }), []);
}

export type { CupsPrinter, CupsPrinterStatistics };
