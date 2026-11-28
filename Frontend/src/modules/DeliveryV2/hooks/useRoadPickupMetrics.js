import { useEffect, useState } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { computeDrivingRoute } from '@food/utils/drivingRoute';
import { DELIVERY_MAPS_LOADER_OPTIONS } from '@/modules/DeliveryV2/utils/mapsLoaderOptions';
import { parseLatLng } from '@/modules/DeliveryV2/utils/geo';
import {
  computePickupMetrics,
  getOrderRestaurantLatLng,
  PICKUP_METRICS_SOURCE,
} from '@/modules/DeliveryV2/utils/pickupMetrics';

// One route request per ~110 m of rider movement, shared by every card showing the same trip.
const routeCache = new Map();
const keyOf = (point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;

function getRoute(key, origin, destination) {
  if (!routeCache.has(key)) {
    routeCache.set(
      key,
      computeDrivingRoute(origin, destination).catch((error) => {
        routeCache.delete(key);
        throw error;
      }),
    );
  }
  return routeCache.get(key);
}

/**
 * Pickup distance and time for a new-order card, measured by road (rider to
 * restaurant) so it matches what the rider sees on the map. When no road route
 * can be fetched the straight-line figure is shown, flagged `approximate`.
 */
export function useRoadPickupMetrics(order, riderLocation) {
  const { isLoaded, loadError } = useJsApiLoader(DELIVERY_MAPS_LOADER_OPTIONS);
  const [route, setRoute] = useState(null);

  const base = computePickupMetrics(order, riderLocation);
  const rider = parseLatLng(riderLocation);
  const restaurant = getOrderRestaurantLatLng(order);
  const canRoute = Boolean(rider && restaurant) && base.source === PICKUP_METRICS_SOURCE.GPS;
  const destinationKey = restaurant ? keyOf(restaurant) : '';
  const routeKey = canRoute ? `${keyOf(rider)}>${destinationKey}` : '';

  useEffect(() => {
    if (!routeKey || !isLoaded) return undefined;
    let cancelled = false;
    getRoute(routeKey, rider, restaurant)
      .then((result) => {
        if (cancelled) return;
        const meters = Number(result?.distanceMeters);
        setRoute({
          destinationKey,
          meters: Number.isFinite(meters) && meters >= 0 ? meters : null,
          seconds: Number(result?.durationSeconds) || null,
        });
      })
      .catch(() => {
        if (!cancelled) setRoute({ destinationKey, meters: null, seconds: null });
      });
    return () => {
      cancelled = true;
    };
    // rider and restaurant are fully described by routeKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, isLoaded]);

  if (!base.isReady) return base;
  if (!canRoute || loadError) return { ...base, approximate: true };
  // While the rider moves, the previous route to this restaurant stays on screen.
  if (!route || route.destinationKey !== destinationKey) {
    return { ...base, isReady: false, distanceKm: null, etaMins: null };
  }
  if (route.meters === null) return { ...base, approximate: true };

  const prepBuffer = Number(order?.prepTime || order?.preparationTime || 5);
  const travelMins = route.seconds ? route.seconds / 60 : route.meters / 416; // ~25 km/h
  return {
    ...base,
    distanceKm: Number((route.meters / 1000).toFixed(1)),
    etaMins: Math.max(1, Math.ceil(travelMins) + prepBuffer),
    approximate: false,
  };
}
