import { useEffect, useState } from "react";

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
    const key = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!key || !window.Kakao) return;
    try {
      if (!window.Kakao.isInitialized()) {
        window.Kakao.init(key);
      }
      setIsSdkReady(window.Kakao.isInitialized());
    } catch {
      setIsSdkReady(false);
    }
  }, []);

  const shareAlbum = ({ imageUrl, linkUrl, description, title = "우리 모임 앨범이 완성됐어요" }: ShareAlbumOptions) => {
    // Kakao SDK 미초기화(웹뷰 밖/키 누락) 시 링크 복사 폴백
    if (!window.Kakao?.isInitialized()) {
      throw new Error("카카오톡 공유를 사용할 수 없습니다. 링크 복사를 이용해주세요.");
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
          title: "앨범 전체 보기",
          link: {
            mobileWebUrl: linkUrl,
            webUrl: linkUrl,
          },
        },
      ],
      });
    } catch {
      throw new Error("카카오톡 공유를 사용할 수 없습니다. 링크 복사를 이용해주세요.");
    }
  };

  return { isKakaoInApp, isSdkReady, shareAlbum };
}
