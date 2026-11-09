export function shellQuote(value: string, shell = 'bash'): string {
  // PowerShell treats typographic single quotes as string delimiters too.
  if (shell === 'powershell') return `'${value.replace(/['\u2018-\u201b]/g, quote => quote + quote)}'`;
  if (shell === 'fish') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
