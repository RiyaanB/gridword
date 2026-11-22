// Dictionary decoding + lookups. Pure; works in browser and Node.
// Packed format is produced by tools/build-dict.mjs (front-coded sorted list).

export class Dictionary {
  /** @param {string} packed contents of data/words.txt */
  constructor(packed) {
    const words = [];
    const common = [];
    let prev = '';
    let start = 0;
    const n = packed.length;
    while (start < n) {
      let end = packed.indexOf('\n', start);
      if (end === -1) end = n;
      if (end > start) {
        const code = packed.charCodeAt(start);
        const isCommon = code < 97;
        const p = code - (isCommon ? 65 : 97);
        const w = prev.slice(0, p) + packed.slice(start + 1, end);
        words.push(w);
        common.push(isCommon ? 1 : 0);
        prev = w;
      }
      start = end + 1;
    }
    this.words = words;
    this.common = Uint8Array.from(common);
    this.size = words.length;
  }

  /** First index i in [lo, hi) with words[i] >= s. */
  lowerBound(s, lo = 0, hi = this.words.length) {
    const w = this.words;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (w[mid] < s) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  indexOf(word) {
    const i = this.lowerBound(word);
    return i < this.words.length && this.words[i] === word ? i : -1;
  }

  has(word) { return this.indexOf(word.toLowerCase()) !== -1; }

  isCommon(word) {
    const i = this.indexOf(word.toLowerCase());
    return i !== -1 && this.common[i] === 1;
  }

  hasPrefix(prefix) {
    const i = this.lowerBound(prefix);
    return i < this.words.length && this.words[i].startsWith(prefix);
  }

  /**
   * Narrow [lo, hi) — the range of words starting with some prefix — to the
   * sub-range of words starting with `prefix` (which extends that prefix).
   * Returns [lo, hi] with lo === hi when empty.
   */
  narrow(prefix, lo, hi) {
    const a = this.lowerBound(prefix, lo, hi);
    // words starting with prefix are < prefix + '{' ('{' follows 'z')
    const b = this.lowerBound(prefix + '{', a, hi);
    return [a, b];
  }
}
