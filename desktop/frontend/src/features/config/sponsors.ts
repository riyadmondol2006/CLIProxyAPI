/**
 * Sponsor display data (the sponsor link row under the "Proxy URL" field label in the network
 * config section).
 * Pure frontend constants, unrelated to the backend config; adding/removing a sponsor only
 * requires changes here.
 * When the array is empty, the sponsor row isn't rendered at all.
 */
export type Sponsor = {
  /** Sponsor name (displayed as-is, not translated). */
  name: string;
  /** Link target on click. */
  url: string;
  /** Optional small icon (shown next to the name). */
  logo?: string;
};

export const SPONSORS: readonly Sponsor[] = [];
