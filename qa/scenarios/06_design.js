// C: 쪽 이동 막대, [채우기] 메뉴, 표지 미리보기
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await waitFor(() => $$('#companyGrid .card-art img.cover-thumb').length >= 6, 4000);
  await shot('d01_start');
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === '준공사진첩'), 200);
  await clickEl($$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === '힐스테이트'), 1800);
  const tab = $$('#sheetTabsBar .sheet-tab').find((t) => t.querySelector('span').textContent === '84㎡A사진첩');
  await clickEl(tab, 700);
  for (let i = 0; i < 5; i++) await clickEl($('#addBlockEndBtn'), 300);
  const rail = () => $$('#pageRail .rail-item');
  check('쪽 이동 막대: 쪽마다 버튼(6쪽)', rail().length === $$('.pv-page').length && rail().length === 6, `${rail().length} / ${$$('.pv-page').length}`);
  check('블록 시트는 블록 번호도 표시', rail()[2].textContent.includes('#3'), rail()[2].textContent);
  rail()[4].click(); await sleep(900);
  const r5 = $$('.pv-page')[4].getBoundingClientRect();
  const vp = $('#gridViewport').getBoundingClientRect();
  check('누르면 그 쪽으로 이동하고 표시됨', Math.abs(r5.top - vp.top) < 120 && rail()[4].classList.contains('on'), `${Math.round(r5.top - vp.top)} ${rail().findIndex((b) => b.classList.contains('on'))}`);
  // [채우기] 메뉴
  check('채우기 메뉴는 처음엔 닫힘', $('#fillMenu').hidden);
  await clickEl($('#fillMenuBtn'), 300);
  check('누르면 열림(사진 자동 채우기·표 붙여넣기)', !$('#fillMenu').hidden && $('#fillMenu').textContent.includes('사진 자동 채우기') && $('#fillMenu').textContent.includes('표 붙여넣기'));
  await shot('d02_fillmenu');
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(200);
  check('바깥을 누르면 닫힘', $('#fillMenu').hidden);
  await clickEl($('#fillMenuBtn'), 300);
  await clickEl($('#pasteTableBtn'), 400);
  check('메뉴에서 표 붙여넣기 → 창 열리고 메뉴 닫힘', !!$('.dyn-modal textarea') && $('#fillMenu').hidden);
  $('.dyn-modal').remove();
  await clickEl($$('#sheetTabsBar .sheet-tab')[0], 600);
  check('표지(1쪽)도 막대에 1', rail().length === 1);
  check('표지에서는 채우기 단추가 꺼짐', $('#fillMenuBtn').disabled);
  await shot('d03_editor');
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
