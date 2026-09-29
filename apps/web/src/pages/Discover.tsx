import { Search, Telescope } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { ProjectCard } from "../components/ProjectCard.js";
import { CloudGate, Empty, ErrorState, Loading } from "../components/States.js";
import { discover, type DiscoverRow, type DiscoverSort } from "../lib/api.js";
import { useAsync } from "../lib/useAsync.js";

const SORTS: readonly { id: DiscoverSort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "most-forked", label: "Most forked" },
  { id: "most-liked", label: "Most liked" },
];
const PAGE = 24;

function Results({ sort, search }: { sort: DiscoverSort; search: string }) {
  const [pages, setPages] = useState(1);
  const result = useAsync(
    () => discover(sort, { limit: PAGE * pages, search }),
    [sort, search, pages],
  );
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.reload} />;
  const rows: readonly DiscoverRow[] | undefined = result.data;
  if (rows === undefined) return <Loading label="Loading designs" />;
  if (rows.length === 0) {
    return (
      <Empty
        icon={<Telescope />}
        title={search ? "No designs match that search" : "Nothing published yet"}
      >
        <p>{search ? "Try a different word." : "Be the first: build something and publish it."}</p>
      </Empty>
    );
  }
  return (
    <>
      <div className="grid">
        {rows.map((row) => (
          <ProjectCard
            key={row.id}
            to={`/project/${row.id}`}
            project={{
              ...row,
              owner: {
                username: row.owner_username,
                display_name: row.owner_display_name,
                avatar_path: row.owner_avatar_path,
              },
              ...(row.forked_from_project_id ? { badge: "Fork" } : {}),
            }}
          />
        ))}
      </div>
      {rows.length === PAGE * pages && (
        <div className="center">
          <button
            type="button"
            className="btn"
            onClick={() => setPages((p) => p + 1)}
            disabled={result.status === "loading"}
          >
            Load more
          </button>
        </div>
      )}
    </>
  );
}

export function Discover() {
  const [params, setParams] = useSearchParams();
  const sort = (SORTS.find((s) => s.id === params.get("sort"))?.id ?? "trending") as DiscoverSort;
  const search = params.get("q") ?? "";
  const [draft, setDraft] = useState(search);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="dim">
            Published designs from the community. Open one to run it, or fork it to make it yours.
          </p>
        </div>
      </header>
      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Sort designs">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === sort}
              className={s.id === sort ? "is-active" : ""}
              onClick={() => setParams((p) => (p.set("sort", s.id), p))}
            >
              {s.label}
            </button>
          ))}
        </div>
        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setParams((p) => (draft.trim() ? p.set("q", draft.trim()) : p.delete("q"), p));
          }}
        >
          <Search aria-hidden="true" />
          <input
            className="input"
            placeholder="Search designs"
            aria-label="Search designs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
      </div>
      <CloudGate>
        <Results key={`${sort}|${search}`} sort={sort} search={search} />
      </CloudGate>
    </section>
  );
}
