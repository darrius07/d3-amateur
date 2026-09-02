export default function Home() {
  return (
    <main className="main" aria-labelledby="home-title">
      <section className="hero">
        <p className="eyebrow">Fondation technique</p>
        <h1 id="home-title">Le football amateur, sur des bases solides.</h1>
        <p className="lead">
          D3 Amateur bâtit une plateforme indépendante, fiable et sécurisée pour les clubs,
          les équipes et les saisons du football amateur.
        </p>
        <div className="status">
          <span className="dot" aria-hidden="true" />
          Step 1 · Fondation en cours
        </div>
      </section>
    </main>
  );
}
