export const CONTROL_IDS = ["family", "weight", "size", "sample", "palette", "grid"] as const;

export type ControlId = (typeof CONTROL_IDS)[number];

/** The page-wide controls that change what each landing section shows. */
export const SECTION_CONTROLS = {
  hero: ["family", "weight", "size", "sample"],
  lineHeight: ["grid", "family", "weight"],
  tashkeel: ["palette", "family"],
  waterfall: ["sample", "family", "weight"],
} as const satisfies Record<string, readonly ControlId[]>;

export type SectionId = keyof typeof SECTION_CONTROLS;

function isSectionId(value: string): value is SectionId {
  return Object.hasOwn(SECTION_CONTROLS, value);
}

/** The controls for a section, most specific first; none for a section no control affects. */
export function controlsFor(section: string | undefined): readonly ControlId[] {
  return section !== undefined && isSectionId(section) ? SECTION_CONTROLS[section] : [];
}

/** The first section in page order that is crossing the reading band. */
export function activeSection(
  order: readonly string[],
  intersecting: ReadonlySet<string>,
): string | undefined {
  return order.find((id) => intersecting.has(id));
}
