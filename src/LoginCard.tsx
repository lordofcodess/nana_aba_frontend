// Modal shown when a user is anonymous and either hits the free-message
// limit or clicks "Sign in" from the sidebar.

import { useState } from "react";
import { useAuth } from "./AuthContext";

type Props = {
  /** Optional explanatory line (e.g. "You've used your 3 free messages."). */
  prompt?: string;
  /** Called when the user closes without signing in. */
  onClose?: () => void;
};

export default function LoginCard({ prompt, onClose }: Props) {
  const { signInWithGoogle, configured } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
    // success path redirects away — no need to setBusy(false)
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
      onClick={onClose}
    >
      <div className="modal login-card" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button
            className="login-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        <div className="login-icon">
          <img src="/logo.png" alt="" />
        </div>

        <h2 id="login-title" className="login-title">
          Sign up or Login
        </h2>

        <p className="login-blurb">
          Start chatting with <span className="login-highlight">Nana Aba AI</span>{" "}
          and get answers about University of Ghana — programmes, admissions,
          and campus life.
        </p>

        {prompt && (
          <div className="login-notice" role="alert">
            <span className="login-notice-icon" aria-hidden="true">!</span>
            <span>{prompt}</span>
          </div>
        )}

        {!configured && (
          <div className="login-notice" role="alert">
            <span className="login-notice-icon" aria-hidden="true">!</span>
            <span>
              Auth isn't configured on this build. Set{" "}
              <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> and
              restart.
            </span>
          </div>
        )}

        {error && (
          <div className="login-notice" role="alert">
            <span className="login-notice-icon" aria-hidden="true">!</span>
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          className="login-google-btn"
          onClick={onGoogle}
          disabled={busy || !configured}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M21.6 12.227c0-.71-.064-1.39-.183-2.045H12v3.868h5.385a4.6 4.6 0 01-1.997 3.016v2.51h3.232c1.889-1.74 2.98-4.305 2.98-7.349z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.964-.894 6.62-2.424l-3.232-2.51c-.896.6-2.043.955-3.388.955-2.604 0-4.81-1.76-5.598-4.122H3.064v2.59A9.996 9.996 0 0012 22z"
            />
            <path
              fill="#FBBC05"
              d="M6.402 13.9a6.014 6.014 0 010-3.8v-2.59H3.064a10.005 10.005 0 000 8.98l3.338-2.59z"
            />
            <path
              fill="#EA4335"
              d="M12 5.978c1.468 0 2.786.504 3.823 1.495l2.866-2.866C16.96 2.99 14.696 2 12 2A9.996 9.996 0 003.064 7.51l3.338 2.59C7.19 7.738 9.396 5.978 12 5.978z"
            />
          </svg>
          <span>{busy ? "Redirecting…" : "Continue with Google"}</span>
          <span className="login-arrow" aria-hidden="true">→</span>
        </button>

        <p className="login-fine">
          By signing in, you agree to use Nana Aba AI responsibly. We don't
          share your data.
        </p>
      </div>
    </div>
  );
}
