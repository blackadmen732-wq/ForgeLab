import { createBrowserRouter } from "react-router";
import { RootLayout } from "./RootLayout.js";
import { RouteError } from "./RouteError.js";
import { SiteLayout } from "./SiteLayout.js";
import { Landing } from "../pages/Landing.js";
import { NotFound } from "../pages/NotFound.js";

/**
 * Routes. The landing page ships in the main bundle so it paints immediately; everything
 * else is split, and the builder (three.js, R3F, the engine) is its own large chunk that
 * only loads when someone opens it.
 */
const lazyPage =
  <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  async () => {
    const module = await load();
    return { Component: module[name] };
  };

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        // One route for both, so the builder is not remounted when a new project gets its id.
        path: "/app/:projectId?",
        lazy: lazyPage(() => import("../builder/BuilderRoute.js"), "BuilderRoute"),
      },
      {
        element: <SiteLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Landing /> },
          { path: "projects", lazy: lazyPage(() => import("../pages/Projects.js"), "Projects") },
          { path: "discover", lazy: lazyPage(() => import("../pages/Discover.js"), "Discover") },
          {
            path: "leaderboards",
            lazy: lazyPage(() => import("../pages/Leaderboards.js"), "Leaderboards"),
          },
          {
            path: "project/:id",
            lazy: lazyPage(() => import("../pages/ProjectPage.js"), "ProjectPage"),
          },
          {
            path: "profile/:username",
            lazy: lazyPage(() => import("../pages/Profile.js"), "Profile"),
          },
          { path: "invite", lazy: lazyPage(() => import("../pages/Invite.js"), "Invite") },
          { path: "settings", lazy: lazyPage(() => import("../pages/Settings.js"), "Settings") },
          {
            path: "auth/callback",
            lazy: lazyPage(() => import("../pages/AuthCallback.js"), "AuthCallback"),
          },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
