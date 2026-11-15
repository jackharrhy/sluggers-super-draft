import { RulesetRevisionSchema, type RulesetRevision } from '@starworks/contracts'

import { PlatformError } from '../platform/errors.ts'

type RuleSetting = RulesetRevision['settings'][number]

export interface SupportedSluggersRule {
  defaultValue: boolean | number
  description: string
  gameplayTarget?: string
  key: string
  label: string
  loadPhase: RuleSetting['loadPhase']
  maximum?: number
  minimum?: number
  step?: number
}

export const SUPPORTED_SLUGGERS_RULES: readonly SupportedSluggersRule[] = [
  {
    defaultValue: 7,
    description: 'Regulation innings before extra innings can begin.',
    gameplayTarget: 'rules.innings',
    key: 'game.innings',
    label: 'Innings',
    loadPhase: 'runtime',
    maximum: 99,
    minimum: 1,
    step: 1,
  },
  {
    defaultValue: true,
    description: 'Allow the game to end early when its mercy condition is met.',
    gameplayTarget: 'rules.mercy',
    key: 'game.mercy',
    label: 'Mercy rule',
    loadPhase: 'runtime',
  },
  {
    defaultValue: true,
    description: 'Allow captains and players to use star abilities.',
    gameplayTarget: 'rules.stars',
    key: 'game.stars',
    label: 'Star abilities',
    loadPhase: 'runtime',
  },
  {
    defaultValue: true,
    description: 'Allow fielding items during the game.',
    gameplayTarget: 'rules.items',
    key: 'game.items',
    label: 'Fielding items',
    loadPhase: 'runtime',
  },
  {
    defaultValue: 120,
    description: 'Seconds available for each normal draft pick.',
    key: 'draft.timer-seconds',
    label: 'Draft timer',
    loadPhase: 'web-only',
    maximum: 86_400,
    minimum: 15,
    step: 1,
  },
]

let supportedRuleByKey = new Map(SUPPORTED_SLUGGERS_RULES.map((rule) => [rule.key, rule]))

export function createStarterRulesetSettings(): RulesetRevision['settings'] {
  return RulesetRevisionSchema.shape.settings.parse(SUPPORTED_SLUGGERS_RULES.map((rule) => ({
    description: rule.description,
    gameplayTarget: rule.gameplayTarget,
    key: rule.key,
    label: rule.label,
    loadPhase: rule.loadPhase,
    value: rule.defaultValue,
  })))
}

export function parseSupportedRuleValues(
  data: FormData,
  settings: RulesetRevision['settings'],
): RulesetRevision['settings'] {
  return RulesetRevisionSchema.shape.settings.parse(settings.map((setting, index) => {
    let definition = supportedRuleByKey.get(setting.key)
    if (!definition) return setting
    let raw = data.get(ruleInputName(index))
    if (typeof raw !== 'string') throw invalidRule(definition.label)
    let value = typeof definition.defaultValue === 'boolean'
      ? parseBoolean(raw, definition.label)
      : parseNumber(raw, definition)
    return { ...setting, value }
  }))
}

export function supportedSluggersRule(key: string): SupportedSluggersRule | null {
  return supportedRuleByKey.get(key) ?? null
}

export function ruleInputName(index: number): string {
  return `rule.${index}`
}

function parseBoolean(raw: string, label: string): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw invalidRule(label)
}

function parseNumber(raw: string, definition: SupportedSluggersRule): number {
  let value = Number(raw)
  if (
    !Number.isFinite(value)
    || (definition.step === 1 && !Number.isInteger(value))
    || (definition.minimum !== undefined && value < definition.minimum)
    || (definition.maximum !== undefined && value > definition.maximum)
  ) {
    throw invalidRule(definition.label)
  }
  return value
}

function invalidRule(label: string): PlatformError {
  return new PlatformError(`${label} has an invalid value`, 'invalid_input')
}
