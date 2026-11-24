// Full-page notice shown instead of the app while the backend is down.
// Turn it off by setting MAINTENANCE_MODE to false in main.tsx and pushing.
export default function Maintenance() {
  return (
    <main className="maintenance">
      <img src="/logo.png" alt="" className="maintenance-logo" />
      <h1>Nana Aba AI is under maintenance</h1>
      <p>We're making some improvements and will be back shortly. Thank you for your patience.</p>
    </main>
  );
}
