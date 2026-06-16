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
        <div className="modal-head">
          <h2 id="login-title">Sign in to Nana Aba AI</h2>
          {onClose && (
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >
              ×
            </button>
          )}
        </div>
        <div className="modal-body">
          {prompt && <p className="login-prompt">{prompt}</p>}
          <p className="login-blurb">
            Sign in with your Google account to keep using Nana Aba AI. We use it
            only to identify you — nothing else.
          </p>
          {!configured && (
            <div className="feedback-error">
              Auth isn't configured on this build. Set{" "}
              <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> and
              restart.
            </div>
          )}
          {error && <div className="feedback-error">{error}</div>}
          <button
            type="button"
            className="google-signin-btn"
            onClick={onGoogle}
            disabled={busy || !configured}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
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
            {busy ? "Redirecting…" : "Continue with Google"}
          </button>
          <p className="login-fine">
            By signing in you agree to use Nana Aba AI responsibly. We don't
            share your data.
          </p>
        </div>
      </div>
    </div>
  );
}
