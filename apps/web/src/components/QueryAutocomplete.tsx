import { useState, useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: string) => void;
  loading?: boolean;
}

const CRIME_CATEGORIES = [
  "all-crime",
  "anti-social-behaviour", 
  "bicycle-theft",
  "burglary",
  "criminal-damage-arson",
  "drugs",
  "other-theft",
  "possession-of-weapons",
  "public-order", 
  "robbery",
  "shoplifting",
  "theft-from-the-person",
  "vehicle-crime",
  "violent-crime",
  "other-crime"
];

const COMMON_LOCATIONS = [
  "London", "Manchester", "Birmingham", "Leeds", "Glasgow",
  "Liverpool", "Sheffield", "Bristol", "Newcastle", "Nottingham"
];

const TIME_PATTERNS = [
  "last month", "last 3 months", "last 6 months", "last year",
  "this month", "this year", "January", "February", "March",
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December"
];

export function QueryAutocomplete({ value, onChange, onSelect, loading }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (value.length < 2) {
      setSuggestions([]);
      return;
    }

    const lowerValue = value.toLowerCase();
    const allSuggestions = [
      ...CRIME_CATEGORIES.filter(cat => cat.includes(lowerValue)),
      ...COMMON_LOCATIONS.filter(loc => loc.toLowerCase().includes(lowerValue)),
      ...TIME_PATTERNS.filter(time => time.toLowerCase().includes(lowerValue))
    ];

    const uniqueSuggestions = [...new Set(allSuggestions)].slice(0, 8);
    setSuggestions(uniqueSuggestions);
    setShowSuggestions(uniqueSuggestions.length > 0);
    setSelectedIndex(-1);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case 'Enter':
      case 'Tab':
        if (selectedIndex >= 0) {
          e.preventDefault();
          onSelect(suggestions[selectedIndex]);
          setShowSuggestions(false);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    onSelect(suggestion);
    setShowSuggestions(false);
  };

  return (
    <div ref={wrapperRef} className="autocomplete-wrapper">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setShowSuggestions(suggestions.length > 0)}
        placeholder="e.g., 'burglary in Manchester last 3 months'"
        className="query-input"
        disabled={loading}
        autoComplete="off"
      />
      
      {showSuggestions && (
        <ul className="suggestions-list">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSuggestionClick(suggestion)}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
