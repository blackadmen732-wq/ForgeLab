import { LEADERBOARD_CATEGORIES } from "@forgelab/sim-runner";
import { ShieldCheck, Trophy } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Avatar } from "../components/Avatar.js";
import { ConfidenceBadge } from "../components/ConfidenceBadge.js";
import { CloudGate, Empty, ErrorState, Loading } from "../components/States.js";
import { leaderboard } from "../lib/api.js";
import { relativeTime } from "../lib/format.js";
import { useAsync } from "../lib/useAsync.js";

export function formatScore(category: string, value: number): string {
  switch (category) {
    case "net-electric":
      return `${(value / 1e6).toFixed(1)} MW`;
    case "lightest-net-positive":
      return `${(value / 1000).toFixed(1)} t`;
    case "fusion-gain":
      return `Q ${value.toFixed(2)}`;
    default:
      return String(value);
  }
}

function Board({ category }: { category: string }) {
  const rows = useAsync(() => leaderboard(category), [category]);
  if (rows.status === "error") return <ErrorState error={rows.error} onRetry={rows.reload} />;
  if (rows.data === undefined) return <Loading label="Loading leaderboard" />;
  if (rows.data.length === 0) {
    return (
      <Empty icon={<Trophy />} title="No verified entries yet">
        <p>
          Publish a design, then use “Submit score” in the builder. The server reruns it and records
          the result.
        </p>
      </Empty>
    );
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Engineer</th>
          <th scope="col">Design</th>
          <th scope="col" className="num-col">
            Score
          </th>
          <th scope="col">Model</th>
          <th scope="col">Verified</th>
        </tr>
      </thead>
      <tbody>
        {rows.data.map((row) => (
          <tr key={row.entry_id}>
            <td className="num">{row.rank}</td>
            <td>
              <Link to={`/profile/${row.username}`} className="who">
                <Avatar path={row.avatar_path} name={row.display_name || row.username} size={20} />
                {row.display_name || row.username}
              </Link>
            </td>
            <td>
              <Link to={`/project/${row.project_id}`}>{row.project_name}</Link>
            </td>
            <td className="num num-col">{formatScore(category, row.value)}</td>
            <td>
              <ConfidenceBadge level={row.confidence} />
            </td>
            <td className="dim">
              {relativeTime(row.verified_at)} · engine {row.engine_version}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Leaderboards() {
  const [params, setParams] = useSearchParams();
  const active =
    LEADERBOARD_CATEGORIES.find((c) => c.id === params.get("category")) ??
    LEADERBOARD_CATEGORIES[0]!;
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Leaderboards</h1>
          <p className="dim">
            <ShieldCheck aria-hidden="true" className="inline-icon" /> Every entry was recomputed on
            the server with the standard 10-minute scenario. Numbers a browser reports are never
            ranked.
          </p>
        </div>
      </header>
      <div className="segmented" role="tablist" aria-label="Category">
        {LEADERBOARD_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === active.id}
            className={c.id === active.id ? "is-active" : ""}
            onClick={() => setParams({ category: c.id })}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="dim board-desc">{active.description}</p>
      <CloudGate>
        <Board key={active.id} category={active.id} />
      </CloudGate>
    </section>
  );
}
