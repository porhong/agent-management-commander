import { Navigate, RouterProvider, createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { Deploy } from '@/routes/deploy';
import { DeployHistory } from '@/routes/deploy-history';
import { LibraryList } from '@/routes/library-list';
import { Matrix } from '@/routes/matrix';
import { Targets } from '@/routes/targets';
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
      { path: 'targets', element: <Targets /> },
      { path: 'matrix', element: <Matrix /> },
      { path: 'history', element: <DeployHistory /> },
      { path: 'deploy', element: <Deploy /> },
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
