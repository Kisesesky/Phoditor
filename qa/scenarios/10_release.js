// [2026-11-27 출시 준비] 내보내기 사진 크기(원본 그대로 기본 / 인쇄용) 선택 · Finder에서 .pbook 두 번 눌러 열기
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공용홀'), 300);
  await clickEl($$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === '롯데'), 2000);
  await clickEl($$('#sheetTabsBar .sheet-tab')[1], 700);
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  const big = $$('#photoGrid .photo-item').find((x) => x.textContent.includes('landscape_3000'));
  await dragTo(big, $('.photo-area-empty'));
  await sleep(900);
  await refreshSizeEstimate();
  check('1. 상태 막대 예상 용량: 기본은 원본 그대로', /원본 그대로/.test($('#sizeEstimateBadge').textContent), $('#sizeEstimateBadge').textContent);

  // 내보내기 창: 사진 크기 선택(기본 원본 그대로) → 인쇄용 고르기
  await clickEl($('#exportBtn'), 300);
  await waitFor(() => $('#exportGoBtn'));
  const seg = $('#exportPhotoModeSeg');
  check('2. 내보내기 창에 사진 크기 선택, 기본은 원본 그대로', !!seg && seg.querySelector('button.on').dataset.v === 'original', seg && seg.textContent);
  await shot('r01_export_dialog');
  await clickEl($('#exportPhotoModeSeg [data-v="print"]'), 100);
  await clickEl($('#exportGoBtn'), 300);
  await waitFor(() => /저장 완료/.test(toastText()), 30000);
  check('3. 인쇄용 내보내기: 큰 사진을 줄였다고 알림', /인쇄용으로 줄인 사진 1장/.test(toastText()), toastText());
  check('3. 인쇄용을 고르면 기억, 상태 막대는 "최대"로 표시', getPhotoMode() === 'print' && /최대 .* 인쇄용으로 줄여 넣음/.test($('#sizeEstimateBadge').textContent), $('#sizeEstimateBadge').textContent);

  // 다시 원본 그대로를 고르면 기억하고, 줄이지 않는다
  await sleep(4200);
  await clickEl($('#exportBtn'), 300);
  await waitFor(() => $('#exportGoBtn'));
  await clickEl($('#exportPhotoModeSeg [data-v="original"]'), 100);
  await clickEl($('#exportGoBtn'), 300);
  await waitFor(() => /저장 완료/.test(toastText()), 30000);
  check('4. 원본 그대로: 줄인 사진 없음', /저장 완료/.test(toastText()) && !/인쇄용으로 줄인/.test(toastText()), toastText());
  check('4. 고른 사진 크기를 기억', getPhotoMode() === 'original' && /원본 그대로/.test($('#sizeEstimateBadge').textContent), $('#sizeEstimateBadge').textContent);

  // .pbook 저장 → 시작 화면으로 → Finder에서 두 번 누른 것처럼 열기
  const cell = $$('td.editable-cell').find((td) => !td.textContent.trim());
  await saveProject(true);
  await sleep(600);
  const saved = docState.filePath;
  check('5. 작업 파일 저장', !!saved && saved.endsWith('.pbook'), saved);
  await goToStart(); await sleep(800);
  await waitFor(() => !$('#editorView').classList.contains('active'), 3000);
  console.log('__QA_OPENFILE__:' + saved);
  await waitFor(() => $('#editorView').classList.contains('active') && docState.filePath === saved, 8000);
  check('5. .pbook 두 번 누르기(open-file) → 그 작업이 열림', $('#editorView').classList.contains('active') && docState.filePath === saved && state.templateDef.company === '롯데', `${docState.filePath} ${state.templateDef && state.templateDef.company}`);
  check('5. 열린 작업에 넣은 사진이 그대로', $$('.pv-page .photo-slot img').length >= 1, $$('.pv-page .photo-slot img').length);
  void cell;

  // 큰 사진 섞인 배치(하늘채 모양): 고르기 → 쪽 화면 격자 → 자동 채우기
  const blkIdx = state.editor.sheets.findIndex((s) => s.role === 'block');
  state.activeSheetIdx = blkIdx; renderSheetTabs(); renderActiveSheet(); await sleep(400);
  const emptyArea = $('.photo-area-empty') || null;
  if (emptyArea) await clickEl(emptyArea, 500);
  else { $('.pv-page .photo-slot').click(); await sleep(500); }
  const spanBtns = $$('.layout-pick.span button');
  check('8. 배치 고르기에 "큰 사진 섞기" 4가지', spanBtns.length === 4 && spanBtns.map((b) => b.dataset.layout).join() === 'L12,L13,T13,T23', spanBtns.map((b) => b.dataset.layout).join());
  await clickEl(spanBtns.find((b) => b.dataset.layout === 'L13'), 700);
  const sl = $$('.pv-page .photo-area-box')[0].querySelectorAll('.photo-slot');
  const r0 = sl[0].getBoundingClientRect(); const r1 = sl[1].getBoundingClientRect(); const r3 = sl[3].getBoundingClientRect();
  check('8. 쪽 화면: 왼쪽 큰 자리 1 + 오른쪽 작은 자리 3', sl.length === 4 && r0.width > r1.width * 1.8 && r0.height > r1.height * 2.5 && r1.left > r0.right - 2 && r3.top > r1.bottom - 2, `${sl.length} big ${Math.round(r0.width)}x${Math.round(r0.height)} small ${Math.round(r1.width)}x${Math.round(r1.height)}`);
  await shot('r04_span_layout');
  // 사진 넣기(첫 자리에 넣은 사진은 그대로, 빈 자리에 차례로)
  for (let i = 0; i < 4; i++) {
    const s = $$('.pv-page .photo-area-box')[0].querySelectorAll('.photo-slot')[i];
    if (s.querySelector('img')) continue;
    await dragTo($$('#photoGrid .photo-item')[i], s);
    await sleep(500);
  }
  check('8. 큰 사진 섞기 자리 4곳 모두 사진', $$('.pv-page .photo-area-box')[0].querySelectorAll('.photo-slot img').length === 4);
  await shot('r05_span_filled');

  // 인쇄·PDF 전 Excel 확인 (하니스가 Excel 상태만 바꿔 줌 — 진짜 Excel은 움직이지 않음)
  const setExcel = async (st) => { const n = window.__qaExcelSet || 0; console.log('__QA_EXCEL__:' + JSON.stringify(st)); await waitFor(() => (window.__qaExcelSet || 0) > n, 3000); };
  check('6. [인쇄]는 [엑셀로 내보내기 ▾] 메뉴 안(⌘P), 도구 막대가 창 안에 들어감', !!$('#exportMenu #printBtn') && $('#exportMenuBtn').getBoundingClientRect().right <= innerWidth && $('#exportBtn').getBoundingClientRect().right <= innerWidth, `${Math.round($('#exportMenuBtn').getBoundingClientRect().right)} / ${innerWidth}`);
  await setExcel({ installed: false, automation: 'unknown' });
  await clickEl($('#printBtn'), 500);
  const m1 = $('.dyn-modal');
  check('6. Excel이 없으면 인쇄 전에 알림(다른 컴퓨터에서 인쇄 안내)', !!m1 && /Excel이 필요해요/.test(m1.textContent) && /엑셀로 내보내기/.test(m1.textContent), m1 && m1.textContent.slice(0, 80));
  await shot('r02_no_excel');
  if (m1) m1.parentNode.removeChild(m1.closest('.modal-backdrop') || m1);
  await sleep(200);
  await setExcel({ installed: true, automation: 'denied' });
  await clickEl($('#pdfBtn'), 500);
  const m2 = $('.dyn-modal');
  check('7. 권한을 거절했었으면 PDF 창 전에 고치는 길(설정 열기·다시 시도)', !!m2 && /Excel 제어를 허용/.test(m2.textContent) && [...m2.querySelectorAll('button')].some((b) => b.textContent === '설정 열기'), m2 && m2.textContent.slice(0, 80));
  await shot('r03_denied');
  await clickEl([...m2.querySelectorAll('button')].find((b) => b.textContent === '취소'), 400);
  check('7. 취소하면 PDF 창은 열리지 않음', !$('.dyn-modal.export-dlg') && !$('.dyn-modal'));
  // 바깥을 눌러 닫아도 기다림이 끝나야 함(단추가 막히지 않게)
  let settled = null;
  excelReady().then((v) => { settled = v; });
  await waitFor(() => $('.dyn-modal'), 2000);
  const bd = $('.dyn-modal');
  bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await waitFor(() => settled !== null, 2000);
  check('7. 바깥 눌러 닫으면 취소로 끝남', settled === false && !$('.dyn-modal'), String(settled));
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
