// ── src/hooks/ops/useCICD.ts ────────────────────────────────────────
// Thin React wrapper over the 57 sorng-cicd Tauri commands.

import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  CicdConnectionConfig,
  CicdConnectionSummary,
  CicdPipeline,
  CicdBuild,
  CicdBuildLogs,
  CicdArtifact,
  CicdSecret,
  CicdDashboard,
  DroneRepo,
  DroneCronJob,
  JenkinsJob,
  JenkinsNode,
  JenkinsPlugin,
  JenkinsSystemInfo,
  GhaWorkflow,
  GhaWorkflowRun,
  GhaJob,
  GhaRunner,
} from '../../types/cicd';

export function useCICD() {
  return useMemo(
    () => ({
      // Connection lifecycle
      connect: (id: string, config: CicdConnectionConfig): Promise<CicdConnectionSummary> =>
        invoke('cicd_connect', { id, config }),
      disconnect: (id: string): Promise<void> => invoke('cicd_disconnect', { id }),
      listConnections: (): Promise<string[]> => invoke('cicd_list_connections'),
      ping: (id: string): Promise<boolean> => invoke('cicd_ping', { id }),
      getDashboard: (id: string): Promise<CicdDashboard> => invoke('cicd_get_dashboard', { id }),

      // Provider-agnostic pipelines
      listPipelines: (id: string): Promise<CicdPipeline[]> => invoke('cicd_list_pipelines', { id }),
      getPipeline: (id: string, pipelineId: string): Promise<CicdPipeline> =>
        invoke('cicd_get_pipeline', { id, pipelineId }),

      // Provider-agnostic builds
      listBuilds: (id: string, pipelineId: string, limit?: number): Promise<CicdBuild[]> =>
        invoke('cicd_list_builds', { id, pipelineId, limit }),
      getBuild: (id: string, buildId: string): Promise<CicdBuild> =>
        invoke('cicd_get_build', { id, buildId }),
      triggerBuild: (
        id: string,
        pipelineId: string,
        params?: Record<string, unknown>,
      ): Promise<CicdBuild> => invoke('cicd_trigger_build', { id, pipelineId, params }),
      cancelBuild: (id: string, buildId: string): Promise<void> =>
        invoke('cicd_cancel_build', { id, buildId }),
      restartBuild: (id: string, buildId: string): Promise<CicdBuild> =>
        invoke('cicd_restart_build', { id, buildId }),
      getBuildLogs: (id: string, buildId: string): Promise<CicdBuildLogs> =>
        invoke('cicd_get_build_logs', { id, buildId }),

      // Artifacts
      listArtifacts: (id: string, buildId: string): Promise<CicdArtifact[]> =>
        invoke('cicd_list_artifacts', { id, buildId }),
      getArtifact: (id: string, artifactId: string): Promise<CicdArtifact> =>
        invoke('cicd_get_artifact', { id, artifactId }),

      // Secrets
      listSecrets: (id: string, scope?: string): Promise<CicdSecret[]> =>
        invoke('cicd_list_secrets', { id, scope }),
      createSecret: (id: string, name: string, value: string, scope?: string): Promise<void> =>
        invoke('cicd_create_secret', { id, name, value, scope }),
      deleteSecret: (id: string, name: string, scope?: string): Promise<void> =>
        invoke('cicd_delete_secret', { id, name, scope }),

      // Drone
      droneListRepos: (id: string): Promise<DroneRepo[]> =>
        invoke('cicd_drone_list_repos', { id }),
      droneGetRepo: (id: string, owner: string, name: string): Promise<DroneRepo> =>
        invoke('cicd_drone_get_repo', { id, owner, name }),
      droneActivateRepo: (id: string, owner: string, name: string): Promise<DroneRepo> =>
        invoke('cicd_drone_activate_repo', { id, owner, name }),
      droneDeactivateRepo: (id: string, owner: string, name: string): Promise<DroneRepo> =>
        invoke('cicd_drone_deactivate_repo', { id, owner, name }),
      droneListCronJobs: (id: string, owner: string, name: string): Promise<DroneCronJob[]> =>
        invoke('cicd_drone_list_cron_jobs', { id, owner, name }),
      droneCreateCronJob: (
        id: string,
        owner: string,
        name: string,
        job: DroneCronJob,
      ): Promise<DroneCronJob> => invoke('cicd_drone_create_cron_job', { id, owner, name, job }),
      droneDeleteCronJob: (
        id: string,
        owner: string,
        name: string,
        jobName: string,
      ): Promise<void> =>
        invoke('cicd_drone_delete_cron_job', { id, owner, name, jobName }),

      // Jenkins
      jenkinsListJobs: (id: string): Promise<JenkinsJob[]> =>
        invoke('cicd_jenkins_list_jobs', { id }),
      jenkinsGetJob: (id: string, jobName: string): Promise<JenkinsJob> =>
        invoke('cicd_jenkins_get_job', { id, jobName }),
      jenkinsCreateJob: (id: string, jobName: string, configXml: string): Promise<void> =>
        invoke('cicd_jenkins_create_job', { id, jobName, configXml }),
      jenkinsDeleteJob: (id: string, jobName: string): Promise<void> =>
        invoke('cicd_jenkins_delete_job', { id, jobName }),
      jenkinsGetConsoleOutput: (id: string, jobName: string, buildNumber: number): Promise<string> =>
        invoke('cicd_jenkins_get_console_output', { id, jobName, buildNumber }),
      jenkinsListQueue: (id: string): Promise<unknown[]> =>
        invoke('cicd_jenkins_list_queue', { id }),
      jenkinsCancelQueue: (id: string, queueItemId: number): Promise<void> =>
        invoke('cicd_jenkins_cancel_queue', { id, queueItemId }),
      jenkinsListNodes: (id: string): Promise<JenkinsNode[]> =>
        invoke('cicd_jenkins_list_nodes', { id }),
      jenkinsGetNode: (id: string, nodeName: string): Promise<JenkinsNode> =>
        invoke('cicd_jenkins_get_node', { id, nodeName }),
      jenkinsGetSystemInfo: (id: string): Promise<JenkinsSystemInfo> =>
        invoke('cicd_jenkins_get_system_info', { id }),
      jenkinsListPlugins: (id: string): Promise<JenkinsPlugin[]> =>
        invoke('cicd_jenkins_list_plugins', { id }),

      // GitHub Actions
      ghaListWorkflows: (id: string, owner: string, repo: string): Promise<GhaWorkflow[]> =>
        invoke('cicd_gha_list_workflows', { id, owner, repo }),
      ghaGetWorkflow: (
        id: string,
        owner: string,
        repo: string,
        workflowId: number,
      ): Promise<GhaWorkflow> => invoke('cicd_gha_get_workflow', { id, owner, repo, workflowId }),
      ghaDispatchWorkflow: (
        id: string,
        owner: string,
        repo: string,
        workflowId: number,
        ref: string,
        inputs?: Record<string, string>,
      ): Promise<void> =>
        invoke('cicd_gha_dispatch_workflow', { id, owner, repo, workflowId, ref, inputs }),
      ghaEnableWorkflow: (
        id: string,
        owner: string,
        repo: string,
        workflowId: number,
      ): Promise<void> => invoke('cicd_gha_enable_workflow', { id, owner, repo, workflowId }),
      ghaDisableWorkflow: (
        id: string,
        owner: string,
        repo: string,
        workflowId: number,
      ): Promise<void> => invoke('cicd_gha_disable_workflow', { id, owner, repo, workflowId }),
      ghaListWorkflowRuns: (
        id: string,
        owner: string,
        repo: string,
        workflowId?: number,
      ): Promise<GhaWorkflowRun[]> =>
        invoke('cicd_gha_list_workflow_runs', { id, owner, repo, workflowId }),
      ghaGetWorkflowRun: (
        id: string,
        owner: string,
        repo: string,
        runId: number,
      ): Promise<GhaWorkflowRun> => invoke('cicd_gha_get_workflow_run', { id, owner, repo, runId }),
      ghaCancelRun: (id: string, owner: string, repo: string, runId: number): Promise<void> =>
        invoke('cicd_gha_cancel_run', { id, owner, repo, runId }),
      ghaRerunRun: (id: string, owner: string, repo: string, runId: number): Promise<void> =>
        invoke('cicd_gha_rerun_run', { id, owner, repo, runId }),
      ghaRerunFailedJobs: (
        id: string,
        owner: string,
        repo: string,
        runId: number,
      ): Promise<void> => invoke('cicd_gha_rerun_failed_jobs', { id, owner, repo, runId }),
      ghaListJobs: (
        id: string,
        owner: string,
        repo: string,
        runId: number,
      ): Promise<GhaJob[]> => invoke('cicd_gha_list_jobs', { id, owner, repo, runId }),
      ghaGetJob: (id: string, owner: string, repo: string, jobId: number): Promise<GhaJob> =>
        invoke('cicd_gha_get_job', { id, owner, repo, jobId }),
      ghaGetJobLogs: (
        id: string,
        owner: string,
        repo: string,
        jobId: number,
      ): Promise<string> => invoke('cicd_gha_get_job_logs', { id, owner, repo, jobId }),
      ghaListArtifacts: (
        id: string,
        owner: string,
        repo: string,
        runId?: number,
      ): Promise<CicdArtifact[]> =>
        invoke('cicd_gha_list_artifacts', { id, owner, repo, runId }),
      ghaDeleteArtifact: (
        id: string,
        owner: string,
        repo: string,
        artifactId: number,
      ): Promise<void> => invoke('cicd_gha_delete_artifact', { id, owner, repo, artifactId }),
      ghaListSecrets: (id: string, owner: string, repo: string): Promise<CicdSecret[]> =>
        invoke('cicd_gha_list_secrets', { id, owner, repo }),
      ghaCreateOrUpdateSecret: (
        id: string,
        owner: string,
        repo: string,
        name: string,
        value: string,
      ): Promise<void> =>
        invoke('cicd_gha_create_or_update_secret', { id, owner, repo, name, value }),
      ghaDeleteSecret: (
        id: string,
        owner: string,
        repo: string,
        name: string,
      ): Promise<void> => invoke('cicd_gha_delete_secret', { id, owner, repo, name }),
      ghaListRunners: (id: string, owner: string, repo: string): Promise<GhaRunner[]> =>
        invoke('cicd_gha_list_runners', { id, owner, repo }),
      ghaGetRunner: (
        id: string,
        owner: string,
        repo: string,
        runnerId: number,
      ): Promise<GhaRunner> => invoke('cicd_gha_get_runner', { id, owner, repo, runnerId }),
      ghaDeleteRunner: (
        id: string,
        owner: string,
        repo: string,
        runnerId: number,
      ): Promise<void> => invoke('cicd_gha_delete_runner', { id, owner, repo, runnerId }),
    }),
    [],
  );
}
