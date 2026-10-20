import { Link } from "react-router-dom";
import { PageHeading } from "../components/Usage.jsx";
import { markOnboardingComplete } from "../onboarding.js";

export default function Welcome() {
  return <>
    <PageHeading title="Your usage, clearly attributed" description="Local-first usage analytics, with original text and turn previews in Session Detail. Hide text whenever you need to." />
    <section className="card welcome"><p className="eyebrow">START WITH EVIDENCE</p>
      <h2>Explore a model. Understand a session. Decide what to try.</h2>
      <p>Overview charts daily request usage, model share, and usage by scope. Follow a day, model, or scope into sortable anonymous sessions. Session Detail separates primary, child, and unattributed usage, with evidence for each available metric.</p>
      <p>Missing data stays Not recorded. Optional guidance explains one change to consider and a metric to compare. No exercises, personal grades, or automatic configuration changes.</p>
      <div className="actions"><Link className="button-link" to="/" onClick={markOnboardingComplete}>Explore Overview</Link>
        <Link to="/settings">Check Data Sources</Link></div>
    </section>
  </>;
}
