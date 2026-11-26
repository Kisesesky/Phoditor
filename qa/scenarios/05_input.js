// B: 칸 이동(Enter·Tab·⇧Tab), 다른 칸 누를 때 클릭 유지, 목차 자동 맞춤, 반복값 안내 한 번만
const openTpl = async (type, company) => {
  if ($('#editorView').classList.contains('active')) await clickEl($('#backToCatalogBtn'), 600);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === type), 200);
  await clickEl($$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === company), 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
};
const tabByName = (n) => $$('#sheetTabsBar .sheet-tab').find((t) => t.querySelector('span') && t.querySelector('span').textContent === n);
const editorTd = () => { const ta = $('.cell-editor-input'); return ta ? ta.parentElement : null; };
const idOf = (td) => (td ? td.dataset.addr || `${td.dataset.rel}#${td.dataset.b}` : null);
const key = (k, extra = {}) => { const ta = $('.cell-editor-input'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })); };
const modalBtn = (txt) => $$('.dyn-modal button').find((b) => b.textContent.trim() === txt);
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await openTpl('공용홀', '롯데');
  await clickEl(tabByName('1.외관'), 700);
  const cells = () => $$('.pv-page td.editable-cell').filter((t) => t.dataset.addr || t.dataset.rel);

  // 1. Enter: 저장하고 다음 칸
  const c0 = cells()[0];
  const id0 = idOf(c0);
  c0.click(); await sleep(200);
  $('.cell-editor-input').value = '첫 칸';
  key('Enter'); await sleep(400);
  const order = cells().map(idOf);
  check('Enter → 저장하고 다음 칸이 열림', idOf(editorTd()) === order[order.indexOf(id0) + 1] && cells().find((t) => idOf(t) === id0).textContent.includes('첫 칸'), `${idOf(editorTd())} / ${order.slice(0, 3)}`);
  // 2. Tab → 다음, ⇧Tab → 앞
  const before = idOf(editorTd());
  $('.cell-editor-input').value = '둘째';
  key('Tab'); await sleep(400);
  check('Tab → 다음 칸', idOf(editorTd()) === order[order.indexOf(before) + 1], idOf(editorTd()));
  key('Tab', { shiftKey: true }); await sleep(400);
  check('⇧Tab → 앞 칸(입력한 값 유지)', idOf(editorTd()) === before && $('.cell-editor-input').value === '둘째', `${idOf(editorTd())} ${$('.cell-editor-input') && $('.cell-editor-input').value}`);
  // 3. ⌘Enter → 저장하고 그대로(편집 끝)
  key('Enter', { metaKey: true }); await sleep(400);
  check('⌘Enter → 저장하고 다음 칸으로 가지 않음', !$('.cell-editor-input'));
  // 4. 편집 중에 다른 칸을 누르면(마우스) 그 칸이 바로 열림
  const a = cells()[0];
  a.click(); await sleep(200);
  $('.cell-editor-input').value = '바꿈';
  const target = cells()[4];
  const targetId = idOf(target);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  // 실제 마우스는 이때 초점이 옮겨 가며 blur가 생긴다(시험 창은 뒤에 떠 있어 blur()가 안 먹으므로 직접 보냄)
  $('.cell-editor-input').dispatchEvent(new FocusEvent('blur'));
  await sleep(500);
  check('편집 중 다른 칸을 누르면 저장하고 그 칸이 열림', idOf(editorTd()) === targetId && cells()[0].textContent.includes('바꿈'), `${idOf(editorTd())} vs ${targetId} a=${idOf(a)} order=${cells().map(idOf).slice(0,6).join(',')}`);
  key('Escape'); await sleep(300);

  // 5. 반복값 안내는 처음 한 번만
  const rep = () => $('.pv-page td.repeated');
  rep().click(); await sleep(250);
  const first = toastText();
  key('Escape'); await sleep(300);
  $('#toast').textContent = '';
  rep().click(); await sleep(250);
  check('반복값 안내는 칸마다 처음 한 번만', first.includes('반복값 칸이에요') && !toastText().includes('반복값 칸이에요'), `${first.slice(0, 20)} / ${toastText().slice(0, 20)}`);
  key('Escape'); await sleep(300);

  // 6. 목차 자동 맞춤(준공 롯데)
  await openTpl('준공사진첩', '롯데');
  await clickEl(tabByName('공간별전경'), 700);
  await clickEl($('#pasteTableBtn'), 400);
  const ta = $('.dyn-modal textarea');
  ta.value = '자재명\n거실 마루\n주방 타일';
  ta.dispatchEvent(new Event('input')); await sleep(300);
  await clickEl(modalBtn('채우기'), 800);
  await clickEl(tabByName('목차'), 700);
  await clickEl($$('#inspBody button').find((b) => b.textContent === '목차 자동 채우기'), 800);
  check('목차 자동 맞춤 켜짐', $$('#inspBody .check-row input').some((i) => i.checked && i.parentElement.textContent.includes('목차도 자동')));
  await clickEl(tabByName('공간별전경'), 700);
  await clickEl($('#addBlockEndBtn'), 600);
  const lastBlock = Math.max(...$$('.pv-page td[data-b]').map((t) => +t.dataset.b));
  const nameCell = $$('.pv-page td.editable-cell').find((t) => t.dataset.b === String(lastBlock) && t.title && t.title.includes('자재명'));
  nameCell.click(); await sleep(200);
  $('.cell-editor-input').value = '욕실 수전';
  key('Enter', { metaKey: true }); await sleep(500);
  await clickEl(tabByName('목차'), 700);
  const toc = () => $$('.pv-page td').map((t) => t.textContent).join('|');
  check('블록을 추가하고 자재명을 적으면 목차에 저절로 들어감', toc().includes('욕실 수전') && toc().includes('거실 마루'), toc().slice(0, 160));
  // 블록은 모두 10개(공간별전경 3 + 다른 시트 7) → 목차 번호는 10까지만, 남는 줄(원래 =B4+1 수식)에는 번호가 없어야 함
  const nums = $$('.pv-page td').map((t) => t.textContent.trim()).filter((v) => /^\d+$/.test(v)).map(Number);
  check('목차 번호는 블록 수(10)까지만, 남는 줄에는 번호 없음', Math.max(...nums) === 10, nums.slice(-5).join(','));
  // 목차 칸을 직접 고치면 자동 맞춤 꺼짐
  const tocItem = $$('.pv-page td.editable-cell').find((t) => t.textContent === '거실 마루');
  tocItem.click(); await sleep(200);
  $('.cell-editor-input').value = '거실 마루(직접)';
  key('Enter', { metaKey: true }); await sleep(500);
  check('목차 칸을 직접 고치면 자동 맞춤 꺼짐', toastText().includes('자동 맞춤을 껐어요') && !$$('#inspBody .check-row input').some((i) => i.checked && i.parentElement.textContent.includes('목차도 자동')), toastText());

  // 7. 내보내기(파일 이름은 report.json saveCalls로 확인)
  await clickEl($('#exportBtn'), 300); await waitFor(() => $('#exportGoBtn')); await clickEl($('#exportGoBtn'), 300);
  const t = await waitFor(() => (toastText().includes('저장 완료') || toastText().includes('실패') ? toastText() : null), 60000);
  check('목차를 채운 뒤에도 내보내기 성공', t && t.includes('저장 완료'), t);
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
