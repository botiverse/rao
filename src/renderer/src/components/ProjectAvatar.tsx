import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Atom,
  Bell,
  BookOpen,
  Bookmark,
  Bot,
  Box,
  Brain,
  Briefcase,
  Bug,
  Check,
  Cloud,
  Code,
  Coffee,
  Compass,
  Database,
  Diamond,
  FileCode,
  Flag,
  FlaskConical,
  Folder,
  Gamepad2,
  Gem,
  Globe,
  Heart,
  House,
  Layers,
  Leaf,
  Lightbulb,
  MessageSquare,
  Moon,
  Music,
  Palette,
  Pencil,
  Rocket,
  Search,
  Shield,
  SmilePlus,
  Sparkles,
  Star,
  Sun,
  Target,
  Terminal,
  Trophy,
  Users,
  Wand,
  Wrench,
  Zap,
} from "lucide-react";
import type { ProjectAvatarValue } from "../lib/projects";

const icons = {
  Smile: SmilePlus,
  Activity,
  Atom,
  Bell,
  Book: BookOpen,
  Bookmark,
  Bot,
  Box,
  Brain,
  Briefcase,
  Bug,
  Cloud,
  Code,
  Coffee,
  Compass,
  Database,
  Diamond,
  File: FileCode,
  Flag,
  Flask: FlaskConical,
  Folder,
  Gamepad: Gamepad2,
  Gem,
  Globe,
  Heart,
  Home: House,
  Layers,
  Leaf,
  Lightbulb,
  Message: MessageSquare,
  Moon,
  Music,
  Palette,
  Pencil,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Sun,
  Target,
  Terminal,
  Trophy,
  Users,
  Wand,
  Wrench,
  Zap,
};
const colors = [
  { name: "Gray", value: "#a3a3a3" },
  { name: "Green", value: "#60a878" },
  { name: "Slate", value: "#89a1b9" },
  { name: "Blue", value: "#86afe5" },
  { name: "Purple", value: "#9886e8" },
  { name: "Mauve", value: "#b095b0" },
  { name: "Peach", value: "#c58b73" },
  { name: "Yellow", value: "#e9b96f" },
  { name: "Pink", value: "#eb718c" },
  { name: "Orange", value: "#e7672c" },
];
export const defaultAvatar: ProjectAvatarValue = { icon: "Smile", color: "#a3a3a3" };

export function ProjectAvatar({
  value = defaultAvatar,
  size = 18,
}: {
  value?: ProjectAvatarValue | undefined;
  size?: number;
}) {
  const Icon = Object.entries(icons).find(([name]) => name === value.icon)?.[1] ?? SmilePlus;
  return <Icon size={size} strokeWidth={1.7} style={{ color: value.color }} className="shrink-0" />;
}

export function AvatarPicker({
  value = defaultAvatar,
  onChange,
  disabled = false,
  size = 38,
}: {
  value?: ProjectAvatarValue | undefined;
  onChange: (value: ProjectAvatarValue) => void | Promise<void>;
  disabled?: boolean;
  size?: number;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const change = async (avatar: ProjectAvatarValue, close: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onChange(avatar);
      if (close) {
        setOpen(false);
        trigger.current?.focus();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (!saving && event.target instanceof Node && !container.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, saving]);
  return (
    <div
      ref={container}
      className="relative"
      onKeyDown={(event) => {
        if (open && !saving && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Change project avatar"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled || saving}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
        className="rounded-xl p-2.5 hover:bg-bg-raised"
      >
        <ProjectAvatar value={value} size={size} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose project avatar"
          className="avatar-popover absolute top-full left-1/2 z-30 mt-1 w-[360px] -translate-x-1/2 rounded-xl border border-line-strong bg-bg-raised shadow-2xl"
        >
          <label className="flex items-center gap-2 border-b border-line px-4 py-3 text-fg-faint">
            <Search size={14} />
            <input
              ref={search}
              aria-label="Search icons"
              placeholder="Search icons…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none"
            />
          </label>
          <div
            role="group"
            aria-label="Avatar color"
            className="mx-3 flex justify-between border-b border-line py-3"
          >
            {colors.map((color) => (
              <button
                key={color.name}
                type="button"
                aria-label={color.name}
                aria-pressed={value.color === color.value}
                disabled={saving}
                onClick={() => {
                  void change({ ...value, color: color.value }, false);
                }}
                className="flex size-7 items-center justify-center rounded-full"
                style={{ backgroundColor: color.value }}
              >
                {value.color === color.value ? <Check size={15} color="#17191b" /> : null}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="Avatar icon"
            className="grid max-h-52 grid-cols-8 gap-1 overflow-y-auto overflow-x-hidden p-3"
          >
            {Object.entries(icons)
              .filter(([name]) => name.toLowerCase().includes(query.trim().toLowerCase()))
              .map(([name, Icon]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={value.icon === name}
                  disabled={saving}
                  title={name}
                  onClick={() => {
                    void change({ ...value, icon: name }, true);
                  }}
                  className={`flex size-9 items-center justify-center rounded-md hover:bg-line-strong ${value.icon === name ? "bg-line-strong" : ""}`}
                >
                  <Icon size={19} strokeWidth={1.7} style={{ color: value.color }} />
                </button>
              ))}
          </div>
          {error ? (
            <p role="alert" className="px-4 pb-4 text-xs text-danger">
              {error}
            </p>
          ) : null}
          {Object.keys(icons).every(
            (name) => !name.toLowerCase().includes(query.trim().toLowerCase()),
          ) ? (
            <p className="px-4 pb-4 text-xs text-fg-muted">No matching icons.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
