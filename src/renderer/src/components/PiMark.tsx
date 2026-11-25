import type { SVGProps } from 'react'
import { Icon } from '@astryxdesign/core/Icon'

function PiGlyph(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 800 800" fill="none" aria-hidden="true" {...props}>
      <path
        fill="#F09082"
        d="M165.29 165.29H517.36V400H400V282.65H165.29Z"
      />
      <path
        fill="#4D9ABF"
        d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"
      />
      <path
        fill="#F1BE58"
        d="M517.36 400H634.72V634.72H517.36Z"
      />
    </svg>
  )
}

export function PiMark({
  size = 'md'
}: {
  size?: 'xsm' | 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  return <Icon icon={PiGlyph} size={size} />
}
