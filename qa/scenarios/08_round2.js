// [2026-11-26 2차 요청] 폴더 들어가기 · 폴더별 자동 채우기(위치=폴더 이름) · 사용자 지정 배치(최대 5×5) · 자르기 비율(자리에 맞춤) · 단축키 · 말풍선
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공백'), 800);
  await clickEl($$('#companyGrid .company-card').find((c) => c.textContent.includes('공백 양식')), 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
  await clickEl($$('#sheetTabsBar .sheet-tab')[1], 700);
  const sheet = () => state.editor.sheets[state.activeSheetIdx];

  // --- 폴더 열기: 하위 폴더 보임, 들어가기/나오기 ---
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  const folders = () => $$('#photoGrid .folder-item').map((f) => f.textContent);
  check('하위 폴더 2개(사진 수와 함께)', folders().length === 2 && folders()[0].includes('16. 현관') && folders()[0].includes('2장'), folders().join(' | '));
  await clickEl($$('#photoGrid .folder-item')[1], 1500);
  check('폴더 들어가기 → 그 폴더 사진 3장, 위 폴더 단추', $$('#photoGrid .photo-item').length === 3 && $('#localUpBtn').style.display !== 'none', $$('#photoGrid .photo-item').length);
  await clickEl($('#localUpBtn'), 1500);
  check('위 폴더로 나옴', $$('#photoGrid .folder-item').length === 2 && $('#localUpBtn').style.display === 'none');

  // --- 폴더별 자동 채우기 ---
  await clickEl($('#autoFillBtn'), 500);
  const modal = () => $('.af-modal');
  check('자동 채우기: 폴더별 방식이 기본, 폴더 이름 → 위치', modal() && modal().textContent.includes('현관') && modal().textContent.includes('거실') && $$('.af-modal .af-folder').length === 2, modal() && modal().textContent.slice(0, 120));
  check('폴더 이름 넣을 칸 = 위치', $$('.af-modal select').some((s) => s.selectedOptions[0] && s.selectedOptions[0].textContent === '위치'));
  await shot('s01_autofill');
  await clickEl($('#autoFillRunBtn'), 2500);
  const locs = () => sheet().blocks.map((b) => (b.values || {})['H{+1}'] || '');
  check('폴더마다 사진 1장씩 블록 5개, 위치 = 현관·현관·거실·거실·거실', locs().join() === '현관,현관,거실,거실,거실' && sheet().blocks.every((b) => b.photoAreas[0] && b.photoAreas[0].slots[0]), locs().join());
  await shot('s02_filled');
  undo(); await sleep(600);
  check('⌘Z로 되돌리기', sheet().blocks.length === 1 && !locs()[0], sheet().blocks.length);
  // 2×1 배치로 다시: 현관 1블록(2장), 거실 2블록(2+1)
  await clickEl($('#autoFillBtn'), 500);
  await clickEl($('.af-modal .layout-pick button[data-layout="2x1"]'), 300);
  check('배치 단추는 "2×1"처럼 숫자만', $('.af-modal .layout-pick button[data-layout="2x1"]').textContent.trim() === '2×1');
  await clickEl($('#autoFillRunBtn'), 2500);
  check('2×1 배치: 블록 3개(현관·거실·거실), 사진 5장', locs().join() === '현관,거실,거실' && sheet().blocks.reduce((a, b) => a + b.photoAreas[0].slots.filter(Boolean).length, 0) === 5, locs().join());

  // --- 사용자 지정 배치 3×2 ---
  $$('.pv-page .photo-slot')[0].click(); await sleep(500);
  const cell = $('#inspBody .layout-grid i[data-c="3"][data-r="2"]');
  check('속성 패널에 5×5 사용자 지정 칸', $$('#inspBody .layout-grid i').length === 25);
  cell.dispatchEvent(new MouseEvent('mouseenter')); await sleep(100);
  check('마우스를 올리면 3×2 (6장) 표시', $('#inspBody .lg-label').textContent.includes('3×2'), $('#inspBody .lg-label').textContent);
  await clickEl(cell, 700);
  const pa0 = () => sheet().blocks[state.selectedBlockIdx].photoAreas[0];
  check('3×2 배치(자리 6개, 사진은 그대로)', pa0().layout === '3x2' && pa0().slots.length === 6 && pa0().slots.filter(Boolean).length === 2 && $$('.block-outline.selected').length >= 0, `${pa0().layout} ${pa0().slots.length}`);
  check('자리 6개가 화면에 그려짐', $$('.pv-page .photo-slot').filter((s) => s.dataset.slotKey && s.dataset.slotKey.startsWith(`${state.activeSheetIdx}-${state.selectedBlockIdx}-0-`)).length === 6);
  await shot('s03_custom_layout');

  // --- 자르기: 자리 모양에 맞춤이 기본 ---
  const slot = { sheetIdx: state.activeSheetIdx, blockIdx: state.selectedBlockIdx, paIdx: 0, slotIdx: 0 };
  const slotRatio = slotAspect(slot);
  openSlotCropEditor(slot);
  await waitFor(() => $('#cropSelection').style.display === 'block', 6000);
  await sleep(300);
  const act = $('#cropRatioSeg button.active');
  check('자를 때 "자리에 맞춤"이 기본', act && act.dataset.ratio === 'slot', act && act.textContent);
  const rr = state.cropSession.rect;
  check('자르기 영역이 자리 비율', Math.abs(rr.w / rr.h - slotRatio) < 0.03, `${(rr.w / rr.h).toFixed(3)} vs ${slotRatio.toFixed(3)}`);
  await shot('s04_crop');
  await clickEl($('#confirmCropBtn'), 2500);
  await waitFor(() => !$('#cropModal').classList.contains('open'), 8000);
  const ph = pa0().slots[0];
  check('자른 사진 비율 = 자리 비율(여백 없이 꽉 참)', ph.isCropped && Math.abs(ph.croppedWidth / ph.croppedHeight - slotRatio) < 0.04, `${ph.croppedWidth}×${ph.croppedHeight} vs ${slotRatio.toFixed(3)}`);

  // --- 단축키 ---
  showDocumentInspector(); await sleep(300);
  const key = (k, mods = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
  const n0 = sheet().blocks.length;
  state.selectedBlockIdx = 0;
  key('d', { metaKey: true }); await sleep(500);
  check('⌘D 블록 복제', sheet().blocks.length === n0 + 1);
  key('y', { metaKey: true }); await sleep(300);
  undo(); await sleep(500);
  check('되돌리기 후 블록 수 원래대로', sheet().blocks.length === n0);
  key('y', { metaKey: true }); await sleep(500);
  check('⌘Y 다시 실행', sheet().blocks.length === n0 + 1);
  state.selectedBlockIdx = 0;
  const first = JSON.stringify(sheet().blocks[0].values);
  key('ArrowDown', { altKey: true }); await sleep(500);
  check('⌥↓ 블록 아래로 옮기기', JSON.stringify(sheet().blocks[1].values) === first && state.selectedBlockIdx === 1);
  key('ArrowUp'); await sleep(300);
  check('↑ 앞 블록 선택', state.selectedBlockIdx === 0);
  key('[', { metaKey: true }); await sleep(600);
  check('⌘[ 앞 시트', state.activeSheetIdx === 0);
  key(']', { metaKey: true }); await sleep(600);
  check('⌘] 다음 시트', state.activeSheetIdx === 1);
  key('\\', { metaKey: true }); await sleep(600);
  check('⌘\\ 속성 패널 접기', $('#inspector').classList.contains('collapsed'));
  key('\\', { metaKey: true }); await sleep(600);
  key('3', { metaKey: true }); await sleep(200);
  check('⌘3 사진 3열', $('#photoGrid').dataset.cols === '3');
  key('2', { metaKey: true }); await sleep(200);
  key('?', { shiftKey: true }); await sleep(300);
  check('? 단축키 목록', !!$('.dyn-modal.sc-help') && $$('.dyn-modal.sc-help .sc-row').length >= 15);
  await shot('s05_shortcuts');
  key('Escape'); await sleep(200);
  check('Esc로 닫힘', !$('.dyn-modal.sc-help'));

  // --- 아이콘 단추 + 말풍선 ---
  check('사진 도구가 글 대신 아이콘', !$('#photoFilterBtn').textContent.trim() && !$('#photoSortName').textContent.trim() && $$('#photoColsSeg button').every((b) => !b.textContent.trim()));
  $('#photoFilterBtn').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(500);
  check('마우스를 올리면 짧은 설명', $('#tipBubble').classList.contains('show') && $('#tipBubble').textContent === '안 넣은 사진만', $('#tipBubble').textContent);
  document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await shot('s06_done');

  // --- [3차] 오른쪽 클릭 메뉴 ---
  const slotEl = $$('.pv-page .photo-slot').find((s) => s.querySelector('img'));
  slotEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 })); await sleep(300);
  const menuText = () => ($('.ctx-menu') ? $('.ctx-menu').textContent : '');
  check('사진 오른쪽 클릭 메뉴(자르기·돌리기·크게 보기·빼기·블록 일)', ['자르기', '돌리기', '크게 보기', '사진 빼기', '블록 복제'].every((t) => menuText().includes(t)), menuText());
  check('오른쪽 클릭한 사진이 선택됨(속성 패널)', !!state.selectedPhotoSlot && $('#inspKicker').textContent.includes('사진 자리'));
  await shot('s07_ctxmenu');
  const nb = sheet().blocks.length;
  $$('.ctx-menu .ctx-item').find((b) => b.textContent.includes('블록 복제')).click(); await sleep(600);
  check('메뉴에서 블록 복제', sheet().blocks.length === nb + 1 && !$('.ctx-menu'));
  const row = $$('.pv-page tr[data-b]').find((t) => !t.querySelector('.photo-slot'));
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 300 })); await sleep(300);
  check('블록 칸 오른쪽 클릭 → 블록 메뉴', menuText().includes('아래에 블록 추가') && menuText().includes('블록 삭제'), menuText());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
  check('Esc로 메뉴 닫힘', !$('.ctx-menu'));
  $('#photoGrid .photo-item').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 500 })); await sleep(300);
  check('사진 패널 오른쪽 클릭 메뉴(넣기·크게 보기·Finder)', menuText().includes('크게 보기') && menuText().includes('Finder에서 보기'), menuText());
  closeContextMenu();

  // --- [3차] 사진 패널 너비 조절·접기 ---
  const sw0 = $('#sidebar').getBoundingClientRect().width;
  const rz = $('#sideResizer').getBoundingClientRect();
  $('#sideResizer').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rz.left + 3, clientY: 400 }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: rz.left + 3 + 120, clientY: 400 }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: rz.left + 3 + 120, clientY: 400 })); await sleep(600);
  check('사진 패널 끌어서 넓히기(+120px)', Math.abs($('#sidebar').getBoundingClientRect().width - (sw0 + 120)) < 4, `${Math.round(sw0)} → ${Math.round($('#sidebar').getBoundingClientRect().width)}`);
  check('넓힌 너비 기억', Number(localStorage.getItem('phoditor.sideW')) > sw0 + 100);
  $('#sideResizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await sleep(500);
  check('두 번 누르면 기본 너비', Math.abs($('#sidebar').getBoundingClientRect().width - 268) < 3);
  await clickEl($('#sideCollapseBtn'), 600);
  check('사진 패널 접기', $('#sidebar').classList.contains('collapsed') && $('#sidebar').getBoundingClientRect().width <= 42);
  await shot('s08_side_collapsed');
  await clickEl($('#sideExpandBtn'), 600);
  check('사진 패널 펼치기', !$('#sidebar').classList.contains('collapsed'));
  const iw0 = $('#inspector').getBoundingClientRect().width;
  const ir = $('#inspResizer').getBoundingClientRect();
  $('#inspResizer').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ir.left + 3, clientY: 400 }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: ir.left + 3 - 80, clientY: 400 }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: ir.left + 3 - 80, clientY: 400 })); await sleep(600);
  check('속성 패널도 끌어서 넓히기', Math.abs($('#inspector').getBoundingClientRect().width - (iw0 + 80)) < 4, `${Math.round(iw0)} → ${Math.round($('#inspector').getBoundingClientRect().width)}`);

  // --- [3차] 내보내기: 앱 안에서 이름·저장할 곳 고르기 ---
  await clickEl($('#exportBtn'), 600);
  check('내보내기 창: 파일 이름·저장할 곳·바꾸기', !!$('#exportNameInput') && !!$('#exportDirText') && !!$('#exportPickDirBtn') && $('#exportNameInput').value.includes('공백'), $('#exportNameInput') && $('#exportNameInput').value);
  await shot('s09_export');
  await clickEl($('#exportPickDirBtn'), 600);
  check('[바꾸기]로 폴더를 고르면 저장할 곳이 바뀜', $('#exportDirText').title.endsWith('photos'), $('#exportDirText').title);
  $('#exportNameInput').value = 'QA_경로지정';
  await clickEl($('#exportGoBtn'), 300);
  const t = await waitFor(() => (toastText().includes('저장 완료') || toastText().includes('실패') ? toastText() : null), 60000);
  check('고른 폴더·이름으로 저장', t && t.includes('저장 완료'), t);
  await clickEl($('#exportBtn'), 600);
  check('다음 내보내기는 지난 폴더를 기억', $('#exportDirText').title.endsWith('photos'), $('#exportDirText').title);
  $('.dyn-modal.export-dlg').remove();
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
