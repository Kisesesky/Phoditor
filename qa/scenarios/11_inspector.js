// [2026-11-27 9.3 R1] 속성 패널 = 행동 패널: 사진을 고르면 그 자리에서 자르기·돌리기·표시·원본으로·크게 보기·빼기
// 내부 정보(정의서·빈 양식·자리표시자 문법)는 작업 화면에서 빼고 설정으로, 오른쪽 클릭 메뉴는 행동만
try {
  const notesShown = () => $$('#inspBody .insp-note').filter((n) => !n.classList.contains('warn') && n.offsetParent).length;
  const menuItems = () => $$('.ctx-menu .ctx-item');
  const menuText = () => ($('.ctx-menu') ? $('.ctx-menu').textContent : '');
  const rclick = async (node, x = 600, y = 400) => { node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })); await sleep(300); };
  const panelText = () => $('#inspBody').textContent;

  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  // 설정 > 양식 정보 카드(옮겨 온 곳)
  await clickEl($('.start-nav .nav-btn[data-page="settings"]'), 800);
  const rows = $$('#setTemplates span.name');
  check('1. 설정에 양식 정보 카드: 양식마다 정의서 버전·확인 상태·빈 양식', rows.length >= 10 && /v\d+ · (승인됨|사람 확인 전)/.test($('#setTemplates').textContent) && /있음|없음/.test($('#setTemplates').textContent), `${rows.length}개`);
  await shot('i03_settings_templates');
  await clickEl($('.start-nav .nav-btn[data-page="home"]') || $('.start-nav .nav-btn[data-page]'), 500);

  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공용홀'), 300);
  await clickEl($$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === '롯데'), 2000);
  await waitFor(() => $('#editorView').classList.contains('active'));
  await clickEl($$('#sheetTabsBar .sheet-tab')[1], 700);

  // 편집 화면 진한 파랑은 [엑셀로 내보내기] 하나
  const prim = () => $$('#editorView button.primary').filter((b) => b.offsetParent);
  check('5. 편집 화면 primary 단추는 [엑셀로 내보내기] 하나(폴더 열기는 보통 단추)', prim().length === 1 && prim()[0].id === 'exportBtn' && !$('#selectFolderBtn').classList.contains('primary'), prim().map((b) => b.id).join());
  check('3. 사진 패널 빈 상태에 "자리 먼저 고르고 누르면 들어감" 안내', /사진 자리를 먼저 고르고/.test($('#photoGrid').textContent), $('#photoGrid').textContent.trim().slice(0, 80));

  // 시트 선택 상태: 내부 정보 없음, 메모 3개 이하
  showDocumentInspector(); el.inspBody.scrollTop = 0; await sleep(300);
  check('1. 시트 선택: 정의서·빈 양식·자리표시자 문법이 패널에 없음', !/정의서|빈 양식|\{\{/.test(panelText()) && /전체 쪽/.test(panelText()), panelText().slice(-120));
  check('4. 시트 선택: 상시 메모 3개 이하', notesShown() <= 3, notesShown());
  await shot('i02_sheet_selected');

  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  // 사진 자리를 고르지 않았을 때 사진 패널 메뉴: 비활성 안내 없음
  await rclick($('#photoGrid .photo-item'), 100, 500);
  check('3. 사진 패널 오른쪽 클릭: 비활성 안내 항목 없음', menuItems().length > 0 && !menuItems().some((b) => b.disabled) && !/먼저 고르면/.test(menuText()), menuText());
  closeContextMenu();

  // 빈 사진 영역 선택 상태
  await clickEl($('.photo-area-empty'), 500);
  check('4. 빈 사진 영역: 상시 메모 3개 이하', notesShown() <= 3, notesShown());

  const ph = (name) => $$('#photoGrid .photo-item').find((x) => x.textContent.includes(name));
  await dragTo(ph('landscape_3000'), $('.photo-area-empty'));
  await sleep(900);
  const slotEl = () => $$('.pv-page .photo-slot').find((s) => s.querySelector('img'));
  await clickEl(slotEl(), 600);
  const acts = () => $$('#inspPhotoActs button');
  check('2. 사진 고름 → 속성 패널 행동 6개(자르기·돌리기·표시·원본으로·크게 보기·빼기)', acts().map((b) => b.dataset.act).join() === 'crop,rotate,anno,revert,zoom,remove' && acts().every((b) => b.querySelector('svg')), acts().map((b) => b.textContent).join('/'));
  check('2. 원본으로는 자르기/돌리기 전엔 비활성, 나머지는 활성', acts().find((b) => b.dataset.act === 'revert').disabled && acts().filter((b) => b.dataset.act !== 'revert').every((b) => !b.disabled));
  check('2. "[사진] 탭이나 오른쪽 클릭으로" 안내문 없음, 원본 고지 한 줄', !/\[사진\] 탭|오른쪽 클릭/.test(panelText()) && /원본 사진 파일은 바뀌지 않아요/.test(panelText()), panelText().slice(0, 160));
  check('4. 사진 고름: 상시 메모 3개 이하', notesShown() <= 3, notesShown());
  await shot('i01_photo_selected');

  // 사진 선택 → 속성 패널에서 자르기 실행
  await clickEl(acts().find((b) => b.dataset.act === 'crop'), 1200);
  check('2. 속성 패널 [자르기] → 자르기 편집기', $('#cropModal').classList.contains('open'));
  await waitFor(() => $('#cropSelection').style.display === 'block', 5000);
  await clickEl($('#confirmCropBtn'), 2500);
  await waitFor(() => !$('#cropModal').classList.contains('open'), 8000);
  await sleep(400);
  check('2. 자른 뒤: 패널 상태 "자름", [원본으로] 활성(리본과 같이)', /자름/.test(panelText()) && !acts().find((b) => b.dataset.act === 'revert').disabled && !$('#rbRevertBtn').disabled, panelText().slice(0, 120));
  await clickEl(acts().find((b) => b.dataset.act === 'revert'), 600);
  check('2. 패널 [원본으로] → 원본 그대로', /원본 그대로/.test(panelText()) && acts().find((b) => b.dataset.act === 'revert').disabled);
  await clickEl(acts().find((b) => b.dataset.act === 'rotate'), 1500);
  await waitFor(() => /90° 돌림/.test(panelText()), 6000);
  check('2. 패널 [돌리기] → 90° 돌림', /90° 돌림/.test(panelText()), panelText().slice(0, 120));
  await clickEl(acts().find((b) => b.dataset.act === 'revert'), 600);

  // 채워진 사진 자리 오른쪽 클릭: 9개 이하, 사진 일이 먼저, 블록은 복제·삭제만
  await rclick(slotEl());
  const labels = menuItems().map((b) => b.textContent);
  check('3. 채워진 자리 메뉴 9개 이하·비활성 안내 없음', labels.length <= 9 && !menuItems().some((b) => b.disabled && !/삭제/.test(b.textContent)), labels.join(' / '));
  check('3. 사진 일이 위, 구분선 아래 블록 복제·삭제만', /자르기/.test(labels[0]) && labels.slice(-2).every((t) => /복제|삭제/.test(t)) && !/아래에 블록 추가|옮기기/.test(menuText()), labels.join(' / '));
  check('3. 채워진 자리 메뉴에 [사진 위 표시] 있음(사진 일 그룹)', labels.findIndex((t) => /사진 위 표시/.test(t)) > 0 && labels.findIndex((t) => /사진 위 표시/.test(t)) < labels.length - 2, labels.join(' / '));
  await shot('i05_slot_menu');
  closeContextMenu();
  // 빈 사진 자리 메뉴: 안내 항목 없음
  await clickEl(acts().find((b) => b.dataset.act === 'remove'), 600);
  const empty = $('.pv-page .photo-slot');
  if (empty && !empty.querySelector('img')) {
    await rclick(empty);
    check('3. 빈 사진 자리 메뉴: "왼쪽 사진을 누르면…" 안내 없음', !/왼쪽 사진을 누르면/.test(menuText()) && menuItems().length > 0, menuText());
    closeContextMenu();
  } else check('3. 패널 [빼기] 뒤 빈 자리', false, '빈 자리 없음');
  check('2. 패널 [빼기] → 사진이 빠짐', !$('.pv-page .photo-slot img'));

  // 속성 패널을 접어도(1280px 좁은 창 가정) 동선 유지: [사진] 탭 파란 점 + 자리 더블클릭 = 자르기
  await dragTo(ph('landscape_3000'), $('.pv-page .photo-slot'));
  await sleep(900);
  setInspectorCollapsed(true); await sleep(500);
  slotEl().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); await sleep(300);
  check('2. 패널 접힘: 사진 자리 고르면 [사진] 탭에 파란 점(ctx-on)', $('#ribbonTabs [data-tab="photo"]').classList.contains('ctx-on'));
  slotEl().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })); await sleep(1200);
  check('2. 패널 접힘: 사진 자리 더블클릭 → 자르기 편집기', $('#cropModal').classList.contains('open'));
  await shot('i04_collapsed_crop');
  document.getElementById('cancelCropBtn') ? $('#cancelCropBtn').click() : $('#cropModal').classList.remove('open');
  await sleep(400);
  setInspectorCollapsed(false); await sleep(300);
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
