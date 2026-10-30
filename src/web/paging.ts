// Arayüz için saf yardımcılar (DOM'a dokunmaz; testlerle doğrulanır).

export interface PageInfo {
  from: number; // 1 tabanlı ilk sıra (sonuç yoksa 0)
  to: number;
  total: number;
  prevOffset: number | null;
  nextOffset: number | null;
  isLast: boolean;
  /** offset toplamın dışında (ör. elle yazılmış URL ya da veri azaldı) */
  outOfRange: boolean;
}

export function pageInfo(total: number, offset: number, limit: number): PageInfo {
  const outOfRange = total > 0 && offset >= total;
  const shown = outOfRange ? 0 : Math.max(0, Math.min(limit, total - offset));
  return {
    from: shown ? offset + 1 : 0,
    to: shown ? offset + shown : 0,
    total,
    prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    nextOffset: !outOfRange && offset + limit < total ? offset + limit : null,
    isLast: outOfRange || offset + limit >= total,
    outOfRange,
  };
}

/**
 * <input type="date"> değeri ("YYYY-MM-DD") için kullanıcının YEREL gününün başı ve sonu (UTC ISO).
 * tzOffsetMinutes: o günün Date#getTimezoneOffset() değeri (İstanbul −180, New York yaz saati 240).
 */
export function localDayBounds(day: string, tzOffsetMinutes: number): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(utcMidnight)) return null;
  const start = utcMidnight + tzOffsetMinutes * 60_000;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000 - 1).toISOString() };
}
