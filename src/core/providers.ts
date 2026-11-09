/** Implement this contract when the actual company vault is connected.
 * Credentials are owned by the provider; they must never enter renderer snapshots or settings.
 * Returned configs must be self-contained (inline certificates/keys, no local file references).
 */
export interface KubeconfigProvider {
  readonly id: string;
  readonly label: string;
  list(signal?: AbortSignal): Promise<{ id: string; label: string }[]>;
  fetch(id: string, signal?: AbortSignal): Promise<string>;
}

// No simulated connection or provider-specific authentication is enabled in v0.1.
export const providers: readonly KubeconfigProvider[] = [];
