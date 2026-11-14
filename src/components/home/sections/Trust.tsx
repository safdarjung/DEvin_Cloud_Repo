"use client";

import { Lock, PenLine, Plus } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { TRUST } from "../story";

type Attempt = "none" | "blocked" | "corrected";

/** "History written in ink", as something you can try: editing a receipt is refused, a correction is a new entry. */
function InkToy() {
  const [attempt, setAttempt] = useState<Attempt>("none");
  const [tries, setTries] = useState(0);
  return (
    <div className="lh-ink">
      <div key={tries} className="lh-receipt lm-card" data-attempt={attempt}>
        <p className="lh-receipt-top">
          <span>Receipt R-0412</span>
          <span className="lm-chip">
            <Lock aria-hidden className="size-3.5" /> Locked
          </span>
        </p>
        <dl>
          <div>
            <dt>Term fee, Grade 7</dt>
            <dd>₹14,500</dd>
          </div>
          {attempt === "corrected" && (
            <div className="lh-receipt-new">
              <dt>Correction C-0031, linked to R-0412</dt>
              <dd>−₹500</dd>
            </div>
          )}
        </dl>
        {attempt === "blocked" && (
          <p className="lh-stamp" data-kind="refused" role="status">
            Refused by the database. Receipts cannot be edited.
          </p>
        )}
        {attempt === "corrected" && (
          <p className="lh-stamp" data-kind="saved" role="status">
            Both entries are kept. The audit log shows who, and when.
          </p>
        )}
      </div>
      <div className="lh-ink-actions">
        <button
          type="button"
          className="lm-btn"
          data-kind="paper"
          onClick={() => {
            setAttempt("blocked");
            setTries((n) => n + 1);
          }}
        >
          <PenLine aria-hidden className="size-4" /> Edit the amount
        </button>
        <button type="button" className="lm-btn" onClick={() => setAttempt("corrected")}>
          <Plus aria-hidden className="size-4" /> Add a correction
        </button>
      </div>
      <p className="lh-caption">Illustration with made-up numbers. In the product a trigger in the database does the refusing.</p>
    </div>
  );
}

export function Trust() {
  return (
    <section id="trust" className="lh-section" aria-labelledby="trust-title">
      <header className="lh-head" data-reveal="">
        <p className="lm-eyebrow">Why a school can rely on it</p>
        <h2 id="trust-title" className="lm-display lh-h2">
          Built so the record can be trusted.
        </h2>
        <p className="lm-lead">Four rules are enforced in the database and the code, not left to good habits.</p>
      </header>
      <div className="lh-trust">
        <ol className="lh-trust-list">
          {TRUST.map((t, i) => (
            <li key={t.key} className="lm-card" data-reveal="pop" style={{ "--i": i } as CSSProperties}>
              <span className="lh-rule-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="lh-rule-title">{t.title}</h3>
              <p>{t.body}</p>
            </li>
          ))}
        </ol>
        <div data-reveal="right">
          <InkToy />
        </div>
      </div>
    </section>
  );
}
