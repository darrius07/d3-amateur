import type { ClubCompleteness } from "./profile";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The one, single progress representation used everywhere completeness is
 * shown (mission section 11: "choisir UNE représentation principale") --
 * a ring with the percentage inside, plus the explicit checklist beneath
 * it so the OWNER always sees exactly what is done and what remains.
 */
export function CompletenessRing({ completeness }: { completeness: ClubCompleteness }) {
  const offset = CIRCUMFERENCE * (1 - completeness.percent / 100);
  const complete = completeness.percent === 100;
  return (
    <div className={`completeness-ring${complete ? " completeness-ring--complete" : ""}`}>
      <svg viewBox="0 0 100 100" width="96" height="96" aria-hidden="true">
        <circle cx="50" cy="50" r={RADIUS} className="completeness-ring-track" />
        <circle cx="50" cy="50" r={RADIUS} className="completeness-ring-progress" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset} />
      </svg>
      <div className="completeness-ring-label" role="status">
        <strong>{completeness.percent}%</strong>
        <span>{completeness.completed} / {completeness.total}</span>
      </div>
    </div>
  );
}

export function CompletenessChecklist({ completeness }: { completeness: ClubCompleteness }) {
  return (
    <ul className="completeness-checklist">
      {completeness.items.map((item) => (
        <li key={item.key} className={item.done ? "is-done" : undefined}>
          <span aria-hidden="true">{item.done ? "✓" : "○"}</span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
