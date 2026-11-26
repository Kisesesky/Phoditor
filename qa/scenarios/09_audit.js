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
  check('7. 누를 수 있는 칸들에 초점 링 규칙', /outline/.test(cssRuleText('.sheet-tab:focus-visible, .photo-slot:focus-visible, .photo-item:focus-visible, .photo-area-empty:focus-visible, .af-folder:focus-visible, .suggest-item:focus-visible, .layout-grid i:focus-visible') || ''));
  check('7. 사진을 끄는 동안 grabbing', /grabbing/.test(cssRuleText('.photo-item:active') || ''));
  $('#photoGrid .photo-item').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 500 })); await sleep(300);
  const dis = $('.ctx-menu .ctx-item:disabled');
  check('7. 비활성 메뉴 항목은 투명도 1(색으로만 흐림)', dis && getComputedStyle(dis).opacity === '1', dis && getComputedStyle(dis).opacity);
  await shot('a04_ctx');
  closeContextMenu();
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
