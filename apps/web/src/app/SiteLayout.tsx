import { GithubMark } from "../components/BrandIcons.js";
import { Link, NavLink, Outlet } from "react-router";
import { AccountMenu } from "../components/AccountMenu.js";
import { Logo } from "../components/Logo.js";

export function SiteLayout() {
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-header__inner">
          <Logo />
          <nav className="site-nav" aria-label="Main">
            <NavLink to="/discover">Discover</NavLink>
            <NavLink to="/leaderboards">Leaderboards</NavLink>
            <NavLink to="/projects">My projects</NavLink>
          </nav>
          <div className="site-header__end">
            <Link to="/app" className="btn btn--primary btn--sm">
              Open builder
            </Link>
            <AccountMenu />
          </div>
        </div>
      </header>
      <main id="main" className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>
            ForgeLab — an engineering sandbox. Results come from simplified, documented models and
            do not validate real reactor designs.
          </span>
          <a
            href="https://github.com/blackadmen732-wq/ForgeLab"
            className="dim"
            target="_blank"
            rel="noreferrer"
          >
            <GithubMark /> Source
          </a>
        </div>
      </footer>
    </div>
  );
}
