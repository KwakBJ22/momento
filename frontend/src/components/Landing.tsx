interface LandingProps { onStart: () => void; onLogin: () => void; }

export default function Landing({ onStart, onLogin }: LandingProps) {
  return <section className="landing" aria-labelledby="landing-title">
    <div className="landing__visual" aria-hidden="true"><span /><span /><span>우리의 오늘</span></div>
    <p className="landing__eyebrow">사진으로 시작하는 가족 앨범</p>
    <h1 id="landing-title">사진을 고르면<br />우리 가족의 이야기가<br />앨범이 돼요.</h1>
    <p className="landing__copy">설명은 나중에 적어도 괜찮아요.<br />사진만으로 바로 시작할 수 있어요.</p>
    <ol className="landing__steps" aria-label="앨범 만들기 과정"><li><b>1</b> 사진 선택</li><li><b>2</b> 한 줄 기억 <small>선택</small></li><li><b>3</b> 앨범 완성</li></ol>
    <button type="button" className="landing__cta" onClick={onStart}>사진 고르고 앨범 만들기</button>
    <p className="landing__hint">로그인 없이 먼저 체험할 수 있어요.</p>
    <button type="button" className="landing__login" onClick={onLogin}>이미 계정이 있나요? 로그인</button>
  </section>;
}
