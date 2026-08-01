import { lookup } from "node:dns/promises";
import { config } from "@kiln/config";
import { CredentialUnavailable, EgressBlocked } from "@kiln/contracts";
import { logger } from "@kiln/observability";
import type { CredentialHandle, EgressClient } from "./define.js";

/**
 * Egress control — CLAUDE.md §9.2 step 8.
 *
 * Agents summarise pages they fetch, and a page can ask to be summarised in a
 * particular way. That makes SSRF a live concern rather than a checklist item:
 * the blocked list below is what stops a fetched document from talking the
 * runtime into reading cloud metadata or an internal service.
 *
 * Three defences, because any one alone is bypassable:
 *   1. host allowlist for credentialed calls
 *   2. DNS resolution checked against private ranges (defeats a public
 *      hostname that resolves to 169.254.169.254)
 *   3. manual redirect handling, re-running both checks per hop
 */

const MAX_REDIRECTS = 3;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalised = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalised === "::1" || normalised === "::") return true;
  if (normalised.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(normalised)) return true; // unique local
  if (normalised.startsWith("::ffff:")) return isPrivateIPv4(normalised.slice(7));
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

export function hostAllowed(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.toLowerCase().trim();
    if (e.length === 0) return false;
    if (e.startsWith("*.")) return h === e.slice(2) || h.endsWith(e.slice(1));
    return h === e;
  });
}

export interface EgressOptions {
  /** Hosts reachable with credentials attached. */
  readonly allowlist?: readonly string[];
  /**
   * Research tools fetch arbitrary public pages by design. Those calls are
   * never credentialed and their output is quarantined as data, never
   * instruction — see quarantine.ts.
   */
  readonly allowArbitraryPublicHosts?: boolean;
  readonly timeoutMs?: number;
  /**
   * Resolves an opaque lease only for the lifetime of the outbound request.
   * A vault integration implements this by delegating to `withCredential`.
   */
  readonly credentialResolver?: CredentialResolver;
  /** Provider-specific request signing. Bearer auth is the safe default. */
  readonly applyCredential?: (
    headers: Headers,
    plaintext: string,
    handle: CredentialHandle,
  ) => void;
  /** Injectable boundaries keep SSRF and credential tests offline. */
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly fetchImpl?: typeof globalThis.fetch;
}

export interface CredentialResolver {
  use<T>(handle: CredentialHandle, operation: (plaintext: string) => Promise<T>): Promise<T>;
}

async function assertReachable(url: URL, options: EgressOptions, credentialed: boolean): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EgressBlocked(url.toString(), `refusing protocol ${url.protocol}`);
  }
  if (url.protocol === "http:" && config().NODE_ENV === "production") {
    throw new EgressBlocked(url.toString(), "plaintext http is refused in production");
  }

  const allowlist = options.allowlist ?? config().EGRESS_ALLOWLIST;
  if ((credentialed || !options.allowArbitraryPublicHosts) && !hostAllowed(url.hostname, allowlist)) {
    throw new EgressBlocked(url.toString(), `host "${url.hostname}" is not on the egress allowlist`);
  }

  // Resolve and check every address the name maps to. A hostname that resolves
  // to a private address is the standard SSRF shape.
  let addresses: { address: string }[];
  try {
    addresses = options.resolveHost
      ? (await options.resolveHost(url.hostname)).map((address) => ({ address }))
      : await lookup(url.hostname, { all: true });
  } catch (error) {
    throw new EgressBlocked(url.toString(), `DNS resolution failed: ${String(error)}`);
  }

  const priv = addresses.filter((a) => isPrivateAddress(a.address));
  if (priv.length > 0) {
    throw new EgressBlocked(
      url.toString(),
      `resolves to a private address (${priv.map((p) => p.address).join(", ")})`,
    );
  }
}

export function createEgressClient(options: EgressOptions = {}): EgressClient {
  return {
    async fetch(rawUrl: string, init: RequestInit & { handle?: CredentialHandle } = {}): Promise<Response> {
      let url = new URL(rawUrl);
      const credentialed = init.handle !== undefined;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertReachable(url, options, credentialed);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

        let response: Response;
        try {
          const { handle, ...rest } = init;
          const send = async (plaintext?: string): Promise<Response> => {
            const headers = new Headers(rest.headers);
            if (plaintext !== undefined && handle !== undefined) {
              if (options.applyCredential) options.applyCredential(headers, plaintext, handle);
              else headers.set("authorization", `Bearer ${plaintext}`);
            }
            return (options.fetchImpl ?? globalThis.fetch)(url, {
              ...rest,
              headers,
              redirect: "manual", // we re-check each hop ourselves
              signal: controller.signal,
            });
          };

          if (handle !== undefined) {
            if (!options.credentialResolver) {
              throw new CredentialUnavailable(handle.provider, undefined, "egress has no vault resolver");
            }
            response = await options.credentialResolver.use(handle, send);
          } else {
            response = await send();
          }
        } finally {
          clearTimeout(timeout);
        }

        if (response.status < 300 || response.status >= 400) return response;

        const location = response.headers.get("location");
        if (!location) return response;

        const next = new URL(location, url);
        logger.debug("following redirect under egress control", { from: url.toString(), to: next.toString() });
        url = next;
      }

      throw new EgressBlocked(url.toString(), `exceeded ${MAX_REDIRECTS} redirects`);
    },
  };
}

/** Used in sandbox mode: every call is refused, loudly and specifically. */
export function createSandboxEgressClient(): EgressClient {
  return {
    async fetch(url: string): Promise<Response> {
      throw new EgressBlocked(
        url,
        "sandbox mode: tools must return simulated data rather than reaching the network",
      );
    },
  };
}
