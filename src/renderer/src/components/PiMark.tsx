export function PiMark({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 800 800"
      fill="none"
      aria-hidden="true"
      className="pi-logo-mark"
    >
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
