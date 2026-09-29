import { publicImageUrl } from "../lib/api.js";

export function Avatar({
  path,
  name,
  size = 28,
}: {
  path: string | null | undefined;
  name: string;
  size?: number;
}) {
  const url = publicImageUrl("avatars", path ?? null);
  const initials = (name.trim()[0] ?? "?").toUpperCase();
  return url === null ? (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  ) : (
    <img className="avatar" src={url} alt="" width={size} height={size} loading="lazy" />
  );
}
