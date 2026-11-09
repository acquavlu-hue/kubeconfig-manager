import { delimiter } from 'node:path';
import { shellQuote } from '../shared/shell-quote';

export function environmentCommand(path: string, shell: string): string {
  if (!['bash', 'zsh', 'fish', 'powershell'].includes(shell)) throw new Error('Shell supportate: bash, zsh, fish, powershell.');
  if (path.includes(delimiter)) throw new Error('Il percorso contiene il separatore di KUBECONFIG. Usa kubectl --kubeconfig con il percorso del file.');
  const value = shellQuote(path, shell);
  if (shell === 'powershell') return `$env:KUBECONFIG = ${value}`;
  if (shell === 'fish') return `set -gx KUBECONFIG ${value};`;
  return `export KUBECONFIG=${value}`;
}
