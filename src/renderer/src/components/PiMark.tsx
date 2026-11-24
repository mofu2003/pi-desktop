export function PiMark({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="pi-logo-mark"
    >
      <path
        d="M5.4 8.2c1.9-2.2 11.3-2.2 13.2 0"
        stroke="currentColor"
        strokeWidth="2.15"
        strokeLinecap="round"
      />
      <path
        d="M8.1 7.2v10.4M15.9 7.2v10.4"
        stroke="currentColor"
        strokeWidth="2.15"
        strokeLinecap="round"
      />
    </svg>
  )
}
