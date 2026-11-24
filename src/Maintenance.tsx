// Full-page notice shown instead of the app while the backend is down.
// Turn it off by setting MAINTENANCE_MODE to false in main.tsx and pushing.
export default function Maintenance() {
  return (
    <main className="maintenance">
      <div className="maintenance-card">
        <div className="maintenance-logo-ring">
          <img src="/logo.png" alt="Nana Aba AI" className="maintenance-logo" />
        </div>
        <span className="maintenance-status">
          <span className="maintenance-dot" aria-hidden="true" />
          Under maintenance
        </span>
        <h1>
          <span className="maintenance-brand">Nana Aba AI</span> will be back soon
        </h1>
        <p>
          We're making some improvements to serve you better. Please check back shortly.
          Thank you for your patience.
        </p>
      </div>
      <footer className="maintenance-footer">University of Ghana · Nana Aba AI</footer>
    </main>
  );
}
