import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";

describe("Health and Readiness Endpoints", () => {
  const app = createApp();

  it("GET /health returns 200 and liveness status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("status", "ok");
    expect(response.body).toHaveProperty("uptime");
    expect(response.body).toHaveProperty("timestamp");
    expect(response.headers).toHaveProperty("x-request-id");
  });

  it("GET /ready returns 200 when all dependencies are ready", async () => {
    const readyApp = createApp({
      checkDatabase: async () => true,
      checkRedis: async () => true,
    });

    const response = await request(readyApp).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.checks).toEqual({
      database: "ok",
      redis: "ok",
    });
  });

  it("GET /ready returns 503 when database check fails", async () => {
    const degradedApp = createApp({
      checkDatabase: async () => false,
      checkRedis: async () => true,
    });

    const response = await request(degradedApp).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("not_ready");
    expect(response.body.checks.database).toBe("failed");
    expect(response.body.checks.redis).toBe("ok");
  });

  it("GET /ready returns 503 when database check throws an exception", async () => {
    const failingApp = createApp({
      checkDatabase: async () => {
        throw new Error("Connection refused");
      },
      checkRedis: async () => true,
    });

    const response = await request(failingApp).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("not_ready");
    expect(response.body.checks.database).toBe("failed");
  });

  it("returns 404 in standard error envelope for unknown routes", async () => {
    const response = await request(app).get("/non-existent-endpoint");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Route GET /non-existent-endpoint not found",
      details: [],
    });
    expect(response.body.error).toHaveProperty("requestId");
  });
});
