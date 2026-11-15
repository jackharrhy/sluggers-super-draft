import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { AppShell, cardStyle } from './app-shell.tsx'

export function MessagePage(handle: Handle<{ heading: string; message: string }>) {
  return () => (
    <AppShell title={handle.props.heading}>
      <section mix={[cardStyle, css({ margin: '40px auto', maxWidth: '620px' })]}>
        <h1 mix={css({ fontSize: '36px', margin: '0 0 16px' })}>{handle.props.heading}</h1>
        <p mix={css({ color: 'var(--text-soft)', fontSize: '18px', lineHeight: 1.65, margin: 0 })}>
          {handle.props.message}
        </p>
      </section>
    </AppShell>
  )
}
