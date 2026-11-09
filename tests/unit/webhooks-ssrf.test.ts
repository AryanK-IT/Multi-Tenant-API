import { describe, it, expect } from "vitest";
import { isDisallowedIp, validateWebhookUrl } from "../../src/webhooks/ssrf";
import { ValidationError } from "../../src/common/errors";

describe("Webhook SSRF Protection (SRS §3.5 FR-18, §5.1)", () => {
  describe("isDisallowedIp", () => {
    it("identifies IPv4 loopback addresses (127.0.0.0/8) as disallowed", () => {
      expect(isDisallowedIp("127.0.0.1")).toBe(true);
      expect(isDisallowedIp("127.0.0.2")).toBe(true);
      expect(isDisallowedIp("127.255.255.255")).toBe(true);
    });

    it("identifies private-use IPv4 addresses (RFC 1918) as disallowed", () => {
      // 10.0.0.0/8
      expect(isDisallowedIp("10.0.0.1")).toBe(true);
      expect(isDisallowedIp("10.255.255.255")).toBe(true);

      // 172.16.0.0/12
      expect(isDisallowedIp("172.16.0.1")).toBe(true);
      expect(isDisallowedIp("172.31.255.255")).toBe(true);

      // 192.168.0.0/16
      expect(isDisallowedIp("192.168.1.1")).toBe(true);
      expect(isDisallowedIp("192.168.254.254")).toBe(true);
    });

    it("identifies carrier-grade NAT addresses (100.64.0.0/10) as disallowed", () => {
      expect(isDisallowedIp("100.64.0.1")).toBe(true);
      expect(isDisallowedIp("100.127.255.255")).toBe(true);
    });

    it("identifies link-local and cloud metadata addresses (169.254.0.0/16) as disallowed", () => {
      expect(isDisallowedIp("169.254.169.254")).toBe(true);
      expect(isDisallowedIp("169.254.1.1")).toBe(true);
    });

    it("identifies multicast, broadcast, and 0.0.0.0 as disallowed", () => {
      expect(isDisallowedIp("0.0.0.0")).toBe(true);
      expect(isDisallowedIp("224.0.0.1")).toBe(true);
      expect(isDisallowedIp("255.255.255.255")).toBe(true);
    });

    it("identifies IPv6 loopback, unspecified, and local addresses as disallowed", () => {
      expect(isDisallowedIp("::1")).toBe(true);
      expect(isDisallowedIp("::")).toBe(true);
      expect(isDisallowedIp("fc00::1")).toBe(true);
      expect(isDisallowedIp("fd12:3456:789a:1::1")).toBe(true);
      expect(isDisallowedIp("fe80::1")).toBe(true);
      expect(isDisallowedIp("ff02::1")).toBe(true);
    });

    it("identifies IPv4-mapped IPv6 addresses wrapping internal addresses as disallowed", () => {
      expect(isDisallowedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isDisallowedIp("::ffff:10.0.0.1")).toBe(true);
      expect(isDisallowedIp("::ffff:169.254.169.254")).toBe(true);
    });

    it("allows valid public IPv4 and IPv6 addresses", () => {
      expect(isDisallowedIp("8.8.8.8")).toBe(false);
      expect(isDisallowedIp("1.1.1.1")).toBe(false);
      expect(isDisallowedIp("93.184.216.34")).toBe(false);
      expect(isDisallowedIp("2607:f8b0:4005:805::200e")).toBe(false);
    });
  });

  describe("validateWebhookUrl", () => {
    it("rejects invalid URL formats", async () => {
      await expect(validateWebhookUrl("not-a-url")).rejects.toThrow(ValidationError);
      await expect(validateWebhookUrl("ftp://example.com")).rejects.toThrow(ValidationError);
    });

    it("rejects URLs with embedded credentials", async () => {
      await expect(
        validateWebhookUrl("https://admin:secret@api.example.com/webhook")
      ).rejects.toThrow(/embedded credentials/);
    });

    it("rejects localhost and cloud metadata hostnames directly", async () => {
      await expect(validateWebhookUrl("https://localhost/webhook")).rejects.toThrow(/prohibited/);
      await expect(
        validateWebhookUrl("https://metadata.google.internal/computeMetadata/v1")
      ).rejects.toThrow(/prohibited/);
      await expect(validateWebhookUrl("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
        /disallowed/
      );
    });

    it("rejects hostnames resolving to private IP addresses", async () => {
      const mockLookup = async () => ["192.168.1.50"];

      await expect(
        validateWebhookUrl("https://internal-service.local/webhook", {
          dnsLookup: mockLookup,
        })
      ).rejects.toThrow(/disallowed IP/);
    });

    it("rejects hostnames resolving to loopback IP addresses", async () => {
      const mockLookup = async () => ["127.0.0.1"];

      await expect(
        validateWebhookUrl("https://my-local-test.com/webhook", {
          dnsLookup: mockLookup,
        })
      ).rejects.toThrow(/disallowed IP/);
    });

    it("rejects hostnames resolving to mixed addresses when at least one is private", async () => {
      const mockLookup = async () => ["93.184.216.34", "10.0.0.5"];

      await expect(
        validateWebhookUrl("https://dual-homed.example.com/webhook", {
          dnsLookup: mockLookup,
        })
      ).rejects.toThrow(/disallowed IP/);
    });

    it("allows valid public HTTPS URLs with public IP resolution", async () => {
      const mockLookup = async () => ["93.184.216.34"];

      const result = await validateWebhookUrl("https://webhook.site/test-uuid", {
        dnsLookup: mockLookup,
      });

      expect(result).toBe("https://webhook.site/test-uuid");
    });

    it("enforces HTTPS requirement when allowHttp is false", async () => {
      const mockLookup = async () => ["93.184.216.34"];

      await expect(
        validateWebhookUrl("http://api.example.com/webhook", {
          dnsLookup: mockLookup,
          allowHttp: false,
        })
      ).rejects.toThrow(/must use HTTPS/);
    });

    it("allows HTTP when allowHttp is true (in dev/test)", async () => {
      const mockLookup = async () => ["93.184.216.34"];

      const result = await validateWebhookUrl("http://api.example.com/webhook", {
        dnsLookup: mockLookup,
        allowHttp: true,
      });

      expect(result).toBe("http://api.example.com/webhook");
    });
  });
});
