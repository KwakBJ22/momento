import { useCallback, useEffect, useState } from "react";

declare global {
  interface Window {
    Kakao?: {
      init: (key: string) => void;
      isInitialized: () => boolean;
      Share: {
        sendDefault: (options: Record<string, unknown>) => void;
      };
    };
  }
}

export interface ShareAlbumOptions {
  imageUrl: string;
  linkUrl: string;
  description: string;
  title: string;
  buttonTitle: string;
}

interface UseKakaoSdkResult {
  isKakaoInApp: boolean;
  isSdkReady: boolean;
  shareAlbum: (options: ShareAlbumOptions) => void;
}

export function useKakaoSdk(): UseKakaoSdkResult {
  const [isSdkReady, setIsSdkReady] = useState(false);

  const isKakaoInApp =
    typeof navigator !== "undefined" && /KAKAOTALK/i.test(navigator.userAgent);

  useEffect(() => {
    let active = true;
    const initialize = () => {
      const key = import.meta.env.VITE_KAKAO_JS_KEY;
      if (!key) {
        console.warn("[우리앨범] Kakao SDK initialization skipped: VITE_KAKAO_JS_KEY is missing.");
        return;
      }
      if (!window.Kakao) return;
      try {
        if (!window.Kakao.isInitialized()) window.Kakao.init(key);
        const ready = window.Kakao.isInitialized();
        if (active) setIsSdkReady(ready);
        if (import.meta.env.DEV) console.debug("[우리앨범] Kakao SDK initialized", { ready });
      } catch (cause) {
        console.warn("[우리앨범] Kakao SDK initialization failed.", cause);
        if (active) setIsSdkReady(false);
      }
    };

    const script = document.querySelector<HTMLScriptElement>('script[src*="kakao_js_sdk"]');
    const onScriptError = () => console.warn("[우리앨범] Kakao SDK script failed to load.");
    initialize();
    script?.addEventListener("load", initialize);
    script?.addEventListener("error", onScriptError);
    return () => {
      active = false;
      script?.removeEventListener("load", initialize);
      script?.removeEventListener("error", onScriptError);
    };
  }, []);

// ★ 기본 문구를 두지 않는다(2026-08-12). `우리 모임 앨범이 완성됐어요` 라는 옛 문구가
  //   기본값으로 남아 있었다 — 부르는 쪽이 문구를 빠뜨리면 조용히 그 옛말이 나간다.
  //   카드 문구는 AlbumShareSheet 의 CARD 한 곳에서만 정한다.
  const shareAlbum = useCallback(({ imageUrl, linkUrl, description, title, buttonTitle }: ShareAlbumOptions) => {
    if (!window.Kakao?.isInitialized() || !window.Kakao.Share?.sendDefault) {
      throw new Error("Kakao SDK is not ready.");
    }

    try {
      window.Kakao.Share.sendDefault({
      objectType: "feed",
      content: {
        title,
        description,
        imageUrl,
        link: {
          mobileWebUrl: linkUrl,
          webUrl: linkUrl,
        },
      },
      buttons: [
        {
          title: buttonTitle,
          link: {
            mobileWebUrl: linkUrl,
            webUrl: linkUrl,
          },
        },
      ],
      });
    } catch (cause) {
      console.warn("[우리앨범] Kakao share invocation failed.", cause);
      throw new Error("Kakao share invocation failed.");
    }
  }, []);

  return { isKakaoInApp, isSdkReady, shareAlbum };
}
