export const BANDIT_DIM = 6;

export function invert(m: number[]): number[] {
  const n = BANDIT_DIM;
  const a = m.slice();
  const inv = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) inv[i * n + i] = 1;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(a[r * n + c]) > Math.abs(a[piv * n + c])) piv = r;
    }
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t = a[c * n + k];
        a[c * n + k] = a[piv * n + k];
        a[piv * n + k] = t;
        const u = inv[c * n + k];
        inv[c * n + k] = inv[piv * n + k];
        inv[piv * n + k] = u;
      }
    }
    const d = a[c * n + c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r * n + c] / d;
      if (f === 0) continue;
      for (let k = 0; k < n; k++) {
        a[r * n + k] -= f * a[c * n + k];
        inv[r * n + k] -= f * inv[c * n + k];
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const d = a[i * n + i];
    if (Math.abs(d) < 1e-12) continue;
    for (let k = 0; k < n; k++) inv[i * n + k] /= d;
  }
  return inv;
}

export function solve(A: number[], b: number[]): number[] {
  const n = BANDIT_DIM;
  const m = A.slice();
  const rhs = b.slice();
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(m[r * n + c]) > Math.abs(m[piv * n + c])) piv = r;
    }
    if (piv !== c) {
      for (let k = c; k < n; k++) {
        const t = m[c * n + k];
        m[c * n + k] = m[piv * n + k];
        m[piv * n + k] = t;
      }
      const t = rhs[c];
      rhs[c] = rhs[piv];
      rhs[piv] = t;
    }
    const d = m[c * n + c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) m[r * n + k] -= f * m[c * n + k];
      rhs[r] -= f * rhs[c];
    }
  }
  return rhs.map((v, i) => {
    const d = m[i * n + i];
    return Math.abs(d) < 1e-12 ? 0 : v / d;
  });
}
