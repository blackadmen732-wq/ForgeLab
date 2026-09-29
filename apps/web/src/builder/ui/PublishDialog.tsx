import { ExternalLink, Globe, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Dialog } from "../../components/Dialog.js";
import { publicImageUrl, removeImage, updateProject, uploadImage } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.js";
import { resizeImage } from "../../lib/images.js";
import { errorMessage, toast } from "../../lib/toast.js";
import { useEditor, useEditorStore } from "../store/context.js";

/** Publishing makes the project public with a thumbnail captured from the viewport. */
export function PublishDialog() {
  const store = useEditorStore();
  const auth = useAuth();
  const cloud = useEditor((v) => v.cloud);
  const name = useEditor((v) => v.name);
  const [description, setDescription] = useState(cloud?.description ?? "");
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => store.openDialog(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void (async () => {
      try {
        const png = await store.viewport?.capture();
        if (!png || !live) return;
        const blob = await resizeImage(png, 800, 500);
        if (!live) return;
        setThumb(blob);
        url = URL.createObjectURL(blob);
        setPreview(url);
      } catch {
        // No thumbnail: publishing still works.
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [store]);

  if (cloud === null || auth.user === null) return null;
  const isPublic = cloud.visibility === "public";
  const existingThumb = publicImageUrl("thumbnails", cloud.thumbnailPath);

  const publish = async (visibility: "public" | "private") => {
    setBusy(true);
    try {
      await store.cloud.flush();
      let thumbnailPath = cloud.thumbnailPath;
      if (visibility === "public" && thumb !== null) {
        const uploaded = await uploadImage("thumbnails", auth.user!.id, thumb, name);
        if (thumbnailPath) await removeImage("thumbnails", thumbnailPath).catch(() => undefined);
        thumbnailPath = uploaded;
      }
      const project = await updateProject(cloud.projectId, {
        visibility,
        description: description.trim().slice(0, 4000),
        thumbnail_path: thumbnailPath,
        name,
      });
      store.cloud.updateBinding({
        visibility: project.visibility,
        description: project.description,
        thumbnailPath: project.thumbnail_path,
        name: project.name,
      });
      toast(
        "success",
        visibility === "public" ? "Published" : "Unpublished",
        visibility === "public"
          ? "Anyone with the link can open, run and fork it."
          : "Only you can see it now.",
      );
      if (visibility === "private") close();
    } catch (error) {
      toast("error", "Couldn't update the project", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={isPublic ? "Published" : "Publish design"}
      onClose={close}
      wide
      footer={
        <>
          {isPublic && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void publish("private")}
            >
              <Lock /> Unpublish
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void publish("public")}
          >
            <Globe /> {isPublic ? "Update public page" : "Publish"}
          </button>
        </>
      }
    >
      <div className="publish">
        <div className="publish__thumb">
          {preview ? (
            <img src={preview} alt="Thumbnail preview from the current view" />
          ) : existingThumb ? (
            <img src={existingThumb} alt="Current thumbnail" />
          ) : (
            <div className="card__placeholder" />
          )}
          <span className="field__hint">
            Thumbnail from the current view. Frame the design the way you want it shown, then reopen
            this dialog.
          </span>
        </div>
        <div className="stack">
          <p>
            <strong>{name}</strong>
          </p>
          <label className="field">
            <span className="field__label">Description</span>
            <textarea
              className="textarea"
              maxLength={4000}
              value={description}
              placeholder="What is it, what did you try, what broke?"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <p className="dim">
            Publishing shares the latest saved version and your named versions. Autosave history
            stays private. Others can fork it into their own projects; lineage is kept.
          </p>
          {isPublic && (
            <Link className="btn btn--sm" to={`/project/${cloud.projectId}`} target="_blank">
              <ExternalLink /> Open public page
            </Link>
          )}
        </div>
      </div>
    </Dialog>
  );
}
