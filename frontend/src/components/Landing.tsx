interface LandingProps { onStart: () => void; onLogin: () => void; }

export default function Landing({ onStart, onLogin }: LandingProps) {
  return <section className="landing" aria-labelledby="landing-title">
    <p className="landing__brand">Momento</p>
    <h1 id="landing-title">사진만 올리면<br />AI가 가족의 이야기가 담긴<br />특별한 앨범을 만들어드립니다.</h1>
    <p className="landing__copy">설명은 나중에 추가해도 괜찮아요.<br />사진만으로 바로 시작할 수 있어요.</p>
    <button type="button" className="landing__cta" onClick={onStart}>사진으로 앨범 만들기</button>
    <p className="landing__hint">로그인 없이 먼저 체험할 수 있어요.</p>
    <button type="button" className="landing__login" onClick={onLogin}>이미 계정이 있나요? 로그인</button>
  </section>;
}
