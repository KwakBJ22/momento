import type { VercelRequest, VercelResponse } from "@vercel/node";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Album generation can include image processing and several AI calls. The
// hosting plan must permit this duration for the proxy to return a real error.
export const maxDuration = 300;

/**
 * Vercel 서버리스 프록시: /api/* → WOORIALBUM_API_URL/api/*
 * 공유 링크 등 작은 요청에 사용한다. Vercel 환경변수: WOORIALBUM_API_URL=https://your-app.up.railway.app
 *
 * ⚠️ 4.5MB를 초과하는 요청은 이 프록시를 통과할 수 없다(Vercel 서버리스 함수 요청
 *    본문 플랫폼 제한). 사진 여러 장(대략 5장 이상) 앨범 생성은 이 한도를 넘어 실패한다.
 *    업로드는 프록시를 우회해 백엔드에 직접 붙어야 한다 — 프런트 빌드 시 Vercel 환경변수
 *    VITE_API_BASE_URL 를 Railway 공개 도메인으로 지정하면 lib/api 의 API_BASE 가 그 값이
 *    되어 /api/upload-album 이 프록시를 타지 않는다. (프록시 코드는 변경하지 않는다.)
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const backend = process.env.WOORIALBUM_API_URL?.trim();
  if (!backend) {
    res.status(503).json({
      detail:
        "백엔드 URL이 설정되지 않았습니다. Vercel에 WOORIALBUM_API_URL 환경변수를 추가해주세요.",
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

  proxyReq.setTimeout(290_000, () => {
    proxyReq.destroy(new Error("Backend request timed out"));
  });

  proxyReq.on("error", (error) => {
    console.error("우리앨범 API proxy request failed", { message: error.message, target: target.origin });
    if (res.headersSent) return;
    res.status(502).json({ detail: "백엔드 서버에 연결하지 못했습니다." });
  });

  req.pipe(proxyReq);
}
