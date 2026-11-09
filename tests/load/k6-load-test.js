/* global __ENV, __VU */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 20 }, // Ramp-up to 20 virtual users
    { duration: "1m", target: 50 }, // Sustained throughput
    { duration: "30s", target: 0 }, // Ramp-down
  ],
  thresholds: {
    // SRS §5.2 Target: p95 latency < 100ms for read/status endpoints
    http_req_duration: ["p(95)<100"],
    // Error rate must remain under 1% during standard load
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  // 1. Health check probe
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
    "health has status ok": (r) => JSON.parse(r.body).status === "ok",
  });

  // 2. Readiness check probe
  const readyRes = http.get(`${BASE_URL}/ready`);
  check(readyRes, {
    "ready returns valid code": (r) => r.status === 200 || r.status === 503,
  });

  // 3. Rate limiting stress probe on auth endpoint
  const authPayload = JSON.stringify({
    email: `loadtest_${__VU}@example.com`,
    password: "Password123!",
  });

  const authRes = http.post(`${BASE_URL}/api/v1/auth/login`, authPayload, {
    headers: { "Content-Type": "application/json" },
  });

  check(authRes, {
    "login returns expected response or 429 when rate limited": (r) =>
      r.status === 401 || r.status === 429 || r.status === 200,
  });

  sleep(0.1);
}
