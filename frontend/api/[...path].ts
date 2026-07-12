import type { VercelRequest, VercelResponse } from "@vercel/node";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Vercel 서버리스 프록시: /api/* → MOMENTO_API_URL/api/*
 * 프로덕션에서 VITE_API_BASE_URL 없이도 공유 링크·업로드가 동작하도록 한다.
 * Vercel 환경변수: MOMENTO_API_URL=https://your-app.up.railway.app
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const backend = process.env.MOMENTO_API_URL?.trim();
  if (!backend) {
    res.status(503).json({
      detail:
        "백엔드 URL이 설정되지 않았습니다. Vercel에 MOMENTO_API_URL 환경변수를 추가해주세요.",
    });
    return;
  }

  const parts = req.query.path;
  const subPath = Array.isArray(parts) ? parts.join("/") : parts || "";
  const incoming = new URL(req.url || "/", "http://localhost");
  const target = new URL(`/api/${subPath}${incoming.search}`, backend.replace(/\/$/, "") + "/");

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || key === "host") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers.host = target.host;

  const transport = target.protocol === "https:" ? https : http;
  const proxyReq = transport.request(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 502;
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value !== undefined) res.setHeader(key, value);
      }
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", () => {
    res.status(502).json({ detail: "백엔드 서버에 연결하지 못했습니다." });
  });

  req.pipe(proxyReq);
}
