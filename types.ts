export interface BeforeDownloadRequest {
  metadata: DownloadMetadata | undefined;
  headers: { [key: string]: Header };
  userContext: UserContext | undefined;
  repoPath: RepoPath | undefined;
}

export interface DownloadMetadata {
  repoPath: RepoPath | undefined;
  originalRepoPath: RepoPath | undefined;
  name: string;
  headOnly: boolean;
  checksum: boolean;
  recursive: boolean;
  modificationTime: number;
  directoryRequest: boolean;
  metadata: boolean;
  lastModified: number;
  ifModifiedSince: number;
  servletContextUrl: string;
  uri: string;
  clientAddress: string;
  zipResourcePath: string;
  zipResourceRequest: boolean;
  replaceHeadRequestWithGet: boolean;
  repoType: RepoType;
}

export interface RepoPath {
  key: string;
  path: string;
  id: string;
  isRoot: boolean;
  isFolder: boolean;
}

export interface Header {
  value: string[];
}

export interface UserContext {
  id: string;
  isToken: boolean;
  realm: string;
}

export enum RepoType {
  REPO_TYPE_UNSPECIFIED = 0,
  REPO_TYPE_LOCAL = 1,
  REPO_TYPE_REMOTE = 2,
  REPO_TYPE_FEDERATED = 3,
  UNRECOGNIZED = -1,
}

export interface BeforeDownloadResponse {
  status: DownloadStatus;
  message: string;
  headers?: { [key: string]: string };
}

export enum DownloadStatus {
  DOWNLOAD_UNSPECIFIED = 0,
  DOWNLOAD_PROCEED = 1,
  DOWNLOAD_STOP = 2,
  DOWNLOAD_WARN = 3,
  UNRECOGNIZED = -1,
}
