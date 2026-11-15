import { css } from 'remix/ui'

// Starworks' shared visual vocabulary. The kitchen sink renders these exact
// mixins so visual review and production UI stay coupled.
export const cardStyle = css({
  '--border': 'var(--paper-border)',
  '--border-strong': 'var(--sluggers-ink)',
  '--danger-text': 'var(--negative)',
  '--link': 'var(--blue-700)',
  '--surface': 'var(--paper)',
  '--surface-deep': 'var(--paper-soft)',
  '--surface-soft': 'var(--paper-soft)',
  '--surface-strong': 'var(--paper-blue)',
  '--success-text': 'var(--positive)',
  '--text-muted': 'var(--ink-muted)',
  '--text-primary': 'var(--ink)',
  '--text-soft': 'var(--ink-soft)',
  background: 'var(--paper)',
  border: '2px solid var(--sluggers-ink)',
  borderRadius: '8px',
  boxShadow: '4px 4px 0 var(--sluggers-ink)',
  color: 'var(--ink)',
  padding: '20px',
})

export const primaryButtonStyle = css({
  background: 'var(--mario-blue-600)',
  border: '2px solid var(--sluggers-ink)',
  borderRadius: '6px',
  boxShadow: '0 3px 0 var(--sluggers-ink)',
  color: 'white',
  cursor: 'pointer',
  fontFamily: 'var(--font-bolt)',
  fontWeight: 700,
  padding: '10px 15px',
  '&:not(:disabled):hover': { background: 'var(--mario-blue-500)', transform: 'translateY(-1px)' },
  '&:active': { boxShadow: 'none', transform: 'translateY(3px)' },
  '&:focus-visible': { outline: '3px solid var(--sluggers-yellow)', outlineOffset: '2px' },
  '&:disabled': { background: 'var(--sluggers-cream)', borderColor: 'var(--paper-border)', boxShadow: 'none', color: 'var(--ink-muted)', cursor: 'not-allowed' },
})

export const secondaryButtonStyle = css({
  background: 'var(--paper-soft)',
  border: '2px solid var(--sluggers-ink)',
  borderRadius: '6px',
  boxShadow: '0 3px 0 var(--sluggers-ink)',
  color: 'var(--sluggers-ink)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 800,
  padding: '10px 14px',
  '&:not(:disabled):hover': { background: 'var(--paper)', transform: 'translateY(-1px)' },
  '&:active': { boxShadow: 'none', transform: 'translateY(3px)' },
  '&:focus-visible': { outline: '3px solid var(--sluggers-yellow)', outlineOffset: '2px' },
  '&:disabled': { background: 'var(--sluggers-cream)', borderColor: 'var(--paper-border)', boxShadow: 'none', color: 'var(--ink-muted)', cursor: 'not-allowed' },
})

export const positiveButtonStyle = css({
  background: 'var(--luigi-green-500)',
  border: '2px solid var(--sluggers-ink)',
  borderRadius: '6px',
  boxShadow: '0 3px 0 var(--sluggers-ink)',
  color: 'var(--sluggers-ink)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 800,
  padding: '10px 14px',
  '&:not(:disabled):hover': { background: 'var(--luigi-green-400)', transform: 'translateY(-1px)' },
  '&:active': { boxShadow: 'none', transform: 'translateY(3px)' },
  '&:focus-visible': { outline: '3px solid var(--sluggers-yellow)', outlineOffset: '2px' },
  '&:disabled': { background: 'var(--sluggers-cream)', borderColor: 'var(--paper-border)', boxShadow: 'none', color: 'var(--ink-muted)', cursor: 'not-allowed' },
})

export const dangerButtonStyle = css({
  background: 'var(--sluggers-red-600)',
  border: '2px solid var(--sluggers-ink)',
  borderRadius: '6px',
  boxShadow: '0 3px 0 var(--sluggers-ink)',
  color: 'white',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 800,
  padding: '10px 14px',
  '&:not(:disabled):hover': { background: 'var(--sluggers-red-500)', transform: 'translateY(-1px)' },
  '&:active': { boxShadow: 'none', transform: 'translateY(3px)' },
  '&:focus-visible': { outline: '3px solid var(--sluggers-yellow)', outlineOffset: '2px' },
  '&:disabled': { background: 'var(--sluggers-cream)', borderColor: 'var(--paper-border)', boxShadow: 'none', color: 'var(--ink-muted)', cursor: 'not-allowed' },
})

export const linkButtonStyle = css({
  background: 'transparent',
  border: 0,
  color: 'var(--link)',
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 800,
  padding: 0,
  textDecoration: 'none',
  '&:hover': { color: 'var(--accent-yellow)' },
  '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: '3px' },
})

export const inputStyle = css({
  background: 'var(--paper)',
  border: '2px solid var(--paper-border)',
  borderRadius: '6px',
  color: 'var(--ink)',
  font: 'inherit',
  minHeight: '42px',
  padding: '9px 11px',
  width: '100%',
  '&:focus': { borderColor: 'var(--mario-blue-500)', outline: '2px solid var(--mario-blue-500)' },
  '&:disabled': { cursor: 'not-allowed', opacity: 0.56 },
  '&::placeholder': { color: 'var(--text-muted)' },
})

export const fieldStyle = css({
  display: 'grid',
  gap: '7px',
  fontWeight: 700,
  '& small': { color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.4 },
})

export const checkboxStyle = css({
  alignItems: 'center',
  display: 'flex',
  gap: '9px',
  '& input': { accentColor: 'var(--blue-950)', height: '18px', width: '18px' },
})

export const badgeStyle = css({
  color: 'var(--text-muted)',
  display: 'inline-flex',
  fontSize: '11px',
  fontWeight: 900,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
})

export const successBadgeStyle = css({
  color: 'var(--text-primary)',
  display: 'inline-flex',
  fontSize: '11px',
  fontWeight: 900,
  textTransform: 'uppercase',
})

export const warningBadgeStyle = css({
  color: 'var(--text-primary)',
  display: 'inline-flex',
  fontSize: '11px',
  fontWeight: 900,
  textTransform: 'uppercase',
})

export const dangerBadgeStyle = css({
  color: 'var(--text-primary)',
  display: 'inline-flex',
  fontSize: '11px',
  fontWeight: 900,
  textTransform: 'uppercase',
})

export const emptyStateStyle = css({
  border: '1px dashed var(--border-strong)',
  borderRadius: '12px',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
  margin: 0,
  padding: '20px',
})

export const mutedTextStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5 })

export const sectionHeadingStyle = css({
  alignItems: 'end',
  display: 'flex',
  gap: '20px',
  justifyContent: 'space-between',
  marginBottom: '18px',
  '& h2': { fontSize: '30px', margin: 0 },
  '& span': { color: 'var(--text-muted)', fontWeight: 800 },
})

export const tableScrollerStyle = css({ overflowX: 'auto' })

export const tableStyle = css({
  borderCollapse: 'collapse',
  minWidth: '560px',
  width: '100%',
  '& th, & td': { borderBottom: '1px solid var(--border)', padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' },
  '& th': { color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase' },
  '& tbody tr:hover': { background: 'var(--surface-soft)' },
})

export const noticeStyle = css({
  background: 'var(--mario-blue-50)',
  border: '2px solid var(--mario-blue-600)',
  borderRadius: '6px',
  color: 'var(--mario-blue-900)',
  lineHeight: 1.5,
  padding: '13px 15px',
})

export const successNoticeStyle = css({
  background: 'var(--luigi-green-50)',
  border: '2px solid var(--luigi-green-600)',
  borderRadius: '6px',
  color: 'var(--luigi-green-900)',
  lineHeight: 1.5,
  padding: '13px 15px',
})

export const warningNoticeStyle = css({
  background: 'var(--daisy-yellow-50)',
  border: '2px solid var(--daisy-yellow-600)',
  borderRadius: '6px',
  color: 'var(--daisy-yellow-950)',
  lineHeight: 1.5,
  padding: '13px 15px',
})

export const dangerNoticeStyle = css({
  background: 'var(--sluggers-red-50)',
  border: '2px solid var(--sluggers-red-600)',
  borderRadius: '6px',
  color: 'var(--sluggers-red-900)',
  lineHeight: 1.5,
  padding: '13px 15px',
})
