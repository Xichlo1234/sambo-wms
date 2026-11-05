/** Bỏ dấu tiếng Việt + chữ thường – dùng cho tìm kiếm & phát hiện trùng */
export function normalizeText(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9.,/\-x ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}
