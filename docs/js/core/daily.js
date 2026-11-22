// Daily challenge helpers. Uses the player's LOCAL calendar date (passed in — no Date.now here).
export const DAILY_EPOCH = { y: 2026, m: 11, d: 21 }; // Gridword #1

function dayNumber(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** @param {{y:number,m:number,d:number}} local date parts (month 1-12) */
export function dailyInfo({ y, m, d }) {
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const number = dayNumber(y, m, d) - dayNumber(DAILY_EPOCH.y, DAILY_EPOCH.m, DAILY_EPOCH.d) + 1;
  return { key, number, seed: `daily-${key}` };
}

/** Key of the day before `key` ('YYYY-MM-DD'). */
export function previousKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Local date parts from a JS Date (caller supplies the Date). */
export function localDateParts(date) {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

const LEN_EMOJI = { 3: '3️⃣', 4: '4️⃣', 5: '5️⃣', 6: '6️⃣', 7: '7️⃣', 8: '8️⃣', 9: '9️⃣' };

/**
 * Shareable text, e.g.
 * Gridword #12 🔤 31 words · 148 pts · best: STRANGE
 */
export function shareText({ number, words, points, best, found = [], totalCommon = 0, foundCommon = words, botsBeaten = null, botsTotal = 5, url = '' }) {
  const lines = [`Gridword #${number} 🔤 ${words} word${words === 1 ? '' : 's'} · ${points} pts${best ? ` · best: ${best.toUpperCase()}` : ''}`];
  if (found.length) {
    const byLen = {};
    for (const w of found) { const L = Math.min(9, w.length); byLen[L] = (byLen[L] || 0) + 1; }
    lines.push(Object.keys(byLen).sort((a, b) => a - b).map(L => `${LEN_EMOJI[L]}×${byLen[L]}`).join(' '));
  }
  if (totalCommon > 0) {
    const pct = Math.min(1, foundCommon / totalCommon);
    const filled = Math.round(pct * 10);
    lines.push('🟩'.repeat(filled) + '⬜'.repeat(10 - filled) + ` ${Math.round(pct * 100)}%`);
  }
  if (botsBeaten !== null) lines.push(`🤖 Beat ${botsBeaten}/${botsTotal} bots`);
  if (url) lines.push(url);
  return lines.join('\n');
}
