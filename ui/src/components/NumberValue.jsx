import { useHelpDisclosure } from "./HelpDisclosure.jsx";
import { compactNumber } from "../number-format.js";

export default function NumberValue({ value, metric, exact, tooltip, interactive = true }) {
  const abbreviated = compactNumber(value, metric);
  const label = exact ?? String(value);
  const disclosure = tooltip || label;
  const { triggerProps, tooltip: renderedTooltip, show } = useHelpDisclosure(disclosure);
  if (!tooltip && (!abbreviated || abbreviated === label)) return <span>{label}</span>;
  return <>
    <span {...triggerProps} className="compact-number" data-exact={label} aria-label={label}
      tabIndex={interactive ? 0 : undefined} role={interactive ? "button" : undefined}
      onKeyDown={(event) => {
        triggerProps.onKeyDown(event);
        if (interactive && ["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); show(); }
      }}
      onClick={interactive ? (event) => { event.preventDefault(); event.stopPropagation(); show(); } : undefined}>{abbreviated || label}</span>
    {renderedTooltip}
  </>;
}
