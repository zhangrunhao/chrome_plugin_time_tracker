import { parse } from "../../vendor/tldts/index.esm.min.js";

export class SiteInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SiteInputError";
    this.code = code;
  }
}

function inputUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new SiteInputError("INVALID_URL", "请输入有效的网址。");
  }

  const trimmed = input.trim();
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  const hasUriScheme = schemeMatch && (!schemeMatch[1].includes(".") || trimmed.startsWith(`${schemeMatch[1]}://`));
  const candidate = hasUriScheme ? trimmed : `https://${trimmed}`;

  try {
    return new URL(candidate);
  } catch {
    throw new SiteInputError("INVALID_URL", "请输入有效的网址。");
  }
}

function registrableDomain(hostname) {
  const result = parse(hostname, {
    allowPrivateDomains: true,
    extractHostname: false,
    detectSpecialUse: true,
  });

  if (
    result.domain === null ||
    result.isSpecialUse === true ||
    (result.isIcann !== true && result.isPrivate !== true)
  ) {
    throw new SiteInputError("UNREGISTRABLE_DOMAIN", "该网址没有可注册主域名。");
  }

  return result.domain;
}

export function normalizeSiteInput(input) {
  const url = inputUrl(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SiteInputError("UNSUPPORTED_PROTOCOL", "只支持 HTTP 和 HTTPS 网址。");
  }

  return {
    domain: registrableDomain(url.hostname),
    normalizedUrl: url.href,
  };
}

export function hostnameMatchesDomain(hostname, domain) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  return normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`);
}

export function matchSiteUrl(url, sites, { enabledOnly = false } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }

  return (
    sites.find(
      site => (!enabledOnly || site.enabled) && hostnameMatchesDomain(parsedUrl.hostname, site.domain),
    ) ?? null
  );
}
