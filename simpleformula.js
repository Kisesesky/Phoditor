// [PDF 비교 수정 2026-11-25] 목차 차례 번호 수식(=B4+1 같은 "칸 ± 숫자")만 계산한다.
// 앱은 수식 계산 엔진이 없고, 내보낸 파일에 계산값이 없으면 Excel이 열 때 다시 계산한다는 보장이 없다.
// 그래서 이 꼴의 수식은 앱이 직접 계산해 계산값을 함께 저장한다. 다른 꼴의 수식은 건드리지 않는다(null).
// 같은 계산을 renderer.js(미리보기)에도 그대로 두었다. 고치면 두 곳을 같이 고친다.
const REF_PLUS = /^\s*=?\s*\$?([A-Z]{1,3})\$?(\d+)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/;

/**
 * @param {(addr:string)=>({formula?:string|null, value?:any}|null)} getCell
 * @param {string[]} formulaAddrs 계산할 수식 칸 주소들
 * @returns {Object<string, number>} 계산할 수 있었던 칸만 담은 결과
 */
function evaluateSimpleFormulas(getCell, formulaAddrs) {
  const memo = {};
  const visiting = new Set();
  const valueOf = (addr) => {
    if (addr in memo) return memo[addr];
    const c = getCell(addr) || {};
    if (c.formula) {
      if (visiting.has(addr)) return null;
      visiting.add(addr);
      const m = REF_PLUS.exec(c.formula);
      let out = null;
      if (m) {
        const base = valueOf(`${m[1]}${m[2]}`);
        if (base !== null) out = m[3] === '+' ? base + Number(m[4]) : base - Number(m[4]);
      }
      visiting.delete(addr);
      memo[addr] = out;
      return out;
    }
    const v = c.value;
    if (v === null || v === undefined || v === '') return 0; // Excel처럼 빈 칸은 0
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null; // 글자가 든 칸을 더하면 Excel도 오류라 계산하지 않는다
  };
  const res = {};
  for (const a of formulaAddrs) {
    const v = valueOf(a);
    if (v !== null) res[a] = v;
  }
  return res;
}

module.exports = { evaluateSimpleFormulas };
