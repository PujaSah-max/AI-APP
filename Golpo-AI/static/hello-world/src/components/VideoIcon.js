import React from 'react';
import myLogo from '../static/my-logo.svg';

export default function VideoIcon({ size = 36, style }) {
  return (
    <img
      src={myLogo}
      alt="video icon"
      width={size}
      height={size}
      style={{
        display: 'block',
        borderRadius: 8,
        boxShadow: '0 6px 14px rgba(0, 0, 0, 0.15)',
        ...style,
      }}
    />
  );
}

