import React from 'react';

export default function RefreshIcon({ size = 18, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M4 12C4 7.58172 7.58172 4 12 4C14.1217 4 16.1566 4.84285 17.6569 6.34315L20 8.5M20 8.5V4M20 8.5H15.5M20 12C20 16.4183 16.4183 20 12 20C9.87827 20 7.84344 19.1571 6.34315 17.6569L4 15.5M4 15.5V20M4 15.5H8.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

