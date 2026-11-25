const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');
const { MyboxClient, MYBOX_AUTH_ERROR_MSG, MYBOX_NETWORK_ERROR_MSG, MYBOX_SERVER_ERROR_MSG } = require('./mybox');

async function runMyboxStubTests() {
  console.log('=== 2단계 B: MYBOX 스텁 서버 자동 테스트 ===');
  const VALID_TOKEN = 'test-pat-secret-token-2026';
  const FAKE_IMAGE_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
    0x08, 0x02, 0x00, 0x00, 0x00, 0xfd, 0xd4, 0x9a, 0x73
  ]);

  let rootCalls = 0;
  let folderCalls = 0;
  let downloadUrlCalls = 0;
  let rawDownloadCalls = 0;
  let seenAuthHeaders = [];

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const pathname = urlObj.pathname;

    // Raw 1-time download URL (no Bearer header required on signed downloadUrl)
    if (pathname === '/signed-download/file-img-1') {
      rawDownloadCalls++;
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(FAKE_IMAGE_BYTES);
      return;
    }

    // All /v1/drive/* endpoints require Authorization: Bearer <PAT>
    const auth = req.headers['authorization'] || '';
    seenAuthHeaders.push(auth);
    if (auth !== `Bearer ${VALID_TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Invalid or expired PAT token' }));
      return;
    }

    // Confirmed Endpoint 1: GET /v1/drive/resources (root listing with nextCursor)
    if (pathname === '/v1/drive/resources') {
      rootCalls++;
      const cursor = urlObj.searchParams.get('cursor');
      if (!cursor) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resources: [
            { resourceId: 'folder-100', name: '현장사진_84A', type: 'folder', path: '/현장사진_84A', parentId: 'root', subFolderCount: 0, fileCount: 2 },
            { resourceId: 'file-root-1', name: 'root_cover.jpg', type: 'file', size: 12345, path: '/root_cover.jpg', parentId: 'root', modifiedTime: '2026-11-24T10:00:00Z' },
            { resourceId: 'file-doc-1', name: 'notes.txt', type: 'file', size: 100, path: '/notes.txt', parentId: 'root' }
          ],
          responseMetaData: { nextCursor: 'page-2-cursor' }
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resources: [
            { resourceId: 'file-root-2', name: 'root_extra.heic', type: 'file', size: 54321, path: '/root_extra.heic', parentId: 'root', modifiedTime: '2026-11-24T11:00:00Z' }
          ],
          responseMetaData: { nextCursor: null }
        }));
      }
      return;
    }

    // Confirmed Endpoint 2: GET /v1/drive/folders/{folderId}/resources
    if (pathname === '/v1/drive/folders/folder-100/resources') {
      folderCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resources: [
          { resourceId: 'file-img-1', name: 'living_room.png', type: 'file', size: FAKE_IMAGE_BYTES.length, path: '/현장사진_84A/living_room.png', parentId: 'folder-100', modifiedTime: '2026-11-24T12:00:00Z' }
        ],
        responseMetaData: { nextCursor: null }
      }));
      return;
    }

    // 서버 오류 흉내 (토큰 문제가 아님)
    if (pathname === '/v1/drive/folders/folder-500/resources') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Service Unavailable' }));
      return;
    }

    // Confirmed Endpoint 3: GET /v1/drive/files/{fileId}/download -> downloadUrl
    if (pathname === '/v1/drive/files/file-img-1/download') {
      downloadUrlCalls++;
      const addr = server.address();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        downloadUrl: `http://127.0.0.1:${addr.port}/signed-download/file-img-1`
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not Found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-mybox-cache-'));

  try {
    const client = new MyboxClient({ token: VALID_TOKEN, baseUrl, cacheDir });

    // [1/5] Connection test + Bearer header
    console.log('\n[1/5] 연결 테스트 및 Authorization: Bearer 헤더 검증...');
    const connRes = await client.testConnection();
    assert.strictEqual(connRes.ok, true);
    assert.strictEqual(connRes.status, 200);
    assert(seenAuthHeaders.includes(`Bearer ${VALID_TOKEN}`), 'Bearer header must be sent');
    console.log('  PASS: 연결 테스트 성공 및 Authorization: Bearer 헤더 확인');

    // [2/5] Root listing with pagination + filtering (folders + images only) + subfolder listing
    console.log('\n[2/5] 루트/하위 폴더 목록 파싱·페이징(nextCursor)·이미지 필터 검증...');
    const rootList = await client.listAllResources(null);
    assert.strictEqual(rootList.folders.length, 1, 'Should parse 1 folder');
    assert.strictEqual(rootList.folders[0].resourceId, 'folder-100');
    assert.strictEqual(rootList.files.length, 2, 'Should parse 2 image files across 2 pages (ignoring .txt)');
    assert(rootCalls >= 3, 'Should have called root endpoint including pagination');

    const subList = await client.listAllResources('folder-100');
    assert.strictEqual(folderCalls, 1);
    assert.strictEqual(subList.files.length, 1);
    assert.strictEqual(subList.files[0].resourceId, 'file-img-1');
    console.log('  PASS: 루트 페이징(2페이지)·비이미지 제외(.txt)·하위 폴더 이동 확인');

    // [3/5] 2-step download + persistent local cache (2nd download must NOT hit server)
    console.log('\n[3/5] 2단계 다운로드(downloadUrl) 및 로컬 캐시 적중 검증...');
    const fileItem = subList.files[0];
    const dl1 = await client.downloadFileToCache({
      resourceId: fileItem.resourceId,
      name: fileItem.name,
      modifiedKey: fileItem.modifiedKey
    });
    assert.strictEqual(dl1.fromCache, false, 'First download must fetch from server');
    assert.strictEqual(downloadUrlCalls, 1);
    assert.strictEqual(rawDownloadCalls, 1);
    assert(fs.existsSync(dl1.localPath));
    assert.strictEqual(
      crypto.createHash('sha256').update(fs.readFileSync(dl1.localPath)).digest('hex'),
      crypto.createHash('sha256').update(FAKE_IMAGE_BYTES).digest('hex'),
      'Downloaded bytes must match server bytes verbatim'
    );

    const dl2 = await client.downloadFileToCache({
      resourceId: fileItem.resourceId,
      name: fileItem.name,
      modifiedKey: fileItem.modifiedKey
    });
    assert.strictEqual(dl2.fromCache, true, 'Second download must hit local cache');
    assert.strictEqual(dl2.localPath, dl1.localPath);
    assert.strictEqual(downloadUrlCalls, 1, 'Must NOT call /download API again on cache hit');
    assert.strictEqual(rawDownloadCalls, 1, 'Must NOT re-download raw bytes on cache hit');
    console.log('  PASS: 최초 1회 다운로드 후 2회차 캐시 적중(서버 재호출 0회) 확인');

    // [4/5] 401 failure handling
    console.log('\n[4/5] 401 인증 실패 시 토큰 확인 안내 메시지 검증...');
    const badClient = new MyboxClient({ token: 'wrong-token', baseUrl, cacheDir });
    let caught = null;
    try {
      await badClient.listResources(null);
    } catch (err) {
      caught = err;
    }
    assert(caught, '401 must throw MyboxError');
    assert.strictEqual(caught.status, 401);
    assert.strictEqual(caught.isAuthError, true);
    assert.strictEqual(caught.message, MYBOX_AUTH_ERROR_MSG);
    console.log(`  PASS: 401 오류 시 "${caught.message}" 반환 확인`);

    // [5/5] 토큰 문제가 아닌 실패는 토큰 확인 안내를 띄우지 않는다
    console.log('\n[5/5] 서버 오류(5xx)·네트워크 오류 안내 구분 검증...');
    let e5 = null;
    try { await client.listResources('folder-500'); } catch (err) { e5 = err; }
    assert(e5 && e5.status === 503 && e5.isAuthError === false, '503 must not be an auth error');
    assert.strictEqual(e5.message, MYBOX_SERVER_ERROR_MSG);
    const deadClient = new MyboxClient({ token: VALID_TOKEN, baseUrl: 'http://127.0.0.1:1/v1', cacheDir });
    let en = null;
    try { await deadClient.testConnection(); } catch (err) { en = err; }
    assert(en && en.status === 0 && en.isAuthError === false, 'Network failure must not be an auth error');
    assert.strictEqual(en.message, MYBOX_NETWORK_ERROR_MSG);
    console.log(`  PASS: 5xx → "${e5.message}", 네트워크 → "${en.message}"`);

    console.log('\nMYBOX 스텁 서버 테스트 5/5 전부 통과!');
  } finally {
    server.close();
  }
}

runMyboxStubTests().catch((err) => {
  console.error('MYBOX 스텁 테스트 실패:', err);
  process.exit(1);
});
