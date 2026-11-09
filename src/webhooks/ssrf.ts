import dns from "dns";
import net from "net";
import { env } from "../config/env";
import { ValidationError } from "../common/errors";

const CLOUD_METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.internal",
  "metadata",
  "instance-data",
]);

/**
 * Checks if an IPv4 address falls within a numeric range given by CIDR or octets.
 */
function isIpv4InSubnet(ip: string, subnet: string, bits: number): boolean {
  const ipParts = ip.split(".").map(Number);
  const subnetParts = subnet.split(".").map(Number);

  if (ipParts.length !== 4 || subnetParts.length !== 4) {
    return false;
  }

  const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
  const subnetNum =
    ((subnetParts[0] << 24) | (subnetParts[1] << 16) | (subnetParts[2] << 8) | subnetParts[3]) >>>
    0;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (subnetNum & mask);
}

/**
 * Determines whether an IP address is disallowed (loopback, private, link-local, cloud-metadata, etc.)
 */
export function isDisallowedIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 address (e.g., ::ffff:127.0.0.1 -> 127.0.0.1)
  const ipv4MappedMatch = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (ipv4MappedMatch) {
    ip = ipv4MappedMatch[1];
  }

  // IPv4 Checks
  if (net.isIPv4(ip)) {
    // 0.0.0.0/8 (Current network / "this" network)
    if (isIpv4InSubnet(ip, "0.0.0.0", 8)) return true;

    // 10.0.0.0/8 (Private-Use, RFC 1918)
    if (isIpv4InSubnet(ip, "10.0.0.0", 8)) return true;

    // 100.64.0.0/10 (Shared Address Space / Carrier-Grade NAT, RFC 6598)
    if (isIpv4InSubnet(ip, "100.64.0.0", 10)) return true;

    // 127.0.0.0/8 (Loopback)
    if (isIpv4InSubnet(ip, "127.0.0.0", 8)) return true;

    // 169.254.0.0/16 (Link-Local & Cloud Metadata 169.254.169.254)
    if (isIpv4InSubnet(ip, "169.254.0.0", 16)) return true;

    // 172.16.0.0/12 (Private-Use, RFC 1918)
    if (isIpv4InSubnet(ip, "172.16.0.0", 12)) return true;

    // 192.168.0.0/16 (Private-Use, RFC 1918)
    if (isIpv4InSubnet(ip, "192.168.0.0", 16)) return true;

    // 224.0.0.0/4 (Multicast, RFC 5771)
    if (isIpv4InSubnet(ip, "224.0.0.0", 4)) return true;

    // 240.0.0.0/4 (Reserved for future use, RFC 1112) & 255.255.255.255 (Broadcast)
    if (isIpv4InSubnet(ip, "240.0.0.0", 4)) return true;

    return false;
  }

  // IPv6 Checks
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    // Loopback ::1
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

    // Unspecified ::
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

    // Unique Local Addresses fc00::/7 (fc00:: - fdff:ffff:...)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

    // Link-Local fe80::/10
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }

    // Multicast ff00::/8
    if (normalized.startsWith("ff")) return true;

    return false;
  }

  // Unrecognized IP format
  return true;
}

export interface ValidateWebhookUrlOptions {
  dnsLookup?: (hostname: string) => Promise<string[]>;
  allowHttp?: boolean;
}

/**
 * Validates a webhook URL against SSRF attack vectors (SRS §3.5 FR-18).
 * Checks protocol, credentials, cloud metadata hosts, and resolves hostname to verify destination IPs.
 */
export async function validateWebhookUrl(
  urlString: string,
  options: ValidateWebhookUrlOptions = {}
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ValidationError("Invalid webhook URL format.");
  }

  // Protocol validation: HTTPS required in production; HTTP allowed only in dev/test
  const allowHttp =
    options.allowHttp !== undefined
      ? options.allowHttp
      : env.NODE_ENV === "development" || env.NODE_ENV === "test";

  if (parsed.protocol === "http:") {
    if (!allowHttp) {
      throw new ValidationError("Webhook URL must use HTTPS.");
    }
  } else if (parsed.protocol !== "https:") {
    throw new ValidationError("Webhook URL protocol must be HTTPS (or HTTP in development).");
  }

  // Reject embedded basic auth credentials
  if (parsed.username || parsed.password) {
    throw new ValidationError("Webhook URL cannot contain embedded credentials.");
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject common cloud metadata and localhost hostnames directly
  if (
    CLOUD_METADATA_HOSTS.has(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    throw new ValidationError(
      `Webhook URL host '${hostname}' is prohibited (loopback, internal, or cloud metadata).`
    );
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new ValidationError(
        `Webhook target IP '${hostname}' is disallowed (loopback, private, link-local, or reserved).`
      );
    }
    return urlString;
  }

  // Perform DNS resolution to check destination IP addresses
  const lookupFn =
    options.dnsLookup ??
    (async (host: string): Promise<string[]> => {
      try {
        const results = await dns.promises.lookup(host, { all: true });
        return results.map((r) => r.address);
      } catch (err) {
        throw new ValidationError(
          `Failed to resolve webhook host '${host}': ${(err as Error).message}`
        );
      }
    });

  const resolvedIps = await lookupFn(hostname);
  if (!resolvedIps || resolvedIps.length === 0) {
    throw new ValidationError(`Webhook host '${hostname}' did not resolve to any IP address.`);
  }

  for (const ip of resolvedIps) {
    if (isDisallowedIp(ip)) {
      throw new ValidationError(
        `Webhook host '${hostname}' resolved to disallowed IP address '${ip}' (loopback, private, or internal).`
      );
    }
  }

  return urlString;
}
