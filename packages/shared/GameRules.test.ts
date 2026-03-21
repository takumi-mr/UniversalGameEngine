import { expect, test, describe } from "bun:test";
import { createSecret, isSecret } from "./GameRules";

describe("GameRules Utilities", () => {
  test("createSecret should create a secret object", () => {
    const secret = createSecret("value", ["p1"], "masked");
    expect(secret.__isSecret).toBe(true);
    expect(secret.value).toBe("value");
    expect(secret.visibleTo).toEqual(["p1"]);
    expect(secret.maskedValue).toBe("masked");
  });

  test("isSecret should identify secret objects", () => {
    expect(isSecret(createSecret("v", ["*"]))).toBe(true);
    expect(isSecret({ __isSecret: true })).toBe(true);
    expect(isSecret({ value: "v" })).toBe(false);
    expect(isSecret(null)).toBe(false);
    expect(isSecret("secret")).toBe(false);
  });
});
