import React from 'react';
import './NewtonsCradleLoader.css';

interface NewtonsCradleLoaderProps {
  size?: string;
  speed?: string;
  color?: string;
}

const NewtonsCradleLoader: React.FC<NewtonsCradleLoaderProps> = ({
  size = '50px',
  speed = '1.2s',
  color = '#474554'
}) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div 
        className="newtons-cradle"
        style={{
          '--uib-size': size,
          '--uib-speed': speed,
          '--uib-color': color
        } as React.CSSProperties}
      >
        <div className="newtons-cradle__dot"></div>
        <div className="newtons-cradle__dot"></div>
        <div className="newtons-cradle__dot"></div>
        <div className="newtons-cradle__dot"></div>
      </div>
    </div>
  );
};

export default NewtonsCradleLoader;
