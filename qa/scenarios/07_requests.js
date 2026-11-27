// [2026-11-26 요청] 시트 넘겨 보기 · 공백 양식 · 긴 글 줄바꿈 · 사진 칸 높이 · 사진 보기 열 수·정렬 방향 · 속성 패널 접기 · 토큰 기간 · 내 양식
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  // --- 시작 화면: 큰 미리보기 + 넘겨 보기 ---
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공용홀'), 300);
  const lotte = () => $$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === '롯데');
  await waitFor(() => lotte().querySelector('img.cover-thumb'), 4000);
  const art = lotte().querySelector('.card-art');
  check('미리보기 영역이 커짐(200px 이상)', art.getBoundingClientRect().height >= 200, art.getBoundingClientRect().height);
  check('카드 설명은 한 줄로 작게', parseFloat(getComputedStyle(lotte().querySelector('.company-meta')).fontSize) <= 11.5);
  const cap0 = art.querySelector('.art-cap').textContent;
  check('첫 장은 표지 · 1/n', /1\/\d/.test(cap0), cap0);
  const src0 = art.querySelector('img').src;
  art.querySelector('.art-nav.next').click(); await sleep(500);
  const cap1 = art.querySelector('.art-cap').textContent;
  check('› 누르면 다음 시트 미리보기(그림·이름 바뀜)', cap1 !== cap0 && /2\/\d/.test(cap1) && art.querySelector('img').src !== src0, cap1);
  check('넘겨 봐도 양식이 열리지 않음', !$('#editorView').classList.contains('active'));
  art.querySelector('.art-nav.prev').click(); await sleep(300);
  check('‹ 로 되돌아감', art.querySelector('.art-cap').textContent === cap0);
  // 그림 영역을 눌러도 열리지 않고 넘겨 보기만(1번 요청)
  art.click(); await sleep(300);
  check('그림을 눌러도 편집 화면으로 안 넘어감', !$('#editorView').classList.contains('active'));
  const r = art.getBoundingClientRect();
  art.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.right - 20, clientY: r.top + 60 })); await sleep(300);
  check('그림 오른쪽을 누르면 다음 시트', /2\/\d/.test(art.querySelector('.art-cap').textContent) && !$('#editorView').classList.contains('active'), art.querySelector('.art-cap').textContent);
  art.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 20, clientY: r.top + 60 })); await sleep(300);
  art.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 120, deltaY: 0 })); await sleep(300);
  check('트랙패드 가로 밀기로 넘김', /2\/\d/.test(art.querySelector('.art-cap').textContent), art.querySelector('.art-cap').textContent);
  art.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -120, deltaY: 0 })); await sleep(300);
  // 시작 화면 구성: 왼쪽 메뉴·양식 한 줄·아래 목록
  check('왼쪽 메뉴(홈·열기·설정)', $$('.start-nav .nav-btn').map((b) => b.textContent.trim()).join() === '홈,열기,설정');
  check('양식이 한 줄(가로로 넘김)', new Set($$('#companyGrid .company-card').map((c) => Math.round(c.getBoundingClientRect().top))).size === 1);
  check('아래 목록 탭(최근 작업·내 양식)', $('#workTabs').textContent.includes('최근 작업') && $('#workTabs').textContent.includes('내 양식'));
  check('목록이 첫 화면 안에 보임(스크롤 없이)', $('#workTabs').getBoundingClientRect().top < innerHeight - 80, `${Math.round($('#workTabs').getBoundingClientRect().top)} / ${innerHeight}`);
  // 설정 화면
  await clickEl($('.start-nav .nav-btn[data-page="settings"]'), 600);
  check('설정 화면: MYBOX 연결 상태·단축키', $('#settingsPage').classList.contains('active') && $('#setMyboxChip').textContent.includes('연결 안 됨') && $$('#setShortcuts .sc-row').length >= 15, $('#setMyboxChip').textContent);
  await clickEl($('#setMyboxTokenBtn'), 500);
  check('설정 화면에서 토큰 넣기 창', $('#settingsModal').classList.contains('open'));
  $('#settingsModal').classList.remove('open');
  await shot('r00_settings');
  await clickEl($('.start-nav .nav-btn[data-page="home"]'), 400);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공백·내 양식'), 800);
  check('공백 양식 카드', !!$$('#companyGrid .company-card').find((c) => c.textContent.includes('공백 양식')));
  await shot('r01_start');

  // --- 공백 양식 열기 ---
  await clickEl($$('#companyGrid .company-card').find((c) => c.textContent.includes('공백 양식')), 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
  check('공백 양식으로 편집 시작(표지·사진 시트)', $('#editorTitle').textContent.includes('공백') && $$('#sheetTabsBar .sheet-tab').length === 2, $('#editorTitle').textContent);
  await clickEl($$('#sheetTabsBar .sheet-tab')[1], 700);
  check('사진 시트: 블록(NO.·위치·내용) 보임', $$('.pv-page td').some((t) => t.textContent.trim() === '내용'));

  // --- 긴 글 줄바꿈 ---
  const LONG = '거실 창호 하부 실리콘 마감 상태 확인 및 보수 완료, 우측 몰딩 이음부 재시공';
  const labelTd = (txt) => $$('.pv-page td').find((t) => t.textContent.trim() === txt);
  const valOf = (txt) => { const l = labelTd(txt); return l && l.nextElementSibling; };
  let v = valOf('위치');
  v.click(); await sleep(250);
  const ta = v.querySelector('.cell-editor-input');
  ta.value = LONG;
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(500);
  v = $$('.pv-page td').find((t) => t.textContent === LONG);
  check('긴 글이 칸 안에서 줄바꿈됨', v && v.classList.contains('wrap') && v.scrollWidth <= v.clientWidth + 2, v && `${v.className} ${v.scrollWidth}/${v.clientWidth}`);
  await shot('r02_wrap');
  // 칸 속성: 줄바꿈 끄기/켜기
  v.click(); await sleep(250);
  const ed = v.querySelector('.cell-editor-input');
  if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);
  const wrapCb = $$('#inspBody label.check-row').find((l) => l.textContent.includes('줄바꿈'));
  check('속성 패널에 "긴 글은 칸 안에서 줄바꿈"(켜짐)', wrapCb && wrapCb.querySelector('input').checked);
  wrapCb.querySelector('input').click(); await sleep(500);
  v = $$('.pv-page td').find((t) => t.textContent === LONG);
  check('끄면 한 줄로(넘침 경고)', v && !v.classList.contains('wrap') && v.classList.contains('overflow'), v && v.className);
  $$('#inspBody label.check-row').find((l) => l.textContent.includes('줄바꿈')).querySelector('input').click(); await sleep(500);
  v = $$('.pv-page td').find((t) => t.textContent === LONG);
  check('다시 켜면 줄바꿈', v && v.classList.contains('wrap'));

  // --- 사진 칸 높이 ---
  const sheet = () => state.editor.sheets[state.activeSheetIdx];
  const photoH = () => ($('.pv-page .photo-area-box') ? $('.pv-page .photo-area-box').getBoundingClientRect().height : 0);
  showDocumentInspector(); await sleep(400);
  const scaleSec = () => $$('#inspBody .insp-sec').find((s) => s.textContent.includes('사진 칸 높이'));
  check('블록 시트 속성에 "사진 칸 높이"', !!scaleSec());
  const h0 = photoH();
  const pages0 = $$('.pv-page').length;
  await clickEl($$('button', scaleSec()).find((b) => b.title === '5% 늘리기'), 600);
  await clickEl($$('button', scaleSec()).find((b) => b.title === '5% 늘리기'), 600);
  check('+ 두 번 → 110%', sheet().photoScale === 1.1 && scaleSec().textContent.includes('110%'), sheet().photoScale);
  check('사진 칸이 실제로 커짐', photoH() > h0 * 1.05, `${Math.round(h0)} → ${Math.round(photoH())}`);
  await clickEl($$('button', scaleSec()).find((b) => b.textContent === '쪽에 꽉 차게'), 900);
  check('쪽에 꽉 차게: 쪽 수 그대로', $$('.pv-page').length === pages0 && (state.splitBlocks || []).length === 0, `${$$('.pv-page').length}/${pages0} ${toastText()}`);
  undo(); await sleep(500);
  check('⌘Z로 높이 되돌리기', sheet().photoScale === 1.1, sheet().photoScale);
  await clickEl($$('button', scaleSec()).find((b) => b.textContent === '원래 높이로'), 600);
  check('원래 높이로', !sheet().photoScale && Math.abs(photoH() - h0) < 2);

  // --- 사진 패널: 보기 열 수 · 정렬 방향 ---
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  const cols = () => getComputedStyle($('#photoGrid')).gridTemplateColumns.split(' ').length;
  check('보기 기본 2열', cols() === 2, cols());
  await clickEl($('#photoColsSeg button[data-cols="4"]'), 300);
  check('4열로', cols() === 4 && $('#photoColsSeg button[data-cols="4"]').classList.contains('active'), cols());
  await shot('r03_cols4');
  await clickEl($('#photoColsSeg button[data-cols="1"]'), 300);
  check('1열로(사진 크게)', cols() === 1 && $('#photoGrid .photo-item').getBoundingClientRect().width > 200, $('#photoGrid .photo-item').getBoundingClientRect().width);
  await clickEl($('#photoColsSeg button[data-cols="2"]'), 300);
  const names = () => $$('#photoGrid .photo-name').map((n) => n.textContent.trim());
  const asc = names();
  check('이름순 아이콘 켜짐(오름)', $('#photoSortName').classList.contains('on') && $('#photoSortName').dataset.tip.includes('오름'));
  await clickEl($('#photoSortName'), 400);
  check('한 번 더 누르면 내림차순으로 뒤집힘', $('#photoSortName').dataset.tip.includes('내림') && names().join() === [...asc].reverse().join(), names().slice(0, 3).join());
  await clickEl($('#photoSortName'), 400);
  check('다시 오름차순', names().join() === asc.join());
  check('정렬·열 수가 MYBOX에도 같이 보임(공통 도구)', !$('#photoSortName').closest('#localControls'));

  // --- 속성 패널 접기 ---
  const vpW = $('#gridViewport').getBoundingClientRect().width;
  await clickEl($('#inspCollapseBtn'), 700);
  check('속성 패널 접힘 → 캔버스 넓어짐', $('#inspector').classList.contains('collapsed') && $('#inspector').getBoundingClientRect().width <= 44 && $('#gridViewport').getBoundingClientRect().width > vpW + 200, `${Math.round(vpW)} → ${Math.round($('#gridViewport').getBoundingClientRect().width)}`);
  await shot('r04_collapsed');
  await clickEl($('#inspExpandBtn'), 700);
  check('다시 펼침', !$('#inspector').classList.contains('collapsed') && $('#inspector').getBoundingClientRect().width > 250);

  // --- MYBOX 토큰 기간 ---
  await clickEl($('#sourceTabMybox'), 900);
  check('MYBOX 패널에 연결 상태 칩(토큰 없음)', !$('#myboxExpiryChip').hidden && $('#myboxExpiryChip').textContent.includes('연결 안 됨'), $('#myboxExpiryChip').textContent);
  await clickEl($('#sourceTabLocal'), 300);
  await openSettingsModal(); await sleep(300);
  check('설정 창: 기간 180·90·60·30일', ['180', '90', '60', '30'].every((d) => $(`#myboxDaysSeg button[data-days="${d}"]`)));
  await clickEl($('#myboxDaysSeg button[data-days="30"]'), 200);
  check('30일 고르면 만료일 미리보기', /남음/.test($('#myboxExpiryPreview').textContent), $('#myboxExpiryPreview').textContent);
  await shot('r05_mybox_settings');
  const d = new Date(); d.setDate(d.getDate() - 20);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ex = expiryFrom(iso, 30);
  check('20일 전 발급 30일 토큰 → 10일 남음', ex.daysLeft === 10 && !ex.expired, JSON.stringify(ex));
  const ex2 = expiryFrom(iso, 30 - 25);
  check('기간 지난 토큰 → 만료', ex2.expired && expiryText(true, ex2).short.includes('만료'), expiryText(true, ex2).short);
  check('7일 이하면 곧 끝남 표시', expiryText(true, expiryFrom(iso, 25)).cls === 'soon');
  $('#settingsModal').classList.remove('open');

  // --- 내 양식으로 저장 → 시작 화면 → 다시 시작 ---
  await clickEl($('#addBlockEndBtn'), 500);
  await clickEl($('#addBlockEndBtn'), 500);
  showDocumentInspector(); await sleep(300);
  await clickEl($('#saveMyTplTopBtn'), 300);
  const nm = $('.dyn-modal input[type=text]');
  nm.value = 'QA 공용홀 기본';
  await clickEl($('#saveMyTplGoBtn'), 800);
  check('내 양식 저장 안내', toastText().includes('QA 공용홀 기본'), toastText());
  startUi.workTab = 'mine';
  await renderMyTemplates(); await sleep(500);
  const myCard = $$('#companyGrid .company-card').find((c) => c.textContent.includes('QA 공용홀 기본'));
  check('아래 "내 양식" 목록에도 나옴', $$('#workList .work-row').some((r) => r.textContent.includes('QA 공용홀 기본')));
  check('시작 화면 "내 양식"에 나옴(블록 3개)', myCard && myCard.textContent.includes('블록 3개'), myCard && myCard.textContent);
  const list = await window.api.myTemplatesList();
  await startFromMyTemplate(list[0].id); await sleep(1200);
  const blockSheet = state.editor.sheets.find((s) => s.role === 'block');
  check('내 양식으로 시작: 블록 3개·글 비움(기본)·사진 없음', blockSheet.blocks.length === 3 && !Object.keys(blockSheet.blocks[0].values || {}).length, `${blockSheet.blocks.length} ${JSON.stringify(blockSheet.blocks[0].values)}`);
  check('새 작업(파일 없음, 저장 안 한 변경 없음)', !docState.filePath && !docState.dirty);
  // 지우기
  window.confirm = () => true;
  await deleteMyTemplate(list[0]); await sleep(400);
  check('내 양식 지우기', !(await window.api.myTemplatesList()).length);
  await shot('r06_done');
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
