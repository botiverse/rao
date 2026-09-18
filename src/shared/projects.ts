export interface ProjectAvatarValue {
  readonly icon: string;
  readonly color: string;
}
export interface ProjectDetails {
  readonly avatar?: ProjectAvatarValue;
  readonly name: string;
  readonly note: string;
}
export function projectId(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{1,128}$/.test(value))
    throw new TypeError("Invalid project ID");
  return value;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseProjectDetails(value: unknown): ProjectDetails {
  if (
    !object(value) ||
    typeof value.name !== "string" ||
    typeof value.note !== "string" ||
    value.name.length > 512 ||
    value.note.length > 1_000_000 ||
    value.name.includes("\0") ||
    value.note.includes("\0")
  ) {
    throw new TypeError("Invalid project name or note");
  }
  let avatar: ProjectAvatarValue | undefined;
  if (value.avatar !== undefined) {
    const raw = value.avatar;
    if (
      !object(raw) ||
      typeof raw.icon !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(raw.icon) ||
      typeof raw.color !== "string" ||
      !/^#[\da-f]{6}$/i.test(raw.color)
    )
      throw new TypeError("Invalid project avatar");
    avatar = { icon: raw.icon, color: raw.color };
  }
  return { name: value.name, note: value.note, ...(avatar ? { avatar } : {}) };
}
