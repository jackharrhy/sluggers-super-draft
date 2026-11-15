export const SLUGGERS_STADIUMS = [
  { id: 'mario-stadium', name: 'Mario Stadium' },
  { id: 'bowser-castle', name: 'Bowser Castle' },
  { id: 'wario-city', name: 'Wario City' },
  { id: 'yoshi-park', name: 'Yoshi Park' },
  { id: 'peach-ice-garden', name: 'Peach Ice Garden' },
  { id: 'dk-jungle', name: 'DK Jungle' },
  { id: 'luigis-mansion', name: "Luigi's Mansion" },
  { id: 'daisy-cruiser', name: 'Daisy Cruiser' },
  { id: 'bowser-jr-playroom', name: "Bowser Jr.'s Playroom" },
] as const

export const SLUGGERS_STADIUM_IDS = SLUGGERS_STADIUMS.map((stadium) => stadium.id) as [
  typeof SLUGGERS_STADIUMS[number]['id'],
  ...Array<typeof SLUGGERS_STADIUMS[number]['id']>,
]
