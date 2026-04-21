/**
 * Visual navigation group for the sidebar.
 * Optional label (e.g. "CORE", "ADVANCED") shown above links.
 * Groups links with a subtle divider between sections.
 */
export function NavGroup({ label, children }) {
  return (
    <div className="nav-group">
      {label && <div className="nav-group-label">{label}</div>}
      {children}
    </div>
  );
}
