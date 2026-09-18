import { runtimeBrandIcon, runtimeBrands } from "@botiverse/oar/brands";
import type { RuntimeId } from "@shared/ipc";

/** Provider identity; project avatars remain user-selected. */
export function RuntimeLogo({
  runtime,
  size = 18,
  theme = "dark",
}: {
  runtime: RuntimeId;
  size?: number;
  theme?: "light" | "dark";
}): React.JSX.Element {
  const brand = runtimeBrands[runtime];
  const src = runtimeBrandIcon(brand, theme);
  if (src === null) return <span style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <img src={src} alt="" title={brand.name} width={size} height={size} className="shrink-0" />
  );
}
