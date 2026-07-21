import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // VITE_API_BASE_URL 미설정 시에도 /api → 로컬 백엔드로 프록시
      // 모바일 LAN 테스트·대용량 업로드를 위해 타임아웃을 넉넉히 둡니다.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
});
