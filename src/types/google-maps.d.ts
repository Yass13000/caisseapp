// Types TypeScript pour Google Maps API
declare global {
  interface Window {
    google: {
      maps: {
        Map: new (element: HTMLElement, options?: google.maps.MapOptions) => google.maps.Map;
        places: {
          AutocompleteService: new () => google.maps.places.AutocompleteService;
          PlacesService: new (map: google.maps.Map | HTMLDivElement) => google.maps.places.PlacesService;
          PlacesServiceStatus: {
            OK: string;
            ZERO_RESULTS: string;
            OVER_QUERY_LIMIT: string;
            REQUEST_DENIED: string;
            INVALID_REQUEST: string;
            UNKNOWN_ERROR: string;
          };
        };
      };
    };
    loadGoogleMaps?: () => void;
  }
}

export {};
