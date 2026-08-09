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
  title?: string;
  buttonTitle?: string;
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

  const shareAlbum = useCallback(({ imageUrl, linkUrl, description, title = "우리 모임 앨범이 완성됐어요", buttonTitle = "앨범 전체 보기" }: ShareAlbumOptions) => {
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
