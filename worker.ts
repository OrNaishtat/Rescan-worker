import { PlatformContext } from 'jfrog-workers';
import { BeforeDownloadRequest, BeforeDownloadResponse, DownloadStatus } from './types';

/**
 * Rescan Worker - BEFORE_DOWNLOAD
 *
 * For customers using Xray retention period (e.g. 30 days) with "block unscanned" policy.
 * When an artifact is not scanned (e.g. dropped from Xray due to retention), this worker:
 * 1. Checks scan status via Xray REST API
 * 2. If not scanned, triggers Force Reindex for the specific artifact only (not the whole repo)
 * 3. Blocks download and notifies user to try again shortly
 *
 * Uses Force Reindex with artifacts array - reindexes only the requested artifact.
 * See https://jfrog.com/help/r/xray-rest-apis/force-reindex
 */

const XRAY_ARTIFACT_STATUS_API = '/xray/api/v1/artifact/status';
const XRAY_FORCE_REINDEX_API = '/xray/api/v1/forceReindex';

export default async function (
  context: PlatformContext,
  data: BeforeDownloadRequest
): Promise<BeforeDownloadResponse> {
  const repoKey = data.metadata?.repoPath?.key;
  const artifactPath = data.metadata?.repoPath?.path;

  if (!repoKey || !artifactPath) {
    console.error('[Rescan Worker] Missing repo or path in request metadata');
    return {
      status: DownloadStatus.DOWNLOAD_STOP,
      message: 'Unable to validate artifact. Missing repository or path information.',
      headers: {},
    };
  }

  if (data.metadata?.repoPath?.isFolder || data.metadata?.repoPath?.isRoot) {
    return {
      status: DownloadStatus.DOWNLOAD_PROCEED,
      message: 'Skipping folder/root - scan check only applies to artifacts.',
      headers: {},
    };
  }

  // Allow Xray's indexing requests - Xray must download artifacts to index/scan them.
  if (isXrayIndexingRequest(data)) {
    console.log(
      `[Rescan Worker] Allowing Xray indexing for ${repoKey}/${artifactPath}`
    );
    return {
      status: DownloadStatus.DOWNLOAD_PROCEED,
      message: 'Allowing Xray indexing request.',
      headers: {},
    };
  }

  try {
    const isXrayAvailable = await checkXrayAvailable(context);
    if (!isXrayAvailable) {
      console.warn('[Rescan Worker] Xray is not available - proceeding with download and warning');
      return {
        status: DownloadStatus.DOWNLOAD_WARN,
        message: 'Could not check Xray scan status. Xray may be unavailable. Proceeding with warning.',
        headers: {},
      };
    }

    const scanStatus = await getArtifactScanStatus(context, repoKey, artifactPath);

    const isScanned =
      scanStatus !== null && (scanStatus === 'DONE' || scanStatus === 'PARTIAL');
    if (isScanned) {
      return {
        status: DownloadStatus.DOWNLOAD_PROCEED,
        message: `Artifact is scanned (status: ${scanStatus}). Proceeding with download.`,
        headers: {},
      };
    }

    // Artifact is not scanned - trigger Force Reindex for this artifact only
    const reindexTriggered = await triggerForceReindexArtifact(
      context,
      repoKey,
      artifactPath
    );

    if (reindexTriggered) {
      console.log(`[Rescan Worker] Force reindex triggered for artifact ${repoKey}/${artifactPath}`);
      return {
        status: DownloadStatus.DOWNLOAD_STOP,
        message:
          'Artifact is not scanned. Reindex has been triggered for this artifact. Please try again shortly once the reindex completes.',
        headers: {},
      };
    }

    console.error(`[Rescan Worker] Failed to trigger reindex for ${repoKey}/${artifactPath}`);
    return {
      status: DownloadStatus.DOWNLOAD_STOP,
      message:
        'Artifact is not scanned. Could not trigger reindex. Please run "Reindex existing artifacts" in Xray for this repo, then try again.',
      headers: {},
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Rescan Worker] Unexpected error: ${errMsg}`, error);
    return {
      status: DownloadStatus.DOWNLOAD_STOP,
      message: `Error during scan validation: ${errMsg}. Please try again.`,
      headers: {},
    };
  }
}

function isXrayIndexingRequest(data: BeforeDownloadRequest): boolean {
  const userId = data.userContext?.id?.toLowerCase() ?? '';
  const realm = data.userContext?.realm?.toLowerCase() ?? '';
  const clientAddr = (data.metadata?.clientAddress ?? '').toLowerCase();
  if (userId.includes('xray')) return true;
  if (realm.includes('xray')) return true;
  if (
    clientAddr === '127.0.0.1' ||
    clientAddr === '::1' ||
    clientAddr === 'localhost' ||
    clientAddr.startsWith('127.')
  ) {
    return true;
  }
  return false;
}

async function checkXrayAvailable(context: PlatformContext): Promise<boolean> {
  try {
    const response = await context.clients.platformHttp.get('/xray/api/v1/system/ping');
    return response?.data?.status === 'pong';
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Rescan Worker] Xray ping failed: ${errMsg}`);
    return false;
  }
}

async function getArtifactScanStatus(
  context: PlatformContext,
  repo: string,
  path: string
): Promise<string | null> {
  try {
    const response = await context.clients.platformHttp.post(XRAY_ARTIFACT_STATUS_API, {
      repo,
      path,
    });

    if (response?.data?.overall?.status) {
      return response.data.overall.status;
    }

    console.warn(`[Rescan Worker] Unexpected scan status response:`, JSON.stringify(response?.data));
    return null;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { response?: { status?: number } })?.response?.status;
    console.error(
      `[Rescan Worker] Scan Status API failed for ${repo}/${path}: ${errMsg}`,
      statusCode ? `(HTTP ${statusCode})` : ''
    );
    return null;
  }
}

/**
 * Force Reindex for a specific artifact only (not the whole repo).
 * API: POST /xray/api/v1/forceReindex
 * Body: { artifacts: [{ repository, path }] }
 * See https://jfrog.com/help/r/xray-rest-apis/force-reindex
 */
async function triggerForceReindexArtifact(
  context: PlatformContext,
  repo: string,
  path: string
): Promise<boolean> {
  try {
    const response = await context.clients.platformHttp.post(XRAY_FORCE_REINDEX_API, {
      artifacts: [
        {
          repository: repo,
          path: path,
        },
      ],
    });

    const statusCode =
      response?.status ??
      (response as { statusCode?: number })?.statusCode ??
      (response as { status?: number })?.status;

    if (statusCode != null && statusCode >= 200 && statusCode < 300) {
      return true;
    }
    if (statusCode == null || statusCode >= 200) {
      return true;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { response?: { status?: number } })?.response?.status;
    const responseBody = (error as { response?: { data?: unknown } })?.response?.data;
    console.error(
      `[Rescan Worker] Force reindex artifact failed (${statusCode ?? '?'}): ${errMsg}`,
      responseBody ? JSON.stringify(responseBody) : ''
    );
  }
  return false;
}
