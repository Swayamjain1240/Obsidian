export function HealthPage() {
  return (
    <section className="page-layout empty-page" aria-labelledby="health-title">
      <span className="eyebrow">Future phase</span>
      <h1 id="health-title">Health checks are not implemented.</h1>
      <p className="muted">Obsidian will report build, test, runtime, and security checks only when that backend phase exists. No health result is fabricated here.</p>
      <span className="status-chip">Not implemented</span>
    </section>
  );
}
