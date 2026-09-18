import { describe, expect, it } from "vitest";
import { issueDevToken } from "./dev.js";
import { verifyAccessToken } from "./jwt.js";

const secret = "dev-secret-that-is-long-enough-for-hs256";

describe("issueDevToken", () => {
  it("issues a token the API's own verifier accepts", async () => {
    const { accessToken, userId } = await issueDevToken("owner@example.com", secret);
    await expect(verifyAccessToken(accessToken, { secret })).resolves.toEqual({
      userId,
      email: "owner@example.com",
    });
  });

  it("derives a stable, uuid-shaped id from the email", async () => {
    const first = await issueDevToken("Owner@Example.com ", secret);
    const second = await issueDevToken("owner@example.com", secret);

    expect(first.userId).toBe(second.userId);
    expect(first.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
