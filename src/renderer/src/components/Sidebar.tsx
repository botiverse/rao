import { ArrowUpRight, LayoutDashboard, Layers3, Plus, Search } from "lucide-react";
import { ProjectAvatar } from "./ProjectAvatar";
import { ProjectMenu } from "./ProjectMenu";
import { useCallback, useState } from "react";
import type { Project } from "../lib/projects";
import { useStore } from "../store";

export function Sidebar({
  projects,
  selected,
  onSelect,
  onNewProject,
  dashboard,
  onDashboard,
}: {
  projects: readonly Project[];
  selected: string | null;
  onSelect: (project: Project) => void;
  onNewProject: () => void;
  dashboard: boolean;
  onDashboard: () => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuProject = projects.find((project) => project.id === menu?.id);
  const [query, setQuery] = useState("");
  const loaded = useStore((store) => store.loaded);
  const runtimes = useStore((store) => store.runtimes);
  const available = runtimes.filter((runtime) => runtime.installation.kind === "available");
  const filtered = projects.filter((project) =>
    `${project.name} ${project.cwd}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <aside className="project-sidebar flex h-full w-60 shrink-0 flex-col border-r border-line bg-bg-sunken">
      <div className="drag-region h-12 shrink-0" />
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-2">
        <div className="brand-mark">r</div>
        <span className="text-lg font-semibold tracking-tight">rao</span>
        <span className="ml-auto rounded border border-line px-1.5 text-[10px] text-fg-faint">
          LOCAL
        </span>
      </div>
      <button
        type="button"
        onClick={onNewProject}
        disabled={!loaded}
        className="mx-3 mb-5 flex items-center justify-between rounded-lg border border-line-strong bg-bg-raised px-3 py-2 text-xs hover:border-accent disabled:opacity-40"
      >
        <span className="flex items-center gap-2">
          <Plus size={14} /> New project
        </span>
        <ArrowUpRight size={13} className="text-fg-faint" />
      </button>
      <label className="mx-4 mb-5 flex items-center gap-2 text-fg-faint">
        <Search size={14} />
        <input
          aria-label="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a project…"
          className="w-full min-w-0 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
        />
      </label>
      <div className="mb-2 flex items-center gap-2 px-5 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-faint">
        <Layers3 size={12} /> Projects{" "}
        <span className="ml-auto">{loaded ? projects.length : "—"}</span>
      </div>
      <nav
        aria-label="Projects"
        aria-busy={!loaded}
        className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3"
      >
        {!loaded ? (
          <div aria-hidden="true" className="space-y-1 motion-safe:animate-pulse">
            {["w-24", "w-32", "w-20"].map((width) => (
              <div key={width} className="flex items-center gap-2 rounded-md px-2 py-2">
                <span className="size-4 rounded bg-fg-faint/15" />
                <span className={`h-3 rounded bg-fg-faint/15 ${width}`} />
              </div>
            ))}
          </div>
        ) : (
          filtered.map((project) => {
            const busy = project.session.state === "busy";
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect(project)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ id: project.id, x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ id: project.id, x: rect.left, y: rect.bottom });
                  }
                }}
                title={project.name}
                aria-current={selected === project.id ? "page" : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${selected === project.id ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-bg-raised"}`}
              >
                <span>
                  <ProjectAvatar value={project.avatar} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{project.name}</span>
                {busy ? (
                  <span aria-label="Running" className="size-1.5 rounded-full bg-ok pulse" />
                ) : null}
              </button>
            );
          })
        )}
        {loaded && filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-fg-faint">
            {query ? "No matching projects." : "No projects."}
          </p>
        ) : null}
      </nav>
      <button
        type="button"
        onClick={onDashboard}
        aria-label="Dashboard"
        aria-current={dashboard ? "page" : undefined}
        className={`m-3 shrink-0 rounded-lg border p-3 text-left ${dashboard ? "border-line-strong bg-accent-soft text-fg" : "border-line text-fg-muted hover:bg-bg-raised hover:text-fg"}`}
      >
        <span className="flex items-center gap-2 text-xs">
          <LayoutDashboard size={14} /> Dashboard{" "}
          <span className="ml-auto size-1.5 rounded-full bg-ok" />
        </span>
        <span className="mt-1 block text-[10px] text-fg-faint">
          {loaded ? `${available.length} runtimes` : "Loading…"}
        </span>
      </button>
      {menu && menuProject ? (
        <ProjectMenu project={menuProject} x={menu.x} y={menu.y} onClose={closeMenu} />
      ) : null}
    </aside>
  );
}
