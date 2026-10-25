import { describe, expect, it } from "vite-plus/test";

import { parseTheme } from "./theme";
import { readTheme, themeCookieHeader } from "./theme.server";

function requestWithCookie(cookie: string | null) {
  return new Request("http://localhost/", cookie ? { headers: { Cookie: cookie } } : undefined);
}

describe("theme", () => {
  it("falls back to midnight for unknown values", () => {
    expect(parseTheme("xdd")).toBe("xdd");
    expect(parseTheme("midnight")).toBe("midnight");
    expect(parseTheme("neon")).toBe("midnight");
    expect(parseTheme(null)).toBe("midnight");
  });

  it("reads back the theme it stored in the cookie", async () => {
    const setCookie = await themeCookieHeader("xdd");
    const [cookie] = setCookie.split(";");
    expect(await readTheme(requestWithCookie(cookie ?? null))).toBe("xdd");
  });

  it("defaults to midnight without a cookie", async () => {
    expect(await readTheme(requestWithCookie(null))).toBe("midnight");
    expect(await readTheme(requestWithCookie("theme=garbage"))).toBe("midnight");
  });
});
