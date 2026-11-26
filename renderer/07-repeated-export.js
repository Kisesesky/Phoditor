// [renderer/07-repeated-export.js] 반복값 일괄 입력 창, 예상 용량, 엑셀 내보내기
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// --- Repeated Values Modal ---
function openRepeatedModal() {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  if (!sheet || sheet.role !== 'block') return;
  const list = (sheet.sheetDef.block && sheet.sheetDef.block.repeatedValues) || [];
  const hdrList = (sheet.sheetDef.block && sheet.sheetDef.block.headerFields) || [];
  if (!list.length && !hdrList.length) {
    showToast('이 시트에는 정의된 반복값 항목이 없습니다.');
    return;
  }

  el.repeatedFormBody.innerHTML = '';
  // [인쇄 비교 수정 2026-11-25] 블록 위 머리 행(현장명·평형·일자) — 원본은 매 쪽 위에 인쇄되는 칸
  for (const hf of hdrList) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const cur = (sheet.headerValues && sheet.headerValues[hf.cell]) || '';
    row.innerHTML = `
      <label>${hf.label || hf.cell} (문서 전체)</label>
      <input type="text" data-hdr-cell="${hf.cell}" value="${cur.replace(/"/g, '&quot;')}" placeholder="입력하면 모든 시트의 머리 행 같은 칸에 들어갑니다" />
    `;
    el.repeatedFormBody.appendChild(row);
  }
  for (const rv of list) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const scopeTag = rv.scope === 'document' ? '문서 전체' : '현재 시트';
    row.innerHTML = `
      <label>${rv.uiLabel || rv.label || rv.cell} (${scopeTag})</label>
      <input type="text" data-rv-cell="${rv.cell}" value="${(sheet.repeatedValues[rv.cell] || '').replace(/"/g, '&quot;')}" placeholder="${rv.scope === 'document' ? '입력하면 문서 전체의 같은 칸에 들어갑니다' : '입력하면 이 시트의 같은 칸에 모두 들어갑니다'}" />
    `;
    el.repeatedFormBody.appendChild(row);
  }
  el.repeatedModal.classList.add('open');
}

function saveRepeatedModal() {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  recordUndo('반복값 일괄 입력');
  const list = (sheet.sheetDef.block && sheet.sheetDef.block.repeatedValues) || [];
  const inputs = el.repeatedFormBody.querySelectorAll('input[data-rv-cell]');
  inputs.forEach((inp) => {
    const cellKey = inp.getAttribute('data-rv-cell');
    const rvDef = list.find((x) => x.cell === cellKey);
    if (rvDef) applyRepeatedValue(sheet, rvDef, inp.value);
  });
  el.repeatedFormBody.querySelectorAll('input[data-hdr-cell]').forEach((inp) => {
    const cellKey = inp.getAttribute('data-hdr-cell');
    for (const s of state.editor.sheets) {
      const hl = (s.role === 'block' && s.sheetDef && s.sheetDef.block && s.sheetDef.block.headerFields) || [];
      if (hl.some((h) => h.cell === cellKey)) {
        s.headerValues = s.headerValues || {};
        s.headerValues[cellKey] = inp.value;
      }
    }
  });
  el.repeatedModal.classList.remove('open');
  renderActiveSheet();
  showToast('반복값을 적용했습니다.');
}

// --- Size Estimate & Export ---
function collectAllPlacedPhotoInfo() {
  const photoPaths = [];
  const croppedItems = [];
  if (!state.editor) return { photoPaths, croppedItems };
  for (const s of state.editor.sheets) {
    if (s.role !== 'block') continue;
    for (const b of s.blocks) {
      for (const pa of Object.values(b.photoAreas || {})) {
        for (const sl of pa.slots || []) {
          if (!sl) continue;
          if (sl.croppedDataBase64) {
            croppedItems.push({
              key: sl.croppedKey || sl.croppedDataBase64.slice(0, 32),
              sizeBytes: sl.sizeBytes || Math.round((sl.croppedDataBase64.length * 3) / 4)
            });
          } else if (sl.path) {
            photoPaths.push(sl.path);
          }
        }
      }
    }
  }
  return { photoPaths, croppedItems };
}

async function refreshSizeEstimate() {
  if (!state.templateDef) return;
  const { photoPaths, croppedItems } = collectAllPlacedPhotoInfo();
  const est = await window.api.estimateExportSize({
    templateId: state.templateDef.id,
    photoPaths,
    croppedItems
  });
  state.lastSizeEstimate = est;
  el.sizeEstimateBadge.textContent = `예상 용량: ${est.totalMB} MB (고유 사진 ${est.uniquePhotoCount}장)`;
  el.sizeEstimateBadge.classList.toggle('warn', !!est.exceeds500MB);
}

async function handleExport() {
  await refreshSizeEstimate();
  if (state.lastSizeEstimate.exceeds500MB) {
    const proceed = confirm(
      `예상 파일 용량이 ${state.lastSizeEstimate.totalMB}MB로 500MB를 넘습니다.\n내보내기에 시간이 걸리거나 엑셀에서 열기 무거울 수 있습니다. 계속 내보낼까요?`
    );
    if (!proceed) return;
  }

  el.exportBtn.disabled = true;
  el.exportBtn.textContent = '내보내는 중...';
  try {
    const res = await window.api.exportXlsx({
      templateId: state.templateDef.id,
      editorState: state.editor,
      suggestedName: `${currentSiteName() ? `${currentSiteName()}_` : ''}${state.templateDef.type}_${state.templateDef.company}`
    });
    if (res.canceled) return;
    if (res.ok) {
      const mb = (res.stats.sizeBytes / (1024 * 1024)).toFixed(2);
      showToast(
        `저장 완료 (${mb}MB · 사진 ${res.stats.totalPhotoPlacements}개 배치 / 고유 ${res.stats.uniqueImagesEmbedded}장 저장)`,
        4000
      );
    } else {
      const retry = confirm(`내보내기에 실패했습니다:\n${res.error}\n\n다시 저장을 시도할까요?`);
      if (retry) {
        el.exportBtn.disabled = false;
        el.exportBtn.innerHTML = EXPORT_BTN_HTML;
        return handleExport();
      }
    }
  } catch (err) {
    const retry = confirm(`내보내기 중 오류가 발생했습니다:\n${err.message || err}\n\n다시 저장을 시도할까요?`);
    if (retry) {
      el.exportBtn.disabled = false;
      el.exportBtn.innerHTML = EXPORT_BTN_HTML;
      return handleExport();
    }
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.innerHTML = EXPORT_BTN_HTML;
  }
}
