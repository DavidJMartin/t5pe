export function hex(bytes: ArrayLike<number>, max = Infinity): string {
  const n = Math.min(bytes.length, max);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(bytes[i].toString(16).toUpperCase().padStart(2, '0'));
  if (bytes.length > n) parts.push(`… (${bytes.length} bytes)`);
  return parts.join(' ');
}

export function hexByte(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}
