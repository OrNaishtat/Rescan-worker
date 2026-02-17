# Rescan Worker

A **JFrog Artifactory Worker** that integrates with Xray to ensure artifacts are scanned before download. Designed for environments using Xray retention policies (e.g. 30 days) with "block unscanned" enabled.

## The Problem

When Xray drops artifacts from its index due to retention, those artifacts become "unscanned" from Xray's perspective. If you have a "block unscanned" policy, users get blocked when trying to download—even though the artifact exists in Artifactory. Manually reindexing entire repositories is slow and disruptive.

## The Solution

This `BEFORE_DOWNLOAD` worker:

1. **Checks** whether the requested artifact is scanned via the Xray REST API
2. **Triggers** a Force Reindex for that specific artifact only (not the whole repo)
3. **Blocks** the download and asks the user to retry shortly—once reindex completes, the download succeeds

Artifact-level reindex is fast and targeted. Users get a clear message instead of a generic block.

## How It Works

```
User requests artifact → Worker checks Xray scan status
                              │
                              ├─ Scanned (DONE/PARTIAL) → Allow download
                              │
                              └─ Not scanned → Trigger Force Reindex for this artifact
                                             → Block download
                                             → User retries after reindex completes
```

**Xray indexing bypass:** Requests from Xray itself (user id/realm containing "xray", or localhost) are always allowed so Xray can index artifacts without being blocked.

## Requirements

- JFrog Artifactory with Workers enabled
- JFrog Xray connected to Artifactory
- Xray REST API accessible from the worker runtime

## Configuration

Edit `manifest.json` to match your repositories:

```json
{
  "filterCriteria": {
    "artifactFilterCriteria": {
      "repoKeys": ["generic-local", "example-repo-local"]
    }
  }
}
```

Replace `generic-local` and `example-repo-local` with the repo keys you want this worker to protect.
