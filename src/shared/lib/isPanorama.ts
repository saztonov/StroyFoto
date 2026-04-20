/**
 * Эвристика: equirectangular-панорама (Ricoh Theta, Insta360 и т.п.) всегда
 * имеет соотношение сторон 2:1. Нижний порог width >= 1024 защищает от
 * случайных «широких» миниатюр и кропов.
 */
export function isPanoramaByRatio(width: number | null | undefined, height: number | null | undefined): boolean {
  if (!width || !height || height <= 0) return false
  if (width < 1024) return false
  return Math.abs(width / height - 2) < 0.03
}
