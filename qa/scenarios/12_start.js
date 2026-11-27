// [2026-11-27 9.3 R3] 시작 화면 = 작업 재개 화면: 최근 작업 우선 · 흐름 안내 · 내 양식 진입점 1곳 · 카드 [열기] · 도움말 탭
try {
  const order = (sel) => +getComputedStyle($(sel)).order;
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await sleep(600);

  // 최근 작업 없음 → 양식 줄이 위, 아래에 3단계 흐름 안내
  check('1. 최근 작업 없음 → 흐름 안내 표시(3단계)', !!$('#flowGuide') && $$('#flowGuide .flow-step').length === 3, $$('#flowGuide .flow-step').length);
  check('1. 흐름 안내: 실제 단추는 1단계에만(공백 양식으로 시작·작업 파일 열기), 진한 파랑 없음',
    $$('#flowGuide .flow-step')[0].querySelectorAll('button').length === 2 && !$$('#flowGuide .flow-step')[1].querySelector('button') && !$$('#flowGuide .flow-step')[2].querySelector('button') && !$('#flowGuide button.primary'));
  const gR = $('#flowGuide').getBoundingClientRect();
  check('1. 흐름 안내가 아래 빈 자리를 채움(화면 아래쪽까지)', gR.height >= 200 && gR.top > $('.tpl-strip-wrap').getBoundingClientRect().bottom, `${Math.round(gR.top)}~${Math.round(gR.bottom)} / ${innerHeight}`);
  check('1. 최근 작업 0건: 양식 줄이 위', !$('#homePage').classList.contains('recent-first') && order('.tpl-head') < order('.work-head'));
  await shot('t01_start_empty');

  // 내 양식 진입점 1곳: 종류 탭에는 '공백'만, 내 양식은 아래 목록 탭
  const tabNames = $$('#typeTabs .type-btn').map((b) => b.firstChild.textContent.trim());
  check('2. 내 양식 진입점 1곳: 종류 탭에 "내 양식" 없음, "공백" 있음', !tabNames.some((n) => /내 양식/.test(n)) && tabNames.includes('공백') && $$('#workTabs button').filter((b) => /내 양식/.test(b.textContent)).length === 1, tabNames.join(','));
  check('2. 양식 없는 종류(기타)는 탭에 없음', !tabNames.includes('기타'), tabNames.join(','));
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '공백'), 500);
  check('2. 공백 탭: 공백 양식 카드만', $$('#companyGrid .company-card').length === 1 && /공백 양식/.test($('#companyGrid').textContent));

  // 카드: [열기] 단추, 그림 배경 한 톤 진하게, 실무자 말
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '준공사진첩'), 500);
  const cards = $$('#companyGrid .company-card');
  check('3. 카드마다 [열기] 단추', cards.length > 0 && cards.every((c) => c.querySelector('.card-open') && c.querySelector('.card-open').textContent === '열기'));
  check('3. 카드 그림 배경 chrome-2(#EFEFF1)', getComputedStyle(cards[0].querySelector('.card-art')).backgroundColor === 'rgb(239, 239, 241)', getComputedStyle(cards[0].querySelector('.card-art')).backgroundColor);
  const metas = cards.map((c) => c.querySelector('.company-meta').textContent).join(' | ');
  check('3. 카드 설명에 블록·항목 같은 내부 말 없음, 잘리지 않음', !/블록|항목/.test(metas) && /사진 칸/.test(metas) && cards.every((c) => { const m = c.querySelector('.company-meta'); return m.scrollHeight <= m.clientHeight + 1; }), metas);
  // 그림 누르면 넘기기(열리지 않음), [열기]는 연다
  const art = cards[0].querySelector('.card-art');
  const r = art.getBoundingClientRect();
  art.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.right - 10, clientY: r.top + 40 })); await sleep(300);
  check('3. 그림 누르면 시트만 넘김(열리지 않음)', !$('#editorView').classList.contains('active'));
  await clickEl(cards[0].querySelector('.card-open'), 2200);
  await waitFor(() => $('#editorView').classList.contains('active'));
  check('3. [열기] → 편집 화면', $('#editorView').classList.contains('active'));

  // 도움말: 탭 2개(사용 흐름 | 단축키), 걷어낸 설명이 여기에
  await pressKey('?', ['shift'], 400);
  if (!$('.dyn-modal.sc-help')) { openShortcutHelp(); await sleep(300); }
  const help = $('.dyn-modal.sc-help');
  check('4. 도움말 창: 탭 2개(사용 흐름 | 단축키)', !!help && $$('.help-tabs button', help).map((b) => b.textContent).join('|') === '사용 흐름|단축키');
  check('4. 사용 흐름에 화면에서 걷어낸 설명(현장명·사진 칸 높이·문서 글꼴·1장 배치·원본 파일)', !!help && ['현장명', '사진 칸 높이', '문서 글꼴', '1장 배치', '원본 사진 파일은 바뀌지 않아요'].every((t) => $('#helpFlow').textContent.includes(t)));
  check('4. 처음엔 사용 흐름만(단축키 목록은 숨김)', getComputedStyle($('.sc-help .shortcut-list')).display === 'none');
  await shot('t03_help');
  await clickEl($$('.help-tabs button', help).find((b) => b.textContent === '단축키'), 200);
  check('4. 단축키 탭(사용 흐름은 숨김)', getComputedStyle($('#helpFlow')).display === 'none' && $$('.sc-help .sc-row').length >= 15 && getComputedStyle($('.sc-help .shortcut-list')).display !== 'none');
  { const m = $('.dyn-modal.sc-help'); (m.closest('.modal-backdrop') || m).remove(); }
  check('4. 편집 화면 상시 메모 정리(글꼴·높이 설명은 도움말로)', !/한꺼번에 바꿉|사진이 들어가는 행만/.test($('#inspBody').textContent));

  // 저장 → 시작 화면: 최근 작업이 위로, 흐름 안내는 사라짐
  await saveProject(true); await sleep(800);
  await goToStart(); await sleep(1200);
  check('5. 최근 작업 1건 → 최근 작업이 위, 새 사진첩 줄이 아래', $('#homePage').classList.contains('recent-first') && $('.work-head').getBoundingClientRect().top < $('.tpl-head').getBoundingClientRect().top && $$('#workList .work-row').length === 1);
  check('5. 최근 작업이 생기면 흐름 안내는 사라짐', !$('#flowGuide'));
  check('5. 자동 저장 복원 안내 자리는 맨 위 그대로', order('#recoverSlot') === 0 && $('#homePage').firstElementChild.id === 'recoverSlot');
  await shot('t02_start_recent');
  // 시작 화면에서도 ?로 같은 도움말
  await pressKey('?', ['shift'], 400);
  check('4. 시작 화면에서도 ?로 도움말', !!$('.dyn-modal.sc-help'));
  { const m = $('.dyn-modal.sc-help'); if (m) (m.closest('.modal-backdrop') || m).remove(); }
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
