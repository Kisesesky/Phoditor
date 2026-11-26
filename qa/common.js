// 시나리오 공통 도우미 (렌더러에서 실행)
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const shot = async (name) => { await sleep(250); console.log('__QA_SHOT__:' + name); await sleep(700); };
const toastText = () => ($('#toast') ? $('#toast').textContent.trim() : '');
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); };
const confirms = [];
window.confirm = (m) => { confirms.push(m); return true; };
window.alert = (m) => { confirms.push('alert:' + m); };
const clickEl = async (el, wait = 300) => { if (!el) throw new Error('element not found'); el.click(); await sleep(wait); };
const byText = (sel, text) => $$(sel).find((e) => e.textContent.includes(text));
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } return null; };
const dragTo = async (srcEl, dstEl) => {
  const dt = new DataTransfer();
  srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  dstEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dstEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await sleep(400);
};
// 진짜 키 누름(하니스가 sendInputEvent로 보냄)
let qaKeyId = 0;
const pressKey = async (key, mods = [], wait = 60) => {
  const id = ++qaKeyId;
  console.log('__QA_KEY__:' + JSON.stringify({ key, mods, id }));
  const t = Date.now();
  while ((window.__qaKeyAck || 0) < id && Date.now() - t < 3000) await sleep(10);
  await sleep(wait);
};
