// Roster order follows Sluggers Stat Editor and MSS AutoTeam. Keep this list in
// game-index order: import formats contain numeric slots, while Starworks uses
// the readable IDs below everywhere outside the adapter boundary.
export const SLUGGERS_CHARACTER_IDS = [
  'mario',
  'luigi',
  'donkey-kong',
  'diddy-kong',
  'peach',
  'daisy',
  'yoshi',
  'baby-mario',
  'baby-luigi',
  'bowser',
  'wario',
  'waluigi',
  'green-koopa-troopa',
  'toad',
  'boo',
  'toadette',
  'red-shy-guy',
  'birdo',
  'monty-mole',
  'bowser-jr',
  'red-koopa-paratroopa',
  'blue-pianta',
  'red-pianta',
  'yellow-pianta',
  'blue-noki',
  'red-noki',
  'green-noki',
  'hammer-bro',
  'toadsworth',
  'blue-toad',
  'yellow-toad',
  'green-toad',
  'purple-toad',
  'blue-magikoopa',
  'red-magikoopa',
  'green-magikoopa',
  'yellow-magikoopa',
  'king-boo',
  'petey-piranha',
  'dixie-kong',
  'goomba',
  'paragoomba',
  'red-koopa-troopa',
  'green-koopa-paratroopa',
  'blue-shy-guy',
  'yellow-shy-guy',
  'green-shy-guy',
  'gray-shy-guy',
  'gray-dry-bones',
  'green-dry-bones',
  'dark-bones',
  'blue-dry-bones',
  'fire-bro',
  'boomerang-bro',
  'wiggler',
  'blooper',
  'funky-kong',
  'tiny-kong',
  'green-kritter',
  'blue-kritter',
  'red-kritter',
  'brown-kritter',
  'king-k-rool',
  'baby-peach',
  'baby-daisy',
  'baby-dk',
  'red-yoshi',
  'blue-yoshi',
  'yellow-yoshi',
  'light-blue-yoshi',
  'pink-yoshi',
  'unused-yoshi-2',
  'unused-yoshi',
  'unused-toad',
  'unused-pianta',
  'unused-kritter',
  'unused-koopa',
  'red-mii-m',
  'orange-mii-m',
  'yellow-mii-m',
  'light-green-mii-m',
  'green-mii-m',
  'blue-mii-m',
  'light-blue-mii-m',
  'pink-mii-m',
  'purple-mii-m',
  'brown-mii-m',
  'white-mii-m',
  'black-mii-m',
  'red-mii-f',
  'orange-mii-f',
  'yellow-mii-f',
  'light-green-mii-f',
  'green-mii-f',
  'blue-mii-f',
  'light-blue-mii-f',
  'pink-mii-f',
  'purple-mii-f',
  'brown-mii-f',
  'white-mii-f',
  'black-mii-f',
] as const

let characterIndexById = new Map<string, number>(SLUGGERS_CHARACTER_IDS.map((id, index) => [id, index]))

export type SluggersCharacterKind = 'playable' | 'mii' | 'unused'

export function sluggersCharacterIdAt(index: number): string {
  let characterId = SLUGGERS_CHARACTER_IDS[index]
  if (!characterId) throw new RangeError(`Unknown Sluggers character index ${index}`)
  return characterId
}

export function sluggersCharacterIndex(characterId: string): number | null {
  let canonicalIndex = characterIndexById.get(characterId)
  if (canonicalIndex !== undefined) return canonicalIndex
  let legacyAlias = /^rmbe01-character-(\d{3})$/.exec(characterId)
  if (!legacyAlias) return null
  let index = Number(legacyAlias[1])
  return index < SLUGGERS_CHARACTER_IDS.length ? index : null
}

export function displayCharacterName(characterId: string): string {
  let canonicalId = canonicalCharacterId(characterId)
  let mii = /^(.*)-mii-([mf])$/.exec(canonicalId)
  if (mii) return `${titleCase(mii[1]!)} Mii (${mii[2]!.toUpperCase()})`
  if (canonicalId === 'bowser-jr') return 'Bowser Jr.'
  if (canonicalId === 'king-k-rool') return 'King K. Rool'
  if (canonicalId === 'baby-dk') return 'Baby DK'
  return titleCase(canonicalId)
}

export function characterHeadshotPath(characterId: string): string {
  let canonicalId = canonicalCharacterId(characterId)
  let fileName = headshotFileName(canonicalId)
  return `/player-headshots/${fileName.replaceAll(' ', '-')}.png`
}

export function sluggersCharacterKind(characterId: string): SluggersCharacterKind {
  let canonicalId = canonicalCharacterId(characterId)
  if (canonicalId.startsWith('unused-')) return 'unused'
  if (canonicalId.includes('-mii-')) return 'mii'
  return 'playable'
}

function canonicalCharacterId(characterId: string): string {
  let index = sluggersCharacterIndex(characterId)
  return index === null ? characterId : SLUGGERS_CHARACTER_IDS[index]!
}

function headshotFileName(characterId: string): string {
  let mii = /^(.*)-mii-[mf]$/.exec(characterId)
  if (mii) {
    if (mii[1] === 'green') return 'dark green mii'
    if (mii[1] === 'blue') return 'dark blue mii'
    return `${mii[1]!.replaceAll('-', ' ')} mii`
  }
  if (characterId.startsWith('unused-')) return 'random'
  if (characterId === 'yoshi') return 'yoshi'
  if (characterId === 'toad') return 'red toad'
  if (characterId.endsWith('koopa-troopa')) return 'koopa'
  if (characterId.endsWith('koopa-paratroopa')) return 'paratroopa'
  if (characterId === 'green-dry-bones' || characterId === 'dark-bones' || characterId === 'blue-dry-bones') return 'dry bones'
  if (characterId === 'fire-bro' || characterId === 'boomerang-bro') return 'hammer bro'
  if (characterId === 'green-kritter') return 'kritter'
  return characterId.replaceAll('-', ' ')
}

function titleCase(value: string): string {
  return value.split('-').map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : '').join(' ')
}
