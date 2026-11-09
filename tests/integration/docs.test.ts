import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";

describe("OpenAPI Documentation & Swagger UI Integration (Phase 9 - SRS §4.1)", () => {
  const app = createApp({
    checkDatabase: async () => true,
    checkRedis: async () => true,
  });

  it("serves raw OpenAPI 3.1 JSON specification at GET /api/docs/openapi.json", async () => {
    const res = await request(app).get("/api/docs/openapi.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.openapi).toBe("3.1.0");
    expect(res.body.info.title).toContain("TaskFlow");
    expect(res.body.paths["/auth/signup"]).toBeDefined();
    expect(res.body.paths["/projects"]).toBeDefined();
    expect(res.body.paths["/tasks/{id}"]).toBeDefined();
    expect(res.body.paths["/webhooks"]).toBeDefined();
  });

  it("serves interactive Swagger UI HTML at GET /api/docs", async () => {
    const res = await request(app).get("/api/docs");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("<title>TaskFlow API Documentation</title>");
    expect(res.text).toContain("swagger-ui");
    expect(res.text).toContain("SwaggerUIBundle");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });

  it("supports root alias GET /docs pointing to Swagger UI", async () => {
    const res = await request(app).get("/docs");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("swagger-ui");
  });

  it("supports root alias GET /docs/openapi.json", async () => {
    const res = await request(app).get("/docs/openapi.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.openapi).toBe("3.1.0");
  });
});
