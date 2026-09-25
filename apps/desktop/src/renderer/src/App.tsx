import { Navigate, RouterProvider, createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { LibraryList } from '@/routes/library-list';
import { ItemEditor } from '@/routes/item';
import { ComingSoon, Dashboard } from '@/routes/placeholder';

/**
 * A data router, not `<Routes>`: the item editor uses `useBlocker` to hold a navigation while it
 * asks about unsaved changes, and only a data router can do that.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'library/:kind', element: <LibraryList /> },
      { path: 'item/:id', element: <ItemEditor /> },
      {
        path: 'targets',
        element: (
          <ComingSoon
            title="Targets"
            milestone="M1.7"
            blurb="Every tool and scope AMC can deploy to, plus the projects you register."
          />
        ),
      },
      {
        path: 'matrix',
        element: (
          <ComingSoon
            title="Deployment matrix"
            milestone="M1.7"
            blurb="Which item is installed in which tool, and whether it is current."
          />
        ),
      },
      {
        path: 'history',
        element: (
          <ComingSoon
            title="Deploy history"
            milestone="M1.7"
            blurb="Every deploy, what it changed, and a way back."
          />
        ),
      },
      {
        path: 'deploy',
        element: (
          <ComingSoon
            title="Deploy"
            milestone="M1.7"
            blurb="Review the plan before anything is written."
          />
        ),
      },
      {
        path: 'import',
        element: (
          <ComingSoon
            title="Import"
            milestone="M1.8"
            blurb="Bring in what you already have. Import never changes your tool folders."
          />
        ),
      },
      {
        path: 'settings',
        element: (
          <ComingSoon
            title="Settings"
            milestone="M1.9"
            blurb="Library location, theme, and how deploys are confirmed."
          />
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

let router: ReturnType<typeof createHashRouter> | undefined;

export function App() {
  // Hash routing: the packaged app is loaded from file://, which has no history server.
  router ??= createHashRouter(routes);
  return <RouterProvider router={router} />;
}
