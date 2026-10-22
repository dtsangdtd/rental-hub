/**
 * Converts a numeric currency amount into Vietnamese words (Bằng chữ).
 * E.g., 4225000 -> "Bốn triệu hai trăm hai mươi lăm nghìn đồng"
 */
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readThreeDigits(triplet: number, showZeroHundred = true): string {
  const h = Math.floor(triplet / 100);
  const t = Math.floor((triplet % 100) / 10);
  const u = triplet % 10;
  const parts: string[] = [];

  if (h > 0 || showZeroHundred) {
    parts.push(DIGITS[h] + ' trăm');
  }

  if (t > 1) {
    parts.push(DIGITS[t] + ' mươi');
    if (u === 1) parts.push('mốt');
    else if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]);
  } else if (t === 1) {
    parts.push('mười');
    if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]);
  } else if (t === 0 && u > 0) {
    if (h > 0 || showZeroHundred) parts.push('lẻ');
    parts.push(DIGITS[u]);
  }

  return parts.join(' ');
}

export function vietnameseCurrencyToWords(n: number): string {
  const amount = Math.round(Math.abs(n));
  if (amount === 0) return 'Không đồng';

  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const triplets: number[] = [];
  let temp = amount;

  while (temp > 0) {
    triplets.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const resultWords: string[] = [];
  for (let i = triplets.length - 1; i >= 0; i--) {
    const val = triplets[i];
    if (val === 0) continue;
    const isFirst = i === triplets.length - 1;
    const words = readThreeDigits(val, !isFirst);
    const scale = scales[i];
    resultWords.push(words + (scale ? ' ' + scale : ''));
  }

  const sentence = resultWords.join(' ').replace(/\s+/g, ' ').trim() + ' đồng';
  // Capitalize first letter
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
