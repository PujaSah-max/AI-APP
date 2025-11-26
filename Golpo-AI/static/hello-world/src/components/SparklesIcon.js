import React from "react";

export default function SparklesIcon({ size = 18, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", ...style }}
    >
      <path
        d="M14 4L15.2 9L20 10L15.2 11L14 16L12.8 11L8 10L12.8 9L14 4Z"
        fill="url(#sparkleGradient)"
        stroke="#FFB347"
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 2L8 4.4L10.4 4.9L8 5.4L7.5 7.8L7 5.4L4.6 4.9L7 4.4L7.5 2Z"
        fill="#FFE4A3"
        stroke="#FFB347"
        strokeWidth="0.3"
      />
      <defs>
        <linearGradient id="sparkleGradient" x1="8" y1="4" x2="20" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFD06F" />
          <stop offset="100%" stopColor="#FFAA4C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

