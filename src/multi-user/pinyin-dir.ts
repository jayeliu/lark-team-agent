import { pinyin } from 'pinyin';

/**
 * Convert a Chinese name to a safe directory name.
 * "张三" → "zhangsan", "Li Ming" → "liming", conflicts get numeric suffix.
 */
export function nameToPinyinDir(name: string): string {
  if (!name || !name.trim()) return 'user';

  // If already ASCII (e.g. English names), just lowercase and remove spaces
  if (/^[\x00-\x7F]+$/.test(name)) {
    return name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32) || 'user';
  }

  // Convert Chinese characters to pinyin, no tones, lowercase
  const result = pinyin(name, {
    style: 'normal', // no tone marks
    heteronym: false,
  })
    .flat()
    .join('')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);

  return result || 'user';
}

/**
 * Given a desired dir name and a set of existing dirs, return a unique name.
 * "zhangsan" already taken → "zhangsan2", "zhangsan3", etc.
 */
export function uniqueDirName(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) return desired;
  let i = 2;
  while (existing.has(`${desired}${i}`)) i++;
  return `${desired}${i}`;
}
