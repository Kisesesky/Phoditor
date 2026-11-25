const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://open-api.mybox.naver.com/v1';

const SUPPORTED_IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff'
]);

const MYBOX_AUTH_ERROR_MSG = 'MYBOX 연결이 안 돼요. 토큰을 다시 확인해줘';
const MYBOX_NETWORK_ERROR_MSG = 'MYBOX 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.';
const MYBOX_SERVER_ERROR_MSG = 'MYBOX 서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';

class MyboxError extends Error {
  constructor(message, { status = 0, serverMessage = '', isAuthError = false } = {}) {
    super(message);
    this.name = 'MyboxError';
    this.status = status;
    this.serverMessage = serverMessage;
    this.isAuthError = isAuthError;
  }
}

function sanitizeBaseUrl(url) {
  return String(url || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * [실토큰 확인 2026-11-25] 목록 응답의 항목 배열 키는 `resources`다.
 * 응답 형태: { resources: [...], fileCount, subFolderCount, responseMetaData: { nextCursor } }
 * 나머지 후보 키는 형식이 바뀔 때를 대비한 예비로만 남긴다.
 */
function extractResourceArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.resources)) return payload.resources;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.list)) return payload.list;
  if (payload.result) {
    if (Array.isArray(payload.result.resources)) return payload.result.resources;
    if (Array.isArray(payload.result.items)) return payload.result.items;
    if (Array.isArray(payload.result.list)) return payload.result.list;
    if (Array.isArray(payload.result)) return payload.result;
  }
  return [];
}

/**
 * [실토큰 확인 2026-11-25] 항목의 `type` 값이 "folder" 또는 "file"이다.
 * 항목 필드: resourceId, parentId, name, type, size, isFavorite, isHidden,
 *           createdAt, modifiedAt, accessedAt, lastModifiedBy
 */
function isFolderItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isFolder === true || item.folder === true) return true;
  const typeVal = String(item.resourceType || item.type || item.kind || '').toLowerCase();
  if (typeVal === 'folder' || typeVal === 'directory' || typeVal === 'dir') return true;
  if (typeVal === 'file') return false;
  // Fallback: confirmed page info fields (subFolderCount / fileCount) or absence of extension/size
  if (typeof item.subFolderCount === 'number' || typeof item.fileCount === 'number') return true;
  return false;
}

/**
 * [실토큰 확인 2026-11-25] 수정 시각 필드는 `modifiedAt`(날짜 문자열)이다.
 * 수정 시각이 없으면 size를 보조 키로 사용한다.
 */
function extractModifiedKey(item) {
  const raw =
    item.modifiedTime ||
    item.modifiedAt ||
    item.updatedAt ||
    item.modifyDate ||
    item.mtime ||
    item.lastModified ||
    '';
  if (raw !== '' && raw !== null && raw !== undefined) return String(raw);
  return `sz${item.size != null ? item.size : 0}`;
}

/**
 * [실토큰 확인 2026-11-25] 다운로드 응답은 { downloadUrl, expiresIn } 최상위 키다.
 */
function extractDownloadUrl(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.downloadUrl === 'string') return payload.downloadUrl;
  if (payload.result && typeof payload.result.downloadUrl === 'string') return payload.result.downloadUrl;
  if (payload.data && typeof payload.data.downloadUrl === 'string') return payload.data.downloadUrl;
  if (typeof payload.url === 'string') return payload.url;
  return null;
}

function isSupportedImageName(name) {
  if (!name) return false;
  const ext = path.extname(String(name)).toLowerCase();
  return SUPPORTED_IMAGE_EXTS.has(ext);
}

function formatErrorFromStatus(status, serverMessage) {
  if (status === 401) {
    return new MyboxError(MYBOX_AUTH_ERROR_MSG, {
      status,
      serverMessage,
      isAuthError: true
    });
  }
  if (status === 429) {
    return new MyboxError('MYBOX 일일 다운로드 한도를 초과했어요. 잠시 후 다시 시도해 주세요.', {
      status,
      serverMessage,
      isAuthError: false
    });
  }
  if (status === 404) {
    return new MyboxError('요청한 MYBOX 폴더 또는 파일을 찾을 수 없어요.', {
      status,
      serverMessage,
      isAuthError: false
    });
  }
  // [검증 후속 수정 2026-11-24] 토큰 문제(401·403)일 때만 토큰 확인 안내를 띄운다
  if (status === 403) {
    return new MyboxError(MYBOX_AUTH_ERROR_MSG, { status, serverMessage, isAuthError: true });
  }
  if (status >= 500) {
    return new MyboxError(MYBOX_SERVER_ERROR_MSG, { status, serverMessage, isAuthError: false });
  }
  return new MyboxError(`MYBOX 요청이 실패했어요. (HTTP ${status})`, { status, serverMessage, isAuthError: false });
}

class MyboxClient {
  constructor({ token = '', baseUrl = DEFAULT_BASE_URL, cacheDir = null } = {}) {
    this._token = token;
    this.baseUrl = sanitizeBaseUrl(baseUrl);
    this.cacheDir = cacheDir;
  }

  setToken(token) {
    this._token = token || '';
  }

  hasToken() {
    return Boolean(this._token && this._token.trim().length > 0);
  }

  async _requestJson(endpointPath, queryParams = {}) {
    if (!this.hasToken()) {
      throw new MyboxError(MYBOX_AUTH_ERROR_MSG, {
        status: 401,
        serverMessage: 'PAT 토큰이 설정되지 않았습니다.',
        isAuthError: true
      });
    }

    const url = new URL(`${this.baseUrl}${endpointPath}`);
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this._token.trim()}`,
          Accept: 'application/json'
        }
      });
    } catch (err) {
      throw new MyboxError(MYBOX_NETWORK_ERROR_MSG, {
        status: 0,
        serverMessage: err && err.message ? err.message : '네트워크 오류',
        isAuthError: false
      });
    }

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (_) {
      json = { raw: text };
    }

    if (!res.ok) {
      const serverMsg =
        (json && (json.message || json.errorMessage || json.error || json.detail)) ||
        res.statusText ||
        `HTTP ${res.status}`;
      throw formatErrorFromStatus(res.status, String(serverMsg));
    }

    return { status: res.status, data: json };
  }

  /**
   * 1. 연결 테스트: 확인된 루트 폴더 목록 경로(GET /v1/drive/resources?count=1)를 1회 호출
   */
  async testConnection() {
    const { status, data } = await this._requestJson('/drive/resources', { count: 1 });
    return {
      ok: true,
      status,
      message: 'MYBOX 연결에 성공했습니다.',
      sampleCount: extractResourceArray(data).length
    };
  }

  /**
   * 2. 폴더 목록 조회 (루트: GET /v1/drive/resources, 하위 폴더: GET /v1/drive/folders/{folderId}/resources)
   * 페이징: responseMetaData.nextCursor -> cursor, count 1~1000 (기본 100)
   */
  async listResources(folderId = null, { count = 100, cursor = null } = {}) {
    const endpoint = folderId
      ? `/drive/folders/${encodeURIComponent(folderId)}/resources`
      : '/drive/resources';

    const { data } = await this._requestJson(endpoint, { count, cursor });
    const rawItems = extractResourceArray(data);
    const nextCursor =
      (data && data.responseMetaData && data.responseMetaData.nextCursor) || null;

    const folders = [];
    const files = [];

    for (const item of rawItems) {
      const id = item.resourceId != null ? String(item.resourceId) : '';
      const name = item.name != null ? String(item.name) : '';
      if (!id || !name) continue;

      if (isFolderItem(item)) {
        folders.push({
          resourceId: id,
          name,
          path: item.path || '',
          parentId: item.parentId != null ? String(item.parentId) : null,
          fileCount: typeof item.fileCount === 'number' ? item.fileCount : null,
          subFolderCount: typeof item.subFolderCount === 'number' ? item.subFolderCount : null,
          isFolder: true
        });
      } else if (isSupportedImageName(name)) {
        const ext = path.extname(name).toLowerCase();
        const modKey = extractModifiedKey(item);
        const cachePath = this.getCacheFilePath(id, modKey, ext);
        files.push({
          resourceId: id,
          name,
          size: typeof item.size === 'number' ? item.size : 0,
          path: item.path || '',
          parentId: item.parentId != null ? String(item.parentId) : null,
          modifiedKey: modKey,
          ext: ext.replace('.', '').toUpperCase(),
          isFolder: false,
          cached: Boolean(cachePath && fs.existsSync(cachePath)),
          localPath: cachePath && fs.existsSync(cachePath) ? cachePath : null
        });
      }
    }

    return { folders, files, nextCursor };
  }

  /**
   * 폴더 내 모든 페이지(nextCursor)를 순회해 폴더 + 이미지 파일 목록 반환
   */
  async listAllResources(folderId = null, { count = 100, maxPages = 20 } = {}) {
    const allFolders = [];
    const allFiles = [];
    let cursor = null;
    let pages = 0;

    do {
      const page = await this.listResources(folderId, { count, cursor });
      allFolders.push(...page.folders);
      allFiles.push(...page.files);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < maxPages);

    return { folders: allFolders, files: allFiles };
  }

  /**
   * 3. 파일·폴더 1건 조회: GET /v1/drive/resources/{resourceId}
   */
  async getResource(resourceId) {
    const { data } = await this._requestJson(`/drive/resources/${encodeURIComponent(resourceId)}`);
    return data;
  }

  /**
   * 캐시 파일 경로 생성: resourceId + 수정 시각(또는 size) 해시
   */
  getCacheFilePath(fileId, modifiedKey, ext = '.jpg') {
    if (!this.cacheDir) return null;
    const safeExt = ext && ext.startsWith('.') ? ext.toLowerCase() : `.${(ext || 'jpg').toLowerCase()}`;
    const hash = crypto
      .createHash('sha256')
      .update(`${fileId}::${modifiedKey || '0'}`)
      .digest('hex')
      .slice(0, 32);
    return path.join(this.cacheDir, `${hash}${safeExt}`);
  }

  /**
   * 4. 파일 다운로드 (2단계) + 로컬 영구 캐시:
   *    1) GET /v1/drive/files/{fileId}/download -> downloadUrl (1회용, 10분 유효)
   *    2) GET downloadUrl -> 원본 바이트 로컬 캐시 저장
   *    이미 캐시에 있으면 서버를 호출하지 않고 즉시 반환한다.
   */
  async downloadFileToCache({ resourceId, name, modifiedKey = '' }) {
    if (!this.cacheDir) {
      throw new Error('MYBOX 캐시 경로가 설정되지 않았습니다.');
    }
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    const ext = path.extname(name || '.jpg').toLowerCase() || '.jpg';
    const cachePath = this.getCacheFilePath(resourceId, modifiedKey, ext);

    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      return {
        localPath: cachePath,
        fromCache: true,
        sizeBytes: stat.size
      };
    }

    // Step 1: Request 1-time downloadUrl
    const { data } = await this._requestJson(
      `/drive/files/${encodeURIComponent(resourceId)}/download`
    );
    const downloadUrl = extractDownloadUrl(data);
    if (!downloadUrl) {
      throw new MyboxError('MYBOX 다운로드 URL을 받지 못했습니다.', {
        status: 500,
        serverMessage: 'downloadUrl 누락'
      });
    }

    // Step 2: Fetch raw bytes from downloadUrl
    let fileRes;
    try {
      fileRes = await fetch(downloadUrl, { method: 'GET' });
    } catch (err) {
      throw new MyboxError('MYBOX 파일 다운로드에 실패했습니다.', {
        status: 0,
        serverMessage: err && err.message ? err.message : '네트워크 오류'
      });
    }

    if (!fileRes.ok) {
      throw formatErrorFromStatus(fileRes.status, `다운로드 URL 오류 (HTTP ${fileRes.status})`);
    }

    const arrayBuf = await fileRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    // Atomic write to cache
    const tmpPath = `${cachePath}.tmp_${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, cachePath);

    return {
      localPath: cachePath,
      fromCache: false,
      sizeBytes: buf.length
    };
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  MYBOX_AUTH_ERROR_MSG,
  MYBOX_NETWORK_ERROR_MSG,
  MYBOX_SERVER_ERROR_MSG,
  MyboxError,
  MyboxClient,
  extractResourceArray,
  extractDownloadUrl,
  isFolderItem,
  isSupportedImageName
};
