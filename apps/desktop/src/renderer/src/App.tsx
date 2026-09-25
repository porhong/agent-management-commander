import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { CommandPalette } from '@/components/command-palette';
import { NewItemDialog } from '@/components/new-item-dialog';
import { LibraryList } from '@/routes/library-list';
import { ComingSoon, Dashboard } from '@/routes/placeholder';
import { useQuery } from '@/lib/ipc';
import type { EditableKind } from '@/lib/kinds';

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newKind, setNewKind] = useState<EditableKind | null>(null);
  const navigate = useNavigate();
  const settings = useQuery('settings.get', undefined);

  // Follows the OS unless Settings says otherwise (T1.6.1).
  useEffect(() => {
    const theme = settings.data?.['theme'];
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset['theme'] = theme;
    else delete document.documentElement.dataset['theme'];
  }, [settings.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <>
      <Routes>
        <Route element={<AppShell onOpenPalette={openPalette} />}>
          <Route index element={<Dashboard />} />
          <Route path="library/:kind" element={<LibraryList />} />
          <Route
            path="item/:id"
            element={
              <ComingSoon
                title="Item editor"
                milestone="M1.6"
                blurb="Edit an item, then preview exactly what each tool will receive."
              />
            }
          />
          <Route
            path="targets"
            element={
              <ComingSoon
                title="Targets"
                milestone="M1.7"
                blurb="Every tool and scope AMC can deploy to, plus the projects you register."
              />
            }
          />
          <Route
            path="matrix"
            element={
              <ComingSoon
                title="Deployment matrix"
                milestone="M1.7"
                blurb="Which item is installed in which tool, and whether it is current."
              />
            }
          />
          <Route
            path="history"
            element={
              <ComingSoon
                title="Deploy history"
                milestone="M1.7"
                blurb="Every deploy, what it changed, and a way back."
              />
            }
          />
          <Route
            path="deploy"
            element={
              <ComingSoon
                title="Deploy"
                milestone="M1.7"
                blurb="Review the plan before anything is written."
              />
            }
          />
          <Route
            path="import"
            element={
              <ComingSoon
                title="Import"
                milestone="M1.8"
                blurb="Bring in what you already have. Import never changes your tool folders."
              />
            }
          />
          <Route
            path="settings"
            element={
              <ComingSoon
                title="Settings"
                milestone="M1.9"
                blurb="Library location, theme, and how deploys are confirmed."
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      <CommandPalette open={paletteOpen} onClose={closePalette} onNewItem={setNewKind} />

      {newKind && (
        <NewItemDialog
          kind={newKind}
          onClose={() => setNewKind(null)}
          onCreated={(id) => {
            setNewKind(null);
            navigate(`/item/${id}`);
          }}
        />
      )}
    </>
  );
}
