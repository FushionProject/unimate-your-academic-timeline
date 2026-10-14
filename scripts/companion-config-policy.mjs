import { isIP } from "node:net";

// Syntax/scope guard only: public DNS, TLS, deployment protection, ownership,
// and the published privacy/support pages still require release verification.
export function isPublicCompanionOrigin(value) {
  try {
    if (typeof value !== "string") return false;
    const url = new URL(value);
    const host = url.hostname;
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !isIP(host.replace(/^\[|\]$/g, "")) &&
      host.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion|arpa)$/.test(
        host,
      ) &&
      !/(?:^|\.)example\.(?:com|net|org)$/.test(host) &&
      !/your_|placeholder/i.test(host)
    );
  } catch {
    return false;
  }
}

export function isDevelopmentCompanionOrigin(value) {
  if (isPublicCompanionOrigin(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

// Chrome requires 1–4 string components, no padded numbers, and not all zero.
export function isChromeExtensionVersion(value) {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/.test(value) &&
    value.split(".").every((part) => Number(part) <= 65535) &&
    value.split(".").some((part) => Number(part) > 0)
  );
}
