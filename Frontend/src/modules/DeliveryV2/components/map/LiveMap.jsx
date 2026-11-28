import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { 
  GoogleMap, 
  Marker, 
  Polygon,
  Polyline,
  useJsApiLoader,
  OverlayView
} from '@react-google-maps/api';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { zoneAPI } from '@food/api';
import { CUSTOMER_PIN_SVG } from '@/modules/DeliveryV2/components/map/map.icons';
import { LOCATION_CONFIG } from '@/modules/DeliveryV2/utils/locationConfig';
import { DELIVERY_MAPS_LOADER_OPTIONS } from '@/modules/DeliveryV2/utils/mapsLoaderOptions';

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  inset: 0
};

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  scaleControl: false,
  streetViewControl: false,
  rotateControl: true,
  fullscreenControl: false,
  styles: [
    { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#444444" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e8f5e9" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#fff3e0" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#ffe0b2" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#424242" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e2f3" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#78909c" }] }
  ]
};
const MARKER_OVERLAP_HIDE_METERS = 40;
const DESTINATION_MARKER_Z_INDEX = 20;

function distanceBetweenMeters(a, b) {
  if (!a || !b || !window.google?.maps?.geometry) return Infinity;
  try {
    const p1 = new window.google.maps.LatLng(a.lat, a.lng);
    const p2 = new window.google.maps.LatLng(b.lat, b.lng);
    return window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
  } catch {
    return Infinity;
  }
}

function toLatLngLiteral(point) {
  if (!point) return null;
  const lat = typeof point.lat === 'function' ? point.lat() : (point.lat ?? point.latitude);
  const lng = typeof point.lng === 'function' ? point.lng() : (point.lng ?? point.longitude);
  return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
}

/** Normalize Route.computeRoutes / DirectionsService output into the shape LiveMap uses. */
function buildDirectionsResult(pathPoints, { distanceMeters = null, durationSeconds = null } = {}) {
  const overview_path = (pathPoints || []).map(toLatLngLiteral).filter(Boolean);
  if (overview_path.length < 2) return null;

  let overview_polyline = null;
  try {
    if (window.google?.maps?.geometry?.encoding) {
      overview_polyline = window.google.maps.geometry.encoding.encodePath(
        overview_path.map((p) => new window.google.maps.LatLng(p.lat, p.lng)),
      );
    }
  } catch {
    overview_polyline = null;
  }

  return {
    routes: [{ overview_path, overview_polyline }],
    distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
  };
}

async function computeWithRoutesApi(origin, destination) {
  const { Route } = await window.google.maps.importLibrary('routes');
  const { routes } = await Route.computeRoutes({
    origin: { lat: origin.lat, lng: origin.lng },
    destination: { lat: destination.lat, lng: destination.lng },
    travelMode: 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
  });

  const route = routes?.[0];
  if (!route?.path?.length) throw new Error('No route path returned');
  return buildDirectionsResult(route.path, {
    distanceMeters: Number(route.distanceMeters),
    durationSeconds: Number(route.durationMillis) / 1000,
  });
}

function computeWithDirectionsService(origin, destination) {
  return new Promise((resolve, reject) => {
    try {
      new window.google.maps.DirectionsService().route(
        {
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          const route = result?.routes?.[0];
          if (status !== 'OK' || !route?.overview_path?.length) {
            reject(new Error(`Directions failed: ${status}`));
            return;
          }
          const leg = route.legs?.[0];
          resolve(
            buildDirectionsResult(route.overview_path, {
              distanceMeters: leg?.distance?.value,
              durationSeconds: leg?.duration?.value,
            }),
          );
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Real road route between the rider and the destination. Uses the Routes API and
 * falls back to the Directions service (whichever the project has enabled). Never
 * fabricates a straight line: with no route the map simply shows none and retries.
 */
async function computeDrivingRoute(origin, destination) {
  try {
    const result = await computeWithRoutesApi(origin, destination);
    if (result) return result;
  } catch (error) {
    console.warn('[LiveMap] Routes API unavailable, trying Directions service:', error?.message || error);
  }
  const result = await computeWithDirectionsService(origin, destination);
  if (!result) throw new Error('No route returned');
  return result;
}

/** Metres along a path. */
function pathLengthMeters(path) {
  if (!window.google?.maps?.geometry || !path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += window.google.maps.geometry.spherical.computeDistanceBetween(
      new window.google.maps.LatLng(path[i - 1].lat, path[i - 1].lng),
      new window.google.maps.LatLng(path[i].lat, path[i].lng),
    );
  }
  return total;
}

/** Rider this far from the drawn route is considered off-route and gets a new one. */
const OFF_ROUTE_METERS = 60;
const ROUTE_RETRY_AFTER_FAILURE_MS = 15000;

export const LiveMap = ({ onMapClick, onMapLoad, onPathReceived, onPolylineReceived, onRouteProgress, zoom = 13.5 }) => {
  const riderLocation = useDeliveryStore((state) => state.riderLocation);
  const gpsError = useDeliveryStore((state) => state.gpsError);
  const activeOrder = useDeliveryStore((state) => state.getFocusedOrder());
  const tripStatus = useDeliveryStore((state) => state.getFocusedTripStatus());
  
  const { isLoaded, loadError } = useJsApiLoader(DELIVERY_MAPS_LOADER_OPTIONS);

  const [directions, setDirections] = useState(null);
  const [map, setMapInternal] = useState(null);
  const [zones, setZones] = useState([]);
  const [lastDirectionsAt, setLastDirectionsAt] = useState(0);
  const [routeError, setRouteError] = useState(false);
  const routeFetchInFlightRef = useRef(false);
  const lastRouteFailureAtRef = useRef(0);
  const offRouteRef = useRef(false);

  const handleMapLoad = (mapInstance) => {
    mapInstance.setOptions({
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      scaleControl: false,
      streetViewControl: false,
      rotateControl: true, // Enabled for front-view navigation
      fullscreenControl: false,
      tilt: 45, // 3D Perspective
    });
    setMapInternal(mapInstance);
    if (onMapLoad) onMapLoad(mapInstance);
  };

  useEffect(() => {
    setLastDirectionsAt(0);
    setDirections(null);
    setRouteError(false);
    lastRouteFailureAtRef.current = 0;
    offRouteRef.current = false;
    if (onRouteProgress) onRouteProgress(null);
  }, [tripStatus, activeOrder?._id, onRouteProgress]);

  const parsePoint = useCallback((raw) => {
    if (!raw) return null;
    if (Array.isArray(raw) && raw.length >= 2) {
      const lng = parseFloat(raw[0]);
      const lat = parseFloat(raw[1]);
      return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    }
    if (Array.isArray(raw.coordinates) && raw.coordinates.length >= 2) {
      const lng = parseFloat(raw.coordinates[0]);
      const lat = parseFloat(raw.coordinates[1]);
      return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    }
    if (raw.location) {
      return parsePoint(raw.location);
    }
    const lat = parseFloat(raw.lat ?? raw.latitude);
    const lng = parseFloat(raw.lng ?? raw.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  }, []);

  const restaurantPoint = useMemo(() => {
    return parsePoint(
      activeOrder?.restaurantLocation ||
      activeOrder?.restaurantId?.location ||
      activeOrder?.restaurant?.location
    );
  }, [activeOrder?.restaurantLocation, activeOrder?.restaurantId, activeOrder?.restaurant, parsePoint]);

  const customerPoint = useMemo(() => {
    // The saved delivery address, the same point the Google Maps buttons and the
    // arrival geofence use. The customer's phone position is not the drop point.
    return parsePoint(
      activeOrder?.customerLocation ||
      activeOrder?.deliveryAddress?.location ||
      activeOrder?.address?.location ||
      activeOrder?.deliveryAddress ||
      activeOrder?.address
    );
  }, [
    activeOrder?.customerLocation,
    activeOrder?.deliveryAddress,
    activeOrder?.address,
    parsePoint
  ]);

  const targetLocation = useMemo(() => {
    if (!activeOrder) return null;
    let rawLoc = null;
    if (tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') {
      rawLoc = activeOrder.restaurantLocation || activeOrder.restaurantId?.location || activeOrder.restaurant?.location;
    } else if (tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') {
      rawLoc = activeOrder.customerLocation ||activeOrder.deliveryAddress?.location || activeOrder.address?.location || activeOrder.deliveryAddress || activeOrder.address;
    }
    if (!rawLoc) return null;
    return parsePoint(rawLoc);
  }, [activeOrder, tripStatus, parsePoint]);

  const parsedRiderLocation = useMemo(() => {
    if (!riderLocation) return null;
    const lat = parseFloat(riderLocation.lat || riderLocation.latitude);
    const lng = parseFloat(riderLocation.lng || riderLocation.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng, heading: parseFloat(riderLocation.heading || 0) } : null;
  }, [riderLocation]);

  /* ─────────────────── 60 fps marker interpolation ─────────────────── */
  const interpStateRef = useRef({
    startPos: null,
    targetPos: null,
    startTime: 0,
    duration: LOCATION_CONFIG.MIN_INTERP_DURATION_MS,
  });
  const currentSmoothPosRef = useRef(null);
  const [smoothLocation, setSmoothLocation] = useState(null);
  const lastPacketTimeRef = useRef(0);
  const animatingRef = useRef(false);
  const startAnimationRef = useRef(() => {});

  useEffect(() => {
    if (!parsedRiderLocation) {
      currentSmoothPosRef.current = null;
      setSmoothLocation(null);
      return;
    }

    const now = Date.now();
    const sinceLast = lastPacketTimeRef.current ? now - lastPacketTimeRef.current : 1500;
    lastPacketTimeRef.current = now;

    const rendered = currentSmoothPosRef.current || parsedRiderLocation;
    interpStateRef.current = {
      startPos: rendered,
      targetPos: parsedRiderLocation,
      startTime: now,
      duration: Math.min(
        Math.max(sinceLast, LOCATION_CONFIG.MIN_INTERP_DURATION_MS),
        LOCATION_CONFIG.MAX_INTERP_DURATION_MS,
      ),
    };

    if (!currentSmoothPosRef.current) {
      currentSmoothPosRef.current = parsedRiderLocation;
      setSmoothLocation(parsedRiderLocation);
    } else {
      startAnimationRef.current();
    }
  }, [parsedRiderLocation?.lat, parsedRiderLocation?.lng, parsedRiderLocation?.heading]);

  useEffect(() => {
    let frameId;
    const step = () => {
      const { startPos, targetPos, startTime, duration } = interpStateRef.current;
      if (!startPos || !targetPos) {
        animatingRef.current = false;
        return;
      }

      const progress = Math.min((Date.now() - startTime) / (duration || 1000), 1);
      const eased = 1 - (1 - progress) ** 2;

      let delta = ((targetPos.heading || 0) - (startPos.heading || 0)) % 360;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;

      const next = {
        lat: startPos.lat + (targetPos.lat - startPos.lat) * eased,
        lng: startPos.lng + (targetPos.lng - startPos.lng) * eased,
        heading: ((startPos.heading || 0) + delta * eased + 360) % 360,
      };

      currentSmoothPosRef.current = next;
      setSmoothLocation(next);

      if (progress >= 1) {
        animatingRef.current = false;
        return;
      }
      frameId = requestAnimationFrame(step);
    };

    startAnimationRef.current = () => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      frameId = requestAnimationFrame(step);
    };

    return () => {
      animatingRef.current = false;
      startAnimationRef.current = () => {};
      cancelAnimationFrame(frameId);
    };
  }, []);

  const activeMarkerLocation = smoothLocation || parsedRiderLocation;

  useEffect(() => {
    if (!map || typeof zoom !== 'number') return;
    const currentZoom = map.getZoom();
    if (currentZoom !== zoom) map.setZoom(zoom);
  }, [zoom, map]);

  const routeThrottleMs = useMemo(() => {
    if (!parsedRiderLocation || !targetLocation || !window.google?.maps?.geometry) return 20000;
    try {
      const dist = distanceBetweenMeters(parsedRiderLocation, targetLocation);
      if (dist > 5000) return 45000;
      if (dist > 2000) return 30000;
      if (dist > 500) return 15000;
      return 8000;
    } catch {
      return 20000;
    }
  }, [parsedRiderLocation, targetLocation]);

  // Routes API (new) — replaces legacy DirectionsService which is blocked on new GCP projects
  useEffect(() => {
    if (!isLoaded || !window.google?.maps) return;
    if (!parsedRiderLocation || !targetLocation) return;

    const now = Date.now();
    // Refresh on schedule, or immediately when the rider has left the drawn route.
    if (directions && now - lastDirectionsAt < routeThrottleMs && !offRouteRef.current) return;
    if (!directions && lastRouteFailureAtRef.current && now - lastRouteFailureAtRef.current < ROUTE_RETRY_AFTER_FAILURE_MS) return;
    if (routeFetchInFlightRef.current) return;

    let cancelled = false;
    routeFetchInFlightRef.current = true;

    (async () => {
      try {
        const result = await computeDrivingRoute(parsedRiderLocation, targetLocation);
        if (cancelled || !result) return;
        offRouteRef.current = false;
        lastRouteFailureAtRef.current = 0;
        setRouteError(false);
        setDirections(result);
        setLastDirectionsAt(Date.now());

        if (result.path && Array.isArray(result.path) && onPathReceived) {
          onPathReceived(result.path);
        }
        const encoded = result.routes?.[0]?.overview_polyline;
        if (encoded && onPolylineReceived) onPolylineReceived(encoded);
      } catch (err) {
        console.warn('[LiveMap] Route unavailable, will retry:', err?.message || err);
        if (cancelled) return;
        lastRouteFailureAtRef.current = Date.now();
        setRouteError(true);
      } finally {
        routeFetchInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isLoaded,
    parsedRiderLocation?.lat,
    parsedRiderLocation?.lng,
    targetLocation?.lat,
    targetLocation?.lng,
    routeThrottleMs,
    lastDirectionsAt,
    directions,
    onPathReceived,
    onPolylineReceived,
  ]);

  useEffect(() => {
    if (directions && onPathReceived) {
      const path = directions.path || directions.routes?.[0]?.overview_path;
      if (path && Array.isArray(path)) {
        const simplePath = path.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : (p.lat ?? p.latitude),
          lng: typeof p.lng === 'function' ? p.lng() : (p.lng ?? p.longitude)
        }));
        onPathReceived(simplePath);
      }
    }
  }, [directions, onPathReceived]);

  useEffect(() => {
    (async () => {
      try {
        const response = await zoneAPI.getPublicZones();
        if (response?.data?.success && response.data.data?.zones) {
          const formattedZones = response.data.data.zones.map(zone => ({
            ...zone,
            paths: (zone.coordinates || []).map(coord => ({ lat: coord.latitude, lng: coord.longitude }))
          })).filter(z => z.paths.length >= 3);
          setZones(formattedZones);
        }
      } catch (err) {}
    })();
  }, []);

  const restaurantMarkerUrl = '/assets/images/cutlery_icon.webp';

  const customerMarkerUrl = useMemo(
    () => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`,
    [],
  );

  const lastCenteredPosRef = useRef(null);
  const framedTripKeyRef = useRef(null);

  // Re-frame map only when the focused order or trip phase changes — never on poll/GPS ticks
  useEffect(() => {
    framedTripKeyRef.current = null;
  }, [activeOrder?._id, tripStatus]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    const hasAnchors = restaurantPoint || customerPoint;
    if (!hasAnchors && !parsedRiderLocation) return;

    const frameKey = `${activeOrder?._id || 'none'}:${tripStatus || 'idle'}`;
    if (framedTripKeyRef.current === frameKey) return;

    const bounds = new window.google.maps.LatLngBounds();
    if (restaurantPoint) bounds.extend(restaurantPoint);
    if (customerPoint) bounds.extend(customerPoint);
    if (parsedRiderLocation) bounds.extend(parsedRiderLocation);

    map.fitBounds(bounds, { top: 70, right: 70, bottom: 120, left: 70 });
    framedTripKeyRef.current = frameKey;

    if (parsedRiderLocation) {
      lastCenteredPosRef.current = parsedRiderLocation;
    }
  }, [map, parsedRiderLocation, restaurantPoint, customerPoint, activeOrder?._id, tripStatus]);

  const remainingPath = useMemo(() => {
    if (!directions || !parsedRiderLocation || !window.google?.maps) return [];
    
    const fullPath = directions.path || directions.routes?.[0]?.overview_path;
    if (!fullPath || !Array.isArray(fullPath) || fullPath.length === 0) return [];

    let closestIndex = 0;
    let minDistance = Infinity;
    const riderLatLng = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);

    for (let i = 0; i < fullPath.length; i++) {
      const p = fullPath[i];
      const pLat = typeof p.lat === 'function' ? p.lat() : (p.lat ?? p.latitude);
      const pLng = typeof p.lng === 'function' ? p.lng() : (p.lng ?? p.longitude);
      const ptLatLng = new window.google.maps.LatLng(pLat, pLng);
      const distance = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, ptLatLng);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    let startIndex = closestIndex;
    if (closestIndex < fullPath.length - 1) {
      const p1 = fullPath[closestIndex];
      const p2 = fullPath[closestIndex + 1];
      const p1Lat = typeof p1.lat === 'function' ? p1.lat() : (p1.lat ?? p1.latitude);
      const p1Lng = typeof p1.lng === 'function' ? p1.lng() : (p1.lng ?? p1.longitude);
      const p2Lat = typeof p2.lat === 'function' ? p2.lat() : (p2.lat ?? p2.latitude);
      const p2Lng = typeof p2.lng === 'function' ? p2.lng() : (p2.lng ?? p2.longitude);

      const p1LatLng = new window.google.maps.LatLng(p1Lat, p1Lng);
      const p2LatLng = new window.google.maps.LatLng(p2Lat, p2Lng);
      const distToCurrent = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, p1LatLng);
      const distToNext = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, p2LatLng);
      const segmentLen = window.google.maps.geometry.spherical.computeDistanceBetween(p1LatLng, p2LatLng);
      
      if (distToNext < segmentLen && distToNext < distToCurrent) {
        startIndex = closestIndex + 1;
      }
    }

    const riderPoint = { lat: parsedRiderLocation.lat, lng: parsedRiderLocation.lng };
    const toObj = (p) => ({
      lat: typeof p.lat === 'function' ? p.lat() : (p.lat ?? p.latitude),
      lng: typeof p.lng === 'function' ? p.lng() : (p.lng ?? p.longitude)
    });

    return [riderPoint, ...fullPath.slice(startIndex).map(toObj)];
  }, [directions, parsedRiderLocation]);

  useEffect(() => {
    if (!directions || !parsedRiderLocation || !window.google?.maps?.geometry) return;
    const fullPath = directions.path || directions.routes?.[0]?.overview_path || [];
    if (remainingPath.length < 2 || fullPath.length < 2) return;

    // Distance from the rider to the nearest point of the remaining route.
    const nearest = remainingPath[1];
    const offBy = distanceBetweenMeters(parsedRiderLocation, nearest);
    if (offBy > OFF_ROUTE_METERS && targetLocation && distanceBetweenMeters(parsedRiderLocation, targetLocation) > OFF_ROUTE_METERS) {
      offRouteRef.current = true;
    }

    if (!onRouteProgress) return;
    const remainingMeters = pathLengthMeters(remainingPath);
    const totalMeters = Number.isFinite(directions.distanceMeters) && directions.distanceMeters > 0
      ? directions.distanceMeters
      : pathLengthMeters(fullPath);
    const etaSeconds = Number.isFinite(directions.durationSeconds) && totalMeters > 0
      ? directions.durationSeconds * Math.min(1, remainingMeters / totalMeters)
      : null;
    onRouteProgress({ remainingMeters, etaSeconds });
  }, [directions, remainingPath, parsedRiderLocation, targetLocation, onRouteProgress]);

  const showRestaurantMarker = useMemo(() => {
    if (!restaurantPoint) return false;
    // Pickup phase only — don't clutter with restaurant pin after pickup
    if (tripStatus !== 'PICKING_UP' && tripStatus !== 'REACHED_PICKUP') return false;
    if (!parsedRiderLocation) return true;
    return distanceBetweenMeters(parsedRiderLocation, restaurantPoint) > MARKER_OVERLAP_HIDE_METERS;
  }, [restaurantPoint, parsedRiderLocation, tripStatus]);

  const showCustomerMarker = useMemo(() => {
    if (!customerPoint) return false;
    // Drop phase only — green pin is customer destination, not shown while going to restaurant
    if (tripStatus !== 'PICKED_UP' && tripStatus !== 'REACHED_DROP') return false;
    if (!parsedRiderLocation) return true;
    return distanceBetweenMeters(parsedRiderLocation, customerPoint) > MARKER_OVERLAP_HIDE_METERS;
  }, [customerPoint, parsedRiderLocation, tripStatus]);

  // Keep center prop stable so GPS / poll updates never call map.setCenter and fight manual pan/zoom
  const seedCenterRef = useRef(null);
  if (!seedCenterRef.current && (parsedRiderLocation || targetLocation)) {
    seedCenterRef.current = parsedRiderLocation || targetLocation;
  }
  // Until a real position exists, show India at country zoom instead of a made-up city.
  const initialCenter = seedCenterRef.current || { lat: 20.5937, lng: 78.9629 };

  // Once the first real fix arrives, move to it (only once) and zoom in to neighborhood view.
  const centeredOnFirstFixRef = useRef(false);
  useEffect(() => {
    if (!map || !parsedRiderLocation) return;
    if (!centeredOnFirstFixRef.current) {
      centeredOnFirstFixRef.current = true;
      if (!activeOrder) {
        map.panTo(parsedRiderLocation);
        map.setZoom(13.5);
      }
    }
  }, [map, parsedRiderLocation, activeOrder]);

  if (loadError) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-red-500 font-bold">Map Load Error</div>;
  if (!isLoaded) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="absolute inset-0 z-0 text-gray-900 overflow-hidden flex flex-col">
      <GoogleMap
        onLoad={handleMapLoad}
        mapContainerStyle={mapContainerStyle}
        center={initialCenter}
        zoom={seedCenterRef.current ? zoom : 5}
        heading={activeMarkerLocation?.heading || 0}
        tilt={45}
        onClick={(e) => onMapClick?.(e.latLng.lat(), e.latLng.lng())}
        options={mapOptions}
      >
        {/* Single active route line (no separate traveled + remaining double polyline) */}
        {remainingPath.length > 0 && (
          <Polyline 
            path={remainingPath} 
            options={{ 
              strokeColor: '#3b82f6', 
              strokeOpacity: 0.9, 
              strokeWeight: 8, 
              zIndex: 12 
            }} 
          />
        )}

        {showRestaurantMarker && (
          <Marker
            position={restaurantPoint}
            zIndex={DESTINATION_MARKER_Z_INDEX}
            icon={{
              url: restaurantMarkerUrl,
              scaledSize: new window.google.maps.Size(48, 48),
              anchor: new window.google.maps.Point(24, 48),
            }}
          />
        )}

        {showCustomerMarker && (
          <Marker
            position={customerPoint}
            zIndex={DESTINATION_MARKER_Z_INDEX}
            icon={{
              url: customerMarkerUrl,
              scaledSize: new window.google.maps.Size(44, 44),
              anchor: new window.google.maps.Point(22, 44),
            }}
          />
        )}

        {activeMarkerLocation && (
          <OverlayView
            position={activeMarkerLocation}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div
              style={{
                // Bottom-center anchor: bike sits on the GPS point; destination pin can sit above it
                transform: `translate(-50%, -88%) rotate(${activeMarkerLocation.heading || 0}deg)`,
                zIndex: 999,
                position: 'relative',
                pointerEvents: 'none',
              }}
              className="relative w-[72px] h-[72px]"
            >
              <img src="/assets/images/MapRider.png" alt="Rider" className="w-full h-full object-contain drop-shadow-md" />
            </div>
          </OverlayView>
        )}

        {zones.map((zone) => (
          <Polygon key={zone._id} paths={zone.paths} options={{ fillColor: "#22c55e", fillOpacity: 0.03, strokeColor: "#22c55e", strokeOpacity: 0.1, strokeWeight: 1, zIndex: 1 }} />
        ))}
      </GoogleMap>

      {(gpsError || (routeError && targetLocation)) && (
        <div className="absolute left-3 right-3 top-[132px] z-[110] pointer-events-none flex justify-center">
          <div className={`max-w-md w-full rounded-xl px-3 py-2 text-[11px] font-semibold shadow-lg ${gpsError?.kind === 'permission_denied' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
            {gpsError ? (
              <>
                <p>{gpsError.title}</p>
                {gpsError.description && <p className="font-normal opacity-90">{gpsError.description}</p>}
              </>
            ) : (
              <p>Route unavailable right now — retrying…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveMap;
