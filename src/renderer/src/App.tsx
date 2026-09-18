import { ProjectTransfer } from "./components/ProjectTransfer";
import { ContextUsageIndicator } from "./components/ContextUsageIndicator";
import { RuntimeLogo } from "./components/RuntimeLogo";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Layers3, LoaderCircle, PanelRight, Plus } from "lucide-react";
import { runtimeBrands } from "@botiverse/oar/brands";
import { AvatarPicker, ProjectAvatar } from "./components/ProjectAvatar";
import { Dashboard } from "./components/Dashboard";
import { Composer } from "./components/Composer";
import { NewSession } from "./components/NewSession";
import { ProjectContext } from "./components/ProjectContext";
import { Sidebar } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import { Transcript } from "./components/Transcript";
import { listProjects, projectPrompt, type Project } from "./lib/projects";
import { useProjects } from "./projects";
import { useStore } from "./store";

export function App() {
  const store = useStore();
  const {
    details,
    update,
    loaded: projectsLoaded,
    error: projectsError,
    load: loadProjects,
  } = useProjects();
  const [dashboard, setDashboard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const projects = listProjects(
    store.order.flatMap((handle) => (store.sessions[handle] ? [store.sessions[handle]] : [])),
    details,
  );
  const session = store.active === null ? undefined : store.sessions[store.active];
  const project = projects.find((item) => item.id === store.active);

  const { connect, load } = store;
  useEffect(() => {
    const disconnect = connect();
    void Promise.all([load(), loadProjects()]);
    return disconnect;
  }, [connect, load, loadProjects]);

  const selectProject = (item: Project): void => {
    setDashboard(false);
    void store.select(item.id);
  };

  return (
    <div className="relative flex h-full">
      <Sidebar
        projects={projects}
        selected={dashboard ? null : (project?.id ?? null)}
        onSelect={selectProject}
        dashboard={dashboard}
        onDashboard={() => setDashboard(true)}
        onNewProject={() => {
          if (store.loaded && projectsLoaded) setCreating(true);
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-line px-6">
          <div className="flex min-w-0 items-center gap-2 text-xs text-fg-faint">
            <Layers3 size={14} />
            <span>{dashboard ? "Dashboard" : "Projects"}</span>
            {project && !dashboard ? (
              <>
                <ChevronRight size={12} />
                <span className="truncate text-fg">{project.name}</span>
              </>
            ) : null}
          </div>
          {project && !dashboard ? (
            <button
              type="button"
              aria-label="Toggle project note"
              aria-pressed={contextOpen}
              onClick={() => setContextOpen(!contextOpen)}
              className="no-drag rounded p-1.5 text-fg-muted hover:bg-bg-raised"
            >
              <PanelRight size={15} />
            </button>
          ) : null}
        </header>
        {dashboard ? (
          <Dashboard />
        ) : (!store.loaded && store.error) || (projectsError && !projectsLoaded) ? (
          <div role="alert" className="m-auto p-6 text-sm text-danger">
            <p>{projectsError ?? store.error}</p>
            <button
              className="my-3 underline"
              type="button"
              onClick={() => {
                void Promise.all([load(), loadProjects()]);
              }}
            >
              Retry loading projects
            </button>
            <ProjectTransfer />
          </div>
        ) : !store.loaded || !projectsLoaded ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-faint"
          >
            <LoaderCircle
              size={22}
              aria-hidden="true"
              className="text-accent motion-safe:animate-spin"
            />
            <span className="text-xs">Loading projects…</span>
          </div>
        ) : !project || !session ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-2xl px-8 py-12">
              <div className="mb-8 flex items-center justify-between gap-4">
                <h1 className="text-xl font-medium tracking-tight">Projects</h1>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-fg-muted hover:bg-bg-raised hover:text-fg"
                >
                  <Plus size={14} /> New project
                </button>
              </div>
              <ProjectTransfer />
              {projects.length > 0 ? (
                <div className="divide-y divide-line">
                  {projects.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectProject(item)}
                      className="group flex w-full items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-bg-raised"
                    >
                      <ProjectAvatar value={item.avatar} size={18} />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                      <ArrowRight
                        size={14}
                        className="text-fg-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-fg-faint">No projects.</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AvatarPicker
                    value={project.avatar}
                    size={24}
                    onChange={(avatar) => update(project.id, { avatar })}
                  />
                  <h1 className="truncate text-2xl font-medium tracking-tight">{project.name}</h1>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 border-t border-line">
              <section
                key={`conversation:${session.summary.handle}`}
                className="flex min-w-0 flex-1 flex-col"
                aria-label="Project conversation"
              >
                <div className="flex items-center gap-2 border-b border-line/60 px-7 py-3">
                  <RuntimeLogo runtime={session.summary.runtime} />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {runtimeBrands[session.summary.runtime].name}
                  </span>
                  <ContextUsageIndicator
                    usage={session.summary.context ?? null}
                    live={session.summary.live}
                  />
                  <StatusPill
                    live={session.summary.live}
                    state={session.state}
                    status={session.status}
                  />
                </div>
                {session.transcript === null ? (
                  <div className="flex flex-1 items-center justify-center text-xs text-fg-faint">
                    Loading conversation…
                  </div>
                ) : (
                  <Transcript items={session.transcript} />
                )}
                <Composer
                  state={session.state}
                  live={session.summary.live}
                  canSteer={session.summary.capabilities?.steer ?? false}
                  note={project.note}
                  onSend={(input) => {
                    void store.send(session.summary.handle, projectPrompt(input, project));
                  }}
                  onAbort={() => {
                    void store.abort(session.summary.handle);
                  }}
                />
              </section>
              {contextOpen ? <ProjectContext key={project.id} project={project} /> : null}
            </div>
          </>
        )}
      </main>
      {creating ? (
        <NewSession onClose={() => setCreating(false)} onCreated={() => setDashboard(false)} />
      ) : null}
      {store.error === null ? null : (
        <div
          role="alert"
          className="absolute right-4 bottom-4 z-30 max-w-md rounded-lg border border-danger/40 bg-bg-raised p-3 text-xs text-danger shadow-xl"
        >
          {store.error}
          <button type="button" onClick={store.dismissError} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
