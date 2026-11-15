import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { characterHeadshotPath, displayCharacterName } from '../../sluggers/characters.ts'

export function CharacterBadge(handle: Handle<{ characterId: string }>) {
  return () => (
    <span mix={characterBadgeStyle}>
      <img src={characterHeadshotPath(handle.props.characterId)} alt="" />
      <span>{displayCharacterName(handle.props.characterId)}</span>
    </span>
  )
}

const characterBadgeStyle = css({
  alignItems: 'center',
  display: 'inline-flex',
  gap: '7px',
  minWidth: 0,
  '& img': { height: '28px', objectFit: 'contain', width: '28px' },
  '& > span': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})
