import type { SessionState } from "../store";

import type { ProjectDetails, ProjectAvatarValue } from "@shared/projects";
export type { ProjectDetails, ProjectAvatarValue } from "@shared/projects";

export interface Project {
  readonly avatar?: ProjectAvatarValue;
  readonly cwd: string;
  readonly name: string;
  readonly id: string;
  readonly session: SessionState;
  readonly note: string;
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part !== "") ?? path;
}

/** Project identity is its single agent session handle, never the workspace path. */
export function listProjects(
  sessions: readonly SessionState[],
  details: Readonly<Record<string, ProjectDetails>>,
): readonly Project[] {
  return sessions.flatMap((session) => {
    const id = session.summary.handle;
    const saved = details[id];
    if (!saved) return [];
    return [
      {
        id,
        cwd: session.summary.cwd,
        name: saved.name || folderName(session.summary.cwd),
        session,
        note: saved.note ?? "",
        ...(saved.avatar ? { avatar: saved.avatar } : {}),
      },
    ];
  });
}

/** Only an explicit, standalone @note mention attaches the saved note. */
export function mentionsNote(input: string): boolean {
  return /(?:^|\s)@note(?=$|\s|[.,!?;:，。！？；：])/u.test(input);
}

export function projectPrompt(input: string, project: Pick<Project, "note">): string {
  const note = project.note.trim();
  return mentionsNote(input) && note
    ? `${input}\n\n--- Referenced note (@note) ---\n${note}`
    : input;
}
