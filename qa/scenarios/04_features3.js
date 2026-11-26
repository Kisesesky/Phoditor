// 3순위: 사진 위 표시, 넘치는 글자 경고·칸 맞춤, 반복값 표시, 지난 현장 복제, 승인 표시, .pbook(사진 포함) 다시 열기
const openTpl = async (type, company) => {
  if ($('#editorView').classList.contains('active')) await clickEl($('#backToCatalogBtn'), 600);
  await clickEl($$('#typeTabs button').find((b) => b.firstChild.textContent.trim() === type), 200);
  await clickEl($$('#companyGrid .company-card').find((c) => c.querySelector('.company-name').textContent.trim() === company), 1800);
  await waitFor(() => $('#editorView').classList.contains('active'));
};
const tabByName = (n) => $$('#sheetTabsBar .sheet-tab').find((t) => t.querySelector('span') && t.querySelector('span').textContent === n);
const relCell = (rel, b) => $(`.pv-page td[data-rel="${rel}"][data-b="${b}"]`);
const modalBtn = (txt) => $$('.dyn-modal button').find((b) => b.textContent.trim() === txt);
const edit = async (td, v) => { td.click(); await sleep(200); const ta = td.querySelector('.cell-editor-input'); ta.value = v; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(500); };
const mouse = (target, type, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
try {
  await waitFor(() => $$('#companyGrid .company-card').length > 0);
  await openTpl('공용홀', '롯데');
  check('양식 정보: 승인됨 표시', $('#inspBody').textContent.includes('승인됨 (2026-11-25)'), $$('#inspBody dd').map((d) => d.textContent).join('|'));
  await clickEl(tabByName('1.외관'), 700);
  await clickEl($('#selectFolderBtn'), 2500);
  await waitFor(() => $$('#photoGrid .photo-item').length >= 5, 15000);
  await dragTo($$('#photoGrid .photo-item').find((p) => p.textContent.includes('landscape')), $('.photo-area-empty'));
  await sleep(1000);

  // 1. 반복값 표시
  check('반복값 칸 보라색 표시(↻)', !!$('.pv-page td.repeated'), $$('.pv-page td.repeated').length);
  $('.pv-page td.repeated').click(); await sleep(300);
  check('반복값 칸을 누르면 안내', toastText().includes('반복값 칸이에요'), toastText());
  const ed0 = $('.pv-page td.repeated .cell-editor-input');
  if (ed0) ed0.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);

  // 2. 넘치는 글자 경고 → 칸에 맞게 줄이기
  await edit(relCell('L{+4}', 0), '아주아주 긴 품목 이름이 들어가서 칸을 한참 넘치는 경우입니다 정말로 깁니다');
  await sleep(400);
  check('넘치는 글자 칸 표시', !!$('.pv-page td.overflow') && $('#overflowChip').classList.contains('visible'), $('#overflowChip').textContent);
  await shot('g01_overflow');
  const ov = relCell('L{+4}', 0);
  ov.click(); await sleep(250);
  const e1 = ov.querySelector('.cell-editor-input'); if (e1) e1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);
  const shrinkCb = $$('#inspBody .check-row input').find((i) => i.parentElement.textContent.includes('칸에 맞게'));
  check('속성 패널: 칸에 맞게 줄이기', !!shrinkCb);
  shrinkCb.checked = true; shrinkCb.dispatchEvent(new Event('change')); await sleep(600);
  const ov2 = relCell('L{+4}', 0);
  check('줄이면 글자가 작아지고, 너무 작게(60% 미만) 줄면 따로 경고', ov2.dataset.shrink === '1' && parseFloat(ov2.style.fontSize) < 14 && ov2.classList.contains('too-small') && $('#overflowChip').textContent.includes('너무 작게'), `${ov2.style.fontSize} ${ov2.className} ${$('#overflowChip').textContent.trim()}`);
  await edit(relCell('L{+4}', 0), '조금 긴 품목 이름입니다');
  const ov3 = relCell('L{+4}', 0);
  check('조금 긴 글은 줄여서 맞추고 경고 없음', ov3.dataset.shrink === '1' && !ov3.classList.contains('overflow'), `${ov3.style.fontSize} ${ov3.className}`);

  // 3. 사진 위 표시
  $('.pv-page .photo-slot').click(); await sleep(400);
  await clickEl($$('#inspBody button').find((b) => b.textContent.includes('사진 위 표시')), 800);
  const modal = $('.anno-modal');
  check('표시 편집 창', !!modal);
  await waitFor(() => $('.anno-edit-layer') && $('.anno-edit-layer').offsetWidth > 50, 5000);
  const layer = $('.anno-edit-layer');
  const r = layer.getBoundingClientRect();
  mouse(layer, 'mousedown', r.left + r.width * 0.2, r.top + r.height * 0.2);
  mouse(window, 'mousemove', r.left + r.width * 0.5, r.top + r.height * 0.5);
  mouse(window, 'mouseup', r.left + r.width * 0.5, r.top + r.height * 0.5);
  await sleep(200);
  modal.__setTool('text');
  mouse(layer, 'mousedown', r.left + r.width * 0.55, r.top + r.height * 0.7);
  await sleep(200);
  const tta = $('.anno-text-edit');
  tta.value = '균열 보수'; tta.dispatchEvent(new Event('blur')); await sleep(200);
  check('화살표·글상자 그림', modal.__items().length === 2 && modal.__items()[0].t === 'arrow' && modal.__items()[1].text === '균열 보수', JSON.stringify(modal.__items()).slice(0, 200));
  await shot('g02_anno_editor');
  await clickEl($('#annoDoneBtn'), 800);
  await sleep(500);
  check('사진 자리에 표시가 겹쳐 보임', !!$('.pv-page .anno-layer line') && $$('.pv-page .anno-layer .anno-text').some((t) => t.textContent === '균열 보수'));
  await shot('g03_anno_slot');
  await clickEl($('#undoBtn'), 600);
  check('되돌리면 표시 사라짐', !$('.pv-page .anno-layer'));
  await clickEl($('#redoBtn'), 600);
  check('다시 하면 표시 다시 보임', !!$('.pv-page .anno-layer'));
  // 표시가 있는 사진을 돌리면 표시도 같이 돈다: 화살표 시작점 (x,y) → (1-y, x)
  const lineRel = () => { const l = $('.pv-page .anno-layer line'); const L = $('.pv-page .anno-layer'); return l ? [l.x1.baseVal.value / L.offsetWidth, l.y1.baseVal.value / L.offsetHeight] : null; };
  const before = lineRel();
  $('.pv-page .photo-slot').click(); await sleep(400);
  await clickEl($$('#inspBody button').find((b) => b.textContent.includes('돌리기')), 300);
  await waitFor(() => $('.pv-page .photo-slot img') && $('.pv-page .photo-slot img').alt.startsWith('[회전]'), 10000);
  await sleep(800);
  const after = lineRel();
  check('사진을 돌리면 표시도 같이 돎', before && after && Math.abs(after[0] - (1 - before[1])) < 0.03 && Math.abs(after[1] - before[0]) < 0.03, `${before && before.map((v) => v.toFixed(2))} → ${after && after.map((v) => v.toFixed(2))}`);

  // 4. 저장(.pbook = 사진 포함) → 지난 현장 복제
  await clickEl($('#saveBtn'), 1500);
  check('저장: 사진 1장 포함', toastText().includes('사진 1장 포함'), toastText());
  await clickEl($('#backToCatalogBtn'), 1200);
  await waitFor(() => $$('#recentSection .recent-dup').length > 0, 5000);
  await clickEl($$('#recentSection .recent-dup')[0], 1200);
  const nameIn = $('.dyn-modal input[type=text]');
  nameIn.value = 'QA 새 현장';
  await clickEl($('#dupGoBtn'), 2500);
  await waitFor(() => $('#editorView').classList.contains('active'), 8000);
  check('복제: 새 현장명이 표지에', $$('.pv-page td').some((t) => t.textContent.includes('QA 새 현장')), $$('.pv-page td.field-cell').map((t) => t.textContent).join('|'));
  await clickEl(tabByName('1.외관'), 800);
  check('복제: 머리 행 현장명도 새 이름', $$('.pv-page td.field-cell').some((t) => t.textContent.includes('QA 새 현장')), $$('.pv-page td.field-cell').map((t) => t.textContent).join('|'));
  check('복제: 사진은 비고 글자는 남음', $$('.pv-page .photo-slot img').length === 0 && relCell('L{+4}', 0).textContent.includes('조금 긴'), `${$$('.pv-page .photo-slot img').length}`);
  check('복제: 저장 안 된 새 작업', $('#editorKicker').textContent.includes('저장 안 됨'), $('#editorKicker').textContent);

  // 5. 원래 작업 다시 열기(사진이 파일 안에서 풀려 나옴)
  await clickEl($('#backToCatalogBtn'), 1500);
  await waitFor(() => $$('#recentSection .recent-open').length > 0, 5000);
  const orig = $$('#recentSection .recent-open').find((b) => !b.textContent.includes('QA 새 현장')) || $$('#recentSection .recent-open')[0];
  await clickEl(orig, 3000);
  await clickEl(tabByName('1.외관'), 800);
  const img = $('.pv-page .photo-slot img');
  check('다시 열기: 사진·표시 그대로', !!img && !!$('.pv-page .anno-layer'), img && img.src.slice(0, 80));
} catch (err) { check('예외 없음', false, String(err && err.stack || err)); }
return { checks, confirms };
