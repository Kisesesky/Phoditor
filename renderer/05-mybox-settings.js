// [renderer/05-mybox-settings.js] MYBOX 설정 창
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// --- Stage 2 B: MYBOX Settings Modal ---
async function openSettingsModal() {
  el.myboxTokenInput.value = '';
  el.myboxTestResult.className = 'test-result-box';
  el.myboxTestResult.textContent = '';
  const st = await window.api.myboxGetStatus();
  el.myboxTokenStatusText.textContent = st.hasToken
    ? `저장된 토큰 있음 (${st.safeStorageAvailable ? 'safeStorage 암호화' : '메모리 임시'})`
    : '저장된 토큰 없음';
  el.settingsModal.classList.add('open');
}

async function handleSaveMyboxToken() {
  const val = el.myboxTokenInput.value.trim();
  if (!val) {
    showToast('PAT 토큰을 입력해 주세요.');
    return;
  }
  const res = await window.api.myboxSaveToken(val);
  if (!res.ok) {
    showToast(res.error || '토큰 저장에 실패했습니다.');
    return;
  }
  el.myboxTokenInput.value = '';
  el.myboxTokenStatusText.textContent = res.persisted
    ? '저장된 토큰 있음 (safeStorage 암호화)'
    : '저장된 토큰 있음 (메모리 임시)';
  showToast(res.warning || 'MYBOX PAT를 안전하게 저장했습니다.');
  if (state.photoSource === 'mybox') {
    state.mybox.folderStack = [{ id: null, name: '/ (루트)' }];
    loadMyboxCurrentFolder();
  }
}

async function handleTestMyboxConnection() {
  el.testMyboxBtn.disabled = true;
  el.testMyboxBtn.textContent = '테스트 중...';
  el.myboxTestResult.className = 'test-result-box';
  try {
    const candidate = el.myboxTokenInput.value.trim();
    const res = await window.api.myboxTestConnection(candidate || null);
    if (res.ok) {
      el.myboxTestResult.className = 'test-result-box ok';
      el.myboxTestResult.textContent = `연결 성공 (HTTP ${res.status}): ${res.message}`;
    } else {
      el.myboxTestResult.className = 'test-result-box err';
      const statusTxt = res.status ? `HTTP ${res.status}` : '네트워크 오류';
      el.myboxTestResult.textContent =
        `${res.message || 'MYBOX 연결이 안 돼요. 토큰을 다시 확인해줘'} (${statusTxt}${res.serverMessage ? ' · ' + res.serverMessage : ''})`;
    }
  } finally {
    el.testMyboxBtn.disabled = false;
    el.testMyboxBtn.textContent = '연결 테스트';
  }
}

async function handleClearMyboxToken() {
  if (!confirm('저장된 MYBOX 토큰을 삭제할까요?')) return;
  await window.api.myboxClearToken();
  el.myboxTokenStatusText.textContent = '저장된 토큰 없음';
  el.myboxTestResult.className = 'test-result-box';
  showToast('MYBOX 토큰을 삭제했습니다.');
}
