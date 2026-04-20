import { Link } from "react-router-dom";

export function SuggestedNext({ to, icon, label, description }) {
  return (
    <div className="suggested-next">
      <Link to={to} className="suggested-next-link">
        <span className="suggested-next-cta">Dive deeper →</span>
        <span className="suggested-next-icon">{icon}</span>
        <strong>{label}</strong>
        <span className="suggested-next-desc">— {description}</span>
      </Link>
    </div>
  );
}
