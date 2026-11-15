export interface EncodedStatChoice {
  label: string
  value: number
}

// Bounds, numeric encodings, and labels follow Sluggers Stat Editor v4.1.
// Values stay numeric so import, compilation, and export share one
// representation; the web control translates the encoded fields for people.
export const STAT_EDITOR_V4_CORE_STAT_BOUNDS = [
  [0, 1], [0, 1], [0, 3], [0, 2], [0, 4], [0, 1], [0, 12], [0, 12],
  [0, 12], [0, 7], [10, 200], [10, 200], [0, 150], [0, 150], [0, 200],
  [0, 200], [0, 200], [0, 200], [0, 10], [0, 10], [0, 10], [0, 10],
  [70, 200], [70, 200], [0, 200], [0, 100], [0, 5], [0, 1], [0, 100],
  [0, 3],
] as const

const encodedCoreStatLabels: Partial<Record<number, readonly string[]>> = {
  0: ['Right', 'Left'],
  1: ['Right', 'Left'],
  2: ['Balanced', 'Power', 'Speed', 'Technique'],
  5: ['No', 'Yes'],
  6: [
    'Standard', 'Fireball', 'Tornado Ball', 'Barrel Ball', 'Banana Ball',
    'Heart Ball', 'Flower Ball', 'Phony Ball', 'Liar Ball', 'Rainbow Ball',
    'Suction Ball', 'Killer Ball', 'Graffiti Ball',
  ],
  7: [
    'Standard', 'Fire Swing', 'Tornado Swing', 'Barrel Swing', 'Banana Swing',
    'Heart Swing', 'Flower Swing', 'Phony Swing', 'Liar Swing', 'Egg Swing',
    'Cannon Swing', 'Breath Swing', 'Graffiti Swing',
  ],
  8: [
    'None', 'Super Dive', 'Super Jump', 'Tongue Catch', 'Suction Catch',
    'Magical Catch', 'Piranha Catch', 'Hammer Throw', 'Keeper Catch', 'Clamber',
    'Ball Dash', 'Laser Beam', 'Quick Throw',
  ],
  9: [
    'None', 'Scatter Dive', 'Ink Dive', 'Angry Attack', 'Teleport',
    'Spin Attack', 'Burrow', 'Enlarge',
  ],
  27: ['Disabled', 'Enabled'],
  29: ['None', 'Breaking Ball', 'Fastball', 'Change-Up'],
}

export function statEditorCharacterChoices(
  definitionKey: string,
  trajectoryNames: readonly string[],
  trajectoryActivation: readonly number[] = [],
): EncodedStatChoice[] | null {
  let match = /^legacy\.stat-editor\.stat-(\d{2})$/.exec(definitionKey)
  if (!match) return null
  let fieldIndex = Number(match[1])
  if (fieldIndex === 26) {
    let choices = trajectoryNames.map((label, value) => ({ label, value }))
    return trajectoryActivation.length
      ? choices.filter((choice) => trajectoryActivation[choice.value] !== 0)
      : choices
  }
  let labels = encodedCoreStatLabels[fieldIndex]
  if (!labels?.length) return null
  return labels.map((label, value) => ({ label, value }))
}

export function displayStatEditorCharacterValue(
  definitionKey: string,
  value: unknown,
  trajectoryNames: readonly string[],
): string {
  if (typeof value !== 'number') return String(value ?? '—')
  let choice = statEditorCharacterChoices(definitionKey, trajectoryNames)
    ?.find((candidate) => candidate.value === value)
  return choice ? choice.label : String(value)
}
