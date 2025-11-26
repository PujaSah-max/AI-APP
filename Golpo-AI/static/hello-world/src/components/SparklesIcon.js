import React from 'react';

export default function SparklesIcon({ size = 18, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      {/* Larger sparkle - positioned slightly right and below */}
      <path
        d="M14 4L15 8.5L19.5 9.5L15 10.5L14 15L13 10.5L8.5 9.5L13 8.5L14 4Z"
        fill="#FFA500"
        stroke="#FF8C00"
        strokeWidth="0.3"
      />
      {/* Smaller sparkle - positioned above and to the left */}
      <path
        d="M8 2L8.4 4.2L10.6 4.6L8.4 5L8 7.2L7.6 5L5.4 4.6L7.6 4.2L8 2Z"
        fill="#FFD700"
        stroke="#FFA500"
        strokeWidth="0.2"
      />
    </svg>
  );
}

