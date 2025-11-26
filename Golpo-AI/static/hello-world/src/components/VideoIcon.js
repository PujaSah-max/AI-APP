import React from "react";

export default function VideoIcon({ size = 22, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", ...style }}
    >
      <rect
        x="2.5"
        y="6"
        width="13"
        height="12"
        rx="3"
        stroke="#fff"
        strokeWidth="1.8"
      />
      <path
        d="M15.5 10.2L21.5 6.5V17.5L15.5 13.8V10.2Z"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="8.5"
        cy="12"
        r="2.3"
        stroke="#fff"
        strokeWidth="1.4"
        fill="none"
      />
    </svg>
  );
}

