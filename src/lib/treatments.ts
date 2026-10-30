/**
 * Labels for vaccine disease groups and deworming tracks. Reminders are kept per group / track
 * (database: vaccines.covers, dewormers.tracks, due_items.groups) so that any vaccine covering a
 * disease closes its reminder, and worm tablets and flea / tick products keep separate reminders.
 */
export const VACCINE_GROUPS: { code: string; label: string; hint: string }[] = [
  { code: "dog_core", label: "Dog core (DHPP)", hint: "Distemper, hepatitis, parvovirus (± parainfluenza)" },
  { code: "lepto", label: "Leptospirosis", hint: "Dogs" },
  { code: "rabies", label: "Rabies", hint: "Dogs and cats" },
  { code: "kennel_cough", label: "Kennel cough", hint: "Bordetella / parainfluenza" },
  { code: "cat_core", label: "Cat core (PCH)", hint: "Panleukopenia, calicivirus, herpesvirus" },
  { code: "felv", label: "FeLV", hint: "Feline leukaemia" },
  { code: "ringworm", label: "Ringworm", hint: "Biocan M" },
];

export const vaccineGroupLabel = (code: string) =>
  VACCINE_GROUPS.find((g) => g.code === code)?.label ?? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const TRACKS = [
  { code: "internal", label: "Internal worms" },
  { code: "external", label: "Fleas & ticks" },
] as const;
export const trackLabel = (code: string) => TRACKS.find((t) => t.code === code)?.label ?? code;

/** What a dewormer can cover (shown as ticks on the dewormer form). */
export const WORM_COVERS = [
  "roundworm", "hookworm", "whipworm", "tapeworm", "heartworm", "giardia", "fleas", "ticks", "mites",
] as const;
