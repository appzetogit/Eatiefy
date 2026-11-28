/**
 * Options for `useJsApiLoader` in the delivery app. The Maps script can only be
 * loaded once, so every delivery screen has to pass exactly these.
 */
export const DELIVERY_MAPS_LOADER_OPTIONS = {
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  libraries: ['places', 'geometry'],
};
