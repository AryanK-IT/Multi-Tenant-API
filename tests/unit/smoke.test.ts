import { describe, it, expect } from "vitest";
import { APP_NAME } from "../../src/index";

describe("Smoke test", () => {
  it("verifies test suite and project environment", () => {
    expect(APP_NAME).toBe("TaskFlow");
  });
});
