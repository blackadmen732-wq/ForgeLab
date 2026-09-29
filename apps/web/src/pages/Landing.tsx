import { Activity, Boxes, GitFork, Flame, Gauge, Trophy } from "lucide-react";
import { Link } from "react-router";

/** A schematic cross-section of a tokamak plant, drawn as an engineering sheet. */
function HeroSchematic() {
  return (
    <svg
      className="hero__schematic"
      viewBox="0 0 560 380"
      role="img"
      aria-label="Schematic cross-section of a fusion power plant"
    >
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--line)" strokeWidth="0.6" />
        </pattern>
        <radialGradient id="plasma" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--plasma)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--plasma)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="560" height="380" fill="url(#grid)" />
      {/* ground */}
      <path d="M20 330H540" stroke="var(--line-strong)" strokeWidth="1.5" />
      {/* TF coils */}
      <g fill="none" stroke="var(--field)" strokeOpacity="0.8" strokeWidth="2">
        <path d="M110 320V110a70 70 0 0 1 70-70h0a70 70 0 0 1 70 70v210z" />
        <path
          d="M310 320V110a70 70 0 0 1 70-70h0a70 70 0 0 1 70 70v210z"
          transform="translate(-60 0)"
          opacity="0.35"
        />
      </g>
      {/* blanket and vessel (poloidal section, two legs) */}
      <g>
        <ellipse
          cx="180"
          cy="185"
          rx="52"
          ry="92"
          fill="none"
          stroke="var(--coolant)"
          strokeWidth="10"
          strokeOpacity="0.35"
        />
        <ellipse
          cx="180"
          cy="185"
          rx="40"
          ry="78"
          fill="none"
          stroke="var(--text-dim)"
          strokeWidth="2"
        />
        <ellipse cx="180" cy="185" rx="30" ry="62" fill="url(#plasma)" className="hero__plasma" />
      </g>
      {/* central solenoid */}
      <rect
        x="84"
        y="95"
        width="14"
        height="180"
        fill="none"
        stroke="var(--field)"
        strokeWidth="2"
      />
      {/* coolant loop to steam generator */}
      <path d="M232 150H330V120H370" fill="none" stroke="var(--coolant)" strokeWidth="2" />
      <path d="M370 250H330V220H232" fill="none" stroke="var(--heat-hot)" strokeWidth="2" />
      <rect
        x="370"
        y="100"
        width="40"
        height="170"
        rx="6"
        fill="var(--panel)"
        stroke="var(--text-dim)"
      />
      <text x="390" y="290" textAnchor="middle" className="hero__label">
        SG
      </text>
      {/* steam to turbine */}
      <path d="M410 130H450" stroke="var(--steam)" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M450 110L500 125V165L450 180Z" fill="var(--panel)" stroke="var(--text-dim)" />
      <rect
        x="500"
        y="132"
        width="26"
        height="26"
        rx="4"
        fill="var(--panel)"
        stroke="var(--power)"
      />
      <path d="M526 145H548" stroke="var(--power)" strokeWidth="2" />
      <text x="475" y="200" textAnchor="middle" className="hero__label">
        TURBINE
      </text>
      {/* callouts */}
      <g className="hero__callouts">
        <path d="M180 185L60 60" stroke="var(--text-faint)" />
        <text x="24" y="52" className="hero__label">
          PLASMA 12.4 keV
        </text>
        <path d="M250 110L300 70" stroke="var(--text-faint)" />
        <text x="300" y="62" className="hero__label">
          TF 5.3 T
        </text>
        <path d="M232 220L280 300" stroke="var(--text-faint)" />
        <text x="250" y="316" className="hero__label">
          σ/σy 0.71
        </text>
      </g>
    </svg>
  );
}

const FEATURES = [
  {
    icon: Boxes,
    title: "Build freely",
    body: "Start from an empty workspace. Place parametric vessels, coils, pumps, pipes, turbines and structure; resize them; wire power, coolant, steam and control however you like.",
  },
  {
    icon: Gauge,
    title: "Physics decides",
    body: "A deterministic engine computes stresses, buckling, electrical networks, coolant flow, magnetic fields, a 0D plasma and D-T fusion power — then nets out the plant's own consumption.",
  },
  {
    icon: Flame,
    title: "Break it, learn why",
    body: "Failures are traced back to their root cause: the pump that lost power, the loop that stopped, the wall that overheated, the plasma that disrupted. Click any event to fly to it.",
  },
  {
    icon: Activity,
    title: "Honest about its limits",
    body: "Every result carries a confidence label — Supported, Approximate or Experimental — and every model is documented. ForgeLab is a sandbox, not a design-validation tool.",
  },
  {
    icon: GitFork,
    title: "Share and fork",
    body: "Publish a design with its history. Anyone can open it, run it, and fork it into their own version — lineage is kept, so improvements are traceable.",
  },
  {
    icon: Trophy,
    title: "Scores the server checks",
    body: "Leaderboard results are recomputed on the server with the same engine and a fixed scenario. Browser-reported numbers never reach a leaderboard.",
  },
];

export function Landing() {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Browser engineering sandbox · V0.1</p>
          <h1 className="hero__title">
            Build anything.
            <br />
            Physics decides.
          </h1>
          <p className="hero__lede">
            Design fusion power plants and the machines around them in 3D, then run them. A
            real-units simulation decides whether your design holds together, makes power, or fails
            — and shows you exactly why.
          </p>
          <div className="row hero__cta">
            <Link to="/app" className="btn btn--primary btn--lg">
              Start Building
            </Link>
            <Link to="/discover" className="btn btn--lg">
              Explore Designs
            </Link>
          </div>
          <p className="hero__note dim">
            No account needed to build. Sign in to save to the cloud and publish.
          </p>
        </div>
        <HeroSchematic />
      </section>

      <section className="features" aria-label="What ForgeLab does">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <article key={title} className="feature">
            <Icon aria-hidden="true" />
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="loop" aria-label="How it works">
        <h2>The loop</h2>
        <ol className="loop__steps">
          <li>
            <span className="num">01</span>
            <strong>Build</strong>
            <span>Place and connect parts in an open 3D workspace.</span>
          </li>
          <li>
            <span className="num">02</span>
            <strong>Simulate</strong>
            <span>Run the plant in a worker thread at up to 10× or flat out.</span>
          </li>
          <li>
            <span className="num">03</span>
            <strong>Fail</strong>
            <span>Read the causal chain: what broke first, and what it took down.</span>
          </li>
          <li>
            <span className="num">04</span>
            <strong>Fix</strong>
            <span>Change a material, a dimension or a setpoint, and run it again.</span>
          </li>
          <li>
            <span className="num">05</span>
            <strong>Share</strong>
            <span>Publish, get forked, and submit a server-verified score.</span>
          </li>
        </ol>
        <Link to="/app" className="btn btn--primary btn--lg">
          Start Building
        </Link>
      </section>
    </div>
  );
}
