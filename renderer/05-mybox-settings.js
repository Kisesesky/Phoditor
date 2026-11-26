// [renderer/05-mybox-settings.js] MYBOX 설정 창
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// --- [2026-11-26] 토큰 유효 기간(180·90·60·30일) → 남은 날 세기 ---
const myboxUi = { hasToken: false, expiry: null, days: 90 };
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function expiryFrom(issuedAt, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt || '') || !(days > 0)) return null;
  const [y, m, d] = issuedAt.split('-').map(Number);
  const exp = new Date(y, m - 1, d + days);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((exp - t) / 86400000);
  const iso = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`;
  return { issuedAt, days, expiresAt: iso, daysLeft, expired: daysLeft <= 0 };
}
function expiryText(hasToken, ex) {
  if (!hasToken) return { cls: 'unknown', short: '연결 안 됨', long: '저장된 토큰 없음' };
  if (!ex) return { cls: 'unknown', short: '연결됨 · 만료일 모름', long: '연결됨 · 기간을 아래에서 골라 주면 남은 날을 세어 드려요' };
  if (ex.expired) return { cls: 'expired', short: `만료됨 (${ex.expiresAt}) · 새 토큰 필요`, long: `토큰 기간이 끝났어요 (${ex.expiresAt}). MYBOX에서 새 토큰을 받아 넣어 주세요.` };
  const cls = ex.daysLeft <= 7 ? 'soon' : '';
  return { cls, short: `연결됨 · ${ex.daysLeft}일 남음 (D-${ex.daysLeft})`, long: `연결됨 · ${ex.expiresAt}까지 ${ex.daysLeft}일 남음${ex.daysLeft <= 7 ? ' — 곧 끝나요, 새 토큰을 준비하세요' : ''}` };
}
async function refreshMyboxStatus() {
  try {
    const st = await window.api.myboxGetStatus();
    myboxUi.hasToken = !!st.hasToken;
    myboxUi.expiry = st.expiry || null;
  } catch (_) {}
  updateMyboxExpiryChip();
}
function updateMyboxExpiryChip() {
  if (!el.myboxExpiryChip) return;
  const t = expiryText(myboxUi.hasToken, myboxUi.expiry);
  el.myboxExpiryChip.hidden = false;
  el.myboxExpiryChip.className = `expiry-chip ${t.cls}`;
  el.myboxExpiryChip.textContent = t.short;
  el.myboxExpiryChip.title = `${t.long} (누르면 MYBOX 설정)`;
}
function setDaysSeg(days) {
  myboxUi.days = days;
  for (const b of el.myboxDaysSeg.querySelectorAll('button')) b.classList.toggle('active', Number(b.dataset.days) === days);
  updateExpiryPreview();
}
function updateExpiryPreview() {
  const ex = expiryFrom(el.myboxIssuedInput.value, myboxUi.days);
  el.myboxExpiryPreview.textContent = ex
    ? (ex.expired ? `이 기간이면 ${ex.expiresAt}에 이미 끝났어요.` : `→ ${ex.expiresAt}까지 (${ex.daysLeft}일 남음). 만료되면 목록에 "만료됨"으로 알려 드려요.`)
    : '발급일을 골라 주세요.';
}

// --- Stage 2 B: MYBOX Settings Modal ---
async function openSettingsModal() {
  el.myboxTokenInput.value = '';
  el.myboxTestResult.className = 'test-result-box';
  el.myboxTestResult.textContent = '';
  const st = await window.api.myboxGetStatus();
  myboxUi.hasToken = !!st.hasToken;
  myboxUi.expiry = st.expiry || null;
  const t = expiryText(st.hasToken, st.expiry);
  el.myboxTokenStatusText.textContent = st.hasToken
    ? `${t.long} (${st.safeStorageAvailable ? '암호화 저장' : '메모리 임시'})`
    : '저장된 토큰 없음';
  el.myboxTokenStatusText.style.color = t.cls === 'expired' ? 'var(--danger, #B42318)' : '';
  el.myboxIssuedInput.value = (st.expiry && st.expiry.issuedAt) || todayIso();
  setDaysSeg((st.expiry && st.expiry.days) || 90);
  el.saveMyboxBtn.textContent = '저장';
  el.settingsModal.classList.add('open');
}

async function handleSaveMyboxToken() {
  const val = el.myboxTokenInput.value.trim();
  const period = { issuedAt: el.myboxIssuedInput.value, days: myboxUi.days };
  if (!val) {
    // 토큰은 그대로 두고 기간만 고치기
    if (myboxUi.hasToken) {
      const r = await window.api.myboxSavePeriod(period);
      myboxUi.expiry = r.expiry || null;
      updateMyboxExpiryChip();
      el.myboxTokenStatusText.textContent = expiryText(true, myboxUi.expiry).long;
      showToast('토큰 기간을 저장했어요.');
      return;
    }
    showToast('PAT 토큰을 입력해 주세요.');
    return;
  }
  const res = await window.api.myboxSaveToken(val, period);
  if (!res.ok) {
    showToast(res.error || '토큰 저장에 실패했습니다.');
    return;
  }
  el.myboxTokenInput.value = '';
  await refreshMyboxStatus();
  el.myboxTokenStatusText.textContent = `${expiryText(true, myboxUi.expiry).long} (${res.persisted ? '암호화 저장' : '메모리 임시'})`;
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
  myboxUi.hasToken = false;
  myboxUi.expiry = null;
  updateMyboxExpiryChip();
  el.myboxTokenStatusText.textContent = '저장된 토큰 없음';
  el.myboxTestResult.className = 'test-result-box';
  showToast('MYBOX 토큰을 삭제했습니다.');
}
