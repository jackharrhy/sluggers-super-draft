import type { StatDefinition } from '@starworks/contracts'

import { PlatformError } from '../platform/errors.ts'

export function parseCharacterStatForm(
  definitions: StatDefinition[],
  data: FormData,
): Record<string, boolean | number | string | null> {
  let values: Record<string, boolean | number | string | null> = {}
  for (let definition of definitions) {
    let field = `stat.${definition.key}`
    if (definition.dataType === 'boolean') {
      values[definition.key] = data.has(field)
      continue
    }
    let raw = data.get(field)
    if (typeof raw !== 'string' || !raw.trim()) {
      if (!definition.required) continue
      throw new PlatformError(`${definition.display.label} is required`, 'invalid_input')
    }
    let value = raw.trim()
    if (definition.dataType === 'enum') {
      if (!definition.choices.some((choice) => choice.value === value)) {
        throw new PlatformError(`${definition.display.label} is invalid`, 'invalid_input')
      }
      values[definition.key] = value
      continue
    }
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
      throw new PlatformError(`${definition.display.label} must be a number`, 'invalid_input')
    }
    let number = Number(value)
    if (
      !Number.isFinite(number)
      || (definition.dataType === 'integer' && !Number.isInteger(number))
      || number < definition.minimum
      || number > definition.maximum
    ) {
      throw new PlatformError(
        `${definition.display.label} must be between ${definition.minimum} and ${definition.maximum}`,
        'invalid_input',
      )
    }
    values[definition.key] = number
  }
  return values
}
