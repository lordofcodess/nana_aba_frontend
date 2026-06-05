import { useState } from "react";
import { submitFeedback, type FeedbackPayload } from "./api";

type Props = {
  lastAssistantMessage: string | null;
  onClose: () => void;
  /** Optional default rating (e.g. when launched from a thumbs-up/down). */
  defaultRating?: FeedbackPayload["rating"];
};

export default function FeedbackModal({
  lastAssistantMessage,
  onClose,
  defaultRating,
}: Props) {
  const [rating, setRating] = useState<FeedbackPayload["rating"]>(defaultRating);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [includeContext, setIncludeContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({
        rating,
        message: message.trim(),
        email: email.trim() || undefined,
        context:
          includeContext && lastAssistantMessage
            ? lastAssistantMessage.slice(0, 10000)
            : undefined,
      });
      setSent(true);
      window.setTimeout(onClose, 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="feedback-title">Send feedback</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" type="button">
            ×
          </button>
        </div>
        {sent ? (
          <p className="modal-thanks">Thanks — your feedback was recorded.</p>
        ) : (
          <form className="modal-body" onSubmit={onSubmit}>
            <div className="feedback-rating">
              <button
                type="button"
                className={`pill ${rating === "like" ? "primary" : ""}`}
                onClick={() => setRating(rating === "like" ? undefined : "like")}
                aria-pressed={rating === "like"}
              >
                👍 Useful
              </button>
              <button
                type="button"
                className={`pill ${rating === "dislike" ? "primary" : ""}`}
                onClick={() => setRating(rating === "dislike" ? undefined : "dislike")}
                aria-pressed={rating === "dislike"}
              >
                👎 Not useful
              </button>
            </div>
            <label className="feedback-label" htmlFor="feedback-msg">
              What's on your mind?
            </label>
            <textarea
              id="feedback-msg"
              className="feedback-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what worked, what didn't, or what you'd like to see…"
              rows={5}
              required
              maxLength={4000}
            />
            <label className="feedback-label" htmlFor="feedback-email">
              Email (optional — if you'd like a reply)
            </label>
            <input
              id="feedback-email"
              className="feedback-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              maxLength={200}
            />
            {lastAssistantMessage && (
              <label className="feedback-check">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(e) => setIncludeContext(e.target.checked)}
                />
                Include the last assistant message as context
              </label>
            )}
            {error && <div className="feedback-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="pill" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="pill primary"
                disabled={busy || !message.trim()}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
