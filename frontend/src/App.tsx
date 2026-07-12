import { useState } from "react";
import AlbumResultView from "./components/AlbumResult";
import AlbumView from "./components/AlbumView";
import UploadForm from "./components/UploadForm";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import type { AlbumResult } from "./types";
import "./App.css";

function getAlbumIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/album\/([0-9a-fA-F-]{36})$/);
  return match ? match[1] : null;
}

function App() {
  const [result, setResult] = useState<AlbumResult | null>(null);
  const { shareAlbum } = useKakaoSdk();
  const sharedAlbumId = getAlbumIdFromPath();

  return (
    <div className="app">
      <header className="app__header">
        <h1>Momento</h1>
        <p>모임 사진과 이야기를 하나의 앨범으로</p>
      </header>

      <main className="app__main">
        {sharedAlbumId ? (
          <AlbumView albumId={sharedAlbumId} />
        ) : result ? (
          <AlbumResultView
            result={result}
            onShare={(narrative) =>
              shareAlbum({
                imageUrl: result.image_url,
                linkUrl: result.share_url,
                description: narrative,
                title: result.title,
              })
            }
            onReset={() => setResult(null)}
          />
        ) : (
          <UploadForm onSuccess={setResult} />
        )}
      </main>
    </div>
  );
}

export default App;
