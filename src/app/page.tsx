import { AuthPanel } from "@/components/AuthPanel";

const highlights = [
  "Multi-agent OpenCode sessions",
  "Model routing & token wallet",
  "Human-in-the-loop approvals",
  "Marketplace, billing & admin",
];

export default function Home() {
  return (
    <main className="landing-shell">
      <header className="landing-topbar" aria-label="Branding">
        <div className="landing-brand">
          <span className="landing-brand-orb" aria-hidden>
            P
          </span>
          <div>
            <strong>PineApple</strong>
            <span>Assistant</span>
          </div>
        </div>
        <a className="landing-topbar-link" href="#access">
          Get started
        </a>
      </header>

      <section className="hero-grid">
        <div className="hero-copy" id="story">
          <div className="eyebrow">OpenCode agent platform</div>
          <h1>Your command center for agents, tasks, and tokens.</h1>
          <p>
            A clean, premium workspace: chat with deployed agents, manage subscriptions and token
            packs, route high-risk work through approvals, and keep full visibility in tasks and
            logs.
          </p>
          <div className="highlight-row">
            {highlights.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div id="access" className="landing-auth-wrap">
          <AuthPanel />
        </div>
      </section>

      <section className="signal-strip" aria-label="Highlights">
        <article>
          <strong>Runtime</strong>
          <span>Per-user sessions, wallet balances, and agent deployment aligned to your plan.</span>
        </article>
        <article>
          <strong>Safety</strong>
          <span>Sensitive operations can pause for your approval before they run.</span>
        </article>
        <article>
          <strong>Operations</strong>
          <span>Editable plans, token packs, transactions, and audit-friendly logging.</span>
        </article>
      </section>
    </main>
  );
}
