import { Router, Request, Response } from "express";
import { openApiSpec } from "./openapi";

export const docsRouter = Router();

// Endpoint providing the raw OpenAPI 3.1 JSON specification
docsRouter.get("/openapi.json", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json(openApiSpec);
});

// Interactive Swagger UI HTML
const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TaskFlow API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/favicon-32x32.png" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #fafafa;
    }
    .topbar {
      display: none;
    }
    .swagger-ui .info {
      margin: 25px 0;
    }
    .swagger-ui .info .title {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: window.location.pathname.replace(/\\/$/, "") + "/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;

docsRouter.get("/", (req: Request, res: Response) => {
  // Relax CSP for Swagger UI resources
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://cdn.jsdelivr.net;"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(swaggerHtml);
});
