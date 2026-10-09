import { Compass } from "lucide-react";
import { Link } from "react-router";

export function NotFound() {
  return (
    <section className="page page--narrow">
      <div className="empty">
        <Compass />
        <h3>Nothing at this address</h3>
        <p>The page may have moved, or the design is private.</p>
        <div className="row">
          <Link className="btn" to="/">
            Home
          </Link>
          <Link className="btn btn--primary" to="/app">
            Open builder
          </Link>
        </div>
      </div>
    </section>
  );
}
