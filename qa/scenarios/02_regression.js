// 예전 기능 회귀: 목차 번호 수식, 넣은 뒤 자르기·원본, 시트 이름 바꾸기, 페이지 단위(한신더휴 2블록/쪽), 머리 행 입력
const openTpl = async (type, company) => {
  if ($('#editorView').classList.contains('active')) await clickEl($('#backToCatalogBtn'), 400);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === type), 200);
  const card = $$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === company);
  await clickEl(card, 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
};
const tabs = () => $$('#sheetTabsBar .sheet-tab');
const tabByName = (n) => tabs().find((t) => t.querySelector('span') && t.querySelector('span').textContent === n);
const cellAt = (a) => $(`.pv-page td[data-addr="${a}"]`);
const edit = async (td, v) => { td.click(); await sleep(200); const ta = td.querySelector('.cell-editor-input'); ta.value = v; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400); };
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  // 1. 목차 번호
  await openTpl('준공사진첩', '롯데');
  await clickEl(tabByName('목차'), 700);
  check('목차 B5 = 1 (B4 비어 있음)', cellAt('B5') && cellAt('B5').textContent.trim() === '1', cellAt('B5') && cellAt('B5').textContent);
  await edit(cellAt('B4'), '5');
  check('B4=5 → B5=6, B6=7', cellAt('B5').textContent.trim() === '6' && cellAt('B6').textContent.trim() === '7', `${cellAt('B5').textContent}|${cellAt('B6').textContent}`);
  check('목차가 2쪽으로 나뉨(원본처럼)', $$('.pv-page').length === 2, $$('.pv-page').length);
  check('목차에 [object Object] 없음', !$$('.pv-page td').some((t) => t.textContent.includes('[object')));

  // 2. 시트 이름 바꾸기
  const t0 = tabs()[0];
  t0.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); await sleep(250);
  tabs()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })); await sleep(250);
  const inp = tabs()[0].querySelector('input.sheet-tab-rename');
  check('탭 더블클릭 → 이름 입력', !!inp);
  inp.value = '겉표지'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400);
  check('이름 바뀜', tabs()[0].querySelector('span').textContent === '겉표지');

  // 3. 넣은 뒤 자르기·원본
  await clickEl(tabByName('공간별전경'), 700);
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  const ph = (n) => $$('#photoGrid .photo-item').find((p) => p.textContent.includes(n));
  await dragTo(ph('landscape_3000'), $('.photo-area-empty'));
  await sleep(900);
  const slot = () => $('.pv-page .photo-slot');
  slot().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); await sleep(300);
  slot().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })); await sleep(1200);
  check('사진 자리 더블클릭 → 자르기 편집기', $('#cropModal').classList.contains('open'));
  await waitFor(() => $('#cropSelection').style.display === 'block', 5000);
  await clickEl($('#confirmCropBtn'), 2500);
  await waitFor(() => !$('#cropModal').classList.contains('open'), 8000);
  check('자른 사진(크롭 표시)', !!$('.pv-page .slot-uncrop-btn'));
  await clickEl($('.pv-page .slot-uncrop-btn'), 500);
  check('원본으로 되돌림', !$('.pv-page .slot-uncrop-btn') && !!$('.pv-page .photo-slot img'));
  // 사진 크기: 작은 사진도 자리에 맞게
  const r = slot().getBoundingClientRect();
  const ir = slot().querySelector('img').getBoundingClientRect();
  check('사진이 자리를 채움', ir.width >= r.width - 12 || ir.height >= r.height - 12, `${Math.round(ir.width)}x${Math.round(ir.height)} in ${Math.round(r.width)}x${Math.round(r.height)}`);

  // 4. 한신더휴 준공: 2블록마다 쪽 나눔
  await openTpl('준공사진첩', '한신더휴');
  await clickEl(tabs()[1], 700);
  for (let i = 0; i < 3; i++) await clickEl($('#addBlockEndBtn'), 500);
  check('한신더휴 블록 4개 → 2쪽', $$('.pv-page').length === 2, $$('.pv-page').length);

  // 5. 머리 행 입력(힐스테이트 사진첩: 현장명 칸 등)
  await openTpl('준공사진첩', '힐스테이트');
  await clickEl(tabByName('84㎡A사진첩'), 800);
  check('힐스테이트 글상자 "{{현장명}} - 84㎡A" 보임', $$('.pv-shape').some((x) => x.textContent.includes('84㎡A')), $$('.pv-shape').map((x) => x.textContent).join('|'));
  check('힐스테이트 머리 로고 2개', $$('.pv-page .pv-pic').length >= 2, $$('.pv-page .pv-pic').length);
  await shot('r01_hill');

  // 6. 내보내기
  await clickEl($('#exportBtn'), 300);
  const t = await waitFor(() => (toastText().includes('저장 완료') || toastText().includes('실패') ? toastText() : null), 60000);
  check('내보내기 성공', t && t.includes('저장 완료'), t);
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
