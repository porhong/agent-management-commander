import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { call, useAction, useQuery } from '@/lib/ipc';
import { KINDS } from '@/lib/kinds';
import { STATUS } from '@/lib/status';

type Step = 'welcome' | 'library' | 'tools' | 'import';
const ORDER: Step[] = ['welcome', 'library', 'tools', 'import'];

/**
 * First run, and re-runnable from Settings (T1.9.1). It explains where things are and what was
 * found. It writes nothing anywhere except the one settings flag that marks it seen — offering
 * to import is as far as it goes, and import itself never touches a tool folder.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const status = useQuery('system.status', undefined);
  const tools = useQuery('tools.detect', undefined);
  const settings = useQuery('settings.get', undefined);
  const update = useAction('settings.update');
  const navigate = useNavigate();

  const index = ORDER.indexOf(step);
  const installed = (tools.data ?? []).filter((t) => t.installed);
  const libraryPath =
    String(settings.data?.['libraryRoot'] ?? '') || `${status.data?.home ?? '~/.amc'}/library`;

  async function finish(to?: string) {
    await update.run({ patch: { onboarded: true } });
    onDone();
    if (to) navigate(to);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to AMC"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
    >
      <div className="flex h-full w-full max-w-2xl flex-col px-8 py-10">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight">AMC</span>
          <span className="id text-muted-foreground">v{status.data?.version ?? ''}</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => void finish()}>
            <X className="size-3.5" aria-hidden />
            Skip
          </Button>
        </div>

        <div className="mt-8 min-h-0 flex-1 overflow-auto">
          {step === 'welcome' && (
            <>
              <h1 className="text-2xl font-semibold">One library, every tool</h1>
              <p className="mt-3 max-w-lg text-muted-foreground">
                Write an agent, a skill or a command once. AMC keeps the original, compiles it for
                each tool you use, and shows you exactly what would change before it writes
                anything.
              </p>
              <ul className="mt-6 flex flex-col gap-3">
                {(['agent', 'skill', 'command'] as const).map((kind) => {
                  const meta = KINDS[kind];
                  return (
                    <li key={kind} className="flex items-start gap-3">
                      <meta.Icon className={`mt-0.5 size-4 shrink-0 ${meta.color}`} aria-hidden />
                      <span>
                        <span className="font-medium">{meta.plural}</span>{' '}
                        <span className="text-muted-foreground">{BLURB[kind]}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {step === 'library' && (
            <>
              <h1 className="text-2xl font-semibold">Your library is yours</h1>
              <p className="mt-3 max-w-lg text-muted-foreground">
                Everything you write lives here as plain folders and files, in a git repo AMC
                commits to on every save. You can read it, back it up, or walk away with it.
              </p>
              <p className="id mt-4 truncate rounded-md border bg-surface p-3" title={libraryPath}>
                {libraryPath}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => void call('system.reveal', { what: 'library' })}
              >
                <FolderOpen className="size-3.5" aria-hidden />
                Open the folder
              </Button>
              <p className="mt-4 max-w-lg text-muted-foreground">
                You can move it later in Settings. Your tools&rsquo; own folders stay where they are
                — AMC only ever sends them compiled copies.
              </p>
            </>
          )}

          {step === 'tools' && (
            <>
              <h1 className="text-2xl font-semibold">What is on this machine</h1>
              <p className="mt-3 max-w-lg text-muted-foreground">
                {tools.loading
                  ? 'Looking…'
                  : installed.length === 0
                    ? 'No supported tools found yet. Install one and AMC will pick it up — nothing here depends on it.'
                    : `Found ${installed.length === 1 ? 'one tool' : `${installed.length} tools`}. These are the places AMC can deploy to.`}
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {(tools.data ?? []).map((tool) => (
                  <li key={tool.toolId} className="rounded-md border bg-surface p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          tool.installed ? STATUS['in-sync'].dot : STATUS.foreign.dot
                        }`}
                      />
                      <span className="font-medium">{tool.displayName}</span>
                      {tool.version && (
                        <span className="id truncate text-muted-foreground">{tool.version}</span>
                      )}
                      {!tool.installed && <span className="text-muted-foreground">not found</span>}
                    </div>
                    {Object.values(tool.roots).map((dir) => (
                      <p key={dir} className="id mt-1 truncate text-muted-foreground" title={dir}>
                        {dir}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 'import' && (
            <>
              <h1 className="text-2xl font-semibold">Start from what you have</h1>
              <p className="mt-3 max-w-lg text-muted-foreground">
                AMC can read the agents, skills and commands already in those folders and bring them
                into your library. It reads them and writes nothing back: the files in your tools
                are left exactly as they are.
              </p>
              <p className="mt-3 max-w-lg text-muted-foreground">
                You will see everything it found and decide what to keep, so there is no harm in
                looking.
              </p>
              <div className="mt-6 flex gap-2">
                <Button onClick={() => void finish('/import')}>
                  Look at what I have
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
                <Button variant="secondary" onClick={() => void finish('/')}>
                  Start empty
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex shrink-0 items-center gap-2">
          <div className="flex gap-1" aria-hidden>
            {ORDER.map((name, i) => (
              <span
                key={name}
                className={`h-1 w-8 rounded-full ${i <= index ? 'bg-ring' : 'bg-border'}`}
              />
            ))}
          </div>
          <span className="text-muted-foreground">
            Step {index + 1} of {ORDER.length}
          </span>
          <div className="flex-1" />
          {index > 0 && (
            <Button variant="ghost" onClick={() => setStep(ORDER[index - 1]!)}>
              <ArrowLeft className="size-3.5" aria-hidden />
              Back
            </Button>
          )}
          {step === 'import' ? (
            <Button variant="ghost" onClick={() => void finish()}>
              <Check className="size-3.5" aria-hidden />
              Done
            </Button>
          ) : (
            <Button onClick={() => setStep(ORDER[index + 1]!)}>
              Next
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const BLURB = {
  agent: 'are specialists you hand work to.',
  skill: 'are the knowledge and procedures they draw on.',
  command: 'are prompts you trigger by name.',
} as const;
