/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The unifying tile motif: a pointy-top hexagon (the R/Shiny "sticker" shape).
 * The SHAPE says "app"; the COLOR says which family — a colored hex (suite
 * accent) means a package, a grey hex means a non-package (Shiny file / hosted
 * URL). A monogram or a small globe glyph sits inside. Fills come from CSS
 * tokens (see theme.css) so both themes read correctly.
 */

// Pointy-top regular hexagon inscribed in a 100×100 box (vertices top & bottom).
const HEX_PATH = 'M50 2 L91.6 26 L91.6 74 L50 98 L8.4 74 L8.4 26 Z';

export type HexTone = 'package' | 'grey';
export type HexVariant = 'monogram' | 'globe';

export interface HexIconProps {
  tone: HexTone;
  variant: HexVariant;
  label: string; // monogram text (ignored for the globe variant)
  size?: number;
}

export function HexIcon({ tone, variant, label, size = 52 }: HexIconProps) {
  return (
    <svg
      className={`hex-icon hex-${tone}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-hidden="true"
    >
      <path className="hex-face" d={HEX_PATH} />
      {variant === 'globe' ? (
        <g className="hex-glyph" fill="none" strokeWidth={5} strokeLinecap="round">
          <circle cx="50" cy="50" r="20" />
          <ellipse cx="50" cy="50" rx="9" ry="20" />
          <line x1="30" y1="50" x2="70" y2="50" />
        </g>
      ) : (
        <text className="hex-mono" x="50" y="50" textAnchor="middle" dominantBaseline="central">
          {label}
        </text>
      )}
    </svg>
  );
}
