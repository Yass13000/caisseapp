import React from 'react';
import './CustomCheckbox.css';

interface CustomCheckboxProps {
  checked: boolean;
  onChange: () => void;
  className?: string;
}

const CustomCheckbox: React.FC<CustomCheckboxProps> = ({ checked, onChange, className = '' }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Empêche la propagation vers le parent
    onChange();
  };

  return (
    <div className={`container ${className}`} onClick={handleClick}>
      <input 
        type="checkbox" 
        checked={checked} 
        onChange={() => {}} // Géré par le onClick du div
        readOnly
      />
      <span className="checkmark"></span>
    </div>
  );
};

export default CustomCheckbox;