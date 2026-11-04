import { describe, it, expect } from "vitest";
import { prisma } from "../../src/db/client";
import { Role } from "@prisma/client";

describe("Database Client and Schema Models", () => {
  it("initializes Prisma client and provides delegates for core models", () => {
    expect(prisma).toBeDefined();
    expect(prisma.org).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.orgMembership).toBeDefined();
  });

  it("exports Role enum matching SRS specifications", () => {
    expect(Role.owner).toBe("owner");
    expect(Role.admin).toBe("admin");
    expect(Role.member).toBe("member");
  });
});
