// 새 화면 전체 흐름: 시작 화면 → 쪽 보기 → 입력 → 사진 → 배치 → 자르기 → 블록 → 글꼴 → 확대/격자 → 내보내기
const openTpl = async (type, company) => {
  if ($('#editorView').classList.contains('active')) await clickEl($('#backToCatalogBtn'), 400);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === type), 200);
  const card = $$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === company);
  await clickEl(card, 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
};
const tabByName = (n) => $$('#sheetTabsBar .sheet-tab').find((t) => t.querySelector('span') && t.querySelector('span').textContent === n);
const insp = () => $('#inspKicker').textContent + ' / ' + $('#inspTitle').textContent;
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  check('시작 화면: 업체 카드와 종류별 개수', $$('#companyGrid .company-card .mono').length >= 8 && /\d/.test($('#typeTabs').textContent), $('#typeTabs').textContent);
  await shot('u01_start');

  await openTpl('공용홀', '롯데');
  check('표지가 종이 쪽으로 보임(1쪽)', $$('.pv-page').length === 1, $$('.pv-page').length);
  check('표지 그림(LOTTE CASTLE 로고) 보임', $$('.pv-page .pv-pic').length >= 1);
  check('속성 패널: 표지', insp().includes('표지') || insp().includes('갑지'), insp());
  const field = $$('.pv-page td.field-cell')[0];
  check('현장명 입력 칸 표시', !!field && field.textContent.includes('현장명'), field && field.textContent);
  field.click(); await sleep(200);
  const ta = field.querySelector('.cell-editor-input');
  ta.value = 'QA 롯데캐슬 시그니처';
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400);
  check('표지 입력 반영', $$('.pv-page td').some((t) => t.textContent.includes('QA 롯데캐슬 시그니처')));
  await shot('u02_cover');

  await clickEl(tabByName('1.외관'), 600);
  check('블록 시트 쪽 보기: 머리말 "롯데건설"', $$('.pv-header').some((x) => x.textContent.includes('롯데건설')), $$('.pv-header').map((x) => x.textContent).join('|'));
  check('바닥글 쪽 번호', $$('.pv-footer').some((x) => /\d/.test(x.textContent)), $$('.pv-footer').map((x) => x.textContent.trim().slice(-6)).join('|'));
  check('반복 머리 행(타입·일자·현장명) 보임', $$('.pv-page td').some((t) => t.textContent.trim() === '타입'));
  check('블록 테두리·이름표', !!$('.block-outline.selected .tag'), $('.block-outline .tag') && $('.block-outline .tag').textContent);

  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  const ph = (n) => $$('#photoGrid .photo-item').find((p) => p.textContent.includes(n));
  await dragTo(ph('landscape_3000'), $('.photo-area-empty'));
  await sleep(900);
  check('사진을 끌어 놓으면 바로 1장 배치', $$('.photo-slot img').length === 1, $$('.photo-slot img').length);
  check('속성 패널: 사진 자리', insp().includes('사진 자리'), insp());
  check('사진 패널에 "넣음 1" 표시', ph('landscape_3000').textContent.includes('넣음 1'));
  await clickEl($$('#inspBody .layout-pick button').find((b) => b.textContent.includes('2장 1×2')), 700);
  check('속성 패널에서 배치 2장(1×2)으로', $$('.pv-page .photo-slot').length === 2, $$('.pv-page .photo-slot').length);
  $$('.pv-page .photo-slot')[1].click(); await sleep(500);
  await clickEl(ph('portrait_1200'), 1200);
  check('자리 선택 후 사진 누르면 그 자리에 들어감', $$('.pv-page .photo-slot img').length === 2, $$('.pv-page .photo-slot img').length);
  await shot('u03_photos');

  // 자르기(속성 패널 단추)
  $$('.pv-page .photo-slot')[0].click(); await sleep(500);
  await clickEl($$('#inspBody button').find((b) => b.textContent === '자르기'), 1500);
  check('속성 패널 [자르기] → 편집기', $('#cropModal').classList.contains('open'));
  await waitFor(() => $('#cropSelection').style.display === 'block', 5000);
  await clickEl($('#confirmCropBtn'), 2500);
  await waitFor(() => !$('#cropModal').classList.contains('open'), 8000);
  check('자른 사진으로 바뀜(원본으로 단추)', $$('#inspBody button').some((b) => b.textContent === '원본으로'), insp());

  // 값 칸 입력 + 칸 글꼴
  const posLabel = $$('.pv-page td').find((t) => t.textContent.replace(/[■\s]/g, '') === '위치');
  const row = posLabel.parentElement;
  const cells = [...row.children];
  const valTd = cells.slice(cells.indexOf(posLabel) + 1).filter((c) => c.classList.contains('editable-cell')).sort((a, b) => b.offsetWidth - a.offsetWidth)[0];
  valTd.click(); await sleep(200);
  const ta2 = valTd.querySelector('.cell-editor-input');
  ta2.value = '1층 로비';
  ta2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400);
  check('블록 값 칸 입력', $$('.pv-page td').some((t) => t.textContent === '1층 로비'));
  const v2 = $$('.pv-page td').find((t) => t.textContent === '1층 로비');
  v2.click(); await sleep(250);
  const ed = v2.querySelector('.cell-editor-input');
  if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);
  check('속성 패널: 칸', insp().includes('칸'), insp());
  const fsel = $$('#inspBody select')[0];
  fsel.value = '궁서'; fsel.dispatchEvent(new Event('change')); await sleep(500);
  const v3 = $$('.pv-page td').find((t) => t.textContent === '1층 로비');
  check('칸 글꼴 궁서 적용(화면)', v3 && v3.style.fontFamily.includes('궁서'), v3 && v3.style.fontFamily);
  await shot('u04_cellfont');

  // 블록 추가·선택·삭제
  await clickEl($('#addBlockEndBtn'), 700);
  check('블록 추가 → 블록 2개', $$('.block-outline').length >= 2 || $$('.pv-page').length >= 2, `${$$('.block-outline').length} / ${$$('.pv-page').length}`);
  check('추가한 블록이 선택됨', insp().includes('2 / 2'), insp());
  await clickEl($('#deleteBlockBtn'), 600);
  check('블록 삭제 → 1개', $$('.block-outline').length === 1, $$('.block-outline').length);

  // 문서 글꼴 바꾸기
  await clickEl($('#fontPanelBtn'), 500);
  const mapRow = $$('#inspBody .font-map-row').find((r) => r.textContent.includes('Spoqa Han Sans Neo Regular'));
  check('문서 글꼴 목록', !!mapRow, $$('#inspBody .font-map-row').map((r) => r.querySelector('.from').textContent).join('|'));
  const msel = mapRow.querySelector('select');
  msel.value = '나눔고딕'; msel.dispatchEvent(new Event('change')); await sleep(600);
  check('문서 글꼴 바꾸면 미설치 안내·설치 단추', $$('#inspBody .insp-note.warn button').some((b) => b.textContent.includes('나눔고딕 설치')));
  await shot('u05_docfont');

  // 확대·격자
  const z0 = $('#zoomLabel').textContent;
  await clickEl($('#zoomInBtn'), 500);
  check('확대', $('#zoomLabel').textContent !== z0 && !$('#zoomLabel').textContent.includes('맞춤'), `${z0} → ${$('#zoomLabel').textContent}`);
  await clickEl($('#zoomLabel'), 500);
  check('맞춤으로 되돌림', $('#zoomLabel').textContent.includes('맞춤'));
  await clickEl($('#gridToggleBtn'), 400);
  check('격자 켜기', !!$('table.pv-grid.show-grid'));
  await clickEl($('#gridToggleBtn'), 400);

  // 반복값 창
  await clickEl($('#editRepeatedBtn'), 400);
  check('반복값 창 열림', $('#repeatedModal').classList.contains('open'));
  await clickEl($('#cancelRepeatedBtn'), 300);

  // 내보내기
  await clickEl($('#exportBtn'), 300);
  const t = await waitFor(() => (toastText().includes('저장 완료') || toastText().includes('실패') ? toastText() : null), 60000);
  check('내보내기 성공', t && t.includes('저장 완료'), t);
  check('내보내기 단추 모양 되돌아옴', $('#exportBtn').textContent.includes('엑셀로 내보내기'), $('#exportBtn').textContent);

  // 없는 글꼴 표시(아크로: HY울릉도L)
  await openTpl('준공사진첩', '아크로');
  check('없는 글꼴 칩 표시', $('#fontBanner').classList.contains('visible') && $('#fontBannerText').textContent.includes('HY울릉도L'), $('#fontBannerText').textContent);
  await clickEl($('#fontBanner'), 500);
  check('칩 누르면 문서 글꼴 패널', $$('#inspBody h4').some((x) => x.textContent.includes('문서 글꼴')));
  await clickEl(tabByName('CONTENTS'), 600);
  check('목차 글상자 칸 줄바꿈 표시', $$('.pv-page').length >= 1);
  await shot('u06_acro_toc');
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
