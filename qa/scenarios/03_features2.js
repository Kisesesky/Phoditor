// 2순위까지 새 기능: 자동 채우기·실행 취소·블록 이동/복제·표 붙여넣기·자동완성·돌리기·크게 보기·필터·목차 채우기·저장/열기·자동 저장
const openTpl = async (type, company) => {
  if ($('#editorView').classList.contains('active')) await clickEl($('#backToCatalogBtn'), 600);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === type), 200);
  const card = $$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === company);
  await clickEl(card, 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
};
const tabByName = (n) => $$('#sheetTabsBar .sheet-tab').find((t) => t.querySelector('span') && t.querySelector('span').textContent === n);
const blocks = () => new Set($$('.pv-page td[data-b]').map((t) => t.dataset.b)).size;
const relCell = (rel, b) => $(`.pv-page td[data-rel="${rel}"][data-b="${b}"]`);
const slotImgs = () => $$('.pv-page .photo-slot img').map((i) => i.alt);
const insp = () => $('#inspKicker').textContent + ' / ' + $('#inspTitle').textContent;
const modalBtn = (txt) => $$('.dyn-modal button').find((b) => b.textContent.trim() === txt);
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await sleep(600);
  check('시작 화면: 최근 작업 영역', !!$('#workTabs') && $('#workTabs').textContent.includes('최근 작업'));
  await openTpl('공용홀', '롯데');
  await clickEl(tabByName('1.외관'), 700);
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);

  // 1. 사진 자동 채우기
  await clickEl($('#autoFillBtn'), 400);
  check('자동 채우기 창', !!$('.dyn-modal') && $('.dyn-modal').textContent.includes('안 넣은 사진 5장'), $('.dyn-modal') && $('.dyn-modal .insp-note').textContent);
  await clickEl($('.dyn-modal [data-v="photos"]'), 200); // 하위 폴더가 있으면 폴더별이 기본 → 이 확인은 '지금 보이는 사진'
  await clickEl(modalBtn('채우기'), 2500);
  check('사진 5장 → 블록 5개 자동 추가', blocks() === 5 && slotImgs().length === 5, `blocks=${blocks()} imgs=${slotImgs().length} ${toastText()}`);
  check('이름순으로 들어감', slotImgs()[0].startsWith('landscape') && slotImgs()[1].startsWith('portrait'), slotImgs().join(','));
  await shot('f01_autofill');

  // 2. 실행 취소 / 다시 실행
  await clickEl($('#undoBtn'), 800);
  check('실행 취소 → 블록 1개, 사진 없음', blocks() === 1 && slotImgs().length === 0, `${blocks()} ${slotImgs().length} ${toastText()}`);
  await clickEl($('#redoBtn'), 800);
  check('다시 실행 → 블록 5개', blocks() === 5 && slotImgs().length === 5);

  // 3. 블록 이동·복제
  const tdInBlock = (b) => $(`.pv-page tr[data-b="${b}"]`);
  tdInBlock(0).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await sleep(300);
  check('블록 1 선택', insp().includes('블록 1 / 5'), insp());
  await clickEl($('#moveDownBtn'), 700);
  check('↓ 아래로: 1·2번 사진 순서 바뀜', slotImgs()[0].startsWith('portrait') && slotImgs()[1].startsWith('landscape'), slotImgs().join(','));
  await clickEl($('#dupBlockBtn'), 700);
  check('복제 → 블록 6개(사진 포함)', blocks() === 6 && slotImgs().length === 6, `${blocks()} ${slotImgs().length}`);
  await clickEl($('#undoBtn'), 600);
  await clickEl($('#undoBtn'), 600);
  check('두 번 되돌리기 → 원래 순서', blocks() === 5 && slotImgs()[0].startsWith('landscape'), slotImgs().join(','));

  // 4. 표 붙여넣기
  await clickEl($('#pasteTableBtn'), 400);
  const ta = $('.dyn-modal textarea');
  ta.value = '공종\t품목\t메모\n건축\t바닥 타일\tx\n설비\t양변기\ty\n전기\t조명\tz';
  ta.dispatchEvent(new Event('input')); await sleep(300);
  const selVals = $$('.dyn-modal .paste-col select').map((s) => s.value);
  check('제목 줄 자동 맞춤(공종·품목, 메모는 넣지 않음)', selVals[0] && selVals[1] && selVals[2] === '', selVals.join('|'));
  const startBtns = $$('.dyn-modal .seg-sm button');
  await clickEl(startBtns.find((b) => b.textContent === '처음부터'), 100);
  await clickEl(modalBtn('채우기'), 800);
  check('블록 1~3에 공종·품목 채움', relCell('L{+3}', 0) && relCell('L{+3}', 0).textContent === '건축' && relCell('L{+4}', 2).textContent === '조명', `${relCell('L{+3}', 0) && relCell('L{+3}', 0).textContent} / ${relCell('L{+4}', 2) && relCell('L{+4}', 2).textContent}`);

  // 5. 자동완성
  const c4 = relCell('L{+3}', 3);
  c4.click(); await sleep(250);
  const ed = c4.querySelector('.cell-editor-input');
  ed.value = '건'; ed.dispatchEvent(new Event('input')); await sleep(250);
  check('자동완성 목록에 "건축"', $$('.suggest-item').some((x) => x.textContent === '건축'), $$('.suggest-item').map((x) => x.textContent).join('|'));
  await shot('f02_suggest');
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await sleep(100);
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(500);
  check('자동완성 고르면 입력됨', relCell('L{+3}', 3).textContent === '건축', relCell('L{+3}', 3).textContent);

  // 6. 사진 돌리기·크게 보기
  $('.pv-page .photo-slot').click(); await sleep(500);
  await clickEl($('#rbRotateBtn'), 300);
  await waitFor(() => $('.pv-page .photo-slot img') && $('.pv-page .photo-slot img').alt.startsWith('[회전]'), 10000);
  const im = $('.pv-page .photo-slot img');
  await sleep(300);
  check('90° 돌림(가로 사진 → 세로)', im.alt.startsWith('[회전]') && im.naturalHeight > im.naturalWidth, `${im.alt} ${im.naturalWidth}x${im.naturalHeight}`);
  await clickEl($('#rbZoomBtn'), 600);
  check('크게 보기 창', !!$('.lightbox .lightbox-img'));
  await shot('f03_lightbox');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
  check('Esc로 닫힘', !$('.lightbox'));

  // 7. 사진 패널 필터
  await clickEl($('#photoFilterBtn'), 400);
  check('안 넣은 것만 → 모두 넣어서 0장', $$('#photoGrid .photo-item').length === 0 && $('#photoCountBadge').textContent.startsWith('0'), $('#photoCountBadge').textContent);
  await clickEl($('#photoFilterBtn'), 400);
  $('#photoSortTime').click(); await sleep(300);
  check('찍은 시간순 정렬', $$('#photoGrid .photo-item').length === 5);

  // 8. 저장 → 수정 → 자동 저장 → 시작 화면 → 최근 작업으로 다시 열기
  await clickEl($('#saveBtn'), 1200);
  check('저장', toastText().includes('저장했어요') && !$('#editorKicker').textContent.includes('수정됨'), `${toastText()} / ${$('#editorKicker').textContent}`);
  const c5 = relCell('L{+4}', 4);
  c5.click(); await sleep(200);
  const ed2 = c5.querySelector('.cell-editor-input');
  ed2.value = '저장 뒤 입력'; ed2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400);
  check('고치면 "수정됨" 표시', $('#editorKicker').textContent.includes('수정됨'), $('#editorKicker').textContent);
  await sleep(3200);
  const auto = await window.api.autosaveRead();
  check('자동 저장본 생김', auto && auto.editor && JSON.stringify(auto.editor).includes('저장 뒤 입력'));
  await clickEl($('#backToCatalogBtn'), 2000);
  check('나갈 때 물어봄 → 저장', confirms.some((m) => m.includes('저장하지 않은 작업')), confirms.slice(-1)[0]);
  await waitFor(() => $$('#workList .work-row').length > 0, 5000);
  const card = $$('#workList .work-row')[0];
  check('최근 작업 카드', !!card && card.textContent.includes('공용홀'), card && card.textContent);
  await clickEl(card, 3000);
  await waitFor(() => $('#editorView').classList.contains('active'), 8000);
  await clickEl(tabByName('1.외관'), 900);
  check('다시 열기: 블록 5개·사진 5장·입력값 그대로', blocks() === 5 && slotImgs().length === 5 && relCell('L{+4}', 4) && relCell('L{+4}', 4).textContent === '저장 뒤 입력', `${blocks()} ${slotImgs().length} ${relCell('L{+4}', 4) && relCell('L{+4}', 4).textContent}`);
  check('돌린 사진도 그대로', slotImgs()[0].startsWith('[회전]'), slotImgs()[0]);
  check('사진 폴더도 다시 열림', $$('#photoGrid .photo-item').length === 5);

  // 9. 목차 자동 채우기(준공 롯데)
  await openTpl('준공사진첩', '롯데');
  await clickEl(tabByName('공간별전경'), 700);
  await clickEl($('#pasteTableBtn'), 400);
  const ta2 = $('.dyn-modal textarea');
  ta2.value = '자재명\n거실 마루\n주방 타일';
  ta2.dispatchEvent(new Event('input')); await sleep(300);
  await clickEl(modalBtn('채우기'), 800);
  await clickEl(tabByName('목차'), 700);
  await clickEl($$('#inspBody button').find((b) => b.textContent === '목차 자동 채우기'), 800);
  const tocText = $$('.pv-page td').map((t) => t.textContent).join('|');
  check('목차에 시트 이름·품목 채움', tocText.includes('공간별전경') && tocText.includes('거실 마루') && tocText.includes('주방 타일'), tocText.slice(0, 200));
  await shot('f04_toc');

  // 10. 내보내기
  await clickEl($('#exportBtn'), 300); await waitFor(() => $('#exportGoBtn')); await clickEl($('#exportGoBtn'), 300);
  const t = await waitFor(() => (toastText().includes('저장 완료') || toastText().includes('실패') ? toastText() : null), 60000);
  check('내보내기 성공', t && t.includes('저장 완료'), t);
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
