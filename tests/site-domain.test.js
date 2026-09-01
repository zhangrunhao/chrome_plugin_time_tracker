import test from "node:test";
import assert from "node:assert/strict";
import {
  SiteInputError,
  normalizeSiteInput,
  hostnameMatchesDomain,
  matchSiteUrl,
} from "../src/domain/site-domain.js";

test("normalizes URLs and private-suffix tenants to registrable domains", () => {
  assert.deepEqual(normalizeSiteInput("https://www.zhihu.com/question/1?x=1"), {
    domain: "zhihu.com",
    normalizedUrl: "https://www.zhihu.com/question/1?x=1",
  });
  assert.equal(normalizeSiteInput("zhuanlan.zhihu.com:443/a").domain, "zhihu.com");
  assert.equal(normalizeSiteInput("https://team.github.io/docs").domain, "team.github.io");
  assert.equal(normalizeSiteInput("https://食狮.com.cn/").domain, "xn--85x722f.com.cn");
});

test("rejects unsupported and non-registrable inputs with stable codes", () => {
  for (const [input, code] of [
    ["", "INVALID_URL"],
    ["chrome://extensions", "UNSUPPORTED_PROTOCOL"],
    ["ftp://example.com/file", "UNSUPPORTED_PROTOCOL"],
    ["http://localhost:3000", "UNREGISTRABLE_DOMAIN"],
    ["https://127.0.0.1", "UNREGISTRABLE_DOMAIN"],
    ["https://com", "UNREGISTRABLE_DOMAIN"],
    ["https://example.unknown", "UNREGISTRABLE_DOMAIN"],
  ]) {
    assert.throws(
      () => normalizeSiteInput(input),
      error => error instanceof SiteInputError && error.code === code,
    );
  }
});

test("matches exact domains and subdomains without suffix spoofing", () => {
  const sites = [{ id: "zhihu", domain: "zhihu.com", enabled: true }];
  assert.equal(hostnameMatchesDomain("www.zhihu.com", "zhihu.com"), true);
  assert.equal(hostnameMatchesDomain("fakezhihu.com", "zhihu.com"), false);
  assert.equal(matchSiteUrl("https://zhuanlan.zhihu.com/p/1", sites).id, "zhihu");
  assert.equal(matchSiteUrl("https://fakezhihu.com", sites), null);
  assert.equal(matchSiteUrl("chrome://extensions", sites), null);
  assert.equal(matchSiteUrl("https://zhihu.com", sites, { enabledOnly: true }).id, "zhihu");
  assert.equal(
    matchSiteUrl("https://zhihu.com", [{ ...sites[0], enabled: false }], { enabledOnly: true }),
    null,
  );
});
