/** The product's mark, exactly as supplied — a black rounded square with a
 * white "DJ" glyph. Used wherever a page has no brand context yet
 * (auth-adjacent, onboarding) — once a brand is selected, its own colour and
 * identity carry the page instead. */
export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mx-auto"
      aria-hidden
    >
      <g transform="translate(0 -8)">
        <rect y="8" width="56" height="55.9997" rx="16" fill="black" />
        <path
          d="M41.2742 35.7042C41.2782 40.3008 41.8119 44.2253 38.4793 47.7238C34.81 51.5758 30.6901 50.9734 25.992 50.9552L20.6004 50.9581L20.6043 44.92L25.4763 44.9308C28.7343 44.9348 31.2101 45.0637 33.7976 42.4347C36.267 39.9257 35.8992 36.7782 35.8904 33.4249L35.8884 27.6007L41.2654 27.5939L41.2742 35.7042ZM24.5564 21.0197C25.98 21.0175 28.7528 20.923 30.0349 21.1681C31.0992 21.3689 32.1045 21.8318 32.9715 22.5187C34.4538 23.7018 35.1174 25.1469 35.3865 27.0529L20.1121 27.0509L20.1082 28.2609L20.1072 44.3771L14.7449 44.3751C14.7433 36.7147 14.6161 28.6504 14.7625 21.0245L24.5564 21.0197ZM31.9187 37.672L31.9207 39.5822L22.4265 39.59L22.4304 37.671L31.9187 37.672ZM31.9197 35.9718C28.8941 36.0633 25.4853 35.9799 22.4285 35.9806V34.0665L31.9207 34.0646L31.9197 35.9718ZM27.1609 30.4796L27.1599 32.3917L22.4334 32.3937L22.4373 30.4786L27.1609 30.4796Z"
          fill="white"
        />
      </g>
    </svg>
  );
}
