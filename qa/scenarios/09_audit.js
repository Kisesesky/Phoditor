// [2026-11-26 디자인 감사 7건] 눌림 튀김 · 리본 펼치기 단추 · 좁은 창 단추 · 폴더 경로 · 색 토큰 · 선 아이콘 · 초점/커서/비활성
const cssRuleText = (selText) => {
  for (const sh of document.styleSheets) {
    let rules;
    try { rules = sh.cssRules; } catch (_) { continue; }
    for (const r of rules) if (r.selectorText === selText) return r.style.cssText;
  }
  return null;
};
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  // 1. 눌림: transform을 쓰지 않음 → 가운데 맞춘 단추(.art-nav 등)의 transform 유지
  const act = cssRuleText('button:active:not(:disabled)');
  check('1. 눌림 규칙이 transform 대신 translate', act && !/transform/.test(act) && /translate/.test(act), act);
  const nav = $('.art-nav');
  check('1. .art-nav 원래 transform 유지', nav && getComputedStyle(nav).transform !== 'none', nav && getComputedStyle(nav).transform);
  // 7. 카드 초점 링 = accent-ring
  check('7. 카드 초점 링이 accent-ring', /accent-ring/.test(cssRuleText('.company-card:focus-visible') || ''), cssRuleText('.company-card:focus-visible'));

  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공백·내 양식'), 600);
  await clickEl($$('#companyGrid .company-card').find((c) => c.textContent.includes('공백 양식')), 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
  await clickEl($$('#sheetTabsBar .sheet-tab')[1], 700);

  // 2. 리본 접기 단추는 리본 밖에 있어 접어도 보임, 토글
  const cbtn = $('#ribbonCollapseBtn');
  check('2. 접기 단추가 리본 밖(도구 막대 줄)', !cbtn.closest('#ribbon') && !!cbtn.closest('.app-toolbar'));
  await clickEl(cbtn, 400);
  const r = cbtn.getBoundingClientRect();
  check('2. 접으면 리본이 사라지고 단추는 보임', $('#ribbon').classList.contains('collapsed') && $('#ribbon').getBoundingClientRect().height === 0 && r.width > 0 && r.height > 0, `${r.width}x${r.height}`);
  check('2. 접힌 상태 아이콘은 아래 방향(180° 회전), 말풍선 "펼치기"', getComputedStyle(cbtn.querySelector('svg')).transform !== 'none' && cbtn.dataset.tip === '리본 펼치기', getComputedStyle(cbtn.querySelector('svg')).transform);
  await shot('a01_ribbon_collapsed');
  await clickEl(cbtn, 400);
  check('2. 다시 누르면 펼침', !$('#ribbon').classList.contains('collapsed') && cbtn.dataset.tip === '리본 접기');
  check('2. 죽은 규칙 정리', cssRuleText('.ribbon.collapsed + * .rb-collapse') === null);

  // 3. 좁은 창: 파일 단추 셋 다 같은 규칙
  const narrow = innerWidth <= 1420;
  const fs = (id) => parseFloat(getComputedStyle($(id)).fontSize);
  check(`3. 파일 단추 글자 숨김이 같은지(창 ${innerWidth}px)`, narrow ? fs('#saveBtn') === 0 && fs('#saveMyTplTopBtn') === 0 && fs('#pdfBtn') === 0 : fs('#saveMyTplTopBtn') > 0 && fs('#saveBtn') > 0, `${fs('#saveBtn')} ${fs('#saveMyTplTopBtn')} ${fs('#pdfBtn')}`);
  check('3. 도구 막대가 창 안에 들어감', $('#exportBtn').getBoundingClientRect().right <= innerWidth && $('#ribbonCollapseBtn').getBoundingClientRect().right <= innerWidth, `${Math.round($('#ribbonCollapseBtn').getBoundingClientRect().right)} / ${innerWidth}`);
  await shot('a02_editor');

  // 4. 폴더 경로가 뒤집히지 않음
  await clickEl($('#sourceTabMybox'), 900);
  const node = $('#myboxPathText');
  const tn = node.firstChild;
  const at = (i) => { const rg = document.createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + 1); return rg.getBoundingClientRect().left; };
  const t = tn.textContent;
  check('4. MYBOX 경로 "/ (루트)"가 왼쪽부터 순서대로', t.includes('/ (루트)') && at(t.indexOf('/')) < at(t.indexOf('(')), `${JSON.stringify(t)} /=${Math.round(at(t.indexOf('/')))} (=${Math.round(at(t.indexOf('(')))}`);
  check('4. 경로 칸은 긴 경로 앞을 줄이는 방식 유지(rtl)', getComputedStyle(node).direction === 'rtl');
  await shot('a03_mybox_path');
  await clickEl($('#sourceTabLocal'), 300);
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  const ft = $('#folderPathText').firstChild.textContent;
  check('4. 내 컴퓨터 경로도 같은 방식(첫 글자가 /)', ft.replace(/[⁦⁩]/g, '').startsWith('/') && $('#folderPathText').title.startsWith('/'), ft.slice(0, 40));

  // 5. 색 토큰
  const root = getComputedStyle(document.documentElement);
  check('5. 새 토큰(ok·danger·warn·mine·folder)', ['--ok-soft', '--ok-border', '--danger-border', '--danger-ink', '--warn-ink', '--mine', '--mine-soft', '--repeat-rgb', '--folder'].every((k) => root.getPropertyValue(k).trim()));
  check('5. 자르기 틀·끌어 놓기 색이 현재 강조색', /var\(--accent\)/.test(cssRuleText('.crop-selection') || '') && /accent-soft/.test(cssRuleText('.photo-slot.drag-over') || ''));
  check('5. 의미 구분색은 그대로(폴더 주황)', getComputedStyle($('#photoGrid .folder-item .i')).color === 'rgb(217, 119, 6)');

  // 6. 열 수 아이콘 = 선 아이콘
  const segSvg = $('#photoColsSeg button svg');
  check('6. 열 수 아이콘이 선 아이콘(stroke 1.7, 채움 없음)', getComputedStyle(segSvg).fill === 'none' && getComputedStyle(segSvg).strokeWidth === '1.7px', `${getComputedStyle(segSvg).fill} ${getComputedStyle(segSvg).strokeWidth}`);
  const sizes = new Set($$('svg').filter((s) => s.getBoundingClientRect().width > 0 && !s.closest('.photo-empty') && !s.closest('.pv-page') && !s.closest('.work-ico') && !s.closest('.card-art')).map((s) => Math.round(parseFloat(getComputedStyle(s).width))));
  check('6. 보이는 아이콘 크기가 14/16/18/22 안', [...sizes].every((z) => [14, 16, 18, 22].includes(z)), [...sizes].join(','));

  // 7. 초점 링·커서·비활성 대비
  check('7. 누를 수 있는 칸들에 초점 링 규칙(안쪽 2px 강조색)', /inset/.test(cssRuleText('.sheet-tab:focus-visible, .photo-slot:focus-visible, .photo-item:focus-visible, .photo-area-empty:focus-visible, .af-folder:focus-visible, .suggest-item:focus-visible, .suggest-item.on, .layout-grid i:focus-visible') || '') && /var\(--accent\)/.test(cssRuleText('.sheet-tab:focus-visible, .photo-slot:focus-visible, .photo-item:focus-visible, .photo-area-empty:focus-visible, .af-folder:focus-visible, .suggest-item:focus-visible, .suggest-item.on, .layout-grid i:focus-visible') || ''), cssRuleText('.sheet-tab:focus-visible, .photo-slot:focus-visible, .photo-item:focus-visible, .photo-area-empty:focus-visible, .af-folder:focus-visible, .suggest-item:focus-visible, .suggest-item.on, .layout-grid i:focus-visible'));
  check('7. 사진을 끄는 동안 grabbing', /grabbing/.test(cssRuleText('.photo-item:active') || ''));
  // [9.3 R1] 사진 패널 메뉴의 비활성 안내 항목은 없앰 → 첫 블록 행 메뉴의 [위로 옮기기](비활성)로 확인
  $$('.pv-page tr[data-b]').find((t) => !t.querySelector('.photo-slot')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 300 })); await sleep(300);
  const dis = $('.ctx-menu .ctx-item:disabled');
  check('7. 비활성 메뉴 항목은 투명도 1(색으로만 흐림)', dis && getComputedStyle(dis).opacity === '1', dis && getComputedStyle(dis).opacity);
  await shot('a04_ctx');
  closeContextMenu();

  // 8. [2026-11-27] 키보드 초점: tabindex + 진짜 Tab 순회 + Enter/Space(기존 클릭 동작)
  const ae = () => document.activeElement;
  const ring = (n) => !!n && n.matches(':focus-visible') && /inset/.test(getComputedStyle(n).boxShadow) && /2px/.test(getComputedStyle(n).boxShadow);
  const tabTo = async (pred, max = 400) => { for (let i = 0; i < max; i++) { if (ae() && pred(ae())) return ae(); await pressKey('Tab', [], 35); } return null; };
  check('8. tabindex=0: 시트 탭·사진 카드·빈 사진 자리', [...$$('.sheet-tab'), ...$$('#photoGrid .photo-item'), ...$$('.photo-area-empty')].every((n) => n.getAttribute('tabindex') === '0') && $$('.photo-area-empty').length > 0, `${$$('.sheet-tab').length}/${$$('#photoGrid .photo-item').length}/${$$('.photo-area-empty').length}`);
  ae().blur();
  let f = await tabTo((n) => n.classList.contains('sheet-tab'));
  check('8. Tab → 시트 탭에 초점·링', ring(f), f && getComputedStyle(f).boxShadow);
  await shot('a05_focus_sheettab');
  await pressKey('Enter', [], 500);
  check('8. 시트 탭 Enter → 그 시트로, 초점 유지', state.activeSheetIdx === 0 && ae().classList.contains('sheet-tab'), `${state.activeSheetIdx} ${ae().className}`);
  await pressKey('Tab'); await pressKey('Space', [], 600);
  check('8. 다음 탭 Space → 시트 2', state.activeSheetIdx === 1 && ae().classList.contains('sheet-tab') && ring(ae()), `${state.activeSheetIdx} ${ae().className}`);
  f = await tabTo((n) => n.classList.contains('photo-area-empty'));
  check('8. Tab → 빈 사진 자리에 초점·링', ring(f), f && getComputedStyle(f).boxShadow);
  await shot('a06_focus_area');
  await pressKey('Enter', [], 500);
  check('8. 빈 사진 자리 Enter → 선택(배치 고르기 보임)', !!state.selectedPhotoArea && $$('.layout-grid i').length === 25, $$('.layout-grid i').length);
  check('8. 배치 칸 tabindex=0', $$('.layout-grid i').length > 0 && $$('.layout-grid i').every((n) => n.getAttribute('tabindex') === '0'));
  f = await tabTo((n) => n.matches('.layout-grid i[data-c="2"][data-r="1"]'));
  check('8. Tab → 배치 칸(2×1)에 초점·링, 크기 표시', ring(f) && /2×1/.test($('.lg-label').textContent), `${f && getComputedStyle(f).boxShadow} ${$('.lg-label') && $('.lg-label').textContent}`);
  await shot('a07_focus_layout');
  await pressKey('Enter', [], 700);
  const slots = () => $$('.pv-page .photo-slot');
  check('8. 배치 칸 Enter → 2칸 생김', slots().length >= 2, slots().length);
  check('8. 사진 자리 tabindex=0', slots().length > 0 && slots().every((n) => n.getAttribute('tabindex') === '0'));
  f = await tabTo((n) => n.classList.contains('photo-slot'));
  check('8. Tab → 사진 자리에 초점·링', ring(f), f && getComputedStyle(f).boxShadow);
  await pressKey('Enter', [], 600);
  check('8. 사진 자리 Enter → 선택, 초점 유지', !!state.selectedPhotoSlot && ae().classList.contains('photo-slot') && ae().classList.contains('selected-slot'), `${JSON.stringify(state.selectedPhotoSlot)} ${ae().className}`);
  await shot('a08_focus_slot');
  f = await tabTo((n) => n.classList.contains('photo-item'));
  await sleep(250); // 사진 카드는 box-shadow 전환(.12s)이 있어 끝난 뒤에 잰다
  check('8. Tab → 사진 카드에 초점·링', ring(f), f && getComputedStyle(f).boxShadow);
  await shot('a09_focus_photo');
  const imgs0 = $$('.pv-page .photo-slot img').length;
  await pressKey('Enter', [], 1500);
  check('8. 사진 카드 Enter → 고른 자리에 넣음', $$('.pv-page .photo-slot img').length === imgs0 + 1, `${imgs0} → ${$$('.pv-page .photo-slot img').length}`);

  await clickEl($('#autoFillBtn'), 600);
  const afRows = $$('.af-folder');
  check('8. 폴더 행 tabindex=0, 안의 체크칸은 차례에서 뺌', afRows.length > 0 && afRows.every((n) => n.getAttribute('tabindex') === '0' && n.querySelector('input').tabIndex === -1), afRows.length);
  f = await tabTo((n) => n.classList.contains('af-folder'), 80);
  check('8. Tab → 폴더 행에 초점·링', ring(f), f && getComputedStyle(f).boxShadow);
  await shot('a10_focus_afolder');
  await pressKey('Space', [], 200);
  check('8. 폴더 행 Space → 체크 풀림(aria-checked도)', !!f && !f.querySelector('input').checked && f.getAttribute('aria-checked') === 'false');
  await pressKey('Space', [], 200);
  check('8. 다시 Space → 체크', !!f && f.querySelector('input').checked && f.getAttribute('aria-checked') === 'true');
  { const m = document.querySelector('.dyn-modal'); if (m) m.parentNode.removeChild(m); }
  await sleep(200);

  rememberValue('__qa_focus', '현관 바닥');
  rememberValue('__qa_focus', '거실 벽');
  const inp = document.createElement('input');
  inp.style.cssText = 'position:fixed;left:400px;top:300px;width:200px';
  document.body.appendChild(inp);
  let picked = 0;
  attachSuggest(inp, '__qa_focus', () => { picked++; });
  inp.focus(); await sleep(200);
  check('8. 제안 항목 tabindex=0', $$('.suggest-item').length === 2 && $$('.suggest-item').every((n) => n.getAttribute('tabindex') === '0'), $$('.suggest-item').length);
  await pressKey('Down', [], 200);
  const on = $('.suggest-item.on');
  check('8. ↓로 고른 제안에 같은 링(입력칸 초점 유지)', !!on && /inset/.test(getComputedStyle(on).boxShadow) && ae() === inp, on && getComputedStyle(on).boxShadow);
  await shot('a11_focus_suggest');
  $$('.suggest-item')[1].focus(); await sleep(150);
  check('8. 제안 항목에 초점이 가도 목록이 닫히지 않음', ae().classList.contains('suggest-item') && ring(ae()), ae().className);
  await pressKey('Enter', [], 300);
  check('8. 제안 항목 Enter → 그 값으로', inp.value === '현관 바닥' && picked === 1 && !$('.suggest-box'), `${inp.value} ${picked}`);
  inp.parentNode.removeChild(inp);
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
